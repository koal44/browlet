import { describe, expect, it } from 'vitest';
import { TestRealm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding/world';

import {
  ctor, defineProxyObject, defineInterface, idlType, impl, op, reference, union,
} from '../../src/web-idl/core/index';
import { getImplementationRecord, getPlatformRecord } from '../../src/web-idl/binding/platform';

describe('interface projection ownership', () => {
  for (const stage of ['fresh', 'stamped', 'projected'] as const) {
    it(`projects an inherited interface from a ${stage} implementation`, () => {
      const { a, b, ctxB, realmA, realmB } = setup();
      const implInst = stage === 'fresh' ? new ChildImpl() : a.construct(ChildImpl);
      const previous = stage === 'projected' ? a.project(ChildImpl, implInst) : undefined;
      const result = ctxB.binding.getConverter(reference('Base'), ctxB.realm).idlToJS(implInst);
      const record = getPlatformRecord(result)!;
      expect(record.implInst).toBe(implInst);
      expect(record.realm).toBe(stage === 'fresh' ? realmB : realmA);
      expect(b.project(BaseImpl, implInst)).toBe(result);
      if (previous) expect(result).toBe(previous);
    });

    it(`rejects an unrelated ${stage} implementation for a named interface`, () => {
      const { a, ctxA } = setup();
      const implInst = stage === 'fresh' ? new OtherImpl() : a.construct(OtherImpl);
      if (stage === 'projected') a.project(OtherImpl, implInst);
      expect(() => ctxA.binding.getConverter(reference('Base'), ctxA.realm).idlToJS(implInst)).toThrow();
    });

    it(`selects a matching union member for a ${stage} implementation`, () => {
      const { a, ctxB, realmA, realmB } = setup();
      const implInst = stage === 'fresh' ? new ChildImpl() : a.construct(ChildImpl);
      const previous = stage === 'projected' ? a.project(ChildImpl, implInst) : undefined;
      const result = ctxB.binding.getConverter(union(reference('Other'), reference('Base'), idlType.DOMString), ctxB.realm).idlToJS(implInst);
      const record = getPlatformRecord(result)!;
      expect(record.implInst).toBe(implInst);
      expect(record.realm).toBe(stage === 'fresh' ? realmB : realmA);
      if (previous) expect(result).toBe(previous);
    });
  }

  for (const projected of [false, true]) {
    it(`rejects another world's ${projected ? 'projected' : 'pending'} implementation`, () => {
      const { a } = setup();
      const { ctxB } = setup();
      const implInst = a.construct(ChildImpl);
      if (projected) a.project(ChildImpl, implInst);
      expect(() => ctxB.binding.getConverter(reference('Base'), ctxB.realm).idlToJS(implInst)).toThrow(/world/);
      expect(() => ctxB.binding.getConverter(union(reference('Base'), idlType.DOMString), ctxB.realm).idlToJS(implInst)).toThrow(/world/);
    });
  }

  it('retains already-platform union values and proxy object identities', () => {
    const { a, ctxB, hostObject } = setup();
    const platformObject = a.project(ChildImpl, new ChildImpl());
    expect(ctxB.binding.getConverter(union(reference('Base'), idlType.DOMString), ctxB.realm).idlToJS(platformObject)).toBe(platformObject);
    expect(ctxB.binding.getConverter(reference('HostObject'), ctxB.realm).idlToJS(hostObject)).toBe(hostObject);
    expect(ctxB.binding.getConverter(union(reference('Other'), reference('HostObject'), idlType.DOMString), ctxB.realm).idlToJS(hostObject)).toBe(hostObject);
  });

  it('preserves ordinary object and object-union values without adoption', () => {
    const { a, ctxB } = setup();
    for (const value of [{}, a.project(ChildImpl, new ChildImpl())]) {
      expect(ctxB.binding.getConverter(idlType.object, ctxB.realm).idlToJS(value)).toBe(value);
      expect(ctxB.binding.getConverter(union(idlType.object, idlType.DOMString), ctxB.realm).idlToJS(value)).toBe(value);
      expect(getImplementationRecord(value)).toBeUndefined();
    }
  });

  it('does not change object-union identity when an object also acquires an implementation stamp', () => {
    const { a, ctxB } = setup();
    const value = new ChildImpl();
    const type = union(idlType.object, idlType.DOMString);
    expect(ctxB.binding.getConverter(type, ctxB.realm).idlToJS(value)).toBe(value);
    a.project(ChildImpl, value);
    expect(ctxB.binding.getConverter(idlType.object, ctxB.realm).idlToJS(value)).toBe(value);
    expect(ctxB.binding.getConverter(type, ctxB.realm).idlToJS(value)).toBe(value);
  });

  it('uses the receiver realm for a fresh result from a borrowed operation', () => {
    const { realmA, realmB, a } = setup();
    const factory = a.project(FactoryImpl, new FactoryImpl());
    const foreignFactory = Reflect.get(realmB.global, 'Factory') as { prototype: { create: () => object; }; };
    const result = Reflect.apply(foreignFactory.prototype.create, factory, []);
    expect(getPlatformRecord(result)?.realm).toBe(realmA);
    expect(result).not.toBeInstanceOf(ChildImpl);
  });
});

function setup() {
  const hostObject = new Proxy(Object.freeze({}), {
    getPrototypeOf() { throw new Error('Host objects must not enter implementation discovery'); },
  });
  const world = new BindingWorld([
    ...definitions,
    defineProxyObject({ name: 'HostObject', is: (value) => value === hostObject }),
  ]);
  const realmA = new TestRealm();
  const realmB = new TestRealm();
  const a = world.register(realmA, (ctx) => ({ realm: ctx.realm }));
  const b = world.register(realmB, (ctx) => ({ realm: ctx.realm }));
  a.install(realmA.global);
  b.install(realmB.global);
  return {
    realmA, realmB, a, b, hostObject,
    ctxA: { binding: world.getRealmBinding(realmA)!, realm: realmA },
    ctxB: { binding: world.getRealmBinding(realmB)!, realm: realmB },
  };
}

class BaseImpl {}
class ChildImpl extends BaseImpl {}
class OtherImpl {}
class FactoryImpl {
  create(): ChildImpl { return new ChildImpl(); }
}

const definitions = [
  defineInterface({ name: 'Base', exposed: '*', implementation: impl(BaseImpl), members: [] }),
  defineInterface({
    name: 'Child', inherits: 'Base', exposed: '*', implementation: impl(ChildImpl), members: [],
  }),
  defineInterface({ name: 'Other', exposed: '*', implementation: impl(OtherImpl), members: [] }),
  defineInterface({
    name: 'Factory', exposed: '*', implementation: impl(FactoryImpl),
    members: [ctor(), op('create', reference('Base'))],
  }),
];
