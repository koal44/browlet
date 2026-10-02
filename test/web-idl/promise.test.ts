import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import { TestRealm as Realm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { jsToIDL, idlToJS } from '../../src/web-idl/conversion';
import {
  idlType, promise as promiseType, sequence,
} from '../../src/web-idl/core/index';
import { PromiseCarrier, getPromiseForWaitingForAll, waitForAll } from '../../src/web-idl/promise';

describe('Web IDL promises', () => {
  it('wraps JavaScript values in a target-realm PromiseCapability', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const value = jsToIDL({ then(resolve: (value: string) => void) { resolve('fulfilled'); } }, ctx.getConversionContext(promiseType(idlType.DOMString), ctx.realm));
    const promise = requirePromiseCarrier(value);
    const javaScriptValue = idlToJS(promise, ctx.getConversionContext(promiseType(idlType.DOMString), ctx.realm));

    expect(javaScriptValue).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(javaScriptValue).not.toBeInstanceOf(Promise);
    expect(idlToJS(promise, ctx.getConversionContext(promiseType(idlType.DOMString), ctx.realm))).toBe(javaScriptValue);
    await expect(javaScriptValue).resolves.toBe('fulfilled');
  });

  it('creates, resolves, rejects, and forwards promise results', async () => {
    const ctx = createContext();
    const resolved = PromiseCarrier.fromIDL(4, ctx.getConversionContext(idlType.long));
    await expect(toJavaScriptPromise(resolved)).resolves.toBe(4);

    const reason = new Error('rejected');
    const rejected = PromiseCarrier.rejected(reason, idlType.long, ctx.realm, ctx.realizeException);
    await expect(toJavaScriptPromise(rejected)).rejects.toBe(reason);
    await expect(toJavaScriptPromise(rejected.react(idlType.long,
      {},
      ctx.realm,
    ))).rejects.toBe(reason);

    const value = { unchanged: true };
    const source = PromiseCarrier.fromJS(value, idlType.any, ctx.realm);
    await expect(source.react(idlType.any, {}, ctx.realm).promise).resolves.toBe(value);
  });

  it('leaves fulfillment and reaction result conversion to its caller', async () => {
    const ctx = createContext();
    const input = requirePromiseCarrier(jsToIDL('4.9', ctx.getConversionContext(promiseType(idlType.long), ctx.realm)));
    let received: unknown;
    const result = [1, 2];
    const reaction = input.react(sequence(idlType.long), {
      fulfilled: (value) => { received = value; return result; },
    }, ctx.realm);

    await expect(reaction.promise).resolves.toBe(result);
    expect(received).toBe('4.9');
  });

  it('converts typed fulfillments when observed by implementation code', async () => {
    const ctx = createContext();
    const input = PromiseCarrier.fromJS('4.9', idlType.long, ctx.realm);
    const converted = input.toImpl(ctx, (value) => value, ctx.realm.Promise);
    await expect(new Promise((resolve, reject) => converted.observe(resolve, reject))).resolves.toBe(4);

    const invalid = requirePromiseCarrier(jsToIDL('😞', ctx.getConversionContext(promiseType(idlType.ByteString), ctx.realm)));
    const failedConversion = invalid.toImpl(ctx, (value) => value, ctx.realm.Promise);
    await expect(new Promise((resolve, reject) => failedConversion.observe(resolve, reject))).rejects
      .toBeInstanceOf(ctx.realm.intrinsics.typeError);
  });

  it.each(['fulfilled', 'rejected'] as const)('rejects a thrown %s reaction', async (reaction) => {
    const ctx = createContext();
    const reason = new Error('reaction failed');
    const source = reaction === 'fulfilled'
      ? PromiseCarrier.fromJS(1, idlType.long, ctx.realm)
      : PromiseCarrier.rejected('source rejected', idlType.long, ctx.realm);
    const result = source.react(idlType.long, {
      [reaction]: () => { throw reason; },
    }, ctx.realm);

    await expect(result.promise).rejects.toBe(reason);
  });

  it('tracks capability resolution rather than native promise settlement', async () => {
    const ctx = createContext();
    let resolveAdopted: ((value: string) => void) | undefined;
    const adopted = new Promise<string>((resolve) => {
      resolveAdopted = resolve;
    });
    const capability = new PromiseCarrier(idlType.any, ctx.realm, ctx.realizeException);
    let settled = false;
    void toJavaScriptPromise(capability).then(() => {
      settled = true;
    });

    expect(capability.resolved).toBe(false);
    capability.resolve(adopted);
    expect(capability.resolved).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveAdopted?.('adopted');
    await expect(toJavaScriptPromise(capability)).resolves.toBe('adopted');
  });

  it('adopts an internal promise capability when resolving a promise', async () => {
    const ctx = createContext();
    const inner = new PromiseCarrier(idlType.any, ctx.realm, ctx.realizeException);
    const created = PromiseCarrier.fromIDL(inner, ctx.getConversionContext(idlType.any));
    const resolved = new PromiseCarrier(idlType.any, ctx.realm, ctx.realizeException);
    resolved.resolve(inner.promise);

    let settled = false;
    void Promise.all([
      toJavaScriptPromise(created),
      toJavaScriptPromise(resolved),
    ]).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    inner.resolve('adopted');
    await expect(Promise.all([
      toJavaScriptPromise(created),
      toJavaScriptPromise(resolved),
    ])).resolves.toEqual(['adopted', 'adopted']);
  });

  it('runs fulfillment and rejection steps', async () => {
    const ctx = createContext();
    let fulfilledValue: unknown;
    const fulfilled = PromiseCarrier.fromIDL(2, ctx.getConversionContext(idlType.long)).react(idlType.undefined, {
      fulfilled: (value) => { fulfilledValue = value; },
    }, ctx.realm);
    await expect(toJavaScriptPromise(fulfilled)).resolves.toBeUndefined();
    expect(fulfilledValue).toBe(2);

    const reason = new Error('recover');
    let rejectedValue: unknown;
    const recovered = PromiseCarrier.rejected(reason, idlType.long, ctx.realm).react(idlType.undefined, {
      rejected: (value) => { rejectedValue = value; },
    }, ctx.realm);
    await expect(toJavaScriptPromise(recovered)).resolves.toBeUndefined();
    expect(rejectedValue).toBe(reason);
  });

  it('converts a resolution value in the resolving context without moving the promise', async () => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const promise = new PromiseCarrier(sequence(idlType.long), first.realm, first.realizeException);

    const jsValue = idlToJS([1, 2], second.getConversionContext(promise.type, second.realm));
    promise.resolve(jsValue);
    const value = await promise.promise;

    expect(promise.promise).toBeInstanceOf(first.realm.intrinsics.promise.constructor);
    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(second.realm.intrinsics.array);
    expect(value).not.toBeInstanceOf(first.realm.intrinsics.array);
  });

  it.each(['fulfilled', 'rejected'] as const)('preserves a %s reaction result while keeping the source promise realm', async (reaction) => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const source = reaction === 'fulfilled'
      ? PromiseCarrier.fromIDL(undefined, first.getConversionContext(idlType.undefined))
      : PromiseCarrier.rejected('rejected', idlType.undefined, first.realm);
    const converted = idlToJS([1, 2], second.getConversionContext(sequence(idlType.long), second.realm));
    const result = source.react(sequence(idlType.long), {
      [reaction]: () => converted,
    }, second.realm);
    const value = await result.promise;

    expect(result.promise).toBeInstanceOf(first.realm.intrinsics.promise.constructor);
    expect(value).toBe(converted);
    expect(value).toBeInstanceOf(second.realm.intrinsics.array);
    expect(value).not.toBeInstanceOf(first.realm.intrinsics.array);
  });

  itPassesWith('v26+', 'explicitQueues')('reacts without consulting author-defined Promise constructors', async () => {
    const ctx = createContext();
    const promise = PromiseCarrier.fromIDL(1, ctx.getConversionContext(idlType.long));
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    const reaction = promise.react(idlType.long,
      { fulfilled: (value) => value },
      ctx.realm,
    );
    await expect(toJavaScriptPromise(reaction)).resolves.toBe(1);
  });

  it('waits for typed promises in list order and handles an empty list later', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const promises = [
      PromiseCarrier.fromIDL(2, ctx.getConversionContext(idlType.long)),
      PromiseCarrier.fromIDL(1, ctx.getConversionContext(idlType.long)),
    ];
    const aggregate = getPromiseForWaitingForAll(promises, idlType.long, ctx.getConversionContext(idlType.long));
    const values = await toJavaScriptPromise(aggregate);

    expect(values).toEqual([2, 1]);
    expect(values).toBeInstanceOf(realm.intrinsics.array);

    let synchronous = true;
    const empty = new Promise<void>((resolve, reject) => {
      waitForAll([], (results) => {
        try {
          expect(synchronous).toBe(false);
          expect(results).toEqual([]);
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, reject, ctx.realm);
    });
    synchronous = false;
    await empty;
  });

  it('rejects an aggregate with the first rejected promise', async () => {
    const ctx = createContext();
    const first = new Error('first');
    const second = new Error('second');
    const aggregate = getPromiseForWaitingForAll([
      PromiseCarrier.rejected(first, idlType.long, ctx.realm, ctx.realizeException),
      PromiseCarrier.rejected(second, idlType.long, ctx.realm, ctx.realizeException),
    ], idlType.long, ctx.getConversionContext(idlType.long));

    await expect(toJavaScriptPromise(aggregate)).rejects.toBe(first);
  });

  it('marks the underlying JavaScript promise as handled', async () => {
    const ctx = createContext();
    const promise = PromiseCarrier.rejected('ignored', idlType.undefined, ctx.realm, ctx.realizeException);

    expect(() => promise.markAsHandled()).not.toThrow();
    await Promise.resolve();
  });

  itPassesWith('v26+', 'explicitQueues')('marks a promise handled without consulting author properties', () => {
    const ctx = createContext();
    const promise = new PromiseCarrier(idlType.undefined, ctx.realm, ctx.realizeException);
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    expect(() => promise.markAsHandled()).not.toThrow();
  });
});

function createContext(world = new BindingWorld([])) {
  const realm = new Realm();
  world.register(realm, (ctx) => ({ realm: ctx.realm }));
  return world.getRealmBinding(realm)!;
}

function requirePromiseCarrier(value: unknown): PromiseCarrier {
  if (!PromiseCarrier.is(value)) throw new Error('Value is not a promise carrier');
  return value;
}

function toJavaScriptPromise(
  promise: PromiseCarrier,
): Promise<unknown> {
  return promise.promise;
}
