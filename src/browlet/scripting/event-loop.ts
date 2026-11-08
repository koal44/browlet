import { InternalError, type TaskRecord } from '../../infra/index';
import { bindAsyncContext, createMicrotaskQueue, type JSMicrotaskQueue } from '../../js-engine/index';
import { Duration, monotonicClock, unsafeSharedCurrentTime, UnsafeMoment } from '../../timing/index';

import type { DocumentImpl } from '../dom/nodes/index';
import type { WindowImpl } from '../browsing/window/index';
import type { BrowletEnvironment } from '../environment/index';
import type { WorkerGlobalImpl } from '../workers/index';

import { DedicatedWorkerAgent, SharedWorkerAgent, ServiceWorkerAgent, WindowAgent, type Agent } from './agents';
import { JSExecutionContext } from './execution-context';
import type { BrowletRealm } from './realm';
import { JSScriptOrModule, type Script } from './script';

// Task-source/queue associations stay private so scheduling can coalesce
// sources without changing callers.
/** Runs an agent's HTML tasks and coordinates its microtask checkpoints. */
// https://html.spec.whatwg.org/multipage/webappapis.html#event-loops
export class EventLoop {
  /** Owning Agent, or null until Agent construction attaches this loop. */
  agent: Agent | null = null;
  /** Engine queue shared by this Agent's realms, using the selected backend. */
  microtaskQueue: JSMicrotaskQueue;
  /** Most recent rendering opportunity reported by the host. */
  lastRenderOpportunityTime = new UnsafeMoment(monotonicClock, 0);
  /** Shared timestamp at the start of the latest Window idle period. */
  lastIdlePeriodStartTime = new UnsafeMoment(monotonicClock, 0);
  /** Explicit context stack for this loop's agent, including retained realm contexts. */
  executionContextStack: JSExecutionContext[] = [];
  /** Incumbent environments retained across host callback entry. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#backup-incumbent-settings-object-stack
  backupIncumbentEnvironmentStack: BrowletEnvironment[] = [];
  /** Nesting of beforeunload/unload dispatch, used to suppress Window.open(). */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#termination-nesting-level
  // Beforeunload maintains this counter; TODO(HTML §7.5.9): also bracket document unloading.
  terminationNestingLevel = 0;
  // Task association belongs to each entry, not the retained context reused by nested entries.
  #scriptEntryTasks: (Task | null)[] = [];
  #currentlyRunningTask: Task | null = null;
  #runningTaskTurn = false;
  #paused = false;
  /** A destroyed worker loop never resumes task or microtask processing. */
  #destroyed = false;
  #performingMicrotaskCheckpoint = false;
  /** Work arriving outside an HTML task needs a host checkpoint wake-up. */
  #microtaskCheckpointRequested = false;
  /** A registration or period deadline needs one idle scheduling opportunity. */
  #idlePeriodRequested = false;
  #init: EventLoopInit;
  #turnRequested = false;
  #taskQueues = new Set<Set<Task>>();
  #taskQueueBySource = new Map<TaskSource, Set<Task>>();
  // Notifying an environment with an empty pending list is a no-op. Retain only
  // environments needing this checkpoint, rather than every environment forever.
  #rejectedPromiseEnvironments = new Set<BrowletEnvironment>();

  /** Retain host scheduling and accounting dependencies for the loop's lifetime. */
  constructor(init: EventLoopInit) {
    this.#init = init;
    this.microtaskQueue = createMicrotaskQueue(() => { this.requestMicrotaskCheckpoint(); });
  }

  /** Task executing on this loop, or null outside task execution. */
  get currentlyRunningTask(): Task | null {
    return this.#currentlyRunningTask;
  }

  /** Whether this loop is executing a task or its microtask checkpoint. */
  get isRunningTaskOrCheckpoint(): boolean {
    // Backends without Promise-job hooks cannot install a Task for each native job.
    // The owning checkpoint still establishes which loop is executing the work.
    return this.#currentlyRunningTask !== null || this.#performingMicrotaskCheckpoint;
  }

