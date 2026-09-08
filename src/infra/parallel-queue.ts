/*
 * HTML section 2.1.1 defines a parallel queue as a queue of algorithm steps
 * which run in series while other work proceeds in parallel. The host chooses
 * how to schedule a drain; the queue owns only serialization and ordering.
 *
 * https://html.spec.whatwg.org/multipage/infrastructure.html#parallel-queue
 */
export class ParallelQueue {
  #algorithmQueue: (() => void)[] = [];
  #algorithmIndex = 0;
  #draining = false;
  #drainScheduled = false;
  #scheduleDrain: ScheduleParallelQueueDrain;

  // SPEC_MISMATCH: start a new parallel queue() -> parallel queue
  constructor(scheduleDrain: ScheduleParallelQueueDrain) {
    this.#scheduleDrain = scheduleDrain;
  }

  enqueue(steps: () => void): void {
    this.#algorithmQueue.push(steps);
    this.#requestDrain();
  }

  #requestDrain(): void {
    if (
      this.#algorithmIndex >= this.#algorithmQueue.length ||
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
      throw new Error('A parallel queue cannot drain reentrantly');
    }

    this.#drainScheduled = false;
    this.#draining = true;
    try {
      while (this.#algorithmIndex < this.#algorithmQueue.length) {
        const steps = this.#algorithmQueue[this.#algorithmIndex++]!;
        steps();
      }
      this.#algorithmQueue.length = 0;
      this.#algorithmIndex = 0;
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
