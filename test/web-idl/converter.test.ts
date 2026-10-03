import { describe, expect, it } from 'vitest';

import { TestRealm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding/world';

import { TypeError as InternalTypeError } from '../../src/infra/exceptions';
import type { InternalPromise } from '../../src/infra/promises';
import {
  annotated, arg, defineCallbackFunction, defineInterface, defineTypedef, idlType, impl, implementationType,
  nullable, onError, op, promise, reference, sequence, xattr,
} from '../../src/web-idl/core/index';

describe('Cached converters', () => {
  it('reuses converters and prepared conversions for the same type, binding, and realm', () => {
    const { first, second, binding } = fixture();
    const type = sequence(idlType.long);
    const converter = binding.getConverter(type, second);

    expect(binding.getConverter(type, second)).toBe(converter);
    expect(converter.binding).toBe(binding);
    expect(converter.realm).toBe(second);
    expect(binding.getConverter(type)).not.toBe(converter);
    expect(binding.getConverter(type).realm).toBe(first);
    expect(converter.declaredType).toBe(type);
    expect(converter.resolvedType).toBe(binding.assembly.getConversionRules(type).resolvedType);
    expect(binding.getConverter(type).resolvedType).toBe(converter.resolvedType);
    const otherBinding = binding.world.getRealmBinding(second)!;
    expect(otherBinding.getConverter(type).resolvedType).toBe(converter.resolvedType);
    expect(otherBinding.getConverter(type).extendedAttributes).toBe(converter.extendedAttributes);
    expect(converter.getJSToIDLSteps()).toBe(converter.getJSToIDLSteps());
    expect(converter.getIDLToJSSteps()).toBe(converter.getIDLToJSSteps());

    const element = converter.forType(idlType.long);
    expect(element).toBe(binding.getConverter(idlType.long, second));
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
    const clamp = clampWorld.getRealmBinding(realm)!.getConverter(type);
    const range = rangeWorld.getRealmBinding(realm)!.getConverter(type);

    expect(clamp).not.toBe(range);
    expect(clamp.integerMode).toBe('clamp');
    expect(range.integerMode).toBe('enforce-range');
    expect(clamp.jsToIDL(300)).toBe(127);
    expect(() => range.jsToIDL(300)).toThrow(realm.intrinsics.typeError);
  });

  it('retains use-specific rules without changing the underlying descriptor', () => {
    const { binding } = fixture();
    const plain = binding.getConverter(idlType.Uint8Array);
    const type = annotated(idlType.Uint8Array, xattr('AllowShared', 'AllowResizable'));
    const shared = binding.getConverter(type);
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

    const string = binding.getConverter(annotated(idlType.DOMString, xattr('LegacyNullToEmptyString')));
    expect(string.nullToEmptyString).toBe(true);
    expect(string.jsToIDL(null)).toBe('');
    expect(string.forType(idlType.DOMString).jsToIDL(null)).toBe('null');
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
    const converter = binding.getConverter(type);
    const convert = converter.getJSToIDLSteps();

    expect(converter.legacyCallback).toBe(binding.assembly.callbackFunctions.get('Handler'));
    expect(converter.legacyCallback).toBe(binding.getConverter(type).legacyCallback);
    expect(binding.getConverter(reference('Handler')).legacyCallback).toBeNull();
    expect(binding.getConverter(sequence(type)).legacyCallback).toBeNull();
    expect(() => convert(5)).toThrow(realm.intrinsics.typeError);
    expect(() => convert({})).toThrow(realm.intrinsics.typeError);
    expect(() => converter.jsToIDL(5)).toThrow(realm.intrinsics.typeError);
    expect(convert(null)).toBeNull();
    expect(converter.getJSToIDLSteps()).toBe(convert);
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
