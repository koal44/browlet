import { describe, expect, it } from 'vitest';

import {
  defineInterface, idlType, impl, observableArray, reference, roAttr,
  type AttributeMember,
} from '../../../../src/web-idl/core/index';
import { DefinitionAssembly } from '../../../../src/web-idl/assembly/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';
import { RealmBinding } from '../../../../src/web-idl/binding/realm';
import { getPlatformRecord } from '../../../../src/web-idl/binding/platform';

import { getMemberBinding } from '../../../support/web-idl-binding';
import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL observable arrays', () => {
  it('creates one realm Array per platform object and attribute', () => {
    const fixture = createNumberArrayBinding();
    const first = getValues(fixture.object);
    const second = getValues(fixture.object);

    expect(first).toBe(second);
    expect(Array.isArray(first)).toBe(true);
    expect(first).toBeInstanceOf(fixture.realm.intrinsics.array);
    expect(first).not.toBeInstanceOf(Array);
    expect(first.constructor).toBe(fixture.realm.intrinsics.array);

    first.push('1', 2);

    expect(first).toEqual([1, 2]);
    expect(fixture.binding.getObservableArrayBackingList(
      fixture.object,
      fixture.binding.resolveInterface('NumberArrays').findMemberByKind('attribute')!.member,
    )).toEqual([1, 2]);

    const other = fixture.binding.allocatePlatformRecord(fixture.binding.resolveInterface('NumberArrays')).platformObject!;
    expect(getValues(other)).not.toBe(first);
  });

  it('preserves the receiver owner when a borrowed getter first exposes the array', () => {
    class ValueImpl {}
    class ValuesImpl {
      get values(): never { throw new Error('Observable arrays use the binding-owned backing list'); }
    }
    const attribute = roAttr('values', observableArray(reference('Value')));
    const world = new BindingWorld([
      defineInterface({ name: 'Value', implementation: impl(ValueImpl), members: [] }),
      defineInterface({ name: 'Values', implementation: impl(ValuesImpl), members: [attribute] }),
    ]);
    const owner = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const other = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const object = owner.project(ValuesImpl, new ValuesImpl());
    const foreign = other.project(ValuesImpl, new ValuesImpl());
    // eslint-disable-next-line @typescript-eslint/unbound-method -- explicitly apply the borrowed getter to the owner
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(foreign), 'values')!.get!;
    const values = Reflect.apply(getter, object, []) as object[];
    const value = new ValueImpl();
    const binding = world.getRealmBinding(owner.realm)!;
    binding.getObservableArrayBackingList(object, binding.resolveInterface('Values').findMemberByKind('attribute')!.member).push(value);

    expect(world.getRealm(values[0]!)).toBe(owner.realm);
    expect(values[0]).toBe(owner.project(ValueImpl, value));
  });

  it('runs indexed implementation steps around backing-list mutations', () => {
    const operations: string[] = [];
    const receivers: object[] = [];
    const fixture = createNumberArrayBinding();
    getMemberBinding(fixture.binding.getImplementationBinding(fixture.binding.resolveInterface(fixture.definition.name)), fixture.attribute).observableArraySteps = {
      delete(value, index) {
        receivers.push(this);
        operations.push(`delete ${index} ${String(value)}`);
      },
      set(value, index) {
        receivers.push(this);
        operations.push(`set ${index} ${String(value)}`);
      },
    };
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
    const fixture = createNumberArrayBinding();
    getMemberBinding(fixture.binding.getImplementationBinding(fixture.binding.resolveInterface(fixture.definition.name)), fixture.attribute).observableArraySteps = {
      delete(_value, index) {
        deleted.push(index);
        if (index === 1) throw exception;
      },
    };
    const values = getValues(fixture.object);
    values.push(1, 2, 3);

    expect(() => Reflect.set(values, 'length', 0)).toThrow(exception);
    expect(deleted).toEqual([2, 1]);
    expect(values).toEqual([1, 2]);
  });

  it('converts an assignment before replacing the existing contents', () => {
    const operations: string[] = [];
    const fixture = createNumberArrayBinding();
    getMemberBinding(fixture.binding.getImplementationBinding(fixture.binding.resolveInterface(fixture.definition.name)), fixture.attribute).observableArraySteps = {
      delete(value, index) {
        operations.push(`delete ${index} ${String(value)}`);
      },
      set(value, index) {
        operations.push(`set ${index} ${String(value)}`);
      },
    };
    const values = getValues(fixture.object);
    values.push(1);
    operations.length = 0;

    expect(() => Reflect.set(
      fixture.object,
      'values',
      [2, Symbol('invalid')],
    )).toThrow(fixture.realm.intrinsics.typeError);
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
      .toThrow(fixture.realm.intrinsics.rangeError);

    values.label = 'numbers';
    expect(values.label).toBe('numbers');
    expect(Reflect.ownKeys(values)).toEqual(['length', 'label']);
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
    expect(exception).toBeInstanceOf(fixture.realm.intrinsics.typeError);
  });

  it('converts interface elements and reflects specification list changes', () => {
    class EmployeeImpl {}
    class BuildingImpl {}
    const employee = defineInterface({
      name: 'Employee',
      exposed: '*',
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
      members: [workers],
    });
    const realm = new Realm();

    const binding = new RealmBinding(
      new DefinitionAssembly([employee, building]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    binding.getImplementationBinding(binding.resolveInterface(employee.name)).createImplementation = () => new EmployeeImpl();
    binding.getImplementationBinding(binding.resolveInterface(building.name)).createImplementation = () => new BuildingImpl();
    const object = binding.allocatePlatformRecord(binding.resolveInterface('Building')).platformObject!;
    const employeeObject = binding.allocatePlatformRecord(binding.resolveInterface('Employee')).platformObject!;
    const employeeImpl = getPlatformRecord(employeeObject)!.implInst;
    const values = getArray(object, 'workers');
    const backingList = binding.getObservableArrayBackingList(object, binding.resolveInterface('Building').findMemberByKind('attribute')!.member);

    values.push(employeeObject);
    expect(backingList).toHaveLength(1);
    expect(backingList[0]).toBe(employeeImpl);
    expect(values[0]).toBe(employeeObject);
    expect(() => values.push({})).toThrow(realm.intrinsics.typeError);

    backingList.push(employeeImpl);
    expect(values).toEqual([employeeObject, employeeObject]);
  });
});

function createNumberArrayBinding(): NumberArrayFixture {
  class NumberArraysImpl {}
  const attribute = {
    kind: 'attribute',
    name: 'values',
    type: observableArray(idlType.long),
  } satisfies AttributeMember;
  const definition = defineInterface({
    name: 'NumberArrays',
    exposed: '*',
    members: [attribute],
  });
  const realm = new Realm();
  const binding = new RealmBinding(
    new DefinitionAssembly([definition]),
    realm,
    new BindingWorld([]),
    (ctx) => ({ realm: ctx.realm }),
  );
  binding.getImplementationBinding(binding.resolveInterface(definition.name)).createImplementation = () => new NumberArraysImpl();
  return {
    attribute,
    binding,
    definition,
    object: binding.allocatePlatformRecord(binding.resolveInterface('NumberArrays')).platformObject!,
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
  definition: ReturnType<typeof defineInterface>;
  attribute: AttributeMember;
  binding: RealmBinding;
  object: object;
  realm: Realm;
};
