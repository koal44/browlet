import type { InternalPromise } from './promises';

/** Promise creation and background work supplied by an execution owner. */
export interface AsyncExecution {
  /** Internal Promise constructor selecting creation and reaction delivery. */
  Promise: typeof InternalPromise;
  /** Schedule background steps without invoking them inline or entering an owner task. */
  runInParallel: (steps: () => void) => void;
}

/** Task delivery with its destination and task source already selected. */
export type TaskScheduling = {
  /** Queue a later task and return a handle for removing it before execution. */
  queueTask(steps: () => void): TaskHandle;
};

export type TaskHandle = {
  remove(): void;
};
