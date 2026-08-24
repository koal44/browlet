import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { convertToIDL, convertToJavaScript } from '../../../src/web-idl/conversion';
import {
  idlType, promise as promiseType,
} from '../../../src/web-idl/declaration/index';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';
import {
  createPromise, createRejectedPromise, createResolvedPromise,
  getPromiseForWaitingForAll, markPromiseAsHandled, reactToPromise,
  uponPromiseFulfillment, uponPromiseRejection, waitForAll,
} from '../../../src/web-idl/promise';
import {
  convertPromiseToJavaScript, isPromiseValue, type IDLPromise,
} from '../../../src/web-idl/promise-value';

describe('Web IDL promises', () => {
  it('wraps JavaScript values in a target-realm PromiseCapability', async () => {
    const { binding, realm } = createBinding();
    const value = convertToIDL(
      { then(resolve: (value: string) => void) { resolve('fulfilled'); } },
      promiseType(idlType.DOMString),
      binding,
    );
    const promise = requirePromiseValue(value);
    const javaScriptValue = convertToJavaScript(
      promise,
      promiseType(idlType.DOMString),
      binding,
    );

    expect(javaScriptValue).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(javaScriptValue).not.toBeInstanceOf(Promise);
    expect(convertToJavaScript(
      promise,
      promiseType(idlType.DOMString),
      binding,
    )).toBe(javaScriptValue);
    await expect(javaScriptValue).resolves.toBe('fulfilled');
  });

  it('creates, resolves, rejects, and reacts to typed promises', async () => {
    const { binding, realm } = createBinding();
    const resolved = createResolvedPromise(4, idlType.long, binding);
    await expect(toJavaScriptPromise(resolved)).resolves.toBe(4);

    const reason = new Error('rejected');
    const rejected = createRejectedPromise(reason, idlType.long, binding);
    await expect(toJavaScriptPromise(rejected)).rejects.toBe(reason);
    await expect(toJavaScriptPromise(reactToPromise(
      rejected,
      idlType.long,
      {},
      binding,
    ))).rejects.toBe(reason);

    const input = requirePromiseValue(convertToIDL(
      '4.9',
      promiseType(idlType.long),
      binding,
    ));
    const reaction = reactToPromise(
      input,
      idlType.long,
      { fulfilled: (value) => Number(value) + 1 },
      binding,
    );
    await expect(toJavaScriptPromise(reaction)).resolves.toBe(5);

    const invalid = requirePromiseValue(convertToIDL(
      '😞',
      promiseType(idlType.ByteString),
      binding,
    ));
    const failedConversion = reactToPromise(
      invalid,
      idlType.ByteString,
      {},
      binding,
    );
    await expect(toJavaScriptPromise(failedConversion)).rejects
      .toBeInstanceOf(realm.intrinsics.typeError);
  });

  it('runs fulfillment and rejection steps in the promise realm', async () => {
    const { binding } = createBinding();
    let fulfilledValue: unknown;
    const fulfilled = uponPromiseFulfillment(
      createResolvedPromise(2, idlType.long, binding),
      (value) => { fulfilledValue = value; },
      binding,
    );
    await expect(toJavaScriptPromise(fulfilled)).resolves.toBeUndefined();
    expect(fulfilledValue).toBe(2);

    const reason = new Error('recover');
    let rejectedValue: unknown;
    const recovered = uponPromiseRejection(
      createRejectedPromise(reason, idlType.long, binding),
      (value) => { rejectedValue = value; },
      binding,
    );
    await expect(toJavaScriptPromise(recovered)).resolves.toBeUndefined();
    expect(rejectedValue).toBe(reason);
  });

  it('omits the fulfillment argument for Promise<undefined>', async () => {
    const { binding } = createBinding();
    let argumentCount = -1;
    const reaction = uponPromiseFulfillment(
      createResolvedPromise(undefined, idlType.undefined, binding),
      function() { argumentCount = arguments.length; },
      binding,
    );

    await expect(toJavaScriptPromise(reaction)).resolves
      .toBeUndefined();
    expect(argumentCount).toBe(0);
  });

  it.fails('reacts without consulting author-defined Promise constructors', async () => {
    const { binding } = createBinding();
    const promise = createResolvedPromise(1, idlType.long, binding);
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    const reaction = reactToPromise(
      promise,
      idlType.long,
      { fulfilled: (value) => value },
      binding,
    );
    await expect(toJavaScriptPromise(reaction)).resolves.toBe(1);
  });

  it('waits for typed promises in list order and handles an empty list later', async () => {
    const { binding, realm } = createBinding();
    const promises = [
      createResolvedPromise(2, idlType.long, binding),
      createResolvedPromise(1, idlType.long, binding),
    ];
    const aggregate = getPromiseForWaitingForAll(
      promises,
      idlType.long,
      binding,
    );
    const values = await toJavaScriptPromise(aggregate);

    expect(values).toEqual([2, 1]);
    expect(values).toBeInstanceOf(realm.intrinsics.array);

    let synchronous = true;
    const empty = new Promise<void>((resolve, reject) => {
      waitForAll(
        [],
        (results) => {
          try {
            expect(synchronous).toBe(false);
            expect(results).toEqual([]);
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject,
        binding,
      );
    });
    synchronous = false;
    await empty;
  });

  it('rejects an aggregate with the first rejected promise', async () => {
    const { binding } = createBinding();
    const first = new Error('first');
    const second = new Error('second');
    const aggregate = getPromiseForWaitingForAll([
      createRejectedPromise(first, idlType.long, binding),
      createRejectedPromise(second, idlType.long, binding),
    ], idlType.long, binding);

    await expect(toJavaScriptPromise(aggregate)).rejects.toBe(first);
  });

  it('marks the underlying JavaScript promise as handled', async () => {
    const { binding } = createBinding();
    const promise = createRejectedPromise('ignored', idlType.undefined, binding);

    expect(() => markPromiseAsHandled(promise)).not.toThrow();
    await Promise.resolve();
  });

  it.fails('marks a promise handled without consulting author properties', () => {
    const { binding } = createBinding();
    const promise = createPromise(idlType.undefined, binding);
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    expect(() => markPromiseAsHandled(promise)).not.toThrow();
  });
});

function createBinding(): { binding: JavaScriptBinding; realm: Realm; } {
  const realm = new Realm();
  return {
    binding: new JavaScriptBinding(
      assembleDefinitions([]),
      realm,
      new PlatformObjectRegistry(),
    ),
    realm,
  };
}

function requirePromiseValue(value: unknown): IDLPromise {
  if (!isPromiseValue(value)) throw new Error('Value is not an IDL promise');
  return value;
}

function toJavaScriptPromise(
  promise: IDLPromise,
): Promise<unknown> {
  return convertPromiseToJavaScript(promise);
}
