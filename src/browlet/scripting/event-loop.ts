import type { DocumentImpl } from '../dom/nodes/document';
import type { UnsafeMoment } from '../performance/clock';
import type { EnvironmentSettingsObject } from './environment';
import type { SchedulerHost } from './scheduler-host';

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
  #schedulingOptions: TaskTurnOptions | null = null;
  #turnRequested = false;
  readonly #taskQueues = new Set<Set<Task>>();
  readonly #taskQueueBySource = new Map<TaskSource, Set<Task>>();

  get currentlyRunningTask(): Task | null {
    return this.#currentlyRunningTask;
  }

  get lastRenderOpportunityTime(): UnsafeMoment | null {
    return this.#lastRenderOpportunityTime;
  }

  start(options: TaskTurnOptions): void {
    if (this.#schedulingOptions !== null) {
      throw new Error('An event loop scheduler is already running');
    }

    this.#schedulingOptions = options;
    this.#requestTurnIfNeeded();
  }

  hasRunnableTasks(isTaskRunnable: (task: Task) => boolean): boolean {
    return [...this.#taskQueues].some((queue) =>
      findFirstRunnableTask(queue, isTaskRunnable) !== undefined,
    );
  }

  runTaskTurn(options: TaskTurnOptions): boolean {
    if (this.#currentlyRunningTask !== null) {
      throw new Error('An event loop cannot run a task reentrantly');
    }

    const { isTaskRunnable, schedulerHost } = options;
    const runnableTaskQueues = [...this.#taskQueues]
      .filter((queue) =>
        findFirstRunnableTask(queue, isTaskRunnable) !== undefined,
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

    const taskStartTime = schedulerHost.unsafeSharedCurrentTime();
    const oldestTask = findFirstRunnableTask(
      selectedTaskQueue,
      isTaskRunnable,
    );
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
      this.performMicrotaskCheckpoint(schedulerHost);
    }

    const taskEndTime = schedulerHost.unsafeSharedCurrentTime();
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

  performMicrotaskCheckpoint(schedulerHost: SchedulerHost): void {
    if (this.#performingMicrotaskCheckpoint) return;

    this.#performingMicrotaskCheckpoint = true;
    try {
      schedulerHost.performMicrotaskCheckpoint();

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
    const microtask = createTask(
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
      !this.hasRunnableTasks(options.isTaskRunnable)
    ) return;

    this.#turnRequested = true;
    options.schedulerHost.requestEventLoopTurn(() => {
      try {
        this.runTaskTurn(options);
      } finally {
        this.#turnRequested = false;
        this.#requestTurnIfNeeded();
      }
    });
  }
}

export type TaskTurnOptions = {
  readonly isTaskRunnable: (task: Task) => boolean;
  readonly longTaskReporter?: LongTaskReporter;
  readonly schedulerHost: SchedulerHost;
  readonly selectTaskQueue?: TaskQueueSelector;
  readonly taskTiming?: TaskTimingHooks;
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

export type Task = {
  readonly steps: () => void;
  readonly source: TaskSource;
  readonly document: DocumentImpl | null;
  readonly scriptEvaluationEnvironmentSettingsObjectSet: Set<EnvironmentSettingsObject>;
};

/*
 * A source is an opaque identity, not the queue itself. The diagnostic name
 * does not participate in equality: two specifications can use the same name
 * without accidentally serializing their tasks together.
 */
export type TaskSource = Readonly<{ name: string; }>;

export function createTaskSource(name: string): TaskSource {
  return Object.freeze({ name });
}

export function createTask(
  source: TaskSource,
  document: DocumentImpl | null,
  steps: () => void,
): Task {
  return {
    steps,
    source,
    document,
    scriptEvaluationEnvironmentSettingsObjectSet: new Set(),
  };
}

export function queueTask(
  source: TaskSource,
  eventLoop: EventLoop,
  document: DocumentImpl | null,
  steps: () => void,
): void {
  /*
   * Require the values which HTML permits specifications to imply. The spec
   * warns that those ambient deductions are ambiguous; Browlet callers should
   * normally enter through the global or element wrapper instead.
   */
  EventLoop.enqueueTask(
    eventLoop,
    createTask(source, document, steps),
  );
}

const microtaskTaskSource = createTaskSource('microtask');

function findFirstRunnableTask(
  taskQueue: ReadonlySet<Task>,
  isTaskRunnable: (task: Task) => boolean,
): Task | undefined {
  for (const task of taskQueue) {
    if (isTaskRunnable(task)) return task;
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
