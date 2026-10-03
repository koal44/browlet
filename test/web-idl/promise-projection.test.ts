import { PromiseConverter } from '../../src/web-idl/converters/promise';
import { describe, expect, it } from 'vitest';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { RealmBinding } from '../../src/web-idl/binding/realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';

import {
  annotated, defineTypedef, idlType, implementationType, promise, reference, sequence, xattr,
} from '../../src/web-idl/core/index';
import { InternalError } from '../../src/infra/internal-error';
import { internalType } from '../../src/infra/promises';
import { TestRealm } from './test-realm';

describe('declared Promise ownership', () => {
  it('keeps inherited creation methods in their selected realms', async () => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = new RealmBinding(new DefinitionAssembly([]), first, world, (ctx) => ({ realm: ctx.realm })).context.Promise;
    const b = new RealmBinding(new DefinitionAssembly([]), second, world, (ctx) => ({ realm: ctx.realm })).context.Promise;
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
    const P = binding.context.Promise;
    const type = implementationType<number[]>(reference('Counts'));
    const result = P.all([P.resolve(1, idlType.long), P.resolve(2, idlType.long)], type);
    const values = await binding.getConverter(promise(type)).idlToJS(result);
    expect(values).toEqual([1, 2]);
    expect(values).toBeInstanceOf(realm.intrinsics.array);
  });

  it.each(['record', 'implementation'] as const)('exposes a frozen %s result without changing identity', async (kind) => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const context = { binding: binding, realm: binding.realm };
    const source = Object.freeze(kind === 'record'
      ? PromiseConverter.fromIDL(7, binding.getConverter(idlType.long))
      : binding.context.Promise.resolve(7, idlType.long));
    const keys = Reflect.ownKeys(source);
    const prototype = Reflect.getPrototypeOf(source);
    const type = promise(idlType.long);
    const result = context.binding.getConverter(type, context.realm).idlToJS(source);
    expect(context.binding.getConverter(type, context.realm).idlToJS(source)).toBe(result);
    expect(result).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(result).resolves.toBe(7);
    expect(Reflect.ownKeys(source)).toEqual(keys);
    expect(Reflect.getPrototypeOf(source)).toBe(prototype);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('rejects exposure when the result descriptor disagrees with the declaration', () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.context.Promise.withResolvers(idlType.double);
    expect(() => binding.getConverter(promise(idlType.long)).idlToJS(source.promise))
      .toThrow(InternalError);
  });

  it('selects a new IDL contract through then even when the payload remains a string', async () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const source = binding.context.Promise.resolve('text', idlType.DOMString);
    const result = source.then((value) => value, undefined, idlType.USVString);
    const context = { binding: binding, realm: binding.realm };
    expect(result.type).toBe(idlType.USVString);
    expect(() => context.binding.getConverter(promise(idlType.DOMString), context.realm).idlToJS(result)).toThrow(InternalError);
    await expect(context.binding.getConverter(promise(idlType.USVString), context.realm).idlToJS(result)).resolves.toBe('text');
  });

  it('retains implementation result metadata without exposing its private representation', () => {
    const realm = new TestRealm();
    const binding = new RealmBinding(new DefinitionAssembly([]), realm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const type = internalType<number>('Counter');
    const source = binding.context.Promise.resolve(7, type);
    expect(source.type).toBe(type);
    expect(() => binding.getConverter(promise(idlType.long)).idlToJS(source)).toThrow(InternalError);
  });

  it('resolves aliases inside nested result types while retaining conversion attributes', async () => {
    const alias = defineTypedef({ name: 'Count', type: idlType.long });
    const realm = new TestRealm();
    const world = new BindingWorld([alias]);
    const binding = new RealmBinding(new DefinitionAssembly([alias]), realm, world, (ctx) => ({ realm: ctx.realm }));
    const source = binding.context.Promise.resolve([7], sequence(implementationType<number>(reference('Count'))));
    const context = { binding: binding, realm: binding.realm };
    await expect(context.binding.getConverter(promise(sequence(idlType.long)), context.realm).idlToJS(source)).resolves.toEqual([7]);
    const clamped = annotated(idlType.long, xattr('Clamp'));
    expect(() => context.binding.getConverter(promise(sequence(clamped)), context.realm).idlToJS(source)).toThrow(InternalError);
  });

  it('retains allocation and identity when an implementation view changes reaction destination', async () => {
    const world = new BindingWorld([]);
    const first = new TestRealm();
    const second = new TestRealm();
    const a = new RealmBinding(new DefinitionAssembly([]), first, world, (ctx) => ({ realm: ctx.realm }));
    const b = new RealmBinding(new DefinitionAssembly([]), second, world, (ctx) => ({ realm: ctx.realm }));
    const source = a.context.Promise.resolve(7, idlType.long);
    const view = b.context.Promise.fromInternal(source);
    const type = promise(idlType.long);
    const result = a.getConverter(type).idlToJS(source);
    expect(b.getConverter(type).idlToJS(view)).toBe(result);
    expect(result).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(result).not.toBeInstanceOf(second.intrinsics.promise.constructor);
    await expect(result).resolves.toBe(7);
    const next = view.then((value) => value + 1);
    expect(next.backing).toBeInstanceOf(second.intrinsics.promise.constructor);
    await expect(next.backing).resolves.toBe(8);
  });
});