  /** The currently running context, or null outside modeled JavaScript execution. */
  get runningExecutionContext(): JSExecutionContext | null {
    return this.executionContextStack.at(-1) ?? null;
  }

  /** The most recently pushed retained realm context. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#entry-execution-context
  get entryExecutionContext(): JSExecutionContext {
    const context = this.executionContextStack.findLast((entry) => entry === entry.realm.executionContext);
    if (context === undefined) throw new InternalError('There is no entry execution context');
    return context;
  }

  /** The topmost context with a non-null ScriptOrModule, irrespective of its skip counter. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#topmost-script-having-execution-context
  get topmostScriptHavingExecutionContext(): JSExecutionContext | null {
    return this.executionContextStack.findLast((context) => context.scriptOrModule !== null) ?? null;
  }

  /** Latest modeled script or native incumbent observation; callback skipping applies to either. */
  private get incumbentExecutionContext(): JSExecutionContext | null {
    return this.executionContextStack.findLast((context) =>
      context.scriptOrModule !== null || context.incumbentEnv !== null,
    ) ?? null;
  }

  /** The HTML script of the topmost ScriptOrModule, independently of incumbent skipping. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#active-script
  get activeScript(): Script | null {
    // GetActiveScriptOrModule selects the same topmost non-null record in our modeled stack.
    const record = this.topmostScriptHavingExecutionContext?.scriptOrModule ?? null;
    return record === null ? null : record.script;
  }

  /** The HTML script in the running context; do not search through lower frames. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#running-script
  get runningScript(): Script | null {
    return this.runningExecutionContext?.scriptOrModule?.script ?? null;
  }

  hasRunnableTasks(exceptSource?: TaskSource): boolean {
    for (const queue of this.#taskQueues) {
      for (const task of queue) {
        if (task.source !== exceptSource && task.isRunnable) return true;
      }
    }
    return false;
  }

  /** Wake once for a new idle registration or the end of its preceding period. */
  requestIdlePeriod(): void {
    this.#idlePeriodRequested = true;
    this.#requestTurnIfNeeded();
  }

