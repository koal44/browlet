import { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject } from './realm';
import type { RealmExecution } from './realm-execution';

/** An environment owning execution and allocation facilities for one JavaScript realm. */
export interface JSEnvironment {
  /** Facilities shared by implementations belonging to this environment. */
  exec: RealmExecution;
  /** Queue networking work on the selected global or parallel queue. */
  queueNetworkingTask(steps: () => void, destination: GlobalObject | ParallelQueue): void;
}

/** Shared method implementation for environments with networking task delivery. */
// https://fetch.spec.whatwg.org/#queue-a-fetch-task
export function queueNetworkingTask(
  this: JSEnvironment, steps: () => void, destination: GlobalObject | ParallelQueue,
): void {
  if (destination instanceof ParallelQueue) {
    destination.enqueue(steps);
  } else {
    this.exec.networking.queueGlobalTask(destination, steps);
  }
}
