import { describe, expect, it } from 'vitest';

import {
  defineInterface, idlType, impl, observableArray, reference, roAttr,
  type AttributeMember, type ObservableArraySteps,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';
import type { RealmBinding } from '../../../../src/web-idl/binding/realm';
import { getPlatformRecord } from '../../../../src/web-idl/binding/platform';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL observable arrays', () => {
  it('creates one realm Array per platform object and attribute', () => {
    const fixture = createNumberArrayBinding();
    const first = getValues(fixture.object);
    const second = getValues(fixture.object);

    expect(first).toBe(second);
    expect(Array.isArray(first)).toBe(true);
    expect(first).toBeInstanceOf(fixture.realm.Array);
    expect(first).not.toBeInstanceOf(Array);
    expect(first.constructor).toBe(fixture.realm.Array);

    first.push('1', 2);

    expect(first).toEqual([1, 2]);
    expect(fixture.implementation.values).toEqual([1, 2]);

    const other = fixture.binding.allocatePlatformRecord(fixture.binding.resolveInterface('NumberArrays')).platformObject!;
    expect(getValues(other)).not.toBe(first);
  });

  it('preserves the receiver owner when a borrowed getter first exposes the array', () => {
    class ValueImpl {}
    class ValuesImpl {
      values: ValueImpl[] = [];
    }
    const attribute = roAttr('values', observableArray(reference('Value')));
    const world = new BindingWorld([
      defineInterface({ name: 'Value', implementation: impl(ValueImpl), members: [] }),
      defineInterface({ name: 'Values', implementation: impl(ValuesImpl), members: [attribute] }),
    ]);
    const owner = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const other = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const implementation = new ValuesImpl();
    const object = owner.project(ValuesImpl, implementation);
    const foreign = other.project(ValuesImpl, new ValuesImpl());
    // eslint-disable-next-line @typescript-eslint/unbound-method -- explicitly apply the borrowed getter to the owner
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(foreign), 'values')!.get!;
    const values = Reflect.apply(getter, object, []) as object[];
    expect(Object.getPrototypeOf(values)).toBe(owner.realm.Array.prototype);
    const value = new ValueImpl();
    implementation.values.push(value);

    expect(world.getRealm(values[0]!)).toBe(owner.realm);
    expect(values[0]).toBe(owner.project(ValueImpl, value));
  });

  it('runs indexed implementation steps around backing-list mutations', () => {
    const operations: string[] = [];
    const receivers: object[] = [];
    const fixture = createNumberArrayBinding({
      delete(value, index) {
        receivers.push(this);
        operations.push(`delete ${index} ${String(value)}`);
      },
      set(value, index) {
        receivers.push(this);
        operations.push(`set ${index} ${String(value)}`);
      },
    });
    const values = getValues(fixture.object);

    values.push(1);
    values[0] = 2;
    values.pop();

    expect(operations).toEqual([
      'set 0 1',
      'delete 0 1',
      'set 0 2',
      'delete 0 2',
    ]);
    const implInst = getPlatformRecord(fixture.object)!.implInst;
    expect(receivers).toHaveLength(4);
    for (const receiver of receivers) expect(receiver).toBe(implInst);
  });

  it('preserves deletions completed before a later delete step throws', () => {
    const deleted: number[] = [];
    const exception = new Error('stop deleting');
    const fixture = createNumberArrayBinding({
      delete(_value, index) {
        deleted.push(index);
        if (index === 1) throw exception;
      },
    });
    const values = getValues(fixture.object);
    values.push(1, 2, 3);

    expect(() => Reflect.set(values, 'length', 0)).toThrow(exception);
    expect(deleted).toEqual([2, 1]);
    expect(values).toEqual([1, 2]);
  });

  it('converts an assignment before replacing the existing contents', () => {
    const operations: string[] = [];
    const fixture = createNumberArrayBinding({
      delete(value, index) {
        operations.push(`delete ${index} ${String(value)}`);
      },
      set(value, index) {
        operations.push(`set ${index} ${String(value)}`);
      },
    });
    const values = getValues(fixture.object);
    values.push(1);
    operations.length = 0;

    expect(() => Reflect.set(
      fixture.object,
      'values',
      [2, Symbol('invalid')],
    )).toThrow(fixture.realm.TypeError);
    expect(values).toEqual([1]);
    expect(operations).toEqual([]);

    expect(Reflect.set(
      fixture.object,
      'values',
      new Set(['3', '4']),
    )).toBe(true);
    expect(getValues(fixture.object)).toBe(values);
    expect(values).toEqual([3, 4]);
    expect(operations).toEqual([
      'delete 0 1',
      'set 0 3',
      'set 1 4',
    ]);
  });

  it('enforces the observable array property invariants', () => {
    const fixture = createNumberArrayBinding();
    const values = getValues(fixture.object) as unknown[] & {
      label?: string;
    };

    expect(Reflect.set(values, '1', 2)).toBe(false);
    expect(Reflect.set(values, 'length', 1)).toBe(false);
    expect(Reflect.set(values, '0', 1)).toBe(true);
    expect(Reflect.set(values, '2', 3)).toBe(false);
    expect(Reflect.defineProperty(values, '0', { writable: false }))
      .toBe(false);
    expect(Reflect.defineProperty(values, 'length', { enumerable: true }))
      .toBe(false);
    expect(Reflect.deleteProperty(values, '0')).toBe(true);
    expect(Reflect.deleteProperty(values, 'length')).toBe(false);
    expect(Reflect.preventExtensions(values)).toBe(false);
    expect(Object.isExtensible(values)).toBe(true);
    expect(() => Reflect.set(values, 'length', 1.5))
      .toThrow(fixture.realm.RangeError);

    values.label = 'numbers';
    expect(values.label).toBe('numbers');
    expect(Reflect.ownKeys(values)).toEqual(['length', 'label']);
  });

  it.each([null, {}])('rejects a non-iterable assignment in the binding realm: %s', (value) => {
    const fixture = createNumberArrayBinding();
    const values = getValues(fixture.object);
    values.push(1);
    expect(() => Reflect.set(fixture.object, 'values', value)).toThrow(fixture.realm.TypeError);
    expect(values).toEqual([1]);
  });

  it('coerces an assigned length through ToUint32 and then ToNumber', () => {
    const fixture = createNumberArrayBinding();
    const values = getValues(fixture.object);
    let coercions = 0;
    const length = {
      valueOf() {
        coercions++;
        return 0;
      },
    };
    values.push(1);

    expect(Reflect.set(values, 'length', length)).toBe(true);
    expect(coercions).toBe(2);
    expect(values).toEqual([]);
  });

  it('converts proxy property descriptors before applying invariants', () => {
    const fixture = createNumberArrayBinding();
    const values = getValues(fixture.object);
    const descriptor = Object.assign(Object.create(null) as object, {
      value: 0,
    });

    Object.defineProperty(Object.prototype, 'configurable', {
      configurable: true,
      value: 1,
    });
    let result: boolean | undefined;
    try {
      result = Reflect.defineProperty(values, 'length', descriptor);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'configurable');
    }
    expect(result).toBe(false);

    Object.defineProperty(Object.prototype, 'get', {
      configurable: true,
      value: 0,
    });
    let exception: unknown;
    try {
      Reflect.defineProperty(values, '0', descriptor);
    } catch (error) {
      exception = error;
    } finally {
      Reflect.deleteProperty(Object.prototype, 'get');
    }
    expect(exception).toBeInstanceOf(fixture.realm.TypeError);
  });

  it('converts interface elements and reflects specification list changes', () => {
    class EmployeeImpl {}
    class BuildingImpl { workers: EmployeeImpl[] = []; }
    const employee = defineInterface({
      name: 'Employee',
      exposed: '*',
      implementation: impl(EmployeeImpl),
      members: [],
    });
    const workers = {
      kind: 'attribute',
      name: 'workers',
      type: observableArray(reference('Employee')),
    } satisfies AttributeMember;
    const building = defineInterface({
      name: 'Building',
      exposed: '*',
      implementation: impl(BuildingImpl),
      members: [workers],
    });
    const realm = new Realm();

    const world = new BindingWorld([employee, building]);
    const binding = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const implementation = new BuildingImpl();
    const employeeImpl = new EmployeeImpl();
    const object = binding.project(BuildingImpl, implementation);
    const employeeObject = binding.project(EmployeeImpl, employeeImpl);
    const values = getArray(object, 'workers');
    const backingList = implementation.workers;

    values.push(employeeObject);
    expect(backingList).toHaveLength(1);
    expect(backingList[0]).toBe(employeeImpl);
    expect(values[0]).toBe(employeeObject);
    expect(() => values.push({})).toThrow(realm.TypeError);

    backingList.push(employeeImpl);
    expect(values).toEqual([employeeObject, employeeObject]);
  });
});

