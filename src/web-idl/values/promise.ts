import { InternalError } from '../../infra/index';

import type { WebIDLRealm } from '../environment';
import type { IDLType } from '../assembly/index';

/** A realm-owned promise with its fulfillment type and settlement lifecycle. */
export class IDLPromise<Type extends IDLType = IDLType> {
  /** Native Promise backing; fulfillment conversion is supplied by its consumer. */
  promise: Promise<unknown>;
  /** Realm used to allocate the promise. */
  realm: WebIDLRealm;
  /** Declared conversion for fulfillment values. */
  type: Type;
  /** Whether a resolving function was accepted; adoption may still be pending. */
  resolved = false;
  /** Native resolution function, invoked after recording the first resolution. */
  #resolve: PromiseSettlement;
  /** Native rejection function, invoked after recording the first resolution. */
  #reject: PromiseSettlement;
  /** Optional conversion of internal failures at the rejection boundary. */
  #realizeException: ExceptionRealizer | undefined;

  constructor(type: Type, realm: WebIDLRealm, realizeException?: ExceptionRealizer) {
    let resolve: PromiseSettlement | undefined;
    let reject: PromiseSettlement | undefined;
    this.promise = new realm.intrinsics.promise.constructor((resolve_, reject_) => {
      resolve = resolve_;
      reject = reject_;
    });
    if (!resolve || !reject) throw new InternalError('Promise constructor did not initialize its capability');
    this.type = type;
    this.realm = realm;
    this.#resolve = resolve;
    this.#reject = reject;
    this.#realizeException = realizeException;
  }

  /** Recognize an IDL promise without inspecting author properties or invoking Proxy traps. */
  static is(value: unknown): value is IDLPromise {
    return typeof value === 'object' && value !== null && #resolve in value;
  }

  /** Adopt an author value, retaining its fulfillment type for later implementation conversion. */
  // https://webidl.spec.whatwg.org/#js-to-promise
  static fromJS<Type extends IDLType>(value: unknown, type: Type, realm: WebIDLRealm, realizeException?: ExceptionRealizer): IDLPromise<Type> {
    const promise = new IDLPromise(type, realm, realizeException);
    promise.resolve(value);
    return promise;
  }

  /** Create a rejected promise in the supplied realm, optionally realizing internal failures. */
  // https://webidl.spec.whatwg.org/#js-promise-manipulation
  static rejected<Type extends IDLType>(reason: unknown, type: Type, realm: WebIDLRealm, realizeException?: ExceptionRealizer): IDLPromise<Type> {
    const promise = new IDLPromise(type, realm, realizeException);
    promise.reject(reason);
    return promise;
  }

  /** Accept a JS resolution value once, including adoption of another promise. */
  resolve(value?: unknown): void {
    if (this.resolved) return;
    this.resolved = true;
    const resolve = this.#resolve;
    resolve(value);
  }

  /** Reject once, realizing an implementation exception when configured. */
  reject(reason?: unknown): void {
    if (this.resolved) return;
    this.resolved = true;
    const reject = this.#reject;
    const realize = this.#realizeException;
    reject(realize ? realize(reason) : reason);
  }

  /** React to JS values without conversion, keeping the result promise in this promise's realm. */
  // Reaction handling extracted from https://webidl.spec.whatwg.org/#dfn-perform-steps-once-promise-is-settled
  // Callers supply any conversions in their reaction steps.
  react<Result extends IDLType>(
    resultType: Result,
    steps: PromiseReactionSteps,
    realm: WebIDLRealm,
    realizeException?: ExceptionRealizer,
  ): IDLPromise<Result> {
    const resultPromise = new IDLPromise(resultType, this.realm, realizeException);
    const onFulfilled = realm.createFunction(
      (_thisArgument, [value]) => {
        try {
          const fulfilled = steps.fulfilled;
          resultPromise.resolve(fulfilled ? fulfilled(value) : value);
        } catch (exception) {
          resultPromise.reject(exception);
        }
      },
      { length: 1, name: '' },
    );
    const onRejected = realm.createFunction(
      (_thisArgument, [reason]) => {
        try {
          const rejected = steps.rejected;
          if (rejected) resultPromise.resolve(rejected(reason));
          else resultPromise.reject(reason);
        } catch (exception) {
          resultPromise.reject(exception);
        }
      },
      { length: 1, name: '' },
    );
    this.realm.observePromise(this.promise, onFulfilled, onRejected);
    return resultPromise;
  }

  /** Mark this promise handled by installing a rejection reaction. */
  // https://webidl.spec.whatwg.org/#js-promise-manipulation
  markAsHandled(): void {
    // ECMAScript does not expose [[PromiseIsHandled]]. Attaching a rejection
    // reaction performs the same state transition on the original promise.
    const onRejected = this.realm.createFunction(
      () => undefined,
      { length: 1, name: '' },
    );
    this.realm.observePromise(
      this.promise,
      undefined,
      onRejected,
    );
  }
}

// https://webidl.spec.whatwg.org/#js-promise-manipulation
export function waitForAll(
  promises: IDLPromise[],
  successSteps: (values: unknown[]) => void,
  failureSteps: (reason: unknown) => void,
  realm: WebIDLRealm,
): void {
  if (promises.length === 0) {
    realm.queueMicrotask(() => successSteps([]));
    return;
  }

  let fulfilledCount = 0;
  let rejected = false;
  const results = Array.from({ length: promises.length });
  const onRejected = realm.createFunction(
    (_thisArgument, [reason]) => {
      if (!rejected) {
        rejected = true;
        failureSteps(reason);
      }
    },
    { length: 1, name: '' },
  );

  promises.forEach((promise, index) => {
    const onFulfilled = realm.createFunction(
      (_thisArgument, [value]) => {
        results[index] = value;
        fulfilledCount++;
        if (fulfilledCount === promises.length) successSteps(results);
      },
      { length: 1, name: '' },
    );
    promise.realm.observePromise(
      promise.promise,
      onFulfilled,
      onRejected,
    );
  });
}

/** Reaction steps that receive and return JS values without implicit conversion. */
export type PromiseReactionSteps = {
  fulfilled?(this: void, value: unknown): unknown;
  rejected?(this: void, reason: unknown): unknown;
};

type PromiseSettlement = (value?: unknown) => void;
type ExceptionRealizer = (value: unknown) => unknown;