  /** Run one eligible task and its checkpoint; return false when none is runnable. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model
  runTaskTurn(): boolean {
    if (this.#destroyed || this.#paused) return false;
    const init = this.#init;
    if (this.#runningTaskTurn || this.#currentlyRunningTask !== null) {
      throw new InternalError('An event loop cannot run a task reentrantly');
    }

    const runnableTaskQueues = [...this.#taskQueues]
      .filter((queue) =>
        findFirstRunnableTask(queue) !== undefined,
      );
    if (runnableTaskQueues.length === 0) {
      this.#startIdlePeriod();
      this.#finishWorkerTurn();
      return false;
    }

    const selectedTaskQueueView = (
      init.selectTaskQueue ?? selectFirstTaskQueue
    )(
      runnableTaskQueues,
    );
    const selectedTaskQueue = runnableTaskQueues.find(
      (taskQueue) => taskQueue === selectedTaskQueueView,
    );
    if (selectedTaskQueue === undefined) {
      throw new InternalError('Task queue selector returned an unavailable queue');
    }

    const taskStartTime = unsafeSharedCurrentTime();
    const oldestTask = findFirstRunnableTask(selectedTaskQueue);
    if (oldestTask === undefined) {
      throw new InternalError('Selected task queue has no runnable task');
    }

    selectedTaskQueue.delete(oldestTask);
    if (oldestTask.document !== null) {
      init.taskTiming?.recordTaskStartTime(
        taskStartTime,
        oldestTask.document,
      );
    }

    let taskError: { value: unknown; } | null = null;
    this.#runningTaskTurn = true;
    this.#currentlyRunningTask = oldestTask;
    try {
      oldestTask.run();
    } catch (error) {
      taskError = { value: error };
    } finally {
      this.#currentlyRunningTask = null;
      try { this.performMicrotaskCheckpoint(); }
      finally { this.#runningTaskTurn = false; }
    }

    const taskEndTime = unsafeSharedCurrentTime();
    init.longTaskReporter?.reportLongTasks(
      taskStartTime,
      taskEndTime,
      oldestTask,
    );
    if (oldestTask.document !== null) {
      init.taskTiming?.recordTaskEndTime(
        taskEndTime,
        oldestTask.document,
      );
    }
    this.#startIdlePeriod();
    this.#finishWorkerTurn();
    if (taskError !== null) throw taskError.value;
    return true;
  }

  /** Find the incumbent for Binding and callback lifecycle code; API implementations receive it explicitly. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#incumbent-settings-object
  getIncumbentEnvironment(): BrowletEnvironment {
    const context = this.incumbentExecutionContext;
    if (
      context !== null &&
      context.skipWhenDeterminingIncumbent === 0
    ) {
      return context.incumbentEnv ?? context.realm.env;
    }

    const backup = this.backupIncumbentEnvironmentStack.at(-1);
    if (backup !== undefined) return backup;
    throw new InternalError('The backup incumbent settings stack is empty');
  }

  /** Scope a native entry observation; retained HTML entry and ScriptOrModule selection stay unchanged. */
  runPlatformCall<Result>(realm: BrowletRealm, incumbentEnv: BrowletEnvironment, steps: () => Result): Result {
    const context = new JSExecutionContext({ realm, incumbentEnv });
    this.executionContextStack.push(context);
    try { return steps(); }
    finally { this.#popExecutionContext(context); }
  }

  /** Push the callback environment and hide the active script from incumbent selection. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#prepare-to-run-a-callback
  prepareToRunCallback(env: BrowletEnvironment): void {
    if (env.responsibleEventLoop !== this) {
      throw new InternalError('A callback context belongs to another event loop');
    }

    this.backupIncumbentEnvironmentStack.push(env);
    const context = this.incumbentExecutionContext;
    if (context !== null) context.skipWhenDeterminingIncumbent++;
  }

  /** Restore incumbent selection after the matching callback entry. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-a-callback
  cleanUpAfterRunningCallback(env: BrowletEnvironment): void {
    const context = this.incumbentExecutionContext;
    if (context !== null) {
      if (context.skipWhenDeterminingIncumbent === 0) {
        throw new InternalError('A callback incumbent counter is already zero');
      }
      context.skipWhenDeterminingIncumbent--;
    }

    if (this.backupIncumbentEnvironmentStack.at(-1) !== env) {
      throw new InternalError('Callback environments were cleaned up out of order');
    }
    this.backupIncumbentEnvironmentStack.pop();
  }

  /** Enter script execution with this environment and the current task. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#prepare-to-run-script
  prepareToRunScript(env: BrowletEnvironment): void {
    if (env.responsibleEventLoop !== this) {
      throw new InternalError('Script settings belong to another event loop');
    }

    const task = this.#currentlyRunningTask;
    // ACCOMMODATION(node-v8-execution-contexts):
    // HTML §§8.1.4.4 and 8.1.6.6.4 expect an engine-owned Promise job to have
    // installed its microtask task before this point. The custom engine's
    // Promise hook does so. Unsupported engines and uncontrolled host entries
    // still need a nullable task; do not infer that V8's unseen stack is empty.
    this.executionContextStack.push(env.realmExecutionContext);
    this.#scriptEntryTasks.push(task);
    task?.scriptEvaluationEnvironments.add(env);
  }

  /** Leave script execution and checkpoint when the execution stack becomes empty. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script
  cleanUpAfterRunningScript(env: BrowletEnvironment): void {
    // TODO(HTML §8.1.4.5, deferred): Coordinate with a future termination boundary.
    // These checks assume normal unwinding; clearing only the modeled stack
    // would leave the actual script running and make this cleanup fail.
    const entry = this.runningExecutionContext;
    if (entry !== env.realmExecutionContext) {
      throw new InternalError('Script settings were cleaned up out of order');
    }
    this.executionContextStack.pop();
    const task = this.#scriptEntryTasks.pop();
    if (task === undefined) throw new InternalError('Script settings have no matching preparation');

    // ACCOMMODATION(node-v8-execution-contexts): A checkpoint clears the current
    // task even while its outer task turn continues. Later callbacks in that
    // turn still have a controlled entry; unrelated engine entries do not.
    if (
      (task !== null || this.#runningTaskTurn) &&
      this.executionContextStack.length === 0
    ) {
      this.performMicrotaskCheckpoint();
    }
  }

  // HTML §§8.1.3.2 and 8.1.4.4 — Browlet-controlled ScriptEvaluation entry.
  // TODO(HTML §8.1.4): Receive the complete Script/Module record from script processing.
  // The record below has no HTML script until the creating/calling algorithms supply one.
  // ACCOMMODATION(node-v8-execution-contexts): Direct embedder entry receives
  // a temporary task because Node exposes no surrounding execution context.
  runScriptEvaluation<Result>(
    env: BrowletEnvironment,
    steps: () => Result,
  ): Result {
    const hostEntryTask = this.#currentlyRunningTask === null
      ? new Task(hostEntryTaskSource, null, { run: () => {} })
      : null;
    if (hostEntryTask !== null) this.#currentlyRunningTask = hostEntryTask;

    try {
      this.prepareToRunScript(env);
      const context = new JSExecutionContext({
        realm: env.realm, scriptOrModule: new JSScriptOrModule(env.realm, null),
      });
      this.executionContextStack.push(context);
      try {
        return steps();
      } finally {
        this.#popExecutionContext(context);
        this.cleanUpAfterRunningScript(env);
      }
    } finally {
      if (hostEntryTask !== null) {
        this.#finishHostScriptEntry(hostEntryTask);
      }
    }
  }

  /**
   * Suspend a continuation-based algorithm until its parallel wait calls ready.
   * The caller must return immediately and move all remaining steps, including
   * paired script/callback cleanup, into continuation. This does not suspend an
   * arbitrary author function or a caller's synchronous try/finally scope.
   */
  // https://html.spec.whatwg.org/multipage/webappapis.html#spin-the-event-loop
  spinUntil(waitForGoal: (ready: () => void) => void, continuation: () => void): void {
    const task = this.#currentlyRunningTask;
    if (task === null) throw new InternalError('Spinning the event loop requires a running task');

    const resume = bindAsyncContext(continuation);
    const oldStack = this.executionContextStack;
    // The modeled entries' task links and callback backups must travel with
    // them, rather than become the bookkeeping of another task while waiting.
    const oldScriptEntryTasks = this.#scriptEntryTasks;
    const oldCallbackStack = this.backupIncumbentEnvironmentStack;
    this.executionContextStack = [];
    this.#scriptEntryTasks = [];
    this.backupIncumbentEnvironmentStack = [];
    try {
      // The existing guard makes this a no-op when a microtask spins.
      this.performMicrotaskCheckpoint();
    } catch (error) {
      this.executionContextStack = oldStack;
      this.#scriptEntryTasks = oldScriptEntryTasks;
      this.backupIncumbentEnvironmentStack = oldCallbackStack;
      throw error;
    }

    // A host turn runs the wait outside HTML task execution. The wait registers
    // its completion; it must not busy-wait or block the host thread.
    this.#init.requestTurn(() => {
      if (this.#destroyed) return;
      let queued = false;
      waitForGoal(() => {
        if (queued) return;
        queued = true;
        task.run = () => {
          const stack = this.executionContextStack;
          const scriptEntryTasks = this.#scriptEntryTasks;
          const callbackStack = this.backupIncumbentEnvironmentStack;
          this.executionContextStack = oldStack;
          this.#scriptEntryTasks = oldScriptEntryTasks;
          this.backupIncumbentEnvironmentStack = oldCallbackStack;
          try { resume(); }
          finally {
            this.executionContextStack = stack;
            this.#scriptEntryTasks = scriptEntryTasks;
            this.backupIncumbentEnvironmentStack = callbackStack;
          }
        };
        // Requeue the suspended task, retaining its source, Document, script
        // evaluation environments, and other task metadata. A spun microtask
        // resumes here as an ordinary task, not on the engine microtask queue.
        this.#enqueueTask(task);
      });
    });
  }

