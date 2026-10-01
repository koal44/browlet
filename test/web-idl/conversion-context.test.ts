import { describe, expect, it } from 'vitest';

import { TestRealm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { TypeError as InternalTypeError } from '../../src/infra/exceptions';
import type { InternalPromise } from '../../src/infra/promises';
import {
  arg, defineCallbackFunction, defineInterface, idlType, impl, implementationType, onError, op,
  promise, reference, sequence,
} from '../../src/web-idl/core/index';

describe('Conversion realm and implementation ownership', () => {
  it('allocates callback argument arrays in B and their fresh implementation elements in A', () => {
    const { first, second, owner } = fixture();
    const callback = second.evaluate('(values) => { globalThis.received = values; }', 'receive.js');

    call(owner, 'send', callback);

    const values = Reflect.get(second.global, 'received') as object[];
    expect(values).toBeInstanceOf(second.intrinsics.array);
    expect(values).not.toBeInstanceOf(first.intrinsics.array);
    expect(values[0]).toBeInstanceOf(Reflect.get(first.global, 'Child'));
    expect(values[0]).not.toBeInstanceOf(Reflect.get(second.global, 'Child'));
  });

  it('reports callback return conversion failures in B', () => {
    const { first, second, owner } = fixture();
    const callback = second.evaluate('() => Symbol("invalid long")', 'number-callback.js');
    let reason: unknown;
    try { call(owner, 'invokeNumber', callback); } catch (error) { reason = error; }

    expect(reason).toBeInstanceOf(second.intrinsics.typeError);
    expect(reason).not.toBeInstanceOf(first.intrinsics.typeError);
  });

  it('converts callback promise fulfillment in B while returning an operation promise in A', async () => {
    const { first, second, owner } = fixture();
    const callback = second.evaluate('() => Promise.resolve(Symbol("invalid long"))', 'promise-callback.js');
    const result = call(owner, 'invokePromise', callback) as Promise<unknown>;
    const reason = await result.catch((error: unknown) => error);

    expect(result).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(reason).toBeInstanceOf(second.intrinsics.typeError);
    expect(reason).not.toBeInstanceOf(first.intrinsics.typeError);
  });

  it('uses A for a direct promise argument even when the original JavaScript promise belongs to B', async () => {
    const { first, second, owner } = fixture();
    const input = second.evaluate('Promise.resolve(Symbol("invalid long"))', 'promise-argument.js');
    const result = call(owner, 'consume', input) as Promise<unknown>;
    const reason = await result.catch((error: unknown) => error);

    expect(reason).toBeInstanceOf(first.intrinsics.typeError);
    expect(reason).not.toBeInstanceOf(second.intrinsics.typeError);
  });

  it('keeps a declared promise and its values in A when passed to a callback in B', async () => {
    const { first, second, owner } = fixture();
    const callback = second.evaluate('(value) => { globalThis.received = value; }', 'receive-promise.js');
    call(owner, 'sendPromise', callback);
    const pending = Reflect.get(second.global, 'received') as Promise<object[]>;
    const values = await pending;

    expect(pending).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(values).toBeInstanceOf(first.intrinsics.array);
    expect(values[0]).toBeInstanceOf(Reflect.get(first.global, 'Child'));
    expect(values[0]).not.toBeInstanceOf(Reflect.get(second.global, 'Child'));
  });

  it('retains the implementation owner when realizing an internal callback-promise rejection', async () => {
    const { first, second, owner } = fixture();
    const callback = second.evaluate('(value) => { globalThis.received = value.catch(reason => reason); }', 'receive-failure.js');
    call(owner, 'sendFailure', callback);
    const pending = Reflect.get(second.global, 'received') as Promise<unknown>;
    const reason = await pending;

    expect(pending).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(reason).toBeInstanceOf(first.intrinsics.typeError);
    expect(reason).not.toBeInstanceOf(second.intrinsics.typeError);
  });
});

function fixture() {
  const first = new TestRealm();
  const second = new TestRealm();
  const world = new BindingWorld(definitions);
  const context = world.register(first, (ctx) => ({ realm: ctx.realm }));
  context.install(first.global);
  world.register(second, (ctx) => ({ realm: ctx.realm })).install(second.global);
  const owner = context.project(SourceImpl, new SourceImpl(context.Promise));
  return { first, second, owner };
}

function call(owner: object, name: string, ...args: unknown[]): unknown {
  return Reflect.apply(Reflect.get(owner, name) as CallableFunction, owner, args);
}

class ChildImpl {}

class SourceImpl {
  constructor(public P: typeof InternalPromise) {}

  send(callback: (values: ChildImpl[]) => void): void { callback([new ChildImpl()]); }
  invokeNumber(callback: () => number): number { return callback(); }
  invokePromise(callback: () => InternalPromise<number>): InternalPromise<number> {
    return callback().then((value) => value, undefined, idlType.long);
  }
  consume(value: InternalPromise<number>): InternalPromise<number> {
    return value.then((item) => item, undefined, idlType.long);
  }
  sendPromise(callback: (value: InternalPromise<ChildImpl[]>) => void): void {
    callback(this.P.resolve([new ChildImpl()], sequence(implementationType<ChildImpl>(reference('Child')))));
  }
  sendFailure(callback: (value: InternalPromise<ChildImpl[]>) => void): void {
    callback(this.P.reject(new InternalTypeError('implementation failure'), sequence(implementationType<ChildImpl>(reference('Child')))));
  }
}

const definitions = [
  defineInterface({ name: 'Child', exposed: '*', implementation: impl(ChildImpl), members: [] }),
  defineInterface({
    name: 'Source', exposed: '*', implementation: impl(SourceImpl),
    members: [
      op('send', idlType.undefined, [arg('callback', reference('Receive'), onError('rethrow'))]),
      op('invokeNumber', idlType.long, [arg('callback', reference('NumberCallback'), onError('rethrow'))]),
      op('invokePromise', promise(idlType.long), [arg('callback', reference('PromiseCallback'))]),
      op('consume', promise(idlType.long), [arg('value', promise(idlType.long))]),
      op('sendPromise', idlType.undefined, [arg('callback', reference('ReceivePromise'), onError('rethrow'))]),
      op('sendFailure', idlType.undefined, [arg('callback', reference('ReceivePromise'), onError('rethrow'))]),
    ],
  }),
  defineCallbackFunction({
    name: 'Receive', returns: idlType.undefined,
    arguments: [arg('values', sequence(implementationType<ChildImpl>(reference('Child'))))],
  }),
  defineCallbackFunction({ name: 'NumberCallback', returns: idlType.long, arguments: [] }),
  defineCallbackFunction({ name: 'PromiseCallback', returns: promise(idlType.long), arguments: [] }),
  defineCallbackFunction({
    name: 'ReceivePromise', returns: idlType.undefined,
    arguments: [arg('value', promise(sequence(implementationType<ChildImpl>(reference('Child')))))],
  }),
];
