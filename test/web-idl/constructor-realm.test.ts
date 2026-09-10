import { describe, expect, it } from 'vitest';
import type { JSFunction } from '../../src/js-engine/index';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { RealmBinding } from '../../src/web-idl/binding';
import { ctor, defineInterface, impl } from '../../src/web-idl/declaration/index';
import { PlatformObjectRegistry } from '../../src/web-idl/platform-object';
import { registerDefinitionBindings } from '../../src/web-idl/projection';
import { TestRealm } from './test-realm';

describe('interface constructor prototype fallback', () => {
  for (const prototype of [null, undefined, 0]) {
    it(`uses the newTarget realm when prototype is ${String(prototype)}`, () => {
      const { first, second, target } = createBindings();
      Reflect.set(target, 'prototype', prototype);
      const object = Reflect.construct(first.getInterfaceObject('Example'), [], target) as object;

      expect(Reflect.getPrototypeOf(object)).toBe(second.getInterfacePrototypeObject('Example'));
      expect(first.getPlatformObjectRecord(object)?.realm).toBe(first.realm);
    });
  }

  it('follows a bound target despite a different function prototype', () => {
    const { first, second, target } = createBindings();
    Reflect.set(first.realm.global, 'foreignTarget', target);
    const bound = first.realm.evaluate(
      'Function.prototype.bind.call(foreignTarget, null)', 'bound.js',
    ) as JSFunction;
    Reflect.setPrototypeOf(bound, first.realm.intrinsics.functionPrototype);
    const object = Reflect.construct(first.getInterfaceObject('Example'), [], bound) as object;

    expect(Reflect.getPrototypeOf(object)).toBe(second.getInterfacePrototypeObject('Example'));
  });

  it('reads prototype once without consulting proxy prototype traps', () => {
    const { first, second, target } = createBindings();
    const trace: string[] = [];
    const proxy = new Proxy(target, {
      get(target, key, receiver) {
        trace.push(`get ${String(key)}`);
        return Reflect.get(target, key, receiver) as unknown;
      },
      getPrototypeOf() { throw new Error('unexpected getPrototypeOf'); },
      getOwnPropertyDescriptor() { throw new Error('unexpected getOwnPropertyDescriptor'); },
    });
    const object = Reflect.construct(first.getInterfaceObject('Example'), [], proxy) as object;

    expect(trace).toEqual(['get prototype']);
    expect(Reflect.getPrototypeOf(object)).toBe(second.getInterfacePrototypeObject('Example'));
  });

  it('throws when a primitive prototype getter revokes newTarget', () => {
    const { first, target } = createBindings();
    const { proxy, revoke } = Proxy.revocable(target, {
      get() { revoke(); return null; },
    });
    expect(() => { Reflect.construct(first.getInterfaceObject('Example'), [], proxy); })
      .toThrow(first.realm.intrinsics.typeError);
  });

  it('throws in the constructor realm when newTarget is already revoked', () => {
    const { first, target } = createBindings();
    const { proxy, revoke } = Proxy.revocable(target, {});
    revoke();
    expect(() => { Reflect.construct(first.getInterfaceObject('Example'), [], proxy); })
      .toThrow(first.realm.intrinsics.typeError);
  });

  it('preserves the exception thrown by a prototype getter', () => {
    const { first, second, target } = createBindings();
    const error = new second.realm.intrinsics.typeError('from the getter');
    const proxy = new Proxy(target, { get() { throw error; } });
    let thrown: unknown;
    try { Reflect.construct(first.getInterfaceObject('Example'), [], proxy); }
    catch (value) { thrown = value; }
    expect(thrown).toBe(error);
  });

  it('reads an object prototype only once', () => {
    const { first, target } = createBindings();
    const prototype = {};
    const trace: PropertyKey[] = [];
    const proxy = new Proxy(target, {
      get(_target, key) { trace.push(key); return prototype; },
    });
    const object = Reflect.construct(first.getInterfaceObject('Example'), [], proxy) as object;
    expect(Reflect.getPrototypeOf(object)).toBe(prototype);
    expect(trace).toEqual(['prototype']);
  });

  it('uses an object prototype even when its getter revokes newTarget', () => {
    const { first, target } = createBindings();
    const prototype = {};
    const { proxy, revoke } = Proxy.revocable(target, {
      get() { revoke(); return prototype; },
    });
    const object = Reflect.construct(first.getInterfaceObject('Example'), [], proxy) as object;
    expect(Reflect.getPrototypeOf(object)).toBe(prototype);
  });
});

function createBindings() {
  class ExampleImpl {}
  const definitions = assembleDefinitions([
    defineInterface({
      name: 'Example', exposed: '*', implementation: impl(ExampleImpl), members: [ctor()],
    }),
  ]);
  const objects = new PlatformObjectRegistry();
  const first = new RealmBinding(definitions, new TestRealm(), objects);
  const second = new RealmBinding(definitions, new TestRealm(), objects);
  registerDefinitionBindings(first);
  registerDefinitionBindings(second);
  const target = second.realm.evaluate('(function Target() {})', 'target.js') as JSFunction;
  Reflect.set(target, 'prototype', null);
  return { first, second, target };
}
