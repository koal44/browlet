import type { JavaScriptFunction, JavaScriptRealm } from './realm';

/** Install reactions on an existing promise without returning a result. */
export function installPromiseReactions(
  realm: JavaScriptRealm,
  promise: Promise<unknown>,
  onFulfilled: JavaScriptFunction | undefined,
  onRejected: JavaScriptFunction | undefined,
): void {
  /*
   * ACCOMMODATION(node-v8-promise-reactions): JavaScript does not expose
   * PerformPromiseThen directly. Calling the captured intrinsic approximates
   * its no-result-capability form, but also creates an unreachable derived
   * promise and can observe an author-overridden constructor or @@species.
   */
  Reflect.apply(
    realm.intrinsics.promise.then,
    promise,
    [onFulfilled, onRejected],
  );
}
