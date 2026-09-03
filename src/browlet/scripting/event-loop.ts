import type { JavaScriptMicrotaskQueue } from '../../javascript/index';
import { DocumentImpl } from '../dom/nodes/document';
import type { UnsafeMoment } from '../performance/clock';
import type { EnvironmentSettingsObject } from './environment';

/*
 * Each agent has a unique event loop. A task source is associated with one
 * task queue per event loop; the association is deliberately private so a
 * future scheduler can coalesce sources without changing callers.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#event-loops
 */
export class EventLoop {
  /* HTML §8.1.3.3 — Backup incumbent settings object stack. */
  readonly #backupIncumbentSettingsObjectStack:
  EnvironmentSettingsObject[] = [];
  readonly #javaScriptExecutionContextStack: TrackedExecutionContext[] = [];
  #currentlyRunningTask: Task | null = null;
  #lastRenderOpportunityTime: UnsafeMoment | null = null;
  #performingMicrotaskCheckpoint = false;
  #schedulingOptions: EventLoopOptions | null = null;
  #turnRequested = false;
  readonly #taskQueues = new Set<Set<Task>>();
  readonly #taskQueueBySource = new Map<TaskSource, Set<Task>>();

  constructor(readonly microtaskQueue: JavaScriptMicrotaskQueue) {}

  get currentlyRunningTask(): Task | null {
    return this.#currentlyRunningTask;
  }

  get lastRenderOpportunityTime(): UnsafeMoment | null {
    return this.#lastRenderOpportunityTime;
  }

  get started(): boolean {
    return this.#schedulingOptions !== null;
  }

  start(options: EventLoopOptions): void {
    if (this.#schedulingOptions !== null) {
      throw new Error('An event loop scheduler is already running');
    }

    this.#schedulingOptions = options;
    this.#requestTurnIfNeeded();
  }

  hasRunnableTasks(): boolean {
    return [...this.#taskQueues].some((queue) =>
      findFirstRunnableTask(queue) !== undefined,
    );
  }

  runTaskTurn(options: EventLoopOptions): boolean {
    if (this.#currentlyRunningTask !== null) {
      throw new Error('An event loop cannot run a task reentrantly');
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
      throw new Error('Task queue selector returned an unavailable queue');
    }

    const taskStartTime = options.unsafeSharedCurrentTime();
    const oldestTask = findFirstRunnableTask(selectedTaskQueue);
    if (oldestTask === undefined) {
      throw new Error('Selected task queue has no runnable task');
    }

    selectedTaskQueue.delete(oldestTask);
    if (oldestTask.document !== null) {
      options.taskTiming?.recordTaskStartTime(
        taskStartTime,
        oldestTask.document,
      );
    }

    let taskError: { readonly value: unknown; } | null = null;
    this.#currentlyRunningTask = oldestTask;
    try {
      oldestTask.steps();
    } catch (error) {
      taskError = { value: error };
    } finally {
      this.#currentlyRunningTask = null;
      this.performMicrotaskCheckpoint();
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

  /* HTML §8.1.3.3 — The incumbent settings object. */
  getIncumbentSettingsObject(
    hostEntrySettings: EnvironmentSettingsObject,
  ): EnvironmentSettingsObject {
    const context = findTopmostScriptHavingExecutionContext(
      this.#javaScriptExecutionContextStack,
    );
    if (
      context !== undefined &&
      context.skipWhenDeterminingIncumbent === 0
    ) {
      return context.settings;
    }

    const backup = this.#backupIncumbentSettingsObjectStack.at(-1);
    if (backup !== undefined) return backup;

    /*
     * ACCOMMODATION(node-v8-execution-contexts):
     * HTML's algorithm asserts here. A call directly from Browlet's embedder
     * has no engine-visible ScriptOrModule for userland to inspect, so its
     * binding realm is the explicit entry boundary.
     */
    return hostEntrySettings;
  }

  /* HTML §8.1.3.3 — Prepare to run a callback. */
  prepareToRunCallback(settings: EnvironmentSettingsObject): void {
    if (settings.responsibleEventLoop !== this) {
      throw new Error('A callback context belongs to another event loop');
    }

    this.#backupIncumbentSettingsObjectStack.push(settings);
    const context = findTopmostScriptHavingExecutionContext(
      this.#javaScriptExecutionContextStack,
    );
    if (context !== undefined) context.skipWhenDeterminingIncumbent++;
  }

  /* HTML §8.1.3.3 — Clean up after running a callback. */
  cleanUpAfterRunningCallback(settings: EnvironmentSettingsObject): void {
    const context = findTopmostScriptHavingExecutionContext(
      this.#javaScriptExecutionContextStack,
    );
    if (context !== undefined) {
      if (context.skipWhenDeterminingIncumbent === 0) {
        throw new Error('A callback incumbent counter is already zero');
      }
      context.skipWhenDeterminingIncumbent--;
    }

    if (this.#backupIncumbentSettingsObjectStack.at(-1) !== settings) {
      throw new Error('Callback settings were cleaned up out of order');
    }
    this.#backupIncumbentSettingsObjectStack.pop();
  }

  /* HTML §8.1.4.4 — Prepare to run script. */
  prepareToRunScript(settings: EnvironmentSettingsObject): void {
    if (settings.responsibleEventLoop !== this) {
      throw new Error('Script settings belong to another event loop');
    }

    const task = this.#currentlyRunningTask;
    /*
     * ACCOMMODATION(node-v8-execution-contexts):
     * HTML §§8.1.4.4 and 8.1.6.6.4 expect an engine-owned Promise job to have
     * installed its microtask task before this point. Node does not expose
     * HostEnqueuePromiseJob, so retain the realm entry when that outer task is
     * invisible, but do not invent a task or infer that V8's stack is empty.
     */
    this.#javaScriptExecutionContextStack.push({
      kind: 'realm',
      settings,
      task,
    });
    task?.scriptEvaluationEnvironmentSettingsObjectSet.add(settings);
  }

