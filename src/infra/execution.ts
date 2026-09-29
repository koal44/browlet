import type { InternalPromise } from './promises';

/** Promise creation, background work, and task delivery for one execution owner. */
export interface AsyncExecution {
  /** Internal Promise constructor selecting creation and reaction delivery. */
  Promise: typeof InternalPromise;
  /** Schedule background steps without invoking them inline or entering an owner task. */
  runInParallel: (steps: () => void) => void;
  /** Queue timer work with the nesting level inherited by timers created inside it. */
  queueTask(source: 'timer', steps: () => void, options: TaskCreationOptions): TaskHandle;
  /** Queue a later task for this owner on the selected source. */
  queueTask(source: TaskSourceKey, steps: () => void): TaskHandle;
}

/** Shared task sources understood by execution providers; hosts own their queues. */
export type TaskSourceKey = 'file' | 'network' | 'dom-manipulation' | 'report' | 'automation' | 'timer';

/** Metadata carried by a queued task. */
export type TaskCreationOptions = {
  /** Nesting level inherited by timers created inside this task; absent for other work. */
  timerNestingLevel?: number;
};

/** Handle for removing a task before it executes. */
export type TaskHandle = {
  remove(): void;
};
