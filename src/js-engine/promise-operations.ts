import type { JavaScriptFunction, JavaScriptRealm } from './realm';

/** Install reactions on an existing promise without returning a result. */
export function installPromiseReactions(
  realm: JavaScriptRealm,
  promise: Promise<unknown>,
  onFulfilled: JavaScriptFunction | undefined,
  onRejected: JavaScriptFunction | undefined,
): void {
  realm.runtime.observePromise(realm, promise, onFulfilled, onRejected);
}
