import type { PromiseValue, Promises } from '../js-engine/index';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import { idlType, sequence, type WebIDLType } from './core/index';
import {
  createIDLPromiseRecord, isIDLPromiseRecord, type IDLPromiseRecord,
} from './promise-record';
import { getUnannotatedType } from './types';

// Web IDL §3.2.24.1 Creating and manipulating Promises — create a new promise.
export function createPromise(
  type: WebIDLType,
  context: ConversionContext,
): IDLPromiseRecord {
  return createIDLPromiseRecord(type, context.realm, context.realizeException);
}

// Project adapter: convert author fulfillment values for an implementation's promise queue.
/** Convert author fulfillment values before supplying an implementation promise. */
export function toImplementationPromise(
  promise: IDLPromiseRecord,
  context: ConversionContext,
  convertValue: (value: unknown) => unknown,
  promises: Promises,
): PromiseValue<unknown> {
  const conversionContext = withPromiseRealm(context, promise);
  return promises.import(promise.promise, (value) =>
    convertValue(convertToIDL(value, promise.type, conversionContext)));
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
  promise.resolve(toPromiseResolution(
    value,
    promise.type,
    withPromiseRealm(context, promise),
  ));
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
  const reactionContext = withPromiseRealm(context, promise);
  const resultPromise = createPromise(resultType, reactionContext);
  const onFulfilled = promise.realm.createFunction(
    (_thisArgument, [value]) => {
      try {
        const idlValue = convertToIDL(value, promise.type, reactionContext);
        settleReaction(
          steps.fulfilled
            ? Reflect.apply(
              steps.fulfilled,
              undefined,
              isUndefinedType(promise.type, reactionContext)
                ? []
                : [idlValue],
            )
            : idlValue,
          resultPromise,
          resultType,
          reactionContext,
        );
      } catch (exception) {
        resultPromise.reject(exception);
      }
    },
    { length: 1, name: '' },
  );
  const onRejected = promise.realm.createFunction(
    (_thisArgument, [reason]) => {
      try {
        settleReaction(
          steps.rejected
            ? Reflect.apply(steps.rejected, undefined, [reason])
            : createRejectedPromise(
              reason,
              resultType,
              reactionContext,
            ),
          resultPromise,
          resultType,
          reactionContext,
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
  promises: readonly IDLPromiseRecord[],
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
  promises: readonly IDLPromiseRecord[],
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

// Project helper: project a reaction result before resolving its result promise.
function settleReaction(
  result: unknown,
  promise: IDLPromiseRecord,
  resultType: WebIDLType,
  context: ConversionContext,
): void {
  promise.resolve(toPromiseResolution(result, resultType, context));
}

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

// Project helper: select the promise's realm for value conversion.
function withPromiseRealm(
  context: ConversionContext,
  promise: IDLPromiseRecord,
): ConversionContext {
  return {
    definitions: context.definitions,
    hostDefinedInterfaces: context.hostDefinedInterfaces,
    world: context.world,
    projectImplementationObject: context.projectImplementationObject,
    realizeException: context.realizeException,
    realm: promise.realm,
  };
}

// Project helper: identify Promise<undefined> reactions that receive no fulfillment argument.
function isUndefinedType(
  type: WebIDLType,
  context: ConversionContext,
): boolean {
  const resolved = getUnannotatedType(type, context.definitions);
  return resolved.kind === 'simple' && resolved.name === 'undefined';
}
