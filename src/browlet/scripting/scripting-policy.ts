/** Browser-owned scripting preference, shared with its worker isolates. */
// https://html.spec.whatwg.org/multipage/webappapis.html#concept-environment-script
// This is the user's preference only. Document sandboxing, response CSP, and
// WebDriver BiDi overrides retain their own environment-specific checks.
export class ScriptingPolicy {
  /** One shared cell; an ordinary copied boolean would become stale during loading or execution. */
  #state: Int32Array<SharedArrayBuffer>;

  /** Create the browser's preference, or attach to that same preference in another isolate. */
  constructor(sharedState: Int32Array<SharedArrayBuffer> | null = null) {
    this.#state = sharedState ?? new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    if (sharedState === null) this.enabled = true;
  }

  /** Current user preference; atomic access also observes changes made in another isolate. */
  get enabled(): boolean { return Atomics.load(this.#state, 0) !== 0; }
  set enabled(enabled: boolean) { Atomics.store(this.#state, 0, enabled ? 1 : 0); }

  /** Internal startup handle, shared rather than transferred; never expose it to author code. */
  get sharedState(): Int32Array<SharedArrayBuffer> { return this.#state; }
}
