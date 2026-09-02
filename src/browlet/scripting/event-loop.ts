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
  #currentlyRunningTask: Task | null = null;
  #lastRenderOpportunityTime: UnsafeMoment | null = null;
  #performingMicrotaskCheckpoint = false;
  #schedulingOptions: EventLoopOptions | null = null;
  #turnRequested = false;
  readonly #taskQueues = new Set<Set<Task>>();
  readonly #taskQueueBySource = new Map<TaskSource, Set<Task>>();

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
      this.performMicrotaskCheckpoint(options.performMicrotaskCheckpoint);
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

  performMicrotaskCheckpoint(
    performJavaScriptMicrotaskCheckpoint: () => void,
  ): void {
    if (this.#performingMicrotaskCheckpoint) return;

    this.#performingMicrotaskCheckpoint = true;
    try {
      performJavaScriptMicrotaskCheckpoint();

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

    /*
     * V8 owns the actual microtask queue. Retain Browlet's task record in the
     * closure without creating a second queue whose ordering could diverge.
     * The explicit checkpoint bridge will enter with the processing model.
     */
    globalThis.queueMicrotask(() => {
      this.#currentlyRunningTask = microtask;
      try {
        microtask.steps();
      } finally {
        this.#currentlyRunningTask = null;
      }
    });
  }

  // -- Friends ----------------------------------------------------------

  static enqueueTask(eventLoop: EventLoop, task: Task): void {
    eventLoop.#getTaskQueue(task.source).add(task);
    eventLoop.#requestTurnIfNeeded();
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
  readonly longTaskReporter?: LongTaskReporter;
  readonly performMicrotaskCheckpoint: (this: void) => void;
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
): void {
  /*
   * Require the values which HTML permits specifications to imply. The spec
   * warns that those ambient deductions are ambiguous; Browlet callers should
   * normally enter through the global or element wrapper instead.
   */
  EventLoop.enqueueTask(
    eventLoop,
    new Task(source, document, steps, options),
  );
}

export type TaskCreationOptions = {
  readonly timerNestingLevel?: number;
};

const microtaskTaskSource = createTaskSource('microtask');

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

/*
 * Node does not expose V8's shared microtask queue through a supported
 * synchronous API. This drains Node's ambient V8 queue as well as next-tick
 * and promise-rejection machinery. Keep the provisional operation explicit
 * and replaceable without allowing it to define Browlet's HTML checkpoint
 * semantics.
 *
 * https://github.com/nodejs/node/issues/65555
 */
export function performNodeMicrotaskCheckpoint(): void {
  getTickCallback()();
}

export function requestNodeEventLoopTurn(steps: () => void): void {
  // Enter from a later Node task; never run an HTML turn synchronously.
  setImmediate(steps);
}

/*
 * HTML section 2.1.1 permits cooperative scheduling. Captured closures stay
 * in this isolate; true worker parallelism needs algorithm-specific data and
 * message boundaries rather than a different implementation of this alias.
 */
export const runInParallel = requestNodeEventLoopTurn;

let tickCallback: (() => void) | undefined;

function getTickCallback(): () => void {
  if (tickCallback !== undefined) return tickCallback;

  const candidate: unknown = Reflect.get(process, '_tickCallback');
  if (typeof candidate !== 'function') {
    throw new Error(
      'Node does not expose the provisional microtask checkpoint bridge',
    );
  }

  tickCallback = () => { Reflect.apply(candidate, process, []); };
  return tickCallback;
}
