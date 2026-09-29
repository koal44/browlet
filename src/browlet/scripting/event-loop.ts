import type { JSMicrotaskQueue } from '../../js-engine/index';
import type { DocumentImpl } from '../dom/nodes/document';
import type { UnsafeMoment } from '../performance/clock';
import type { Environment } from './environment';
import { InternalError } from '../../infra/internal-error';
import type { TaskCreationOptions } from '../../infra/execution';

// Task-source/queue associations stay private so scheduling can coalesce
// sources without changing callers.
/** Runs an agent's HTML tasks and coordinates its microtask checkpoints. */
// https://html.spec.whatwg.org/multipage/webappapis.html#event-loops
export class EventLoop {
  // https://html.spec.whatwg.org/multipage/webappapis.html#backup-incumbent-settings-object-stack
  #backupIncumbentSettingsObjectStack: Environment[] = [];
  #jsExecutionContextStack: TrackedExecutionContext[] = [];
  #currentlyRunningTask: Task | null = null;
  #runningTaskTurn = false;
  #lastRenderOpportunityTime: UnsafeMoment | null = null;
  #performingMicrotaskCheckpoint = false;
  #schedulingOptions: EventLoopOptions | null = null;
  #turnRequested = false;
  #taskQueues = new Set<Set<Task>>();
  #taskQueueBySource = new Map<TaskSource, Set<Task>>();

  constructor(public microtaskQueue: JSMicrotaskQueue) {}

  /** Task executing on this loop, or null outside task execution. */
  get currentlyRunningTask(): Task | null {
    return this.#currentlyRunningTask;
  }

  /** Most recent rendering opportunity reported by the host. */
  get lastRenderOpportunityTime(): UnsafeMoment | null {
    return this.#lastRenderOpportunityTime;
  }

  get started(): boolean {
    return this.#schedulingOptions !== null;
  }

  start(options: EventLoopOptions): void {
    if (this.#schedulingOptions !== null) {
      throw new InternalError('An event loop scheduler is already running');
    }

    this.#schedulingOptions = options;
    this.#requestTurnIfNeeded();
  }

  hasRunnableTasks(): boolean {
    return [...this.#taskQueues].some((queue) =>
      findFirstRunnableTask(queue) !== undefined,
    );
  }

