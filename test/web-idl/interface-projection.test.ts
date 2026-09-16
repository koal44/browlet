import { describe, expect, it } from 'vitest';
import { TestRealm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { convertToJavaScript } from '../../src/web-idl/conversion';
import {
  ctor, defineInterface, idlType, impl, op, reference, union,
} from '../../src/web-idl/core/index';
import { getImplementationRecord, getPlatformRecord } from '../../src/web-idl/platform-object';

describe('interface projection ownership', () => {
  for (const stage of ['fresh', 'stamped', 'projected'] as const) {
    it(`projects an inherited interface from a ${stage} implementation`, () => {
      const { a, b, ctxB, realmA, realmB } = setup();
      const implInst = stage === 'fresh' ? new ChildImpl() : a.construct(ChildImpl);
      const previous = stage === 'projected' ? a.project(ChildImpl, implInst) : undefined;
      const result = convertToJavaScript(implInst, reference('Base'), ctxB);
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
      expect(() => convertToJavaScript(implInst, reference('Base'), ctxA)).toThrow();
    });

    it(`selects a matching union member for a ${stage} implementation`, () => {
      const { a, ctxB, realmA, realmB } = setup();
      const implInst = stage === 'fresh' ? new ChildImpl() : a.construct(ChildImpl);
      const previous = stage === 'projected' ? a.project(ChildImpl, implInst) : undefined;
      const result = convertToJavaScript(
        implInst, union(reference('Other'), reference('Base'), idlType.DOMString), ctxB,
      );
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
      expect(() => convertToJavaScript(implInst, reference('Base'), ctxB)).toThrow(/world/);
      expect(() => convertToJavaScript(
        implInst, union(reference('Base'), idlType.DOMString), ctxB,
      )).toThrow(/world/);
    });
  }

  it('retains already-platform union values and host-defined interface identities', () => {
    const { a, ctxB, hostObject } = setup();
    const platformObject = a.project(ChildImpl, new ChildImpl());
    expect(convertToJavaScript(
      platformObject, union(reference('Base'), idlType.DOMString), ctxB,
    )).toBe(platformObject);
    expect(convertToJavaScript(hostObject, reference('HostObject'), ctxB)).toBe(hostObject);
    expect(convertToJavaScript(
      hostObject, union(reference('Other'), reference('HostObject'), idlType.DOMString), ctxB,
    )).toBe(hostObject);
  });

  it('preserves ordinary object and object-union values without adoption', () => {
    const { a, ctxB } = setup();
    for (const value of [{}, a.project(ChildImpl, new ChildImpl())]) {
      expect(convertToJavaScript(value, idlType.object, ctxB)).toBe(value);
      expect(convertToJavaScript(value, union(idlType.object, idlType.DOMString), ctxB)).toBe(value);
      expect(getImplementationRecord(value)).toBeUndefined();
    }
  });

  it('does not change object-union identity when an object also acquires an implementation stamp', () => {
    const { a, ctxB } = setup();
    const value = new ChildImpl();
    const type = union(idlType.object, idlType.DOMString);
    expect(convertToJavaScript(value, type, ctxB)).toBe(value);
    a.project(ChildImpl, value);
    expect(convertToJavaScript(value, idlType.object, ctxB)).toBe(value);
    expect(convertToJavaScript(value, type, ctxB)).toBe(value);
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
  const world = new BindingWorld(definitions, {
    hostDefinedInterfaces: [{ name: 'HostObject', is: (value) => value === hostObject }],
  });
  const realmA = new TestRealm();
  const realmB = new TestRealm();
  const a = world.register(realmA);
  const b = world.register(realmB);
  a.install(realmA.global);
  b.install(realmB.global);
  return {
    realmA, realmB, a, b, hostObject,
    ctxA: world.getRealmBinding(realmA)!.defaultConversionContext,
    ctxB: world.getRealmBinding(realmB)!.defaultConversionContext,
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
