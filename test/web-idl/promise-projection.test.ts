import { describe, expect, it } from 'vitest';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { projectPromise } from '../../src/web-idl/conversion';
import { idlType } from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import { TestRealm } from './test-realm';

describe('Promise projection ownership', () => {
  it.each(['native', 'internal'] as const)('preserves a frozen %s source and its projected identity', async (kind) => {
    const realm = new TestRealm();
    const binding = new RealmBinding(assembleDefinitions([]), realm, new BindingWorld([]));
    const source = Object.freeze(kind === 'native' ? Promise.resolve(7) : realm.promises.resolve(7));
    const keys = Reflect.ownKeys(source);
    const prototype = Reflect.getPrototypeOf(source);

    const projected = projectPromise(source, idlType.long, binding);
    expect(projectPromise(source, idlType.long, binding)).toBe(projected);
    await expect(projected).resolves.toBe(7);
    expect(projectPromise(source, idlType.long, binding)).toBe(projected);
    expect(Reflect.ownKeys(source)).toEqual(keys);
    expect(Reflect.getPrototypeOf(source)).toBe(prototype);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it.each(['native', 'internal'] as const)('distinguishes world, realm, and result type for one %s source', async (kind) => {
    const definitions = assembleDefinitions([]);
    const world = new BindingWorld([]);
    const realm = new TestRealm();
    const otherRealm = new TestRealm();
    const binding = new RealmBinding(definitions, realm, world);
    const otherRealmBinding = new RealmBinding(definitions, otherRealm, world);
    const otherWorldBinding = new RealmBinding(definitions, realm, new BindingWorld([]));
    const source = kind === 'native' ? Promise.resolve(7) : realm.promises.resolve(7);

    const projected = projectPromise(source, idlType.long, binding);
    const differentRealm = projectPromise(source, idlType.long, otherRealmBinding);
    const differentWorld = projectPromise(source, idlType.long, otherWorldBinding);
    const differentType = projectPromise(source, idlType.any, binding);
    expect(new Set([projected, differentRealm, differentWorld, differentType]).size).toBe(4);
    expect(projected).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(differentRealm).toBeInstanceOf(otherRealm.intrinsics.promise.constructor);
    await expect(Promise.all([projected, differentRealm, differentWorld, differentType]))
      .resolves.toEqual([7, 7, 7, 7]);
    expect(projectPromise(source, idlType.long, binding)).toBe(projected);
    expect(projectPromise(source, idlType.long, otherRealmBinding)).toBe(differentRealm);
    expect(projectPromise(source, idlType.long, otherWorldBinding)).toBe(differentWorld);
    expect(projectPromise(source, idlType.any, binding)).toBe(differentType);
  });
});
