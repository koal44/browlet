import { Promises } from '../../infra/promises';

export function requestNodeEventLoopTurn(steps: () => void): void {
  // Enter from a later Node task; never run an HTML turn synchronously.
  setImmediate(steps);
}

/*
 * HTML section 2.1.1 permits cooperative scheduling. Captured closures stay
 * in this isolate; true worker parallelism needs algorithm-specific data and
 * message boundaries rather than a different implementation of this alias.
 */
export const runInParallel = requestNodeEventLoopTurn;

/** Internal continuations for browser-owned work that has no HTML realm. */
// Page implementations use their environment's execution facilities instead.
// eslint-disable-next-line no-restricted-globals -- Browser-owned work uses Node's host Promise queue, independently of Window lifetime.
export const hostPromises = new Promises(Promise, (promise, fulfilled, rejected) => {
  void promise.then(fulfilled, rejected).catch((error: unknown) => {
    requestNodeEventLoopTurn(() => { throw error; });
  });
});
