import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import { idlType, sequence, type WebIDLType } from './declaration/index';
import {
  createPromiseValue, isPromiseValue, type IDLPromise,
} from './promise-value';
import { getUnannotatedType } from './types';

export function createPromise(
  type: WebIDLType,
  context: ConversionContext,
): IDLPromise {
  return createPromiseValue(type, context.realm, context.realizeException);
}

export function createResolvedPromise(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): IDLPromise {
  const javaScriptValue = convertToJavaScript(value, type, context);
  const promise = createPromise(type, context);
  promise.resolve(javaScriptValue);
  return promise;
}

export function createRejectedPromise(
  reason: unknown,
  type: WebIDLType,
  context: ConversionContext,
): IDLPromise {
  const promise = createPromise(type, context);
  rejectPromise(promise, reason);
  return promise;
}

export function resolvePromise(
  promise: IDLPromise,
  value: unknown,
  context: ConversionContext,
): void {
  promise.resolve(convertToJavaScript(
    value,
    promise.type,
    withPromiseRealm(context, promise),
  ));
}

export function rejectPromise(
  promise: IDLPromise,
  reason: unknown,
): void {
  promise.reject(reason);
}

export function reactToPromise(
  promise: IDLPromise,
  resultType: WebIDLType,
  steps: PromiseReactionSteps,
  context: ConversionContext,
): IDLPromise {
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

  performPromiseThen(promise, onFulfilled, onRejected);
  return resultPromise;
}

export function uponPromiseFulfillment(
  promise: IDLPromise,
  steps: (value: unknown) => void,
  context: ConversionContext,
): IDLPromise {
  return reactToPromise(
    promise,
    idlType.undefined,
    { fulfilled: steps },
    context,
  );
}

export function uponPromiseRejection(
  promise: IDLPromise,
  steps: (reason: unknown) => void,
  context: ConversionContext,
): IDLPromise {
  return reactToPromise(
    promise,
    idlType.undefined,
    { rejected: steps },
    context,
  );
}

export function waitForAll(
  promises: readonly IDLPromise[],
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
    performPromiseThen(promise, onFulfilled, onRejected);
  });
}

export function getPromiseForWaitingForAll(
  promises: readonly IDLPromise[],
  type: WebIDLType,
  context: ConversionContext,
): IDLPromise {
  const promise = createPromise(sequence(type), context);
  waitForAll(
    promises,
    (values) => resolvePromise(promise, values, context),
    (reason) => rejectPromise(promise, reason),
    context,
  );
  return promise;
}

export function markPromiseAsHandled(promise: IDLPromise): void {
  // ECMAScript does not expose [[PromiseIsHandled]]. Attaching a rejection
  // reaction performs the same state transition on the original promise.
  const onRejected = promise.realm.createFunction(
    () => undefined,
    { length: 1, name: '' },
  );
  performPromiseThen(promise, undefined, onRejected);
}

export type PromiseReactionSteps = {
  fulfilled?(this: void, value: unknown): unknown;
  rejected?(this: void, reason: unknown): unknown;
};

function settleReaction(
  result: unknown,
  promise: IDLPromise,
  resultType: WebIDLType,
  context: ConversionContext,
): void {
  promise.resolve(isPromiseValue(result)
    ? result.promise
    : convertToJavaScript(result, resultType, context));
}

function withPromiseRealm(
  context: ConversionContext,
  promise: IDLPromise,
): ConversionContext {
  return {
    definitions: context.definitions,
    hostDefinedInterfaces: context.hostDefinedInterfaces,
    platformObjects: context.platformObjects,
    realizeException: context.realizeException,
    realm: promise.realm,
  };
}

function isUndefinedType(
  type: WebIDLType,
  context: ConversionContext,
): boolean {
  const resolved = getUnannotatedType(type, context.definitions);
  return resolved.kind === 'simple' && resolved.name === 'undefined';
}

function performPromiseThen(
  promise: IDLPromise,
  onFulfilled: PromiseReaction | undefined,
  onRejected: PromiseReaction | undefined,
): void {
  // JavaScript does not expose PerformPromiseThen without a result
  // capability. This call has the same reaction behavior, but also creates an
  // unreachable derived promise and can observe an overridden constructor.
  Reflect.apply(
    promise.realm.intrinsics.promise.then,
    promise.promise,
    [onFulfilled, onRejected],
  );
}

type PromiseReaction = (...argumentsList: unknown[]) => unknown;
