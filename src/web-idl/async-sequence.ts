import { getMethod, isObject } from '../js-engine/index';
import type { PromiseValue } from '../js-engine/promises';

import {
  idlType, type AsyncSequenceType, type WebIDLType,
} from './core/index';
import type { WebIDLRealmHost } from './js-realm';
import {
  createIDLPromise, type IDLPromise,
} from './promise-value';
import { defineDataProperty } from './property';

/** Converted iteration steps supplied to implementation algorithms. */
export type AsyncSequenceValue<T> = {
  next(): PromiseValue<T | typeof endOfIteration>;
  return(reason: unknown): PromiseValue<unknown>;
};

// Project helper: retain the async-sequence record with its element type.
// Web IDL §3.2.22 Async sequences — async_sequence<T>.
export function createIDLAsyncSequence(
  object: object,
  elementType: WebIDLType,
  method: JSMethod,
  iteratorType: AsyncSequenceIteratorType,
): IDLAsyncSequence {
  return {
    [asyncSequenceBrand]: true,
    elementType,
    iteratorType,
    method,
    object,
  };
}

// Web IDL §3.2.22 Async sequences — convert a JavaScript value to an async sequence.
export function convertJavaScriptValueToAsyncSequence(
  value: unknown,
  type: AsyncSequenceType,
  realm: WebIDLRealmHost,
): IDLAsyncSequence {
  if (!isObject(value)) {
    throw new realm.intrinsics.typeError(
      'An async sequence value must be an object',
    );
  }

  const asyncMethod = getMethod(value, Symbol.asyncIterator, realm);
  if (asyncMethod) {
    return createIDLAsyncSequence(value, type.type, asyncMethod, 'async');
  }
  const syncMethod = getMethod(value, Symbol.iterator, realm);
  if (!syncMethod) {
    throw new realm.intrinsics.typeError('Value is not asynchronously iterable');
  }
  return createIDLAsyncSequence(value, type.type, syncMethod, 'sync');
}

// Web IDL §3.2.22 Async sequences — convert an async sequence to a JavaScript value.
export function convertAsyncSequenceToJavaScript(value: unknown): object {
  if (!isIDLAsyncSequence(value)) {
    throw new Error('IDL async sequence is not an async sequence value');
  }
  return value.object;
}

// Web IDL §3.2.22.1 Iterating async sequences — open an async sequence.
export function openAsyncSequence(
  sequence: IDLAsyncSequence,
  realm: WebIDLRealmHost,
): IDLAsyncIterator {
  let record = getIteratorFromMethod(sequence.object, sequence.method, realm);
  if (sequence.iteratorType === 'sync') {
    record = createAsyncFromSyncIterator(record, realm);
  }
  return { elementType: sequence.elementType, record };
}

// Web IDL §3.2.22.1 Iterating async sequences — get the next value.
export function getAsyncIteratorNextValue(
  iterator: IDLAsyncIterator,
  realm: WebIDLRealmHost,
  convert: (value: unknown, type: WebIDLType) => unknown,
): IDLPromise {
  let nextResult: unknown;
  try {
    nextResult = Reflect.apply(
      iterator.record.nextMethod,
      iterator.record.iterator,
      [],
    );
    if (!isObject(nextResult)) {
      throw new realm.intrinsics.typeError('Iterator result is not an object');
    }
  } catch (exception) {
    return createRejectedPromise(exception, realm);
  }

  const nextPromise = createResolvedPromise(nextResult, realm);
  return reactToPromise(nextPromise, realm, (iterationResult) => {
    if (!isObject(iterationResult)) {
      throw new realm.intrinsics.typeError('Iterator result is not an object');
    }
    if (Reflect.get(iterationResult, 'done')) return endOfIteration;
    return convert(
      Reflect.get(iterationResult, 'value'),
      iterator.elementType,
    );
  });
}

// Web IDL §3.2.22.1 Iterating async sequences — close an async iterator.
export function closeAsyncIterator(
  iterator: IDLAsyncIterator,
  reason: unknown,
  realm: WebIDLRealmHost,
): IDLPromise {
  let returnMethod: JSMethod | undefined;
  try {
    returnMethod = getMethod(iterator.record.iterator, 'return', realm);
  } catch (exception) {
    return createRejectedPromise(exception, realm);
  }
  if (!returnMethod) return createResolvedPromise(undefined, realm);

  let returnResult: unknown;
  try {
    returnResult = Reflect.apply(
      returnMethod,
      iterator.record.iterator,
      [reason],
    );
  } catch (exception) {
    return createRejectedPromise(exception, realm);
  }

  return reactToPromise(
    createResolvedPromise(returnResult, realm),
    realm,
    (result) => {
      if (!isObject(result)) {
        throw new realm.intrinsics.typeError('Iterator return result is not an object');
      }
      return undefined;
    },
  );
}

// Project helper: recognize our retained async-sequence value.
export function isIDLAsyncSequence(value: unknown): value is IDLAsyncSequence {
  return isObject(value) && asyncSequenceBrand in value;
}

