/** Presence and activity of a worker's owner in another isolate; never a copied Document. */
export class RemoteWorkerOwner {
  /** One atomic cell: removed = 0, active = 1, inactive = 2. */
  #state: Int32Array<SharedArrayBuffer>;

  /** Create an outside-owned state, or attach the inside view to the same shared cell. */
  constructor(sharedState: Int32Array<SharedArrayBuffer> | null = null) {
    this.#state = sharedState ?? new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  }

  /** Read changes even while script has prevented delivery of native host messages. */
  get state(): WorkerOwnerState {
    const state = Atomics.load(this.#state, 0);
    return state === 1 ? 'active' : state === 2 ? 'inactive' : null;
  }

  /** Written by the execution owner observing the original Document. */
  set state(state: WorkerOwnerState) {
    Atomics.store(this.#state, 0, state === 'active' ? 1 : state === 'inactive' ? 2 : 0);
  }

  /** Private startup data, shared rather than transferred or exposed to author code. */
  get sharedState(): Int32Array<SharedArrayBuffer> { return this.#state; }
}

/** An owner's active need, or null once no owner remains on the remote side. */
export type WorkerOwnerState = 'active' | 'inactive' | null;
