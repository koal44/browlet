import { defineDataProperty, getMethod, isObject, type JSMethod } from '../../js-engine/index';
import type { InternalPromise } from '../../infra/promises';
import { idlType, type AsyncSequenceType, type WebIDLType } from '../core/index';
import type { WebIDLRealm } from '../environment';
import type { ConversionContext } from '../conversion-context';
import { PromiseCarrier } from './promise';

/** Converted iteration steps supplied to implementation algorithms. */
export type AsyncSequenceValue<T> = {
  next(): InternalPromise<T | typeof endOfIteration>;
  return(reason: unknown): InternalPromise<unknown>;
};

/** An iterable with the captured method and type needed to open its sequence. */
export class AsyncSequenceCarrier {
  /** Private identity tested without inspecting author iterable properties. */
  #brand = undefined;
  /** Original author iterable, preserved for identity and invocation. */
  object: object;
  /** Declared conversion applied to each yielded value. */
  elementType: WebIDLType;
  /** Iterator method captured when the author value was converted. */
  method: JSMethod;
  /** Whether opening needs an async-from-sync iterator. */
  iteratorType: AsyncSequenceIteratorType;

  constructor(object: object, elementType: WebIDLType, method: JSMethod, iteratorType: AsyncSequenceIteratorType) {
    this.object = object;
    this.elementType = elementType;
    this.method = method;
    this.iteratorType = iteratorType;
  }

  /** Recognize a converted async sequence. */
  static is(value: unknown): value is AsyncSequenceCarrier {
    return isObject(value) && #brand in value;
  }

  /** Capture the author's iterable and its selected iteration method. */
  // https://webidl.spec.whatwg.org/#js-to-async-iterable
  static fromJS(value: unknown, context: ConversionContext): AsyncSequenceCarrier {
    const type = context.resolvedType as AsyncSequenceType;
    const { realm } = context;
    if (!isObject(value)) {
      throw new realm.intrinsics.typeError(
        'An async sequence value must be an object',
      );
    }

    const asyncMethod = getMethod(value, Symbol.asyncIterator, realm);
    if (asyncMethod) {
      return new AsyncSequenceCarrier(value, type.type, asyncMethod, 'async');
    }
    const syncMethod = getMethod(value, Symbol.iterator, realm);
    if (!syncMethod) {
      throw new realm.intrinsics.typeError('Value is not asynchronously iterable');
    }
    return new AsyncSequenceCarrier(value, type.type, syncMethod, 'sync');
  }

  /** Open a fresh iterator using the method captured during conversion. */
  // https://webidl.spec.whatwg.org/#async-sequence-open
  open(realm: WebIDLRealm): AsyncIteratorCarrier {
    let record = IteratorRecord.fromMethod(this.object, this.method, realm);
    if (this.iteratorType === 'sync') record = record.toAsync(realm);
    return new AsyncIteratorCarrier(this.elementType, record);
  }
}

/** An opened iterator with the conversion type of its yielded values. */
export class AsyncIteratorCarrier {
  /** Declared conversion applied to each yielded value. */
  elementType: WebIDLType;
  /** Live iterator and its captured next method. */
  record: IteratorRecord;

  constructor(elementType: WebIDLType, record: IteratorRecord) {
    this.elementType = elementType;
    this.record = record;
  }

  /** Advance this iterator and convert the next yielded value. */
  // https://webidl.spec.whatwg.org/#async-iterator-get-next-value
  nextValue(realm: WebIDLRealm, convert: (value: unknown, type: WebIDLType) => unknown): PromiseCarrier {
    let nextResult: unknown;
    try {
      nextResult = Reflect.apply(
        this.record.nextMethod,
        this.record.iterator,
        [],
      );
      if (!isObject(nextResult)) {
        throw new realm.intrinsics.typeError('Iterator result is not an object');
      }
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, realm);
    }

