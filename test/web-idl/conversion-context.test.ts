import { describe, expect, it } from 'vitest';

import { TestRealm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { jsToIDL } from '../../src/web-idl/conversion';
import { TypeError as InternalTypeError } from '../../src/infra/exceptions';
import type { InternalPromise } from '../../src/infra/promises';
import {
  annotated, arg, defineCallbackFunction, defineInterface, defineTypedef, idlType, impl, implementationType,
  nullable, onError, op, promise, reference, sequence, xattr,
} from '../../src/web-idl/core/index';

describe('Cached conversion contexts', () => {
  it('reuses contexts and prepared conversions for the same type, binding, and realm', () => {
    const { first, second, binding } = fixture();
    const type = sequence(idlType.long);
    const context = binding.getConversionContext(type, second);

    expect(binding.getConversionContext(type, second)).toBe(context);
    expect(context.binding).toBe(binding);
    expect(context.realm).toBe(second);
    expect(binding.getConversionContext(type)).not.toBe(context);
    expect(binding.getConversionContext(type).realm).toBe(first);
    expect(context.declaredType).toBe(type);
    expect(context.resolvedType).toBe(binding.assembly.getConversionRules(type).resolvedType);
    expect(binding.getConversionContext(type).resolvedType).toBe(context.resolvedType);
    const otherBinding = binding.world.getRealmBinding(second)!;
    expect(otherBinding.getConversionContext(type).resolvedType).toBe(context.resolvedType);
    expect(otherBinding.getConversionContext(type).extendedAttributes).toBe(context.extendedAttributes);
    expect(context.getJSToIDLConverter()).toBe(context.getJSToIDLConverter());
    expect(context.getIDLToJSConverter()).toBe(context.getIDLToJSConverter());

    const element = context.forType(idlType.long);
    expect(element).toBe(binding.getConversionContext(idlType.long, second));
    expect(element.binding).toBe(binding);
    expect(element.realm).toBe(second);
  });

  it('keeps alias rules separate between binding worlds even when their realm and descriptor match', () => {
    const realm = new TestRealm();
    const type = reference('Integer');
    const clampWorld = new BindingWorld([
      defineTypedef({ name: 'Integer', type: annotated(idlType.byte, xattr('Clamp')) }),
    ]);
    const rangeWorld = new BindingWorld([
      defineTypedef({ name: 'Integer', type: annotated(idlType.byte, xattr('EnforceRange')) }),
    ]);
    clampWorld.register(realm, (ctx) => ({ realm: ctx.realm }));
    rangeWorld.register(realm, (ctx) => ({ realm: ctx.realm }));
    const clamp = clampWorld.getRealmBinding(realm)!.getConversionContext(type);
    const range = rangeWorld.getRealmBinding(realm)!.getConversionContext(type);

    expect(clamp).not.toBe(range);
    expect(clamp.integerMode).toBe('clamp');
    expect(range.integerMode).toBe('enforce-range');
    expect(jsToIDL(300, clamp)).toBe(127);
    expect(() => jsToIDL(300, range)).toThrow(realm.intrinsics.typeError);
  });

  it('retains use-specific rules without changing the underlying descriptor', () => {
    const { binding } = fixture();
    const plain = binding.getConversionContext(idlType.Uint8Array);
    const type = annotated(idlType.Uint8Array, xattr('AllowShared', 'AllowResizable'));
    const shared = binding.getConversionContext(type);
    expect(shared).not.toBe(plain);
    expect(shared.declaredType).toBe(type);
    expect(shared.resolvedType).toBe(idlType.Uint8Array);
    expect(shared.allowShared).toBe(true);
    expect(shared.allowResizable).toBe(true);
    expect(shared.extendedAttributes).toEqual([
      { kind: 'no-arguments', name: 'AllowShared' },
      { kind: 'no-arguments', name: 'AllowResizable' },
    ]);
    expect(plain.allowShared).toBe(false);
    expect(plain.allowResizable).toBe(false);

    const string = binding.getConversionContext(annotated(idlType.DOMString, xattr('LegacyNullToEmptyString')));
    expect(string.nullToEmptyString).toBe(true);
    expect(jsToIDL(null, string)).toBe('');
    expect(jsToIDL(null, string.forType(idlType.DOMString))).toBe('null');
  });

  it('identifies legacy callback declarations without weakening ordinary conversion', () => {
    const realm = new TestRealm();
    const world = new BindingWorld([defineCallbackFunction({
      name: 'Handler', returns: idlType.undefined, arguments: [],
      ...xattr('LegacyTreatNonObjectAsNull'),
    })]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    const type = nullable(reference('Handler'));
    const context = binding.getConversionContext(type);
    const convert = context.getJSToIDLConverter();

    expect(context.legacyCallback).toBe(binding.assembly.callbackFunctions.get('Handler'));
    expect(context.legacyCallback).toBe(binding.getConversionContext(type).legacyCallback);
    expect(binding.getConversionContext(reference('Handler')).legacyCallback).toBeNull();
    expect(binding.getConversionContext(sequence(type)).legacyCallback).toBeNull();
    expect(() => convert(5)).toThrow(realm.intrinsics.typeError);
    expect(() => convert({})).toThrow(realm.intrinsics.typeError);
    expect(() => jsToIDL(5, context)).toThrow(realm.intrinsics.typeError);
    expect(convert(null)).toBeNull();
    expect(context.getJSToIDLConverter()).toBe(convert);
  });
});

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
  return { first, second, owner, binding: world.getRealmBinding(first)! };
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