  /**
   * Block the current task in a synchronous host wait, retaining its execution stack.
   * The caller supplies the current environment and a wait that returns only when
   * its goal is met. The wait must not run author code or depend on this thread's
   * queued callbacks; a Promise or asynchronous wait cannot satisfy this contract.
   */
  // https://html.spec.whatwg.org/multipage/webappapis.html#pause
  pauseUntil(waitForGoal: () => undefined, env: BrowletEnvironment): void {
    if (env.responsibleEventLoop !== this) {
      throw new InternalError('The current environment belongs to another event loop');
    }
    if (this.#currentlyRunningTask === null || this.#paused) {
      throw new InternalError('Pausing requires a running, unpaused task');
    }

    // Use the current global's environment across the host call. It need not
    // belong to the task's Document or the script used for performance attribution.
    const timeBeforePause = env.currentHighResolutionTime();
    this.#paused = true;
    try {
      // TODO(HTML pause step 3): A UI host must synchronously reflect pending
      // rendering/UI state where necessary. The headless host has no such UI.
      waitForGoal();
      const duration = new Duration(env.currentHighResolutionTime().milliseconds - timeBeforePause.milliseconds);
      // TODO(Long Animation Frames §3.2.2): Supply record-pause-duration when
      // Document frame timing and pending-script records have an implementation.
      this.#init.taskTiming?.recordPauseDuration?.(duration, this.runningScript);
    } finally {
      this.#paused = false;
      this.#requestTurnIfNeeded();
    }
  }