    const nextPromise = PromiseCarrier.fromJS(nextResult, idlType.any, realm);
    return nextPromise.react(idlType.any, {
      fulfilled: (iterationResult) => {
        if (!isObject(iterationResult)) {
          throw new realm.intrinsics.typeError('Iterator result is not an object');
        }
        const iteration = iterationResult as { done?: unknown; value?: unknown; };
        if (iteration.done) return endOfIteration;
        return convert(iteration.value, this.elementType);
      },
    }, realm);
  }

  /** Close this iterator with the supplied reason. */
  // https://webidl.spec.whatwg.org/#async-iterator-close
  close(reason: unknown, realm: WebIDLRealm): PromiseCarrier {
    let returnMethod: JSMethod | undefined;
    try {
      returnMethod = getMethod(this.record.iterator, 'return', realm);
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, realm);
    }
    if (!returnMethod) return PromiseCarrier.fromJS(undefined, idlType.any, realm);

    let returnResult: unknown;
    try {
      returnResult = Reflect.apply(
        returnMethod,
        this.record.iterator,
        [reason],
      );
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, realm);
    }

    const returnPromise = PromiseCarrier.fromJS(returnResult, idlType.any, realm);
    return returnPromise.react(idlType.any, {
      fulfilled: (result) => {
        if (!isObject(result)) {
          throw new realm.intrinsics.typeError('Iterator return result is not an object');
        }
        return undefined;
      },
    }, realm);
  }
}

export const endOfIteration: unique symbol = Symbol(
  'Web IDL end of iteration',
);

type AsyncSequenceIteratorType = 'async' | 'sync';

/** A live iterator and its captured next method, without Web IDL element conversion. */
class IteratorRecord {
  /** Object used as the receiver when calling iteration methods. */
  iterator: object;
  /** Next method captured when the iterator was opened. */
  nextMethod: JSMethod;

  constructor(iterator: object, nextMethod: JSMethod) {
    this.iterator = iterator;
    this.nextMethod = nextMethod;
  }

  /** Open an iterator and capture the next method used for subsequent steps. */
  // https://tc39.es/ecma262/#sec-getiteratorfrommethod
  static fromMethod(object: object, method: JSMethod, realm: WebIDLRealm): IteratorRecord {
    const iterator = Reflect.apply(method, object, []);
    if (!isObject(iterator)) {
      throw new realm.intrinsics.typeError('Iterator method did not return an object');
    }
    const nextMethod = getMethod(iterator, 'next', realm);
    if (!nextMethod) {
      throw new realm.intrinsics.typeError('Iterator has no next method');
    }
    return new IteratorRecord(iterator, nextMethod);
  }

  /** Create an async iterator that awaits values yielded by this synchronous iterator. */
  // https://tc39.es/ecma262/#sec-createasyncfromsynciterator
  toAsync(realm: WebIDLRealm): IteratorRecord {
    const iterator = realm.createOrdinaryObject(realm.intrinsics.iteration.asyncIteratorPrototype);
    const next = realm.createFunction(
      (_thisArgument, args) => this.#invokeAsAsync('next', args, realm).promise,
      { length: 1, name: 'next' },
    );
    const return_ = realm.createFunction(
      (_thisArgument, args) => this.#invokeAsAsync('return', args, realm).promise,
      { length: 1, name: 'return' },
    );
    defineDataProperty(iterator, 'next', next);
    defineDataProperty(iterator, 'return', return_);
    return new IteratorRecord(iterator, next);
  }

  /** Invoke next or return, await its value, and create an async iterator result. */
  // https://tc39.es/ecma262/#sec-async-from-sync-iterator-objects
  // Combines next/return with AsyncFromSyncIteratorContinuation for this adapter.
  #invokeAsAsync(operation: 'next' | 'return', args: unknown[], realm: WebIDLRealm): PromiseCarrier {
    try {
      const method = operation === 'next' ? this.nextMethod : getMethod(this.iterator, 'return', realm);
      if (!method) {
        return PromiseCarrier.fromJS(realm.createIteratorResultObject(args[0], true), idlType.any, realm);
      }
      const result = Reflect.apply(method, this.iterator, args);
      if (!isObject(result)) {
        throw new realm.intrinsics.typeError('Iterator result is not an object');
      }
      const iteration = result as { done?: unknown; value?: unknown; };
      const done = Boolean(iteration.done);
      const valuePromise = PromiseCarrier.fromJS(iteration.value, idlType.any, realm);
      return valuePromise.react(idlType.any, {
        fulfilled: (value) => realm.createIteratorResultObject(value, done),
      }, realm);
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, realm);
    }
  }
}
