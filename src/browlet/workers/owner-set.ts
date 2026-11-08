import type { BrowletEnvironment } from '../environment/index';

import type { WorkerOwner } from './worker-global-scope';

/** Worker owners with the start of the current uninterrupted ownerless period. */
export class WorkerOwnerSet extends Set<WorkerOwner> {
  /** Environment supplying the local reading of the shared monotonic clock. */
  #env: BrowletEnvironment;
  /** Null while any owner remains; otherwise the time the set became empty. */
  #emptySince: number | null;
  /** Lifetime monitors notified after membership and ownerless timing have changed. */
  #observers = new Set<() => void>();

  /** Begin an ownerless period on the owning environment's lifetime clock. */
  constructor(env: BrowletEnvironment) {
    super();
    this.#env = env;
    this.#emptySince = env.unsafeSharedCurrentTime();
  }

  /** Monotonic milliseconds when this ownerless period began, or null while owned. */
  get emptySince(): number | null {
    return this.#emptySince;
  }

  /** End the ownerless period and notify monitors only for a newly added owner. */
  override add(owner: WorkerOwner): this {
    if (this.has(owner)) return this;
    super.add(owner);
    this.#emptySince = null;
    this.#notify();
    return this;
  }

  /** Remove an owner, starting the ownerless period when the final owner leaves. */
  override delete(owner: WorkerOwner): boolean {
    const removed = super.delete(owner);
    if (removed && this.size === 0) this.#emptySince = this.#env.unsafeSharedCurrentTime();
    if (removed) this.#notify();
    return removed;
  }

  /** Remove all remaining owners in one membership change. */
  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.#emptySince = this.#env.unsafeSharedCurrentTime();
    this.#notify();
  }

  /** Observe subsequent membership changes; unsubscribe before releasing a worker host. */
  observe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => { this.#observers.delete(observer); };
  }

  /** Deliver one change to the monitors present when that change occurred. */
  #notify(): void {
    for (const observer of [...this.#observers]) observer();
  }
}