function createNumberArrayBinding(observableArraySteps?: ObservableArraySteps): NumberArrayFixture {
  class NumberArraysImpl { values: number[] = []; }
  const attribute = {
    kind: 'attribute',
    name: 'values',
    type: observableArray(idlType.long),
    observableArraySteps,
  } satisfies AttributeMember;
  const definition = defineInterface({
    name: 'NumberArrays',
    exposed: '*',
    implementation: impl(NumberArraysImpl),
    members: [attribute],
  });
  const realm = new Realm();
  const world = new BindingWorld([definition]);
  const context = world.register(realm, (ctx) => ({ realm: ctx.realm }));
  const binding = world.getRealmBinding(realm)!;
  const implementation = new NumberArraysImpl();
  const object = context.project(NumberArraysImpl, implementation);
  return {
    attribute,
    binding,
    definition,
    object,
    implementation,
    realm,
  };
}

function getValues(object: object): unknown[] {
  return getArray(object, 'values');
}

function getArray(object: object, name: string): unknown[] {
  const value: unknown = Reflect.get(object, name);
  if (!Array.isArray(value)) throw new Error(`${name} is not an Array`);
  return value;
}

type NumberArrayFixture = {
  implementation: { values: number[]; };
  definition: ReturnType<typeof defineInterface>;
  attribute: AttributeMember;
  binding: RealmBinding;
  object: object;
  realm: Realm;
};