export type IDLAsyncSequence = {
  [asyncSequenceBrand]: true;
  elementType: WebIDLType;
  iteratorType: AsyncSequenceIteratorType;
  method: JSMethod;
  object: object;
};

export type IDLAsyncIterator = {
  elementType: WebIDLType;
  record: IteratorRecord;
};

export const endOfIteration: unique symbol = Symbol(
  'Web IDL end of iteration',
);

const asyncSequenceBrand: unique symbol = Symbol('Web IDL async sequence');

type AsyncSequenceIteratorType = 'async' | 'sync';

type IteratorRecord = {
  iterator: object;
  nextMethod: JSMethod;
};

type JSMethod = (
  this: unknown,
  ...argumentsList: unknown[]
) => unknown;

// Project adapter for ECMAScript §7.4.3 GetIteratorFromMethod.
function getIteratorFromMethod(
  object: object,
  method: JSMethod,
  realm: WebIDLRealmHost,
): IteratorRecord {
  const iterator = Reflect.apply(method, object, []);
  if (!isObject(iterator)) {
    throw new realm.intrinsics.typeError('Iterator method did not return an object');
  }
  const nextMethod = getMethod(iterator, 'next', realm);
  if (!nextMethod) {
    throw new realm.intrinsics.typeError('Iterator has no next method');
  }
  return { iterator, nextMethod };
}

// Project adapter for ECMAScript §27.1.5.1 CreateAsyncFromSyncIterator, supplying next and return.
function createAsyncFromSyncIterator(
  sync: IteratorRecord,
  realm: WebIDLRealmHost,
): IteratorRecord {
  const iterator = realm.createOrdinaryObject(
    realm.intrinsics.iteration.asyncIteratorPrototype,
  );
  const next = realm.createFunction(
    (_thisArgument, argumentsList) => adaptSyncIteratorResult(
      sync,
      'next',
      argumentsList,
      realm,
    ).promise,
    { length: 1, name: 'next' },
  );
  const return_ = realm.createFunction(
    (_thisArgument, argumentsList) => adaptSyncIteratorResult(
      sync,
      'return',
      argumentsList,
      realm,
    ).promise,
    { length: 1, name: 'return' },
  );
  defineDataProperty(iterator, 'next', next);
  defineDataProperty(iterator, 'return', return_);
  return { iterator, nextMethod: next };
}

// Project adapter for ECMAScript §27.1.5 Async-from-Sync Iterator Objects —
// next, return, and AsyncFromSyncIteratorContinuation.
function adaptSyncIteratorResult(
  sync: IteratorRecord,
  operation: 'next' | 'return',
  argumentsList: unknown[],
  realm: WebIDLRealmHost,
): IDLPromise {
  let method: JSMethod | undefined;
  try {
    method = operation === 'next'
      ? sync.nextMethod
      : getMethod(sync.iterator, 'return', realm);
    if (!method) {
      return createResolvedPromise(
        realm.createIteratorResultObject(argumentsList[0], true),
        realm,
      );
    }

    const result = Reflect.apply(method, sync.iterator, argumentsList);
    if (!isObject(result)) {
      throw new realm.intrinsics.typeError('Iterator result is not an object');
    }
    const done = Boolean(Reflect.get(result, 'done'));
    const valuePromise = createResolvedPromise(
      Reflect.get(result, 'value'),
      realm,
    );
    return reactToPromise(valuePromise, realm, (value) =>
      realm.createIteratorResultObject(value, done));
  } catch (exception) {
    return createRejectedPromise(exception, realm);
  }
}

// Project helper: react to adaptation promises without IDL value conversion.
// Web IDL §3.2.24.1 Creating and manipulating Promises — react.
function reactToPromise(
  promise: IDLPromise,
  realm: WebIDLRealmHost,
  fulfilled: (value: unknown) => unknown,
): IDLPromise {
  const result = createIDLPromise(idlType.any, realm);
  const onFulfilled = realm.createFunction(
    (_thisArgument, [value]) => {
      try {
        result.resolve(fulfilled(value));
      } catch (exception) {
        result.reject(exception);
      }
    },
    { length: 1, name: '' },
  );
  const onRejected = realm.createFunction(
    (_thisArgument, [reason]) => { result.reject(reason); },
    { length: 1, name: '' },
  );
  realm.observePromise(
    promise.promise,
    onFulfilled,
    onRejected,
  );
  return result;
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — create a resolved Promise<any>.
function createResolvedPromise(
  value: unknown,
  realm: WebIDLRealmHost,
): IDLPromise {
  const promise = createIDLPromise(idlType.any, realm);
  promise.resolve(value);
  return promise;
}

// Web IDL §3.2.24.1 Creating and manipulating Promises — create a rejected Promise<any>.
function createRejectedPromise(
  reason: unknown,
  realm: WebIDLRealmHost,
): IDLPromise {
  const promise = createIDLPromise(idlType.any, realm);
  promise.reject(reason);
  return promise;
}
