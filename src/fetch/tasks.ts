import { ParallelQueue } from '../shared/parallel-queue';

/** Fetch §2, queue a fetch task. */
export function queueFetchTask(
  algorithm: () => void,
  taskDestination: object | ParallelQueue,
  queueGlobalTask: QueueGlobalFetchTask,
): void {
  if (taskDestination instanceof ParallelQueue) {
    taskDestination.enqueue(algorithm);
  } else {
    queueGlobalTask(taskDestination, algorithm);
  }
}

/** HTML queues this on the networking task source for the supplied global. */
export type QueueGlobalFetchTask = (global: object, steps: () => void) => void;
