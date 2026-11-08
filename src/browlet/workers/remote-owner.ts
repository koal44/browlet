/** Lifetime contribution of owners in another isolate; never copied Documents. */
export class RemoteWorkerOwner {
  /** One atomic snapshot: owner present, active owner, extended lifetime, permissible. */
  #state: Int32Array<SharedArrayBuffer>;

  /** Create an outside-owned state, or attach the inside view to the same shared cell. */
  constructor(sharedState: Int32Array<SharedArrayBuffer> | null = null) {
    this.#state = sharedState ?? new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  }

  /** Read changes even while script has prevented delivery of native host messages. */
  get state(): WorkerOwnerState {
    const state = Atomics.load(this.#state, 0);
    return (state & OwnerFlags.Active) !== 0 ? 'active' : (state & OwnerFlags.Present) !== 0 ? 'inactive' : null;
  }

  /** Written by the execution owner observing the original Document. */
  set state(state: WorkerOwnerState) {
    this.update(state, false, state !== null);
  }

  /** Shared owners can keep a worker active without any fully active Document. */
  get inExtendedLifetime(): boolean { return (Atomics.load(this.#state, 0) & OwnerFlags.ExtendedLifetime) !== 0; }

  /** Read both ways to stay active together, including transitions into or out of an extension. */
  get activelyNeeded(): boolean { return (Atomics.load(this.#state, 0) & (OwnerFlags.Active | OwnerFlags.ExtendedLifetime)) !== 0; }

  /** Includes the shared worker's ownerless extension and between-loads grace period. */
  get permissible(): boolean { return (Atomics.load(this.#state, 0) & OwnerFlags.Permissible) !== 0; }

  /** Read activity and permissibility together, without observing a partially published update. */
  get suspendable(): boolean {
    const state = Atomics.load(this.#state, 0);
    return (state & OwnerFlags.Permissible) !== 0 && (state & (OwnerFlags.Active | OwnerFlags.ExtendedLifetime)) === 0;
  }

  /** Private startup data, shared rather than transferred or exposed to author code. */
  get sharedState(): Int32Array<SharedArrayBuffer> { return this.#state; }

  /** Publish the browser's complete decision in one atomic write. */
  update(state: WorkerOwnerState, extended: boolean, permissible: boolean): void {
    Atomics.store(this.#state, 0,
      (state === null ? 0 : OwnerFlags.Present) | (state === 'active' ? OwnerFlags.Active : 0) |
      (extended ? OwnerFlags.ExtendedLifetime : 0) | (permissible ? OwnerFlags.Permissible : 0));
  }
}

/** An owner's active need, or null once no owner remains on the remote side. */
export type WorkerOwnerState = 'active' | 'inactive' | null;

/** Independent lifetime contributions packed into the shared owner-state cell. */
const enum OwnerFlags {
  Present = 1,
  Active = 2,
  ExtendedLifetime = 4,
  Permissible = 8,
}
