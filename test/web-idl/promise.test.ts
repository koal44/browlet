import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import { TestRealm as Realm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { convertToIDL, convertToJavaScript } from '../../src/web-idl/conversion';
import {
  idlType, promise as promiseType, sequence,
} from '../../src/web-idl/core/index';
import {
  createPromise, createRejectedPromise, createResolvedPromise,
  getPromiseForWaitingForAll, isPromiseUnresolved, markPromiseAsHandled,
  reactToPromise, resolvePromise,
  uponPromiseFulfillment, uponPromiseRejection, waitForAll,
} from '../../src/web-idl/promise';
import {
  isIDLPromiseRecord, type IDLPromiseRecord,
} from '../../src/web-idl/promise-record';

describe('Web IDL promises', () => {
  it('wraps JavaScript values in a target-realm PromiseCapability', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const value = convertToIDL(
      { then(resolve: (value: string) => void) { resolve('fulfilled'); } },
      promiseType(idlType.DOMString),
      ctx,
    );
    const promise = requirePromiseRecord(value);
    const javaScriptValue = convertToJavaScript(
      promise,
      promiseType(idlType.DOMString),
      ctx,
    );

    expect(javaScriptValue).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(javaScriptValue).not.toBeInstanceOf(Promise);
    expect(convertToJavaScript(
      promise,
      promiseType(idlType.DOMString),
      ctx,
    )).toBe(javaScriptValue);
    await expect(javaScriptValue).resolves.toBe('fulfilled');
  });

  it('creates, resolves, rejects, and reacts to typed promises', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const resolved = createResolvedPromise(4, idlType.long, ctx);
    await expect(toJavaScriptPromise(resolved)).resolves.toBe(4);

    const reason = new Error('rejected');
    const rejected = createRejectedPromise(reason, idlType.long, ctx);
    await expect(toJavaScriptPromise(rejected)).rejects.toBe(reason);
    await expect(toJavaScriptPromise(reactToPromise(
      rejected,
      idlType.long,
      {},
      ctx,
    ))).rejects.toBe(reason);

    const input = requirePromiseRecord(convertToIDL(
      '4.9',
      promiseType(idlType.long),
      ctx,
    ));
    const reaction = reactToPromise(
      input,
      idlType.long,
      { fulfilled: (value) => Number(value) + 1 },
      ctx,
    );
    await expect(toJavaScriptPromise(reaction)).resolves.toBe(5);

    const invalid = requirePromiseRecord(convertToIDL(
      '😞',
      promiseType(idlType.ByteString),
      ctx,
    ));
    const failedConversion = reactToPromise(
      invalid,
      idlType.ByteString,
      {},
      ctx,
    );
    await expect(toJavaScriptPromise(failedConversion)).rejects
      .toBeInstanceOf(realm.intrinsics.typeError);
  });

  it('tracks capability resolution rather than native promise settlement', async () => {
    const ctx = createContext();
    let resolveAdopted: ((value: string) => void) | undefined;
    const adopted = new Promise<string>((resolve) => {
      resolveAdopted = resolve;
    });
    const capability = createPromise(idlType.any, ctx);
    let settled = false;
    void toJavaScriptPromise(capability).then(() => {
      settled = true;
    });

    expect(isPromiseUnresolved(capability)).toBe(true);
    resolvePromise(capability, adopted, ctx);
    expect(isPromiseUnresolved(capability)).toBe(false);
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveAdopted?.('adopted');
    await expect(toJavaScriptPromise(capability)).resolves.toBe('adopted');
  });

  it('adopts an internal promise capability when resolving a promise', async () => {
    const ctx = createContext();
    const inner = createPromise(idlType.any, ctx);
    const created = createResolvedPromise(inner, idlType.any, ctx);
    const resolved = createPromise(idlType.any, ctx);
    resolvePromise(resolved, inner, ctx);

    let settled = false;
    void Promise.all([
      toJavaScriptPromise(created),
      toJavaScriptPromise(resolved),
    ]).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolvePromise(inner, 'adopted', ctx);
    await expect(Promise.all([
      toJavaScriptPromise(created),
      toJavaScriptPromise(resolved),
    ])).resolves.toEqual(['adopted', 'adopted']);
  });

  it('runs fulfillment and rejection steps', async () => {
    const ctx = createContext();
    let fulfilledValue: unknown;
    const fulfilled = uponPromiseFulfillment(
      createResolvedPromise(2, idlType.long, ctx),
      (value) => { fulfilledValue = value; },
      ctx,
    );
    await expect(toJavaScriptPromise(fulfilled)).resolves.toBeUndefined();
    expect(fulfilledValue).toBe(2);

    const reason = new Error('recover');
    let rejectedValue: unknown;
    const recovered = uponPromiseRejection(
      createRejectedPromise(reason, idlType.long, ctx),
      (value) => { rejectedValue = value; },
      ctx,
    );
    await expect(toJavaScriptPromise(recovered)).resolves.toBeUndefined();
    expect(rejectedValue).toBe(reason);
  });

  it('converts a resolution value in the resolving context without moving the promise', async () => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const promise = createPromise(sequence(idlType.long), first);

    resolvePromise(promise, [1, 2], second);
    const value = await promise.promise;

    expect(promise.promise).toBeInstanceOf(first.realm.intrinsics.promise.constructor);
    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(second.realm.intrinsics.array);
    expect(value).not.toBeInstanceOf(first.realm.intrinsics.array);
  });

  it.each(['fulfilled', 'rejected'] as const)('converts a %s reaction result in the registering context while keeping the source promise realm', async (reaction) => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const source = reaction === 'fulfilled'
      ? createResolvedPromise(undefined, idlType.undefined, first)
      : createRejectedPromise('rejected', idlType.undefined, first);
    const result = reactToPromise(source, sequence(idlType.long), {
      [reaction]: () => [1, 2],
    }, second);
    const value = await result.promise;

    expect(result.promise).toBeInstanceOf(first.realm.intrinsics.promise.constructor);
    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(second.realm.intrinsics.array);
    expect(value).not.toBeInstanceOf(first.realm.intrinsics.array);
  });

  it('omits the fulfillment argument for Promise<undefined>', async () => {
    const ctx = createContext();
    let argumentCount = -1;
    const reaction = uponPromiseFulfillment(
      createResolvedPromise(undefined, idlType.undefined, ctx),
      function() { argumentCount = arguments.length; },
      ctx,
    );

    await expect(toJavaScriptPromise(reaction)).resolves
      .toBeUndefined();
    expect(argumentCount).toBe(0);
  });

  itPassesWith('v26+', 'explicitQueues')('reacts without consulting author-defined Promise constructors', async () => {
    const ctx = createContext();
    const promise = createResolvedPromise(1, idlType.long, ctx);
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    const reaction = reactToPromise(
      promise,
      idlType.long,
      { fulfilled: (value) => value },
      ctx,
    );
    await expect(toJavaScriptPromise(reaction)).resolves.toBe(1);
  });

  it('waits for typed promises in list order and handles an empty list later', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const promises = [
      createResolvedPromise(2, idlType.long, ctx),
      createResolvedPromise(1, idlType.long, ctx),
    ];
    const aggregate = getPromiseForWaitingForAll(
      promises,
      idlType.long,
      ctx,
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
        ctx,
      );
    });
    synchronous = false;
    await empty;
  });

  it('rejects an aggregate with the first rejected promise', async () => {
    const ctx = createContext();
    const first = new Error('first');
    const second = new Error('second');
    const aggregate = getPromiseForWaitingForAll([
      createRejectedPromise(first, idlType.long, ctx),
      createRejectedPromise(second, idlType.long, ctx),
    ], idlType.long, ctx);

    await expect(toJavaScriptPromise(aggregate)).rejects.toBe(first);
  });

  it('marks the underlying JavaScript promise as handled', async () => {
    const ctx = createContext();
    const promise = createRejectedPromise('ignored', idlType.undefined, ctx);

    expect(() => markPromiseAsHandled(promise)).not.toThrow();
    await Promise.resolve();
  });

  itPassesWith('v26+', 'explicitQueues')('marks a promise handled without consulting author properties', () => {
    const ctx = createContext();
    const promise = createPromise(idlType.undefined, ctx);
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    expect(() => markPromiseAsHandled(promise)).not.toThrow();
  });
});

function createContext(world = new BindingWorld([])) {
  const realm = new Realm();
  world.register(realm);
  return world.getRealmBinding(realm)!.defaultConversionContext;
}

function requirePromiseRecord(value: unknown): IDLPromiseRecord {
  if (!isIDLPromiseRecord(value)) throw new Error('Value is not an IDL promise');
  return value;
}

function toJavaScriptPromise(
  promise: IDLPromiseRecord,
): Promise<unknown> {
  return promise.promise;
}
