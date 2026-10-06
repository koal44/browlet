import { describe, expect, it } from 'vitest';

import type { InternalPromise } from '../../../src/infra/promises';
import {
  idlType, implementationType, promise as promiseType, sequence,
} from '../../../src/web-idl/core/index';
import { IDLPromise, waitForAll } from '../../../src/web-idl/values/promise';
import { PromiseConverter } from '../../../src/web-idl/converters/promise';
import { BindingWorld } from '../../../src/web-idl/binding/world';

import { itPassesWith } from '../../test-runtime';
import { TestRealm as Realm } from '../../support/web-idl-realm';

describe('Web IDL promises', () => {
  it('wraps JavaScript values in a target-realm PromiseCapability', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const value = ctx.getConverter(ctx.assembly.getIDLType(promiseType(idlType.DOMString)), ctx.realm).jsToIDL({ then(resolve: (value: string) => void) { resolve('fulfilled'); } });
    const promise = requireIDLPromise(value);
    const javaScriptValue = ctx.getConverter(ctx.assembly.getIDLType(promiseType(idlType.DOMString)), ctx.realm).idlToJS(promise);

    expect(javaScriptValue).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(javaScriptValue).not.toBeInstanceOf(Promise);
    expect(ctx.getConverter(ctx.assembly.getIDLType(promiseType(idlType.DOMString)), ctx.realm).idlToJS(promise)).toBe(javaScriptValue);
    await expect(javaScriptValue).resolves.toBe('fulfilled');
  });

  it('creates, resolves, rejects, and forwards promise results', async () => {
    const ctx = createContext();
    const resolved = PromiseConverter.fromIDL(4, ctx.getConverter(ctx.assembly.getIDLType(idlType.long)));
    await expect(toJavaScriptPromise(resolved)).resolves.toBe(4);

    const reason = new Error('rejected');
    const rejected = IDLPromise.rejected(reason, ctx.assembly.getIDLType(idlType.long), ctx.realm, ctx.realizeException);
    await expect(toJavaScriptPromise(rejected)).rejects.toBe(reason);
    await expect(toJavaScriptPromise(rejected.react(ctx.assembly.getIDLType(idlType.long),
      {},
      ctx.realm,
    ))).rejects.toBe(reason);

    const value = { unchanged: true };
    const source = IDLPromise.fromJS(value, ctx.assembly.getIDLType(idlType.any), ctx.realm);
    await expect(source.react(ctx.assembly.getIDLType(idlType.any), {}, ctx.realm).promise).resolves.toBe(value);
  });

  it('leaves fulfillment and reaction result conversion to its caller', async () => {
    const ctx = createContext();
    const input = requireIDLPromise(ctx.getConverter(ctx.assembly.getIDLType(promiseType(idlType.long)), ctx.realm).jsToIDL('4.9'));
    let received: unknown;
    const result = [1, 2];
    const reaction = input.react(ctx.assembly.getIDLType(sequence(idlType.long)), {
      fulfilled: (value) => { received = value; return result; },
    }, ctx.realm);

    await expect(reaction.promise).resolves.toBe(result);
    expect(received).toBe('4.9');
  });

  it('converts typed fulfillments when observed by implementation code', async () => {
    const ctx = createContext();
    const converted = ctx.jsToImpl('4.9', implementationType<InternalPromise<number>>(promiseType(idlType.long)));
    await expect(new Promise((resolve, reject) => converted.observe(resolve, reject))).resolves.toBe(4);

    const failedConversion = ctx.jsToImpl('😞', implementationType<InternalPromise<string>>(promiseType(idlType.ByteString)));
    await expect(new Promise((resolve, reject) => failedConversion.observe(resolve, reject))).rejects
      .toBeInstanceOf(ctx.realm.intrinsics.typeError);
  });

  it.each(['fulfilled', 'rejected'] as const)('rejects a thrown %s reaction', async (reaction) => {
    const ctx = createContext();
    const reason = new Error('reaction failed');
    const source = reaction === 'fulfilled'
      ? IDLPromise.fromJS(1, ctx.assembly.getIDLType(idlType.long), ctx.realm)
      : IDLPromise.rejected('source rejected', ctx.assembly.getIDLType(idlType.long), ctx.realm);
    const result = source.react(ctx.assembly.getIDLType(idlType.long), {
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
    const capability = new IDLPromise(ctx.assembly.getIDLType(idlType.any), ctx.realm, ctx.realizeException);
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
    const inner = new IDLPromise(ctx.assembly.getIDLType(idlType.any), ctx.realm, ctx.realizeException);
    const created = PromiseConverter.fromIDL(inner, ctx.getConverter(ctx.assembly.getIDLType(idlType.any)));
    const resolved = new IDLPromise(ctx.assembly.getIDLType(idlType.any), ctx.realm, ctx.realizeException);
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
    const fulfilled = PromiseConverter.fromIDL(2, ctx.getConverter(ctx.assembly.getIDLType(idlType.long))).react(ctx.assembly.getIDLType(idlType.undefined), {
      fulfilled: (value) => { fulfilledValue = value; },
    }, ctx.realm);
    await expect(toJavaScriptPromise(fulfilled)).resolves.toBeUndefined();
    expect(fulfilledValue).toBe(2);

    const reason = new Error('recover');
    let rejectedValue: unknown;
    const recovered = IDLPromise.rejected(reason, ctx.assembly.getIDLType(idlType.long), ctx.realm).react(ctx.assembly.getIDLType(idlType.undefined), {
      rejected: (value) => { rejectedValue = value; },
    }, ctx.realm);
    await expect(toJavaScriptPromise(recovered)).resolves.toBeUndefined();
    expect(rejectedValue).toBe(reason);
  });

  it('converts a resolution value in the resolving context without moving the promise', async () => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const promise = new IDLPromise(first.assembly.getIDLType(sequence(idlType.long)), first.realm, first.realizeException);

    const jsValue = second.getConverter(promise.type, second.realm).idlToJS([1, 2]);
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
      ? PromiseConverter.fromIDL(undefined, first.getConverter(first.assembly.getIDLType(idlType.undefined)))
      : IDLPromise.rejected('rejected', first.assembly.getIDLType(idlType.undefined), first.realm);
    const converted = second.getConverter(second.assembly.getIDLType(sequence(idlType.long)), second.realm).idlToJS([1, 2]);
    const result = source.react(second.assembly.getIDLType(sequence(idlType.long)), {
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
    const promise = PromiseConverter.fromIDL(1, ctx.getConverter(ctx.assembly.getIDLType(idlType.long)));
    expect(Reflect.defineProperty(toJavaScriptPromise(promise), 'constructor', {
      get() { throw new Error('constructor was consulted'); },
    })).toBe(true);

    const reaction = promise.react(ctx.assembly.getIDLType(idlType.long),
      { fulfilled: (value) => value },
      ctx.realm,
    );
    await expect(toJavaScriptPromise(reaction)).resolves.toBe(1);
  });

  it('waits for typed promises in list order and handles an empty list later', async () => {
    const ctx = createContext();
    const { realm } = ctx;
    const promises = [
      PromiseConverter.fromIDL(2, ctx.getConverter(ctx.assembly.getIDLType(idlType.long))),
      PromiseConverter.fromIDL(1, ctx.getConverter(ctx.assembly.getIDLType(idlType.long))),
    ];
    const aggregate = PromiseConverter.getPromiseForWaitingForAll(promises, ctx.assembly.getIDLType(idlType.long), ctx.getConverter(ctx.assembly.getIDLType(idlType.long)));
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
    const aggregate = PromiseConverter.getPromiseForWaitingForAll([
      IDLPromise.rejected(first, ctx.assembly.getIDLType(idlType.long), ctx.realm, ctx.realizeException),
      IDLPromise.rejected(second, ctx.assembly.getIDLType(idlType.long), ctx.realm, ctx.realizeException),
    ], ctx.assembly.getIDLType(idlType.long), ctx.getConverter(ctx.assembly.getIDLType(idlType.long)));

    await expect(toJavaScriptPromise(aggregate)).rejects.toBe(first);
  });

  it('marks the underlying JavaScript promise as handled', async () => {
    const ctx = createContext();
    const promise = IDLPromise.rejected('ignored', ctx.assembly.getIDLType(idlType.undefined), ctx.realm, ctx.realizeException);

    expect(() => promise.markAsHandled()).not.toThrow();
    await Promise.resolve();
  });

  itPassesWith('v26+', 'explicitQueues')('marks a promise handled without consulting author properties', () => {
    const ctx = createContext();
    const promise = new IDLPromise(ctx.assembly.getIDLType(idlType.undefined), ctx.realm, ctx.realizeException);
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

function requireIDLPromise(value: unknown): IDLPromise {
  if (!IDLPromise.is(value)) throw new Error('Value is not an IDL promise');
  return value;
}

function toJavaScriptPromise(
  promise: IDLPromise,
): Promise<unknown> {
  return promise.promise;
}
