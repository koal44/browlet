import { InternalPromise } from '../../infra/promises';

/** Request a later host turn for HTML's event-loop work. */
export function requestNodeEventLoopTurn(steps: () => void): void {
  // Enter from a later Node task; never run an HTML turn synchronously.
  setImmediate(steps);
}

// HTML section 2.1.1 permits cooperative scheduling. Captured closures stay
// in this isolate; true worker parallelism needs algorithm-specific data and
// message boundaries rather than a different implementation of this alias.
export const runInParallel = requestNodeEventLoopTurn;

/** Internal continuations for browser-owned work that has no HTML realm. */
// Page implementations use their environment's execution facilities instead.
export class HostPromise<T> extends InternalPromise<T> {
  protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
    void this.backing.then(fulfilled, rejected).catch((error: unknown) => {
      requestNodeEventLoopTurn(() => { throw error; });
    });
  }
}
