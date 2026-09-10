import { PromiseValue, installPromiseReactions, type Promises } from '../js-engine/index';
import type { PlatformObjectRegistry } from './platform-object';
import type { WebIDLRealmHost } from './javascript-realm';
import {
  convertToIDL, convertToJavaScript, createBufferResult, type ConversionContext,
} from './conversion';
import type { ByteSequence } from './buffer-source';
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

/** Adapt an implementation promise to the declared result type and realm. */
export function projectPromise(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  newBufferResult = false,
): IDLPromise {
  if (isPromiseValue(value)) return value;
  const source = value as Promise<unknown> | PromiseValue<unknown>;
  let promises = promiseProjections.get(context.platformObjects);
  if (!promises) {
    promises = new WeakMap();
    promiseProjections.set(context.platformObjects, promises);
  }
  let projections = promises.get(source);
  const existing = projections?.find((entry) =>
    entry.realm === context.realm && entry.type === type &&
    entry.newBufferResult === newBufferResult);
  if (existing) return existing.promise;

  const promise = createPromise(type, context);
  if (!projections) {
    projections = [];
    promises.set(source, projections);
  }
  projections.push({ realm: context.realm, type, promise, newBufferResult });
  // These callbacks adapt implementation state; author reactions still run
  // through the projected promise's own realm and queue.
  const onFulfilled = (result: unknown): void => {
    try {
      resolvePromise(promise, newBufferResult
        ? createBufferResult(result as ByteSequence, type, context)
        : result, context);
    } catch (error) {
      promise.reject(error);
    }
  };
  const onRejected = (reason: unknown): void => {
    promise.reject(reason);
  };
  try {
    if (source instanceof PromiseValue) {
      context.realm.promises.import(source).observe(onFulfilled, onRejected);
    } else {
      installPromiseReactions(context.realm, source, onFulfilled, onRejected);
    }
  } catch (error) {
    promise.reject(error);
  }
  return promise;
}

/** Convert author fulfillment values before supplying an implementation promise. */
export function toImplementationPromise(
  promise: IDLPromise,
  context: ConversionContext,
  convertValue: (value: unknown) => unknown,
  promises: Promises,
): PromiseValue<unknown> {
  const conversionContext = withPromiseRealm(context, promise);
  return promises.import(promise.promise, (value) =>
    convertValue(convertToIDL(value, promise.type, conversionContext)));
}

export function createResolvedPromise(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): IDLPromise {
  const promise = createPromise(type, context);
  promise.resolve(toPromiseResolution(value, type, context));
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
  promise.resolve(toPromiseResolution(
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

export function isPromiseUnresolved(promise: IDLPromise): boolean {
  return !promise.resolved;
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

  installPromiseReactions(
    promise.realm,
    promise.promise,
    onFulfilled,
    onRejected,
  );
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
    installPromiseReactions(
      promise.realm,
      promise.promise,
      onFulfilled,
      onRejected,
    );
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
  installPromiseReactions(
    promise.realm,
    promise.promise,
    undefined,
    onRejected,
  );
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
  promise.resolve(toPromiseResolution(result, resultType, context));
}

function toPromiseResolution(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): unknown {
  return isPromiseValue(value)
    ? value.promise
    : convertToJavaScript(value, type, context);
}

function withPromiseRealm(
  context: ConversionContext,
  promise: IDLPromise,
): ConversionContext {
  return {
    definitions: context.definitions,
    hostDefinedInterfaces: context.hostDefinedInterfaces,
    platformObjects: context.platformObjects,
    projectImplementationObject: context.projectImplementationObject,
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

// A retained implementation promise has one projection per result type and
// realm within a binding world, including when a foreign method is borrowed.
const promiseProjections = new WeakMap<PlatformObjectRegistry, WeakMap<
  Promise<unknown> | PromiseValue<unknown>,
  {
    realm: WebIDLRealmHost;
    type: WebIDLType;
    promise: IDLPromise;
    newBufferResult: boolean;
  }[]
>>();
