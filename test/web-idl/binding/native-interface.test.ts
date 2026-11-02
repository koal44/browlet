import { describe, expect, it } from 'vitest';

import { InternalError } from '../../../src/infra/internal-error';
import { hasMapData, type JSFunctionWithPrototype } from '../../../src/js-engine/index';
import {
  arg, ctor, defineDictionary, defineInterface, defineNamespace, idlType, op, reference, sequence, staticOp, union, xattr,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { getPlatformRecord } from '../../../src/web-idl/values/platform';
import { createBinding, installTestBindings } from '../../support/web-idl-binding';
import { createConversionSteps, expectRealmTypeError } from '../../support/web-idl-conversion';
import { TestRealm } from '../../support/web-idl-realm';

// Engine-owned objects use the same identity for implementation and platform.
const nativeMap = defineInterface({
  name: 'NativeMap', members: [],
  interfaceOverride: { isInstance: hasMapData },
});

it('installs converted static operations while preserving each native constructor and prototype', () => {
  type Environment = { realm: TestRealm; };
  let captures = 0;
  const definition = defineInterface<Environment>({
    name: 'NativeMap', exposed: '*',
    interfaceOverride: {
      isInstance: hasMapData,
      getInterfaceObject: (env) => { captures++; return env.realm.Map; },
    },
    members: [staticOp('read', idlType.any,
      [arg('map', reference('NativeMap')), arg('key', idlType.DOMString)],
      { overrideInvoke: (_environments, map, key) => Reflect.apply(mapGet, map, [key]) as unknown },
    )],
  });
  const world = new BindingWorld<Environment>([definition]);
  const foreign = new TestRealm();
  const foreignMap = new foreign.Map([['undefined', 42]]);
  for (const realm of [new TestRealm(), new TestRealm()]) {
    const constructor = realm.Map;
    const prototype = constructor.prototype;
    const descriptors = Object.getOwnPropertyDescriptors(prototype);
    world.register(realm, () => ({ realm }));
    const binding = world.getRealmBinding(realm)!;
    expect(binding.installDefinitions().get('NativeMap')).toBe(constructor);
    expect(constructor.prototype).toBe(prototype);
    expect(Reflect.ownKeys(prototype)).toEqual(Reflect.ownKeys(descriptors));
    for (const key of Reflect.ownKeys(descriptors)) {
      const before = Reflect.get(descriptors, key) as PropertyDescriptor;
      const after = Object.getOwnPropertyDescriptor(prototype, key)!;
      for (const field of Reflect.ownKeys(before)) expect(Reflect.get(after, field)).toBe(Reflect.get(before, field));
    }
    expect(new constructor()).toBeInstanceOf(constructor);
    const read = Reflect.get(constructor, 'read') as (map: unknown, key: unknown) => unknown;
    expect(Reflect.getPrototypeOf(read)).toBe(realm.functionPrototype);
    expect(Reflect.apply(read, null, [foreignMap, undefined])).toBe(42);
    expect(Object.getOwnPropertyDescriptor(constructor, 'read')).toEqual({
      value: read, writable: true, enumerable: true, configurable: true,
    });
    const invalidName = { toString() { throw new Error('Name must not be converted'); } };
    expect(() => read({}, invalidName)).toThrow(realm.TypeError);
    expect(() => { Reflect.apply(read, null, [foreignMap]); }).toThrow(realm.TypeError);
    expect(binding.installDefinitions().get('NativeMap')).toBe(constructor);
    expect(Reflect.get(constructor, 'read')).toBe(read);
  }
  expect(captures).toBe(2);
});

// The test implementation uses the captured native operation; Binding owns its argument conversion.
const mapGet = Reflect.get(Map.prototype, 'get') as (this: Map<unknown, unknown>, key: unknown) => unknown;

it('leaves a value-only interface untouched inside a supplied namespace', () => {
  type Environment = { realm: TestRealm; };
  const definition = defineInterface({
    name: 'Map', exposed: '*', members: [], interfaceOverride: { isInstance: hasMapData },
    ...xattr(['LegacyNamespace', 'Tools']),
  });
  const world = new BindingWorld<Environment>([
    definition,
    defineNamespace<Environment>({
      name: 'Tools', exposed: '*', members: [], overrideNamespace: (env) => ({ Map: env.realm.Map }),
    }),
  ]);
  const realm = new TestRealm();
  world.register(realm, () => ({ realm }));
  const installed = world.getRealmBinding(realm)!.installDefinitions();
  expect(installed.has('Map')).toBe(false);
  expect(Reflect.get(installed.get('Tools')!, 'Map')).toBe(realm.Map);
});

it('returns and records the native constructor result without an extra platform object', () => {
  type Environment = { realm: TestRealm; };
  const definition = defineInterface<Environment>({
    name: 'Map', exposed: '*',
    interfaceOverride: { isInstance: hasMapData, getInterfaceObject: (env) => env.realm.Map },
    members: [ctor(
      [arg('key', idlType.DOMString)],
      { overrideConstruct: ({ relevant: env }, key) => new env.realm.Map([[key, 42]]) },
    )],
  });
  const realm = new TestRealm();
  const world = new BindingWorld<Environment>([definition]);
  world.register(realm, () => ({ realm }));
  const binding = world.getRealmBinding(realm)!;
  const constructor = binding.installDefinitions().get('Map') as JSFunctionWithPrototype;
  const value = Reflect.construct(constructor, [undefined]) as object;
  expect(hasMapData(value)).toBe(true);
  expect(Reflect.apply(mapGet, value, ['undefined'])).toBe(42);
  expect(Object.getPrototypeOf(value)).toBe(realm.Map.prototype);
  expect(Reflect.get(value, 'constructor')).toBe(constructor);
  expect(constructor.length).toBe(1);
  expect(constructor.name).toBe('Map');
  const record = getPlatformRecord(value);
  expect(record).toBeDefined();
  expect(record!.implInst).toBe(value);
  expect(record!.platformObject).toBe(value);
  expect(record!.realm).toBe(realm);
  expect(world.project(value)).toBe(value);
  expect(world.unwrap(value)).toBe(value);
  expect(binding.installDefinitions().get('Map')).toBe(constructor);
  expect(() => { Reflect.apply(constructor, undefined, ['key']); }).toThrow(realm.TypeError);

  const otherWorld = new BindingWorld([nativeMap]);
  const otherRealm = new TestRealm();
  const other = otherWorld.register(otherRealm, () => ({ realm: otherRealm }));
  // Native conversion remains usable across worlds without moving its established owner.
  expect(other.jsToImpl(value, reference('NativeMap'))).toBe(value);
  expect(other.implToJS(value, reference('NativeMap'))).toBe(value);
  expect(other.getObjectRecord(value)).toBeUndefined();
  expect(otherWorld.project(value)).toBeUndefined();
  expect(otherWorld.unwrap(value)).toBeUndefined();
  expect(getPlatformRecord(value)).toBe(record);
});

describe.each(['direct', 'prepared'] as const)('native interface conversion (%s)', (mode) => {
  it('preserves native identity across realms and prototype changes, rejecting lookalikes', () => {
    const { binding, realm } = createBinding([nativeMap]);
    const converter = binding.getConverter(binding.assembly.getIDLType(reference('NativeMap')));
    const { jsToIDL, idlToJS } = createConversionSteps(mode);
    const foreign = new TestRealm();
    const map = new foreign.Map();
    Object.setPrototypeOf(map, null);
    expect(jsToIDL(map, converter)).toBe(map);
    expect(idlToJS(map, converter)).toBe(map);
    for (const invalid of [null, 1, {}, Object.create(Map.prototype), new Proxy(map, {})]) {
      expectRealmTypeError(() => jsToIDL(invalid, converter), realm);
      expect(() => idlToJS(invalid, converter)).toThrow(InternalError);
    }
    expect(binding.installDefinitions().has('NativeMap')).toBe(false);
  });

  it('selects a native interface before an iterable union branch and preserves result identity', () => {
    const { binding } = createBinding([nativeMap]);
    const converter = binding.getConverter(binding.assembly.getIDLType(union(reference('NativeMap'), sequence(idlType.long))));
    const { jsToIDL, idlToJS } = createConversionSteps(mode);
    const map = new Map();
    Object.defineProperty(map, Symbol.iterator, { get() { throw new Error('must not read iterator'); } });
    expect(jsToIDL(map, converter)).toBe(map);
    expect(idlToJS(map, converter)).toBe(map);
    expect(jsToIDL([1, 2], converter)).toEqual([1, 2]);
  });
});

it('selects native overloads by brand and argument count without modifying native objects', () => {
  const world = new BindingWorld([
    nativeMap,
    defineDictionary({ name: 'Options', members: [] }),
    defineNamespace({
      name: 'Operations', exposed: '*', members: [
        op('pick', idlType.DOMString,
          [arg('value', reference('NativeMap')), arg('extra', idlType.object, { optional: true })],
          { overrideInvoke: () => 'native' },
        ),
        op('pick', idlType.DOMString,
          [arg('value', idlType.Uint8Array), arg('extra', idlType.object, { optional: true }),
            arg('options', reference('Options'), { optional: true })],
          { overrideInvoke: () => 'bytes' },
        ),
      ],
    }),
  ]);
  const { realm } = installTestBindings(world);
  const api = Reflect.get(realm.globalObject, 'Operations') as { pick(...args: unknown[]): string; };
  const foreign = new TestRealm();
  const map = new foreign.Map();
  expect(api.pick(map)).toBe('native');
  expect(api.pick(map, {})).toBe('native');
  expect(api.pick(new Uint8Array(), {}, {})).toBe('bytes');
  // Three arguments leave only the byte overload in the effective overload set.
  expect(() => api.pick(map, {}, {})).toThrow(realm.TypeError);
  expect(() => api.pick(Object.create(Map.prototype))).toThrow(realm.TypeError);
  expect(Object.getPrototypeOf(map)).toBe(foreign.Map.prototype);
});