  /** Run one eligible task and its checkpoint; return false when none is runnable. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model
  runTaskTurn(options: EventLoopOptions): boolean {
    if (this.#runningTaskTurn || this.#currentlyRunningTask !== null) {
      throw new InternalError('An event loop cannot run a task reentrantly');
    }

    const runnableTaskQueues = [...this.#taskQueues]
      .filter((queue) =>
        findFirstRunnableTask(queue) !== undefined,
      );
    if (runnableTaskQueues.length === 0) return false;

    const selectedTaskQueueView = (
      options.selectTaskQueue ?? selectFirstTaskQueue
    )(
      runnableTaskQueues,
    );
    const selectedTaskQueue = runnableTaskQueues.find(
      (taskQueue) => taskQueue === selectedTaskQueueView,
    );
    if (selectedTaskQueue === undefined) {
      throw new InternalError('Task queue selector returned an unavailable queue');
    }

    const taskStartTime = options.unsafeSharedCurrentTime();
    const oldestTask = findFirstRunnableTask(selectedTaskQueue);
    if (oldestTask === undefined) {
      throw new InternalError('Selected task queue has no runnable task');
    }

    selectedTaskQueue.delete(oldestTask);
    if (oldestTask.document !== null) {
      options.taskTiming?.recordTaskStartTime(
        taskStartTime,
        oldestTask.document,
      );
    }

    let taskError: { value: unknown; } | null = null;
    this.#runningTaskTurn = true;
    this.#currentlyRunningTask = oldestTask;
    try {
      oldestTask.steps();
    } catch (error) {
      taskError = { value: error };
    } finally {
      this.#currentlyRunningTask = null;
      try { this.performMicrotaskCheckpoint(); }
      finally { this.#runningTaskTurn = false; }
    }

    const taskEndTime = options.unsafeSharedCurrentTime();
    options.longTaskReporter?.reportLongTasks(
      taskStartTime,
      taskEndTime,
      oldestTask,
    );
    if (oldestTask.document !== null) {
      options.taskTiming?.recordTaskEndTime(
        taskEndTime,
        oldestTask.document,
      );
    }
    if (taskError !== null) throw taskError.value;
    return true;
  }

  /** Find the incumbent settings object for a script or host entry. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#incumbent-settings-object
  getIncumbentSettingsObject(
    hostEntryEnv: Environment,
  ): Environment {
    const context = findTopmostScriptHavingExecutionContext(
      this.#jsExecutionContextStack,
    );
    if (
      context !== undefined &&
      context.skipWhenDeterminingIncumbent === 0
    ) {
      return context.env;
    }

    const backup = this.#backupIncumbentSettingsObjectStack.at(-1);
    if (backup !== undefined) return backup;

    // ACCOMMODATION(node-v8-execution-contexts):
    // HTML's algorithm asserts here. A call directly from Browlet's embedder
    // has no engine-visible ScriptOrModule for userland to inspect, so its
    // binding realm is the explicit entry boundary.
    return hostEntryEnv;
  }

  /** Push callback settings and hide the active script from incumbent selection. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#prepare-to-run-a-callback
  prepareToRunCallback(env: Environment): void {
    if (env.responsibleEventLoop !== this) {
      throw new InternalError('A callback context belongs to another event loop');
    }

    this.#backupIncumbentSettingsObjectStack.push(env);
    const context = findTopmostScriptHavingExecutionContext(
      this.#jsExecutionContextStack,
    );
    if (context !== undefined) context.skipWhenDeterminingIncumbent++;
  }

  /** Restore incumbent selection after the matching callback entry. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-a-callback
  cleanUpAfterRunningCallback(env: Environment): void {
    const context = findTopmostScriptHavingExecutionContext(
      this.#jsExecutionContextStack,
    );
    if (context !== undefined) {
      if (context.skipWhenDeterminingIncumbent === 0) {
        throw new InternalError('A callback incumbent counter is already zero');
      }
      context.skipWhenDeterminingIncumbent--;
    }

    if (this.#backupIncumbentSettingsObjectStack.at(-1) !== env) {
      throw new InternalError('Callback settings were cleaned up out of order');
    }
    this.#backupIncumbentSettingsObjectStack.pop();
  }

  /** Enter script execution with this environment and the current task. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#prepare-to-run-script
  prepareToRunScript(env: Environment): void {
    if (env.responsibleEventLoop !== this) {
      throw new InternalError('Script settings belong to another event loop');
    }

    const task = this.#currentlyRunningTask;
    // ACCOMMODATION(node-v8-execution-contexts):
    // HTML §§8.1.4.4 and 8.1.6.6.4 expect an engine-owned Promise job to have
    // installed its microtask task before this point. The custom engine's
    // Promise hook does so. Unsupported engines and uncontrolled host entries
    // still need a nullable task; do not infer that V8's unseen stack is empty.
    this.#jsExecutionContextStack.push({
      kind: 'realm',
      env,
      task,
    });
    task?.scriptEvaluationEnvironmentSettingsObjectSet.add(env);
  }

  /** Leave script execution and checkpoint when the execution stack becomes empty. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script
  cleanUpAfterRunningScript(env: Environment): void {
    const entry = this.#jsExecutionContextStack.at(-1);
    if (
      entry?.kind !== 'realm' ||
      entry.env !== env
    ) {
      throw new InternalError('Script settings were cleaned up out of order');
    }
    this.#jsExecutionContextStack.pop();

    // ACCOMMODATION(node-v8-execution-contexts): A checkpoint clears the current
    // task even while its outer task turn continues. Later callbacks in that
    // turn still have a controlled entry; unrelated engine entries do not.
    if (
      (entry.task !== null || this.#runningTaskTurn) &&
      this.#jsExecutionContextStack.length === 0
    ) {
      this.performMicrotaskCheckpoint();
    }
  }

  // HTML §§8.1.3.2 and 8.1.4.4 — Browlet-controlled ScriptEvaluation entry.
  // The settings and skip counter are the host-visible portion needed for
  // incumbent selection; the eventual Script record remains §8.1.4.1 work.
  // ACCOMMODATION(node-v8-execution-contexts): Direct embedder entry receives
  // a temporary task because Node exposes no surrounding execution context.
  runScriptEvaluation<Result>(
    env: Environment,
    steps: () => Result,
  ): Result {
    const hostEntryTask = this.#currentlyRunningTask === null
      ? new Task(hostEntryTaskSource, null, () => {})
      : null;
    if (hostEntryTask !== null) this.#currentlyRunningTask = hostEntryTask;

    try {
      this.prepareToRunScript(env);
      const context: ScriptHavingExecutionContext = {
        kind: 'script',
        env,
        skipWhenDeterminingIncumbent: 0,
      };
      this.#jsExecutionContextStack.push(context);
      try {
        return steps();
      } finally {
        this.#popScriptExecutionContext(context);
        this.cleanUpAfterRunningScript(env);
      }
    } finally {
      if (hostEntryTask !== null) {
        this.#finishHostScriptEntry(hostEntryTask);
      }
    }
  }

  /** Conditional checkpoint at a Browlet-controlled parser entry. */
  performMicrotaskCheckpointIfStackEmpty(): void {
    if (this.#jsExecutionContextStack.length === 0) {
      this.performMicrotaskCheckpoint();
    }
  }

