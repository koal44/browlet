import { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject, RealmExecution } from '../js-engine/index';

/** Fetch §2, https://fetch.spec.whatwg.org/#queue-a-fetch-task */
export function queueFetchTask(
  algorithm: () => void,
  taskDestination: GlobalObject | ParallelQueue,
  exec: RealmExecution,
): void {
  if (taskDestination instanceof ParallelQueue) {
    taskDestination.enqueue(algorithm);
  } else {
    exec.networking.queueGlobalTask(taskDestination, algorithm);
  }
}
