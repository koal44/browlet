import type { BrowletEnvironment } from '../environment/index';

import type { WorkerOwner } from './worker-global-scope';

/** Worker owners with the start of the current uninterrupted ownerless period. */
export class WorkerOwnerSet extends Set<WorkerOwner> {
  /** Environment supplying the local reading of the shared monotonic clock. */
  #env: BrowletEnvironment;
  /** Null while any owner remains; otherwise the time the set became empty. */
  #emptySince: number | null;

  constructor(env: BrowletEnvironment) {
    super();
    this.#env = env;
    this.#emptySince = env.unsafeSharedCurrentTime();
  }

  /** Monotonic milliseconds when this ownerless period began, or null while owned. */
  get emptySince(): number | null {
    return this.#emptySince;
  }

  override add(owner: WorkerOwner): this {
    super.add(owner);
    this.#emptySince = null;
    return this;
  }

  override delete(owner: WorkerOwner): boolean {
    const removed = super.delete(owner);
    if (removed && this.size === 0) this.#emptySince = this.#env.unsafeSharedCurrentTime();
    return removed;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.#emptySince = this.#env.unsafeSharedCurrentTime();
  }
}