  /** Conditional checkpoint at a Browlet-controlled parser entry. */
  performMicrotaskCheckpointIfStackEmpty(): void {
    if (this.executionContextStack.length === 0) {
      this.performMicrotaskCheckpoint();
    }
  }

  /** Drain the shared queue, then schedule notifications for pending rejections. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint
  performMicrotaskCheckpoint(): void {
    if (this.#destroyed || this.#paused || this.#performingMicrotaskCheckpoint) return;

    this.#microtaskCheckpointRequested = false;
    this.#performingMicrotaskCheckpoint = true;
    try {
      this.microtaskQueue.performMicrotaskCheckpoint();

      if (this.#rejectedPromiseEnvironments.size !== 0) {
        const rejectedPromiseEnvironments = this.#rejectedPromiseEnvironments;
        this.#rejectedPromiseEnvironments = new Set();
        for (const env of rejectedPromiseEnvironments) env.notifyAboutRejectedPromises();
      }

      // TODO(IndexedDB §2.7.1): Deactivate transactions whose cleanup event loop
      // is this loop and clear that association. Transaction state is not implemented.
      // https://w3c.github.io/IndexedDB/#cleanup-indexed-database-transactions
      // Native checkpoints already clear kept objects; review ordering and isolation
      // with those consumers (EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint).
    } finally {
      this.#performingMicrotaskCheckpoint = false;
    }

    // TODO(Long Animation Frames §3.2.2): Finish pending scripts for Documents
    // on this loop. Document frame timing and pending-script entries are missing.
    // https://w3c.github.io/long-animation-frames/#record-timing-info-for-microtask-checkpoint
  }

  /** Include this environment's pending rejections in the next checkpoint. */
  scheduleRejectedPromiseNotification(env: BrowletEnvironment): void {
    if (this.#destroyed) return;
    this.#rejectedPromiseEnvironments.add(env);
  }

  /** Queue internal steps; the Document is metadata, not a fully-active delivery gate. */
  queueMicrotask(
    steps: () => void,
    document: DocumentImpl | null = null,
  ): void {
    if (this.#destroyed) return;
    const microtask = new Task(
      microtaskTaskSource,
      document,
      { run: steps },
    );

    this.microtaskQueue.enqueueMicrotask(() => {
      // https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint
      // Suppress nested checkpoints requested by scripted callbacks.
      const wasPerformingMicrotaskCheckpoint =
        this.#performingMicrotaskCheckpoint;
      this.#performingMicrotaskCheckpoint = true;
      this.#currentlyRunningTask = microtask;
      try {
        microtask.run();
      } finally {
        this.#currentlyRunningTask = null;
        this.#performingMicrotaskCheckpoint =
          wasPerformingMicrotaskCheckpoint;
      }
    });

    this.requestMicrotaskCheckpoint();
  }

  /** Coalesce external wake-ups; an executing task or checkpoint already drains this queue. */
  requestMicrotaskCheckpoint(): void {
    if (this.#destroyed) return;
    // Used both by parallel algorithms reaching a stable state and by native
    // cleanup completion. Notify the same host turn; do not add a dummy job.
    if (
      this.#currentlyRunningTask === null &&
      !this.#runningTaskTurn &&
      !this.#performingMicrotaskCheckpoint
    ) {
      this.#microtaskCheckpointRequested = true;
      this.#requestTurnIfNeeded();
    }
  }

  queueTask(
    source: TaskSource,
    document: DocumentImpl | null,
    task: TaskRecord,
  ): Task {
    // Keep HTML's otherwise implied destination and Document explicit.
    const queuedTask = new Task(source, document, task);
    this.#enqueueTask(queuedTask);
    return queuedTask;
  }

  removeTask(task: Task): boolean {
    if (!this.#getTaskQueue(task.source).delete(task)) return false;
    task.discard?.();
    return true;
  }

  /** Discard queued tasks associated with a document, across all task sources. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document
  removeTasksForDocument(document: DocumentImpl): void {
    this.#removeTasks((task) => task.document === document);
  }

  /** Remove every queued task, notifying its internal owner without running task steps. */
  removeAllTasks(): void {
    this.#removeTasks(() => true);
  }

  notifyTaskRunnabilityChanged(): void {
    // Reactivation may make retained idle registrations eligible without a task.
    if (this.agent instanceof WindowAgent) {
      for (const window of this.agent.windowObjects) {
        if (window.idleCallbacks.hasPending) {
          this.#idlePeriodRequested = true;
          break;
        }
      }
    }
    this.#requestTurnIfNeeded();
  }

  getTaskQueue(source: TaskSource): Set<Task> {
    return this.#getTaskQueue(source);
  }

  getTaskQueues(): Set<Set<Task>> {
    return this.#taskQueues;
  }

  #removeTasks(matches: (task: Task) => boolean): void {
    const discarded: Task[] = [];
    for (const queue of this.#taskQueues) {
      for (const task of queue) {
        if (matches(task)) {
          queue.delete(task);
          discarded.push(task);
        }
      }
    }
    // Detach the whole batch before notifying waiting owners, including reentrant removal.
    // A failed notification must not leave another removed task's owner waiting forever.
    let failure: { error: unknown; } | undefined;
    for (const task of discarded) {
      try { task.discard?.(); }
      catch (error) { failure ??= { error }; }
    }
    if (failure !== undefined) throw failure.error;
  }

  /** Admit new and resumed tasks through the same worker-closing rule. */
  #enqueueTask(task: Task): void {
    if (this.#destroyed) { task.discard?.(); return; }
    // HTML §10.2.2: closing workers discard new tasks from every source.
    // Unqueued cancellation handles still report removal as false.
    const agent = this.agent;
    if ((agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent || agent instanceof ServiceWorkerAgent) &&
      agent.globalScope?.closing === true) { task.discard?.(); return; }
    this.#getTaskQueue(task.source).add(task);
    this.#requestTurnIfNeeded();
  }

  /** Select a closing dedicated/shared worker only once every task queue is empty. */
  #getWorkerReadyToFinish(): WorkerGlobalImpl | null {
    const agent = this.agent;
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) return null;
    const global = agent.globalScope;
    if (global?.closing !== true) return null;
    for (const queue of this.#taskQueues) {
      if (queue.size !== 0) return null;
    }
    return global;
  }

  /** Resume run-a-worker cleanup after the final task and its microtasks have finished. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model
  #finishWorkerTurn(): void {
    if (this.#destroyed || this.#microtaskCheckpointRequested) return;
    // TODO(HTML §8.1.7.3): A worker rendering-opportunity producer must check the
    // dedicated global's isAnimationFrameProviderSupported(), pass its current
    // high-resolution time to animationFrameController.runCallbacks(), then update
    // worker rendering. Display/OffscreenCanvas production is not connected here.
    const global = this.#getWorkerReadyToFinish();
    if (global === null) return;
    this.#destroyed = true;
    this.#rejectedPromiseEnvironments.clear();
    try { global.finishRunning(); }
    finally { this.#init.onWorkerFinish?.(); }
    // Service Worker shutdown belongs to its own processing model.
  }

  /** Offer idle work a live deadline only after runnable tasks have drained. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#idle-deadline-computation
  #startIdlePeriod(): void {
    this.#idlePeriodRequested = false;
    const agent = this.agent;
    if (!(agent instanceof WindowAgent) || this.hasRunnableTasks()) return;

    const startTime = this.lastIdlePeriodStartTime = unsafeSharedCurrentTime();
    // The headless runtime has no frame producer. A rendering host must supply
    // animation-frame/pending-render state and refresh rate when it is connected.
    const rendering = this.#init.idleRendering;

    const computeDeadline = (): UnsafeMoment => {
      let deadline = startTime.milliseconds + 50;
      let hasPendingRenders = false;
      for (const window of agent.windowObjects) {
        if (rendering?.hasPendingRenders(window)) hasPendingRenders = true;
        const { env } = window;
        const timerDeadline = window.getWindowOrWorkerGlobalScopeMixin().timers.getNextTimeoutDeadline();
        if (timerDeadline !== null) {
          // SPEC_CLASH(idle-timer-time-origin): HTML compares relative timer
          // timestamps with shared monotonic time. Translate by the owning
          // Window's origin before comparing; see ROADMAP.md's idle-period slice.
          deadline = Math.min(deadline, env.timeOrigin.addDuration(timerDeadline).milliseconds);
        }
      }
      if (hasPendingRenders && rendering !== undefined) {
        deadline = Math.min(deadline, this.lastRenderOpportunityTime.milliseconds + 1000 / rendering.getRefreshRate());
      }
      return new UnsafeMoment(monotonicClock, deadline);
    };

    for (const window of agent.windowObjects) {
      window.idleCallbacks.startIdlePeriod(() => computeDeadline().coarsen(window.env.crossOriginIsolatedCapability));
    }
  }

  #getTaskQueue(source: TaskSource): Set<Task> {
    let queue = this.#taskQueueBySource.get(source);
    if (queue === undefined) {
      queue = new Set();
      this.#taskQueueBySource.set(source, queue);
      this.#taskQueues.add(queue);
    }
    return queue;
  }

  #popExecutionContext(context: JSExecutionContext): void {
    if (this.runningExecutionContext !== context) {
      throw new InternalError('Execution contexts were cleaned up out of order');
    }
    this.executionContextStack.pop();
  }

  #finishHostScriptEntry(task: Task): void {
    if (
      this.#currentlyRunningTask !== null &&
      this.#currentlyRunningTask !== task
    ) {
      throw new InternalError('A host script entry left another task running');
    }
    this.#currentlyRunningTask = null;
  }

  #requestTurnIfNeeded(): void {
    if (
      this.#destroyed || this.#paused || this.#turnRequested ||
      (!this.#microtaskCheckpointRequested && !this.#idlePeriodRequested && !this.hasRunnableTasks() &&
        this.#getWorkerReadyToFinish() === null)
    ) return;

    this.#turnRequested = true;
    this.#init.requestTurn(() => {
      try {
        if (this.#destroyed || this.#paused) return;
        if (this.#microtaskCheckpointRequested) {
          this.performMicrotaskCheckpoint();
          this.#startIdlePeriod();
          this.#finishWorkerTurn();
        } else {
          this.runTaskTurn();
        }
      } finally {
        this.#turnRequested = false;
        this.#requestTurnIfNeeded();
      }
    });
  }
}

/** Fixed host and specification-subsystem dependencies supplied at construction. */
export type EventLoopInit = {
  /** Request a later host turn; never invoke the steps synchronously. */
  requestTurn: (this: void, steps: () => void) => void;
  /** Release the dedicated/shared worker's execution host after HTML cleanup, including failed cleanup. */
  onWorkerFinish?: (this: void) => void;
  selectTaskQueue?: TaskQueueSelector;
  longTaskReporter?: LongTaskReporter;
  taskTiming?: TaskTimingHooks;
  idleRendering?: WindowIdleRendering;
};

/** The rendering owner supplies predictions when frame production is connected. */
export type WindowIdleRendering = {
  /** True for queued animation-frame callbacks or the host's predicted rendering updates. */
  hasPendingRenders(this: void, window: WindowImpl): boolean;
  /** Current display refresh rate in hertz, used only when rendering is pending. */
  getRefreshRate(this: void): number;
};

export type TaskTimingHooks = {
  // Long Animation Frames editor's draft:
  // https://w3c.github.io/long-animation-frames/#record-task-start-time
  // https://w3c.github.io/long-animation-frames/#record-task-end-time
  recordTaskStartTime(
    this: void,
    startTime: UnsafeMoment,
    document: DocumentImpl,
  ): void;
  recordTaskEndTime(
    this: void,
    endTime: UnsafeMoment,
    document: DocumentImpl,
  ): void;
  // https://w3c.github.io/long-animation-frames/#record-pause-duration
  // The performance owner receives the running script explicitly, rather than
  // discovering the loop or its execution stack through ambient state.
  recordPauseDuration?(this: void, duration: Duration, script: Script | null): void;
};

export type LongTaskReporter = {
  // The eventual Long Tasks owner can derive top-level browsing contexts
  // from the task's script-evaluation settings set. Keep that unimplemented
  // subsystem behind this seam rather than manufacturing its result here.
  //
  // https://w3c.github.io/longtasks/#report-long-tasks
  reportLongTasks(
    this: void,
    startTime: UnsafeMoment,
    endTime: UnsafeMoment,
    task: Task,
  ): void;
};

export type TaskQueueSelector = (
  runnableTaskQueues: Set<Task>[],
) => Set<Task>;

/** Queued HTML work with source identity and document-activity gating. */
// https://html.spec.whatwg.org/multipage/webappapis.html#concept-task
export class Task {
  /** Document whose activity gates execution, or null for ungated work. */
  document: DocumentImpl | null;
  /** Environments whose scripts were evaluated while this task ran. */
  scriptEvaluationEnvironments = new Set<BrowletEnvironment>();
  /** Fixed source identity used to select the task's queue. */
  source: TaskSource;
  /** Algorithm steps executed when this task is selected. */
  run: () => void;
  /** Implementation-only completion for an owner whose queued task is removed. */
  discard?: () => void;
  /** Nesting level inherited by timer initialization inside this task. */
  timerNestingLevel?: number;
  /** Additional readiness condition supplied by the task's owner. */
  #isRunnable?: () => boolean;

  constructor(
    source: TaskSource,
    document: DocumentImpl | null,
    task: TaskRecord,
  ) {
    this.document = document;
    this.source = source;
    this.run = task.run;
    this.discard = task.discard;
    this.timerNestingLevel = task.timerNestingLevel;
    this.#isRunnable = task.isRunnable;
  }

  get isRunnable(): boolean {
    return (this.#isRunnable?.() ?? true) &&
      (this.document === null || this.document.isFullyActive());
  }
}

// A source is an opaque identity, not the queue itself. The diagnostic name
// does not participate in equality: two specifications can use the same name
// without accidentally serializing their tasks together.
export type TaskSource = { name: string; };

export function createTaskSource(name: string): TaskSource {
  return { name };
}

const microtaskTaskSource = createTaskSource('microtask');
const hostEntryTaskSource = createTaskSource('host script entry');

function findFirstRunnableTask(
  taskQueue: Set<Task>,
): Task | undefined {
  for (const task of taskQueue) {
    if (task.isRunnable) return task;
  }
  return undefined;
}

function selectFirstTaskQueue(
  runnableTaskQueues: Set<Task>[],
): Set<Task> {
  const [taskQueue] = runnableTaskQueues;
  if (taskQueue === undefined) {
    throw new InternalError('Cannot select from an empty set of task queues');
  }
  return taskQueue;
}