  performMicrotaskCheckpoint(): void {
    if (this.#performingMicrotaskCheckpoint) return;

    this.#performingMicrotaskCheckpoint = true;
    try {
      this.microtaskQueue.performMicrotaskCheckpoint();

      // TODO(HTML §8.1.7.3): Notify rejected promises and clean up IndexedDB transactions.
      // Native checkpoints already clear kept objects; review ordering and isolation
      // with those consumers (EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint).
    } finally {
      this.#performingMicrotaskCheckpoint = false;
    }

    // TODO(HTML section 8.1.7.3): Record microtask-checkpoint timing.
  }

  queueMicrotask(
    steps: () => void,
    document: DocumentImpl | null = null,
  ): void {
    const microtask = new Task(
      microtaskTaskSource,
      document,
      steps,
    );

    this.microtaskQueue.enqueueMicrotask(() => {
      // https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint
      // Suppress nested checkpoints requested by scripted callbacks.
      const wasPerformingMicrotaskCheckpoint =
        this.#performingMicrotaskCheckpoint;
      this.#performingMicrotaskCheckpoint = true;
      this.#currentlyRunningTask = microtask;
      try {
        microtask.steps();
      } finally {
        this.#currentlyRunningTask = null;
        this.#performingMicrotaskCheckpoint =
          wasPerformingMicrotaskCheckpoint;
      }
    });
  }

  // -- Internal ---------------------------------------------------------

  queueTask(
    source: TaskSource,
    document: DocumentImpl | null,
    steps: () => void,
    options: TaskCreationOptions = {},
  ): Task {
    // Keep HTML's otherwise implied destination and Document explicit.
    const task = new Task(source, document, steps, options);
    this.#getTaskQueue(source).add(task);
    this.#requestTurnIfNeeded();
    return task;
  }

  removeTask(task: Task): boolean {
    return this.#getTaskQueue(task.source).delete(task);
  }

  /** Discard queued tasks associated with a document, across all task sources. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document
  removeTasksForDocument(document: DocumentImpl): void {
    for (const queue of this.#taskQueues) {
      for (const task of queue) {
        if (task.document === document) queue.delete(task);
      }
    }
  }

  notifyTaskRunnabilityChanged(): void {
    this.#requestTurnIfNeeded();
  }

  setLastRenderOpportunityTime(time: UnsafeMoment): void {
    this.#lastRenderOpportunityTime = time;
  }

  getTaskQueue(source: TaskSource): ReadonlySet<Task> {
    return this.#getTaskQueue(source);
  }

  getTaskQueues(): ReadonlySet<ReadonlySet<Task>> {
    return this.#taskQueues;
  }

  // -- Private ----------------------------------------------------------

  #getTaskQueue(source: TaskSource): Set<Task> {
    let queue = this.#taskQueueBySource.get(source);
    if (queue === undefined) {
      queue = new Set();
      this.#taskQueueBySource.set(source, queue);
      this.#taskQueues.add(queue);
    }
    return queue;
  }

  #popScriptExecutionContext(context: ScriptHavingExecutionContext): void {
    if (this.#jsExecutionContextStack.at(-1) !== context) {
      throw new InternalError('Script execution contexts were cleaned up out of order');
    }
    this.#jsExecutionContextStack.pop();
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
    const options = this.#schedulingOptions;
    if (
      options === null ||
      this.#turnRequested ||
      !this.hasRunnableTasks()
    ) return;

    this.#turnRequested = true;
    options.requestEventLoopTurn(() => {
      try {
        this.runTaskTurn(options);
      } finally {
        this.#turnRequested = false;
        this.#requestTurnIfNeeded();
      }
    });
  }
}

export type EventLoopOptions = {
  createMicrotaskQueue: () => JSMicrotaskQueue;
  longTaskReporter?: LongTaskReporter;
  requestEventLoopTurn: (
    this: void,
    steps: () => void,
  ) => void;
  selectTaskQueue?: TaskQueueSelector;
  taskTiming?: TaskTimingHooks;
  unsafeSharedCurrentTime: (this: void) => UnsafeMoment;
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
  runnableTaskQueues: ReadonlySet<Task>[],
) => ReadonlySet<Task>;

/** Queued HTML work with source identity and document-activity gating. */
// https://html.spec.whatwg.org/multipage/webappapis.html#concept-task
export class Task {
  /** Document whose activity gates execution, or null for ungated work. */
  document: DocumentImpl | null;
  /** Settings objects whose scripts were evaluated while this task ran. */
  scriptEvaluationEnvironmentSettingsObjectSet = new Set<Environment>();
  /** Fixed source identity used to select the task's queue. */
  readonly source: TaskSource;
  /** Algorithm steps executed when this task is selected. */
  steps: () => void;
  /** Nesting level inherited by timer initialization inside this task. */
  timerNestingLevel?: number;

  constructor(
    source: TaskSource,
    document: DocumentImpl | null,
    steps: () => void,
    options: TaskCreationOptions = {},
  ) {
    this.document = document;
    this.source = source;
    this.steps = steps;
    this.timerNestingLevel = options.timerNestingLevel;
  }

  get isRunnable(): boolean {
    return this.document === null ||
      this.document.isFullyActive();
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

type TrackedExecutionContext =
  | RealmExecutionContextEntry
  | ScriptHavingExecutionContext;

type RealmExecutionContextEntry = {
  kind: 'realm';
  env: Environment;
  task: Task | null;
};

type ScriptHavingExecutionContext = {
  kind: 'script';
  env: Environment;
  skipWhenDeterminingIncumbent: number;
};

function findTopmostScriptHavingExecutionContext(
  stack: TrackedExecutionContext[],
): ScriptHavingExecutionContext | undefined {
  return stack.findLast((context) => context.kind === 'script');
}

function findFirstRunnableTask(
  taskQueue: ReadonlySet<Task>,
): Task | undefined {
  for (const task of taskQueue) {
    if (task.isRunnable) return task;
  }
  return undefined;
}

function selectFirstTaskQueue(
  runnableTaskQueues: ReadonlySet<Task>[],
): ReadonlySet<Task> {
  const [taskQueue] = runnableTaskQueues;
  if (taskQueue === undefined) {
    throw new InternalError('Cannot select from an empty set of task queues');
  }
  return taskQueue;
}
