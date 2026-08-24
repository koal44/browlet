import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, idlType, observableArray, reference,
  type AttributeMember,
} from '../../../src/web-idl/declaration/index';
import { ImplementationRegistry } from '../../../src/web-idl/registry';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

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
      fixture.attribute,
    )).toEqual([1, 2]);

    const other = fixture.binding.createPlatformObject('NumberArrays');
    expect(getValues(other)).not.toBe(first);
  });

  it('runs indexed implementation steps around backing-list mutations', () => {
    const operations: string[] = [];
    const receivers: object[] = [];
    const implementations = new ImplementationRegistry();
    const fixture = createNumberArrayBinding(implementations);
    implementations.setObservableArraySteps(fixture.attribute, {
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
    expect(receivers).toEqual([
      fixture.object,
      fixture.object,
      fixture.object,
      fixture.object,
    ]);
  });

  it('preserves deletions completed before a later delete step throws', () => {
    const deleted: number[] = [];
    const exception = new Error('stop deleting');
    const implementations = new ImplementationRegistry();
    const fixture = createNumberArrayBinding(implementations);
    implementations.setObservableArraySteps(fixture.attribute, {
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
    const implementations = new ImplementationRegistry();
    const fixture = createNumberArrayBinding(implementations);
    implementations.setObservableArraySteps(fixture.attribute, {
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
    const employee = defineInterface({
      exposed: '*',
      members: [],
      name: 'Employee',
    });
    const workers = {
      kind: 'attribute',
      name: 'workers',
      type: observableArray(reference('Employee')),
    } satisfies AttributeMember;
    const building = defineInterface({
      exposed: '*',
      members: [workers],
      name: 'Building',
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([employee, building]),
      realm,
      new PlatformObjectRegistry(),
    );
    const object = binding.createPlatformObject('Building');
    const employeeObject = binding.createPlatformObject('Employee');
    const values = getArray(object, 'workers');
    const backingList = binding.getObservableArrayBackingList(object, workers);

    values.push(employeeObject);
    expect(backingList).toEqual([employeeObject]);
    expect(values[0]).toBe(employeeObject);
    expect(() => values.push({})).toThrow(realm.intrinsics.typeError);

    backingList.push(employeeObject);
    expect(values).toEqual([employeeObject, employeeObject]);
  });
});

function createNumberArrayBinding(
  implementations = new ImplementationRegistry(),
): NumberArrayFixture {
  const attribute = {
    kind: 'attribute',
    name: 'values',
    type: observableArray(idlType.long),
  } satisfies AttributeMember;
  const interface_ = defineInterface({
    exposed: '*',
    members: [attribute],
    name: 'NumberArrays',
  });
  const realm = new Realm();
  const binding = new JavaScriptBinding(
    assembleDefinitions([interface_]),
    realm,
    new PlatformObjectRegistry(),
    implementations,
  );
  return {
    attribute,
    binding,
    object: binding.createPlatformObject('NumberArrays'),
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
  attribute: AttributeMember;
  binding: JavaScriptBinding;
  object: object;
  realm: Realm;
};
