import { setImmediate } from 'node:timers';

import { InternalPromise } from '../infra/promises';

/** Internal continuations on this isolate's Node host queue, independent of browser realms. */
export class NodePromise<T> extends InternalPromise<T> {
  protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
    void this.backing.then(fulfilled, rejected).catch(reportPromiseObserverError);
  }
}

/** Report an unexpected internal observer exception to Node, retaining the thrown value. */
// A throw inside a Promise reaction would only reject another Promise. Report on
// the host queue after reaction cleanup; Node owns its uncaught-exception policy.
export function reportPromiseObserverError(error: unknown): void {
  setImmediate(() => { throw error; });
}
