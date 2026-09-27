import { InternalPromise, type InternalPromiseWithResolvers, type PromiseResultType } from '../infra/promises';
import type { BindingContext } from './binding-context';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import { idlType, implementationType, sequence, type ImplementationType, type WebIDLType } from './core/index';
import {
  createIDLPromiseRecord, isIDLPromiseRecord, type IDLPromiseRecord,
} from './promise-record';
import { getUnannotatedType } from './types';

/** Add this binding's result conversion to the realm's implementation Promise constructor. */
export function createWebIDLPromiseConstructor(context: BindingContext): typeof InternalPromise {
  return class WebIDLPromise<T> extends context.realm.Promise<T> {
    static override withResolvers<T>(type: PromiseResultType<T>): InternalPromiseWithResolvers<T> {
      if (type.kind === 'implementation') return super.withResolvers(type);
      const resultType = type as ImplementationType<T>;
      const record = createIDLPromiseRecord(resultType, context.realm, (value) => context.realizeException(value));
      const promise = new this(record.promise, type, (value) => context.convertToImpl(value, resultType) as T);
      return {
        promise,
        get isResolved() { return record.resolved; },
        resolve(value) {
          try {
            if (value instanceof InternalPromise) {
              record.resolve(value.backing);
            } else {
              // Conversion precedes the native resolving function, including reentrant resolution.
              record.resolve(context.convertToJavaScript(value, resultType));
            }
          } catch (error) { record.reject(error); }
        },
        reject: record.reject,
      };
    }
  };
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — create a new promise.
export function createPromise(
  type: WebIDLType,
  context: ConversionContext,
): IDLPromiseRecord {
  return createIDLPromiseRecord(type, context.realm, context.binding.realizeException);
}

// Project adapter: convert author fulfillment values for an implementation's promise queue.
/** Convert fulfillment values inside the implementation's native reaction. */
export function toImplementationPromise(
  promise: IDLPromiseRecord,
  context: ConversionContext,
  convertValue: (value: unknown) => unknown,
  P: typeof InternalPromise,
): InternalPromise<unknown> {
  const conversionContext = { binding: context.binding, realm: promise.realm };
  return P.fromNative(promise.promise, (value) =>
    convertValue(convertToIDL(value, promise.type, conversionContext)), implementationType<unknown>(promise.type));
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — create a resolved promise.
export function createResolvedPromise(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): IDLPromiseRecord {
  const promise = createPromise(type, context);
  promise.resolve(toPromiseResolution(value, type, context));
  return promise;
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — create a rejected promise.
export function createRejectedPromise(
  reason: unknown,
  type: WebIDLType,
  context: ConversionContext,
): IDLPromiseRecord {
  const promise = createPromise(type, context);
  rejectPromise(promise, reason);
  return promise;
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — resolve.
export function resolvePromise(
  promise: IDLPromiseRecord,
  value: unknown,
  context: ConversionContext,
): void {
  promise.resolve(toPromiseResolution(value, promise.type, context));
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — reject.
export function rejectPromise(
  promise: IDLPromiseRecord,
  reason: unknown,
): void {
  promise.reject(reason);
}

// Project helper: inspect whether either resolving function has been accepted.
export function isPromiseUnresolved(promise: IDLPromiseRecord): boolean {
  return !promise.resolved;
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — react.
export function reactToPromise(
  promise: IDLPromiseRecord,
  resultType: WebIDLType,
  steps: PromiseReactionSteps,
  context: ConversionContext,
): IDLPromiseRecord {
  const resultPromise = createIDLPromiseRecord(
    resultType, promise.realm, context.binding.realizeException,
  );
  const onFulfilled = context.realm.createFunction(
    (_thisArgument, [value]) => {
      try {
        const idlValue = convertToIDL(value, promise.type, context);
        resolvePromise(
          resultPromise,
          steps.fulfilled
            ? Reflect.apply(
              steps.fulfilled,
              undefined,
              isUndefinedType(promise.type, context)
                ? []
                : [idlValue],
            )
            : idlValue,
          context,
        );
      } catch (exception) {
        resultPromise.reject(exception);
      }
    },
    { length: 1, name: '' },
  );
  const onRejected = context.realm.createFunction(
    (_thisArgument, [reason]) => {
      try {
        resolvePromise(
          resultPromise,
          steps.rejected
            ? Reflect.apply(steps.rejected, undefined, [reason])
            : createRejectedPromise(
              reason,
              resultType,
              context,
            ),
          context,
        );
      } catch (exception) {
        resultPromise.reject(exception);
      }
    },
    { length: 1, name: '' },
  );

  promise.realm.observePromise(
    promise.promise,
    onFulfilled,
    onRejected,
  );
  return resultPromise;
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — upon fulfillment.
export function uponPromiseFulfillment(
  promise: IDLPromiseRecord,
  steps: (value: unknown) => void,
  context: ConversionContext,
): IDLPromiseRecord {
  return reactToPromise(
    promise,
    idlType.undefined,
    { fulfilled: steps },
    context,
  );
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — upon rejection.
export function uponPromiseRejection(
  promise: IDLPromiseRecord,
  steps: (reason: unknown) => void,
  context: ConversionContext,
): IDLPromiseRecord {
  return reactToPromise(
    promise,
    idlType.undefined,
    { rejected: steps },
    context,
  );
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — wait for all.
export function waitForAll(
  promises: IDLPromiseRecord[],
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

// Web IDL §3.2.24.1 Creating and manipulating Promises — get a promise for waiting for all.
export function getPromiseForWaitingForAll(
  promises: IDLPromiseRecord[],
  type: WebIDLType,
  context: ConversionContext,
): IDLPromiseRecord {
  const promise = createPromise(sequence(type), context);
  waitForAll(
    promises,
    (values) => resolvePromise(promise, values, context),
    (reason) => rejectPromise(promise, reason),
    context,
  );
  return promise;
}

// Project implementation of Web IDL §3.2.24.1 Creating and manipulating Promises — mark as handled.
export function markPromiseAsHandled(promise: IDLPromiseRecord): void {
  // ECMAScript does not expose [[PromiseIsHandled]]. Attaching a rejection
  // reaction performs the same state transition on the original promise.
  const onRejected = promise.realm.createFunction(
    () => undefined,
    { length: 1, name: '' },
  );
  promise.realm.observePromise(
    promise.promise,
    undefined,
    onRejected,
  );
}

export type PromiseReactionSteps = {
  fulfilled?(this: void, value: unknown): unknown;
  rejected?(this: void, reason: unknown): unknown;
};

// Project helper: unwrap an IDL promise or project an ordinary resolution value.
function toPromiseResolution(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): unknown {
  return isIDLPromiseRecord(value)
    ? value.promise
    : convertToJavaScript(value, type, context);
}

// Project helper: identify Promise<undefined> reactions that receive no fulfillment argument.
function isUndefinedType(
  type: WebIDLType,
  context: ConversionContext,
): boolean {
  const resolved = getUnannotatedType(type, context.binding.definitions);
  return resolved.kind === 'simple' && resolved.name === 'undefined';
}