  /* HTML §8.1.4.4 — Clean up after running script. */
  cleanUpAfterRunningScript(settings: EnvironmentSettingsObject): void {
    const entry = this.#javaScriptExecutionContextStack.at(-1);
    if (
      entry?.kind !== 'realm' ||
      entry.settings !== settings
    ) {
      throw new Error('Script settings were cleaned up out of order');
    }
    this.#javaScriptExecutionContextStack.pop();

    /*
     * ACCOMMODATION(node-v8-execution-contexts): A null task means the entry
     * came from engine-owned work whose surrounding execution stack is hidden.
     */
    if (
      entry.task !== null &&
      this.#javaScriptExecutionContextStack.length === 0
    ) {
      this.performMicrotaskCheckpoint();
    }
  }

  /*
   * HTML §§8.1.3.2 and 8.1.4.4 — Browlet-controlled ScriptEvaluation entry.
   * The settings and skip counter are the host-visible portion needed for
   * incumbent selection; the eventual Script record remains §8.1.4.1 work.
   * ACCOMMODATION(node-v8-execution-contexts): Direct embedder entry receives
   * a temporary task because Node exposes no surrounding execution context.
   */
  runScriptEvaluation<Result>(
    settings: EnvironmentSettingsObject,
    steps: () => Result,
  ): Result {
    const hostEntryTask = this.#currentlyRunningTask === null
      ? new Task(hostEntryTaskSource, null, () => {})
      : null;
    if (hostEntryTask !== null) this.#currentlyRunningTask = hostEntryTask;

    try {
      this.prepareToRunScript(settings);
      const context: ScriptHavingExecutionContext = {
        kind: 'script',
        settings,
        skipWhenDeterminingIncumbent: 0,
      };
      this.#javaScriptExecutionContextStack.push(context);
      try {
        return steps();
      } finally {
        this.#popScriptExecutionContext(context);
        this.cleanUpAfterRunningScript(settings);
      }
    } finally {
      if (hostEntryTask !== null) {
        this.#finishHostScriptEntry(hostEntryTask);
      }
    }
  }

