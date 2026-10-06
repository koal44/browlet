import { describe, expect, it } from 'vitest';

import {
  annotated, defineDictionary, defineTypedef, dictMember, idlType, implementationType, promise, reference, sequence, xattr,
} from '../../../src/web-idl/core/index';
import { InternalError } from '../../../src/infra/internal-error';
import { internalType } from '../../../src/infra/promises';
import { TypeError as TypeErrorRequest } from '../../../src/infra/exceptions';
import { DefinitionAssembly } from '../../../src/web-idl/assembly/index';
import { PromiseConverter } from '../../../src/web-idl/converters/promise';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { RealmBinding } from '../../../src/web-idl/binding/realm';

import { TestRealm } from '../../support/web-idl-realm';

describe('declared Promise ownership', () => {
  it('keeps inherited creation methods in their selected realms', async () => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = new RealmBinding(new DefinitionAssembly([]), first, world, (ctx) => ({ realm: ctx.realm })).Promise;
    const b = new RealmBinding(new DefinitionAssembly([]), second, world, (ctx) => ({ realm: ctx.realm })).Promise;
    const initial = a.resolve(1, idlType.long);
    const foreign = b.resolve(2, idlType.long);
    const later = a.try(() => 3, idlType.long);
    const recovered = b.reject('failure', idlType.long).catch(() => 4);
    for (const value of [initial, later]) expect(value.backing).toBeInstanceOf(first.intrinsics.promise.constructor);
    for (const value of [foreign, recovered]) expect(value.backing).toBeInstanceOf(second.intrinsics.promise.constructor);
    const combined = a.all([initial, foreign, later, recovered], sequence(idlType.long));
    expect(combined.backing).toBeInstanceOf(first.intrinsics.promise.constructor);
    const values = await combined.backing;
    expect(values).toEqual([1, 2, 3, 4]);
    expect(values).toBeInstanceOf(first.intrinsics.array);
  });

  it('uses a named sequence contract when joining results', async () => {
    const alias = defineTypedef({ name: 'Counts', type: sequence(idlType.long) });
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([alias]), realm, new BindingWorld([alias]), (ctx) => ({ realm: ctx.realm }));
    const P = binding.Promise;
    const type = implementationType<number[]>(reference('Counts'));
    const result = P.all([P.resolve(1, idlType.long), P.resolve(2, idlType.long)], type);
    const values = await binding.getConverter(binding.assembly.getIDLType(promise(type))).idlToJS(result);
    expect(values).toEqual([1, 2]);
    expect(values).toBeInstanceOf(realm.intrinsics.array);
  });

  it.each(['record', 'implementation'] as const)('exposes a frozen %s result without changing identity', async (kind) => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const context = { binding: binding, realm: binding.realm };
    const source = Object.freeze(kind === 'record'
      ? PromiseConverter.fromIDL(7, binding.getConverter(binding.assembly.getIDLType(idlType.long)))
      : binding.Promise.resolve(7, idlType.long));
    const keys = Reflect.ownKeys(source);
    const prototype = Reflect.getPrototypeOf(source);
    const type = promise(idlType.long);
    const result = context.binding.getConverter(context.binding.assembly.getIDLType(type), context.realm).idlToJS(source);
    expect(context.binding.getConverter(context.binding.assembly.getIDLType(type), context.realm).idlToJS(source)).toBe(result);
    expect(result).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(result).resolves.toBe(7);
    expect(Reflect.ownKeys(source)).toEqual(keys);
    expect(Reflect.getPrototypeOf(source)).toBe(prototype);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('rejects exposure when the result descriptor disagrees with the declaration', () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.Promise.withResolvers(idlType.double);
    expect(() => binding.getConverter(binding.assembly.getIDLType(promise(idlType.long))).idlToJS(source.promise))
      .toThrow(InternalError);
  });

  it('selects a new IDL contract through then even when the payload remains a string', async () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.Promise.resolve('text', idlType.DOMString);
    const result = source.then((value) => value, undefined, idlType.USVString);
    const context = { binding: binding, realm: binding.realm };
    expect(result.type).toBe(binding.assembly.builtinTypes.USVString);
    expect(() => context.binding.getConverter(context.binding.assembly.getIDLType(promise(idlType.DOMString)), context.realm).idlToJS(result)).toThrow(InternalError);
    await expect(context.binding.getConverter(context.binding.assembly.getIDLType(promise(idlType.USVString)), context.realm).idlToJS(result)).resolves.toBe('text');
  });

  it('retains implementation result metadata without exposing its private representation', () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const type = internalType<number>();
    const source = binding.Promise.resolve(7, type);
    expect(source.type).toBe(type);
    expect(() => binding.getConverter(binding.assembly.getIDLType(promise(idlType.long))).idlToJS(source)).toThrow(InternalError);
  });

  it.each(['pending', 'settled'] as const)('adopts a %s implementation result before accepting later settlement attempts', async (state) => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.Promise.withResolvers(internalType<number>());
    if (state === 'settled') source.resolve(7);
    const declared = binding.Promise.withResolvers(idlType.long);
    declared.resolve(source.promise);
    expect(declared.isResolved).toBe(true);
    declared.resolve(99);
    declared.reject('late rejection');
    if (state === 'pending') source.resolve(7);
    const exposed = binding.getConverter(binding.assembly.getIDLType(promise(idlType.long))).idlToJS(declared.promise);
    await expect(exposed).resolves.toBe(7);
  });

  it('decodes a host Promise even when it carries the destination IDL descriptor', async () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.Promise.fromInternal(new TestRealm().Promise.resolve(7, idlType.long));
    const declared = binding.Promise.resolve(source, idlType.long);
    await expect(declared.backing).resolves.toBe(7);
    expect(() => binding.getConverter(binding.assembly.getIDLType(promise(idlType.long))).idlToJS(source)).toThrow(InternalError);
  });

  it('reads the implementation value when adopting a different native result contract', async () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.Promise.fromNative(Promise.resolve(42), String, idlType.DOMString);
    const declared = binding.Promise.resolve(source, idlType.USVString);
    await expect(declared.backing).resolves.toBe('42');
  });

  it('retains native result identity when adopting a compatible contract from another realm', async () => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = world.register(first, (ctx) => ({ realm: ctx.realm }));
    const b = world.register(second, (ctx) => ({ realm: ctx.realm }));
    const type = sequence(idlType.long);
    const source = a.Promise.resolve([7], type);
    const imported = b.Promise.fromInternal(source);
    const declared = b.Promise.resolve(imported, type);
    expect(declared.backing).toBeInstanceOf(second.intrinsics.promise.constructor);
    expect(await declared.backing).toBe(await source.backing);
  });

  it('allocates an adopted implementation result in the destination realm', async () => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = world.register(first, (ctx) => ({ realm: ctx.realm }));
    const b = world.register(second, (ctx) => ({ realm: ctx.realm }));
    const source = a.Promise.resolve([7], internalType<number[]>());
    const declared = b.Promise.resolve(source, sequence(idlType.long));
    expect(declared.backing).toBeInstanceOf(second.intrinsics.promise.constructor);
    const value = await declared.backing;
    expect(value).toEqual([7]);
    expect(value).toBeInstanceOf(second.intrinsics.array);
    expect(value).not.toBeInstanceOf(first.intrinsics.array);
  });

  it.each(['direct', 'view'] as const)('rejects %s self-adoption in the destination realm', async (mode) => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const declared = binding.Promise.withResolvers(idlType.long);
    const source = mode === 'direct' ? declared.promise
      : binding.Promise.fromNative(declared.promise.backing, () => 7, internalType<number>());
    declared.resolve(source);
    expect(declared.isResolved).toBe(true);
    await expect(declared.promise.backing).rejects.toBeInstanceOf(realm.intrinsics.typeError);
  });

  it.each(['rejection', 'reading'] as const)('realizes an adopted implementation failure during %s in the destination realm', async (mode) => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = world.register(first, (ctx) => ({ realm: ctx.realm }));
    const b = world.register(second, (ctx) => ({ realm: ctx.realm }));
    const failure = new TypeErrorRequest('source failed');
    const source = mode === 'rejection'
      ? a.Promise.reject(failure, internalType<number>())
      : a.Promise.fromNative(Promise.resolve(7), () => { throw failure; }, internalType<number>());
    const declared = b.Promise.resolve(source, idlType.long);
    await expect(declared.backing).rejects.toBeInstanceOf(second.intrinsics.typeError);
  });

  it.each(['reenter', 'throw'] as const)('settles adopted values when destination conversion can %s', async (mode) => {
    const definition = defineDictionary({ name: 'Result', members: [dictMember('value', idlType.long)] });
    const world = new BindingWorld([definition]);
    const binding = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const declared = binding.Promise.withResolvers(implementationType<{ value: number; }>(reference('Result')));
    const failure = new Error('conversion failed');
    const source = binding.Promise.resolve({
      get value() {
        if (mode === 'throw') throw failure;
        declared.reject('reentrant rejection');
        return 7;
      },
    }, internalType<{ value: number; }>());
    declared.resolve(source);
    expect(declared.isResolved).toBe(true);
    if (mode === 'throw') await expect(declared.promise.backing).rejects.toBe(failure);
    else await expect(declared.promise.backing).resolves.toEqual({ value: 7 });
  });

  it('resolves aliases inside nested result types while retaining conversion attributes', async () => {
    const alias = defineTypedef({ name: 'Count', type: idlType.long });
    const realm = new TestRealm();
    const world = new BindingWorld([alias]);
    const binding = new RealmBinding(new DefinitionAssembly([alias]), realm, world, (ctx) => ({ realm: ctx.realm }));
    const source = binding.Promise.resolve([7], sequence(implementationType<number>(reference('Count'))));
    const context = { binding: binding, realm: binding.realm };
    await expect(context.binding.getConverter(context.binding.assembly.getIDLType(promise(sequence(idlType.long))), context.realm).idlToJS(source)).resolves.toEqual([7]);
    const clamped = annotated(idlType.long, xattr('Clamp'));
    expect(() => context.binding.getConverter(context.binding.assembly.getIDLType(promise(sequence(clamped))), context.realm).idlToJS(source)).toThrow(InternalError);
  });

  it('retains allocation and identity when an implementation view changes reaction destination', async () => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = new RealmBinding(new DefinitionAssembly([]), first, world, (ctx) => ({ realm: ctx.realm }));
    const b = new RealmBinding(new DefinitionAssembly([]), second, world, (ctx) => ({ realm: ctx.realm }));
    const source = a.Promise.resolve(7, idlType.long);
    const view = b.Promise.fromInternal(source);
    const type = promise(idlType.long);
    const result = a.getConverter(a.assembly.getIDLType(type)).idlToJS(source);
    expect(b.getConverter(b.assembly.getIDLType(type)).idlToJS(view)).toBe(result);
    expect(result).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(result).not.toBeInstanceOf(second.intrinsics.promise.constructor);
    await expect(result).resolves.toBe(7);
    const next = view.then((value) => value + 1);
    expect(next.backing).toBeInstanceOf(second.intrinsics.promise.constructor);
    await expect(next.backing).resolves.toBe(8);
  });
});
