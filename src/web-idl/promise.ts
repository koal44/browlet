import { InternalPromise, type InternalPromiseWithResolvers, type PromiseResultType } from '../infra/promises';
import type { BindingContext } from './binding-context';
import { jsToIDL, idlToJS, type ConversionContext } from './conversion';
import { implementationType, type ImplementationType, type WebIDLType } from './core/index';
import type { WebIDLRealm } from './realm';
import { InternalError } from '../infra/internal-error';

/** A realm-owned promise with its fulfillment type and settlement lifecycle. */
export class PromiseCarrier {
  /** Promise exposed to author code. */
  promise: Promise<unknown>;
  /** Realm used to allocate the promise. */
  realm: WebIDLRealm;
  /** Declared conversion for fulfillment values. */
  type: WebIDLType;
  /** Whether a resolving function was accepted; adoption may still be pending. */
  resolved = false;
  /** Native resolution function, invoked after marking the carrier resolved. */
  #resolve: PromiseSettlement;
  /** Native rejection function, invoked after marking the carrier resolved. */
  #reject: PromiseSettlement;
  /** Optional conversion of internal failures at the rejection boundary. */
  #realizeException: ExceptionRealizer | undefined;

  constructor(type: WebIDLType, realm: WebIDLRealm, realizeException?: ExceptionRealizer) {
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

  /** Recognize carriers without inspecting an author promise or invoking Proxy traps. */
  static is(value: unknown): value is PromiseCarrier {
    return typeof value === 'object' && value !== null && #resolve in value;
  }

  /** Adopt an author value into a new promise with the declared fulfillment type. */
  // https://webidl.spec.whatwg.org/#js-to-promise
  static fromJS(value: unknown, type: WebIDLType, realm: WebIDLRealm, realizeException?: ExceptionRealizer): PromiseCarrier {
    const promise = new PromiseCarrier(type, realm, realizeException);
    promise.resolve(value);
    return promise;
  }

  /** Create a promise resolved with an IDL value converted in the supplied context. */
  // https://webidl.spec.whatwg.org/#js-promise-manipulation
  static fromIDL(value: unknown, type: WebIDLType, context: ConversionContext): PromiseCarrier {
    const promise = new PromiseCarrier(type, context.realm, context.binding.realizeException);
    const jsValue = PromiseCarrier.is(value) ? value.promise : idlToJS(value, type, context);
    promise.resolve(jsValue);
    return promise;
  }

  /** Create a rejected promise in the supplied realm, optionally realizing internal failures. */
  // https://webidl.spec.whatwg.org/#js-promise-manipulation
  static rejected(reason: unknown, type: WebIDLType, realm: WebIDLRealm, realizeException?: ExceptionRealizer): PromiseCarrier {
    const promise = new PromiseCarrier(type, realm, realizeException);
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

  /** Reject once, realizing an internal exception request when configured. */
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
  react(
    resultType: WebIDLType,
    steps: PromiseReactionSteps,
    realm: WebIDLRealm,
    realizeException?: ExceptionRealizer,
  ): PromiseCarrier {
    const resultPromise = new PromiseCarrier(resultType, this.realm, realizeException);
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

  /** Convert fulfillment values inside an implementation promise's native reaction. */
  toImpl<Result>(context: ConversionContext, convertValue: (value: unknown) => Result, P: typeof InternalPromise): InternalPromise<Result> {
    const conversionContext = { binding: context.binding, realm: this.realm };
    return P.fromNative(this.promise, (value) =>
      convertValue(jsToIDL(value, this.type, conversionContext)), implementationType<Result>(this.type));
  }
}

/** Add this binding's result conversion to the realm's implementation Promise constructor. */
export function createWebIDLPromiseConstructor(context: BindingContext): typeof InternalPromise {
  return class WebIDLPromise<T> extends context.realm.Promise<T> {
    static override withResolvers<T>(type: PromiseResultType<T>): InternalPromiseWithResolvers<T> {
      if (type.kind === 'implementation') return super.withResolvers(type);
      const resultType = type as ImplementationType<T>;
      const carrier = new PromiseCarrier(resultType, context.realm, (value) => context.realizeException(value));
      const promise = new this(carrier.promise, type, (value) => context.jsToImpl(value, resultType));
      return {
        promise,
        get isResolved() { return carrier.resolved; },
        resolve(value) {
          try {
            if (value instanceof InternalPromise) {
              carrier.resolve(value.backing);
            } else {
              // Conversion precedes the native resolving function, including reentrant resolution.
              carrier.resolve(context.implToJS(value, resultType));
            }
          } catch (error) { carrier.reject(error); }
        },
        reject(reason) { carrier.reject(reason); },
      };
    }
  };
}

// https://webidl.spec.whatwg.org/#js-promise-manipulation
export function waitForAll(
  promises: PromiseCarrier[],
  successSteps: (values: unknown[]) => void,
  failureSteps: (reason: unknown) => void,
  context: ConversionContext,
): void {
  if (promises.length === 0) {
    context.realm.queueMicrotask(() => successSteps([]));
    return;
  }

  let fulfilledCount = 0;
  let rejected = false;
  const results = Array.from({ length: promises.length });
  const onRejected = context.realm.createFunction(
    (_thisArgument, [reason]) => {
      if (!rejected) {
        rejected = true;
        failureSteps(reason);
      }
    },
    { length: 1, name: '' },
  );

  promises.forEach((promise, index) => {
    const onFulfilled = context.realm.createFunction(
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

// https://webidl.spec.whatwg.org/#waiting-for-all-promise
export function getPromiseForWaitingForAll(
  promises: PromiseCarrier[],
  type: WebIDLType,
  context: ConversionContext,
): PromiseCarrier {
  const promise = new PromiseCarrier(context.binding.assembly.getSequenceType(type), context.realm, context.binding.realizeException);
  waitForAll(
    promises,
    (values) => {
      const jsValues = idlToJS(values, promise.type, context);
      promise.resolve(jsValues);
    },
    (reason) => promise.reject(reason),
    context,
  );
  return promise;
}

/** Reaction steps that receive and return JS values without implicit conversion. */
export type PromiseReactionSteps = {
  fulfilled?(this: void, value: unknown): unknown;
  rejected?(this: void, reason: unknown): unknown;
};

type PromiseSettlement = (value?: unknown) => void;
type ExceptionRealizer = (value: unknown) => unknown;