  performMicrotaskCheckpoint(): void {
    if (this.#performingMicrotaskCheckpoint) return;

    this.#performingMicrotaskCheckpoint = true;
    try {
      this.microtaskQueue.performMicrotaskCheckpoint();

      /*
       * TODO(HTML section 8.1.7.3): Notify rejected promises, clean up
       * IndexedDB transactions, and perform ClearKeptObjects once their
       * owning subsystems supply those operations.
       */
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
      /* HTML §8.1.7.3 — Suppress checkpoints requested by scripted callbacks. */
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

  // -- Friends ----------------------------------------------------------

  static enqueueTask(eventLoop: EventLoop, task: Task): void {
    eventLoop.#getTaskQueue(task.source).add(task);
    eventLoop.#requestTurnIfNeeded();
  }

  static removeTask(eventLoop: EventLoop, task: Task): boolean {
    return eventLoop.#getTaskQueue(task.source).delete(task);
  }

  static notifyTaskRunnabilityChanged(eventLoop: EventLoop): void {
    eventLoop.#requestTurnIfNeeded();
  }

  static setLastRenderOpportunityTime(
    eventLoop: EventLoop,
    time: UnsafeMoment,
  ): void {
    eventLoop.#lastRenderOpportunityTime = time;
  }

  static getTaskQueue(
    eventLoop: EventLoop,
    source: TaskSource,
  ): ReadonlySet<Task> {
    return eventLoop.#getTaskQueue(source);
  }

  static getTaskQueues(eventLoop: EventLoop): ReadonlySet<ReadonlySet<Task>> {
    return eventLoop.#taskQueues;
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
    if (this.#javaScriptExecutionContextStack.at(-1) !== context) {
      throw new Error('Script execution contexts were cleaned up out of order');
    }
    this.#javaScriptExecutionContextStack.pop();
  }

  #finishHostScriptEntry(task: Task): void {
    if (
      this.#currentlyRunningTask !== null &&
      this.#currentlyRunningTask !== task
    ) {
      throw new Error('A host script entry left another task running');
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
  readonly createMicrotaskQueue: () => JavaScriptMicrotaskQueue;
  readonly longTaskReporter?: LongTaskReporter;
  readonly requestEventLoopTurn: (
    this: void,
    steps: () => void,
  ) => void;
  readonly selectTaskQueue?: TaskQueueSelector;
  readonly taskTiming?: TaskTimingHooks;
  readonly unsafeSharedCurrentTime: (this: void) => UnsafeMoment;
};

export type TaskTimingHooks = {
  /*
   * Long Animation Frames editor's draft:
   * https://w3c.github.io/long-animation-frames/#record-task-start-time
   * https://w3c.github.io/long-animation-frames/#record-task-end-time
   */
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
  /*
   * The eventual Long Tasks owner can derive top-level browsing contexts
   * from the task's script-evaluation settings set. Keep that unimplemented
   * subsystem behind this seam rather than manufacturing its result here.
   *
   * https://w3c.github.io/longtasks/#report-long-tasks
   */
  reportLongTasks(
    this: void,
    startTime: UnsafeMoment,
    endTime: UnsafeMoment,
    task: Task,
  ): void;
};

export type TaskQueueSelector = (
  runnableTaskQueues: readonly ReadonlySet<Task>[],
) => ReadonlySet<Task>;

export class Task {
  readonly document: DocumentImpl | null;
  readonly scriptEvaluationEnvironmentSettingsObjectSet =
    new Set<EnvironmentSettingsObject>();
  readonly source: TaskSource;
  readonly steps: () => void;
  readonly timerNestingLevel?: number;

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
      DocumentImpl.isFullyActive(this.document);
  }
}

/*
 * A source is an opaque identity, not the queue itself. The diagnostic name
 * does not participate in equality: two specifications can use the same name
 * without accidentally serializing their tasks together.
 */
export type TaskSource = Readonly<{ name: string; }>;

export function createTaskSource(name: string): TaskSource {
  return Object.freeze({ name });
}

export function queueTask(
  source: TaskSource,
  eventLoop: EventLoop,
  document: DocumentImpl | null,
  steps: () => void,
  options: TaskCreationOptions = {},
): Task {
  /*
   * Require the values which HTML permits specifications to imply. The spec
   * warns that those ambient deductions are ambiguous; Browlet callers should
   * normally enter through the global or element wrapper instead.
   */
  const task = new Task(source, document, steps, options);
  EventLoop.enqueueTask(eventLoop, task);
  return task;
}

export type TaskCreationOptions = {
  readonly timerNestingLevel?: number;
};

const microtaskTaskSource = createTaskSource('microtask');
const hostEntryTaskSource = createTaskSource('host script entry');

type TrackedExecutionContext =
  | RealmExecutionContextEntry
  | ScriptHavingExecutionContext;

type RealmExecutionContextEntry = {
  readonly kind: 'realm';
  readonly settings: EnvironmentSettingsObject;
  readonly task: Task | null;
};

type ScriptHavingExecutionContext = {
  readonly kind: 'script';
  readonly settings: EnvironmentSettingsObject;
  skipWhenDeterminingIncumbent: number;
};

function findTopmostScriptHavingExecutionContext(
  stack: readonly TrackedExecutionContext[],
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
  runnableTaskQueues: readonly ReadonlySet<Task>[],
): ReadonlySet<Task> {
  const [taskQueue] = runnableTaskQueues;
  if (taskQueue === undefined) {
    throw new Error('Cannot select from an empty set of task queues');
  }
  return taskQueue;
}
