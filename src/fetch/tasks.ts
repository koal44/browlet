import { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject, RuntimeContext } from '../js-engine/index';

/** Fetch §2, https://fetch.spec.whatwg.org/#queue-a-fetch-task */
export function queueFetchTask(
  algorithm: () => void,
  taskDestination: GlobalObject | ParallelQueue,
  runtime: RuntimeContext,
): void {
  if (taskDestination instanceof ParallelQueue) {
    taskDestination.enqueue(algorithm);
  } else {
    runtime.networking.queueGlobalTask(taskDestination, algorithm);
  }
}
