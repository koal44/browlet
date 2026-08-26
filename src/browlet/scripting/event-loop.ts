import type { DocumentImpl } from '../dom/nodes/document';
import type { EnvironmentSettingsObject } from './environment';

/*
 * Each agent has a unique event loop. A task source is associated with one
 * task queue per event loop; the association is deliberately private so a
 * future scheduler can coalesce sources without changing callers.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#event-loops
 */
export class EventLoop {
  readonly #taskQueues = new Set<Set<Task>>();
  readonly #taskQueueBySource = new Map<TaskSource, Set<Task>>();

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
    globalThis.queueMicrotask(() => microtask.steps());
  }

  // -- Friends ----------------------------------------------------------

  static enqueueTask(eventLoop: EventLoop, task: Task): void {
    eventLoop.#getTaskQueue(task.source).add(task);
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
}

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
