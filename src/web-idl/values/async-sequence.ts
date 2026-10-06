import { endOfIteration } from '../../infra/index';
import { getMethod, isObject, type JSMethod } from '../../js-engine/index';

import type { WebIDLRealm } from '../environment';
import { anyType, undefinedType, type IDLType, type IDLUndefinedType } from '../assembly/index';
import { IDLPromise } from './promise';
import type { IDLValue } from './value';

/** An iterable with the captured method and type needed to open its sequence. */
export class IDLAsyncSequence<Element extends IDLType = IDLType> {
  /** Private identity tested without inspecting author iterable properties. */
  #brand = undefined;
  /** Original author iterable, preserved for identity and invocation. */
  object: object;
  /** Declared conversion applied to each yielded value. */
  elementType: Element;
  /** Iterator method captured when the author value was converted. */
  method: JSMethod;
  /** Whether opening needs an async-from-sync iterator. */
  iteratorType: AsyncSequenceIteratorType;

  constructor(object: object, elementType: Element, method: JSMethod, iteratorType: AsyncSequenceIteratorType) {
    this.object = object;
    this.elementType = elementType;
    this.method = method;
    this.iteratorType = iteratorType;
  }

  /** Recognize a converted async sequence. */
  static is(value: unknown): value is IDLAsyncSequence {
    return isObject(value) && #brand in value;
  }

  /** Open a fresh iterator using the method captured during conversion. */
  // https://webidl.spec.whatwg.org/#async-sequence-open
  open(realm: WebIDLRealm): AsyncSequenceIterator<Element> {
    const record = IteratorRecord.fromMethod(this.object, this.method, realm);
    // Keep async-from-sync state directly; its private adapter is never exposed.
    if (this.iteratorType === 'sync') record.syncRealm = realm;
    return new AsyncSequenceIterator(this.elementType, record);
  }
}

/** An opened iterator with the conversion type of its yielded values. */
export class AsyncSequenceIterator<Element extends IDLType = IDLType> {
  /** Declared conversion applied to each yielded value. */
  elementType: Element;
  /** Live iterator and its captured next method. */
  record: IteratorRecord;

  constructor(elementType: Element, record: IteratorRecord) {
    this.elementType = elementType;
    this.record = record;
  }

  /** Advance this iterator and convert the next yielded value. */
  // https://webidl.spec.whatwg.org/#async-iterator-get-next-value
  nextValue(realm: WebIDLRealm, convert: (value: unknown, type: Element) => IDLValue<Element>): IDLPromise {
    let nextResult: unknown;
    try {
      nextResult = this.record.syncRealm
        ? this.record.invokeAsAsync('next', [], this.record.syncRealm).promise
        : Reflect.apply(this.record.nextMethod, this.record.iterator, []);
      if (!isObject(nextResult)) {
        throw new realm.intrinsics.typeError('Iterator result is not an object');
      }
    } catch (exception) {
      return IDLPromise.rejected(exception, anyType, realm);
    }

    const nextPromise = IDLPromise.fromJS(nextResult, anyType, realm);
    return nextPromise.react(anyType, {
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
  close(reason: unknown, realm: WebIDLRealm): IDLPromise<IDLUndefinedType> {
    let returnResult: unknown;
    try {
      if (this.record.syncRealm) {
        returnResult = this.record.invokeAsAsync('return', [reason], this.record.syncRealm).promise;
      } else {
        const returnMethod = getMethod(this.record.iterator, 'return', realm);
        if (!returnMethod) return IDLPromise.fromJS(undefined, undefinedType, realm);
        returnResult = Reflect.apply(returnMethod, this.record.iterator, [reason]);
      }
    } catch (exception) {
      return IDLPromise.rejected(exception, undefinedType, realm);
    }

    const returnPromise = IDLPromise.fromJS(returnResult, anyType, realm);
    return returnPromise.react(undefinedType, {
      fulfilled: (result) => {
        if (!isObject(result)) {
          throw new realm.intrinsics.typeError('Iterator return result is not an object');
        }
        return undefined;
      },
    }, realm);
  }
}

type AsyncSequenceIteratorType = 'async' | 'sync';

/** A live iterator and its captured next method, without Web IDL element conversion. */
class IteratorRecord {
  /** Object used as the receiver when calling iteration methods. */
  iterator: object;
  /** Next method captured when the iterator was opened. */
  nextMethod: JSMethod;
  /** Opening realm that owns synchronous adaptation's Promises, results, and errors. */
  syncRealm?: WebIDLRealm;

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

  /** Invoke next or return, await its value, and create an async iterator result. */
  // https://tc39.es/ecma262/#sec-async-from-sync-iterator-objects
  // Combines next/return with AsyncFromSyncIteratorContinuation without allocating an adapter.
  invokeAsAsync(operation: 'next' | 'return', args: unknown[], realm: WebIDLRealm): IDLPromise {
    try {
      const method = operation === 'next' ? this.nextMethod : getMethod(this.iterator, 'return', realm);
      if (!method) {
        return IDLPromise.fromJS(realm.createIteratorResultObject(args[0], true), anyType, realm);
      }
      const result = Reflect.apply(method, this.iterator, args);
      if (!isObject(result)) {
        throw new realm.intrinsics.typeError('Iterator result is not an object');
      }
      const iteration = result as { done?: unknown; value?: unknown; };
      const done = Boolean(iteration.done);
      const valuePromise = IDLPromise.fromJS(iteration.value, anyType, realm);
      return valuePromise.react(anyType, {
        fulfilled: (value) => realm.createIteratorResultObject(value, done),
      }, realm);
    } catch (exception) {
      return IDLPromise.rejected(exception, anyType, realm);
    }
  }
}
