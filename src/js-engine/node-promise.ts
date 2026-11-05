import { InternalPromise } from '../infra/promises';

/** Internal continuations on this isolate's Node host queue, independent of browser realms. */
export class NodePromise<T> extends InternalPromise<T> {
  protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
    void this.backing.then(fulfilled, rejected).catch((error: unknown) => {
      setImmediate(() => { throw error; });
    });
  }
}
