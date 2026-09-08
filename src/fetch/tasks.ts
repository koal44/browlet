import { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject } from '../js-engine/index';

/**
 * Fetch §2, queue a fetch task.
 * The extra callback supplies HTML's networking task operation for global destinations.
 */
export function queueFetchTask(
  algorithm: () => void,
  taskDestination: GlobalObject | ParallelQueue,
  queueGlobalTask: QueueGlobalFetchTask,
): void {
  if (taskDestination instanceof ParallelQueue) {
    taskDestination.enqueue(algorithm);
  } else {
    queueGlobalTask(taskDestination, algorithm);
  }
}

/** HTML queues this on the networking task source for the supplied global. */
export type QueueGlobalFetchTask = (global: GlobalObject, steps: () => void) => void;

/** HTML scheduling used by body extraction and its optional parallel task destination. */
export type FetchTaskScheduling = {
  queueGlobalTask: QueueGlobalFetchTask;
  runInParallel: (steps: () => void) => void;
};
