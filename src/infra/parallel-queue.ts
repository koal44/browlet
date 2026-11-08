import { InternalError } from './internal-error';
import type { TaskRecord, TaskHandle } from './tasks';

/*
 * A parallel queue runs tasks in series while other work proceeds in parallel.
 * HTML section 2.1.1 defines its ordering contract. The host chooses
 * how to schedule a drain; the queue owns only serialization and ordering.
 *
 * https://html.spec.whatwg.org/multipage/infrastructure.html#parallel-queue
 */
export class ParallelQueue {
  /** Each enqueue owns its task identity, including repeated callbacks and later drains. */
  #taskQueue: TaskRecord[] = [];
  #taskIndex = 0;
  #draining = false;
  #drainScheduled = false;
  #scheduleDrain: ScheduleParallelQueueDrain;

  constructor(scheduleDrain: ScheduleParallelQueueDrain) {
    this.#scheduleDrain = scheduleDrain;
  }

  /** Append a task, retaining its internal notification if removed before execution. */
  enqueue(task: TaskRecord): TaskHandle {
    const queuedTask: TaskRecord = { run: task.run, discard: task.discard };
    this.#taskQueue.push(queuedTask);
    this.#requestDrain();
    return {
      remove: () => {
        const index = this.#taskQueue.indexOf(queuedTask, this.#taskIndex);
        if (index === -1) return;
        this.#taskQueue.splice(index, 1);
        queuedTask.discard?.();
      },
    };
  }

  #requestDrain(): void {
    if (
      this.#taskIndex >= this.#taskQueue.length ||
      this.#draining ||
      this.#drainScheduled
    ) return;

    this.#drainScheduled = true;
    try {
      this.#scheduleDrain(() => this.#drain());
    } catch (error) {
      this.#drainScheduled = false;
      throw error;
    }
  }

  #drain(): void {
    if (this.#draining) {
      throw new InternalError('A parallel queue cannot drain reentrantly');
    }

    this.#drainScheduled = false;
    this.#draining = true;
    try {
      while (this.#taskIndex < this.#taskQueue.length) {
        const { run } = this.#taskQueue[this.#taskIndex++]!;
        run();
      }
      this.#taskQueue.length = 0;
      this.#taskIndex = 0;
    } finally {
      this.#draining = false;
      this.#requestDrain();
    }
  }
}

/* The host must arrange the drain and return without invoking it inline. */
export type ScheduleParallelQueueDrain = (
  drain: () => void,
) => void;
