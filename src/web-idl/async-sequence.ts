import {
  idlType, type AsyncSequenceType, type WebIDLType,
} from './adapter/definition';
import type { WebIDLRealmHost } from './javascript-realm';
import {
  createPromiseValue, type IDLPromise,
} from './promise-value';

export function createAsyncSequenceValue(
  object: object,
  elementType: WebIDLType,
  method: JavaScriptMethod,
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
    return createAsyncSequenceValue(value, type.type, asyncMethod, 'async');
  }
  const syncMethod = getMethod(value, Symbol.iterator, realm);
  if (!syncMethod) {
    throw new realm.intrinsics.typeError('Value is not asynchronously iterable');
  }
  return createAsyncSequenceValue(value, type.type, syncMethod, 'sync');
}

export function convertAsyncSequenceToJavaScript(value: unknown): object {
  if (!isAsyncSequence(value)) {
    throw new Error('IDL async sequence is not an async sequence value');
  }
  return value.object;
}

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

export function closeAsyncIterator(
  iterator: IDLAsyncIterator,
  reason: unknown,
  realm: WebIDLRealmHost,
): IDLPromise {
  let returnMethod: JavaScriptMethod | undefined;
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

export function isAsyncSequence(value: unknown): value is IDLAsyncSequence {
  return isObject(value) && asyncSequenceBrand in value;
}

export type IDLAsyncSequence = {
  [asyncSequenceBrand]: true;
  elementType: WebIDLType;
  iteratorType: AsyncSequenceIteratorType;
  method: JavaScriptMethod;
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
  nextMethod: JavaScriptMethod;
};

type JavaScriptMethod = (
  this: unknown,
  ...argumentsList: unknown[]
) => unknown;

function getIteratorFromMethod(
  object: object,
  method: JavaScriptMethod,
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

function createAsyncFromSyncIterator(
  sync: IteratorRecord,
  realm: WebIDLRealmHost,
): IteratorRecord {
  const iterator = createRealmObject(
    realm,
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

function adaptSyncIteratorResult(
  sync: IteratorRecord,
  operation: 'next' | 'return',
  argumentsList: unknown[],
  realm: WebIDLRealmHost,
): IDLPromise {
  let method: JavaScriptMethod | undefined;
  try {
    method = operation === 'next'
      ? sync.nextMethod
      : getMethod(sync.iterator, 'return', realm);
    if (!method) {
      return createResolvedPromise(
        createIteratorResult(realm, argumentsList[0], true),
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
      createIteratorResult(realm, value, done));
  } catch (exception) {
    return createRejectedPromise(exception, realm);
  }
}

function reactToPromise(
  promise: IDLPromise,
  realm: WebIDLRealmHost,
  fulfilled: (value: unknown) => unknown,
): IDLPromise {
  const result = createPromiseValue(idlType.any, realm);
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
  Reflect.apply(
    realm.intrinsics.promise.then,
    promise.promise,
    [onFulfilled, onRejected],
  );
  return result;
}

function createResolvedPromise(
  value: unknown,
  realm: WebIDLRealmHost,
): IDLPromise {
  const promise = createPromiseValue(idlType.any, realm);
  promise.resolve(value);
  return promise;
}

function createRejectedPromise(
  reason: unknown,
  realm: WebIDLRealmHost,
): IDLPromise {
  const promise = createPromiseValue(idlType.any, realm);
  promise.reject(reason);
  return promise;
}

function getMethod(
  object: object,
  key: PropertyKey,
  realm: WebIDLRealmHost,
): JavaScriptMethod | undefined {
  const method = Reflect.get(object, key) as unknown;
  if (method === undefined || method === null) return;
  if (typeof method !== 'function') {
    throw new realm.intrinsics.typeError(`${String(key)} is not callable`);
  }
  return method as JavaScriptMethod;
}

function createIteratorResult(
  realm: WebIDLRealmHost,
  value: unknown,
  done: boolean,
): object {
  const result = createRealmObject(realm, realm.intrinsics.objectPrototype);
  defineDataProperty(result, 'value', value);
  defineDataProperty(result, 'done', done);
  return result;
}

function createRealmObject(
  realm: WebIDLRealmHost,
  prototype: object | null,
): object {
  const object = Reflect.construct(realm.intrinsics.object, []);
  if (!Reflect.setPrototypeOf(object, prototype)) {
    throw new Error('Could not set a Web IDL object prototype');
  }
  return object;
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
