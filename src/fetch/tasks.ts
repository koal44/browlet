import { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject, JSEnvironment } from '../js-engine/index';

/** Fetch §2, https://fetch.spec.whatwg.org/#queue-a-fetch-task */
export function queueFetchTask(
  algorithm: () => void,
  taskDestination: GlobalObject | ParallelQueue,
  env: JSEnvironment,
): void {
  if (taskDestination instanceof ParallelQueue) {
    taskDestination.enqueue(algorithm);
  } else {
    env.exec.networking.queueGlobalTask(taskDestination, algorithm);
  }
}
