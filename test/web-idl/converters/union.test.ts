import { describe, expect, it } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import {
  annotated, asyncSequence, defineDictionary, defineEnumeration, defineInterface, idlType, nullable,
  reference, sequence, union, xattr,
} from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s union conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('preserves symbols in unions before string conversion', () => {
    const { binding, realm } = createBinding();
    const converter = binding.getConverter(binding.assembly.getIDLType(union(idlType.symbol, idlType.DOMString)));
    const value = Symbol('value');

    expect(jsToIDL(value, converter)).toBe(value);
    expect(idlToJS(value, converter)).toBe(value);
    expect(jsToIDL('value', converter)).toBe('value');
    expect(idlToJS('value', converter)).toBe('value');
    expect(jsToIDL(42, converter)).toBe('42');
    expectRealmTypeError(() => jsToIDL(Object(value), converter), realm);
  });

  it('returns null and undefined only when the union declares them', () => {
    const { binding } = createBinding();
    const nullableUnion = binding.getConverter(binding.assembly.getIDLType(union(nullable(idlType.long), idlType.DOMString)));
    const undefinedUnion = binding.getConverter(binding.assembly.getIDLType(union(idlType.undefined, idlType.DOMString)));

    expect(idlToJS(null, nullableUnion)).toBeNull();
    expect(idlToJS(undefined, undefinedUnion)).toBeUndefined();
    expect(() => idlToJS(undefined, nullableUnion)).toThrow(InternalError);
    expect(() => idlToJS(null, undefinedUnion)).toThrow(InternalError);
  });

  it('applies each conversion\'s attributes when a union descriptor is reused', () => {
    const { binding, realm } = createBinding();
    const type = union(idlType.byte, idlType.boolean);
    const clamped = annotated(type, xattr('Clamp'));
    const enforced = annotated(type, xattr('EnforceRange'));

    expect(jsToIDL(300, binding.getConverter(binding.assembly.getIDLType(clamped)))).toBe(127);
    expectRealmTypeError(() => jsToIDL(300, binding.getConverter(binding.assembly.getIDLType(enforced))), realm);
    expect(jsToIDL(300, binding.getConverter(binding.assembly.getIDLType(type)))).toBe(44);
    expect(jsToIDL(300, binding.getConverter(binding.assembly.getIDLType(clamped)))).toBe(127);
  });

  it('uses each assembly\'s enumeration values for a shared union descriptor', () => {
    const type = union(idlType.long, reference('Choice'));
    const first = createBinding([defineEnumeration({ name: 'Choice', values: ['', '__proto__'] })]);
    const second = createBinding([defineEnumeration({ name: 'Choice', values: ['constructor'] })]);
    let text = '';
    let conversions = 0;
    const value = { toString() { conversions++; return text; } };

    for (let i = 0; i < 2; i++) {
      text = '';
      expect(jsToIDL(value, first.binding.getConverter(first.binding.assembly.getIDLType(type), first.realm))).toBe('');
      text = '__proto__';
      expect(jsToIDL(value, first.binding.getConverter(first.binding.assembly.getIDLType(type), first.realm))).toBe('__proto__');
      expectRealmTypeError(() => jsToIDL(value, second.binding.getConverter(second.binding.assembly.getIDLType(type), second.realm)), second.realm);
      text = 'constructor';
      expect(jsToIDL(value, second.binding.getConverter(second.binding.assembly.getIDLType(type), second.realm))).toBe('constructor');
      expectRealmTypeError(() => jsToIDL(value, first.binding.getConverter(first.binding.assembly.getIDLType(type), first.realm)), first.realm);
      expect(jsToIDL(12, first.binding.getConverter(first.binding.assembly.getIDLType(type), first.realm))).toBe(12);
      expect(jsToIDL(12, second.binding.getConverter(second.binding.assembly.getIDLType(type), second.realm))).toBe(12);
    }
    expect(conversions).toBe(10);
  });

  it('selects union members from the JavaScript value category', () => {
    const node = defineInterface({ name: 'Node', members: [] });
    const options = defineDictionary({
      name: 'Options',
      members: [{ default: false, name: 'capture', type: idlType.boolean }],
    });
    const { binding } = createBinding([node, options]);
    const assembled = binding.assembly.interfaces.get('Node');
    const platformObject = {};
    const implInst = {};
    if (!assembled) throw new Error('Missing Node interface');
    binding.initializePlatformObject(platformObject, assembled, implInst);

    expect(jsToIDL(platformObject, binding.getConverter(binding.assembly.getIDLType(union(reference('Node'), idlType.DOMString))))).toBe(implInst);
    expect(jsToIDL(['1', 2], binding.getConverter(binding.assembly.getIDLType(union(sequence(idlType.long), idlType.DOMString))))).toEqual([1, 2]);
    expect(jsToIDL(undefined, binding.getConverter(binding.assembly.getIDLType(union(reference('Options'), idlType.boolean))))).toMatchObject({ record: { capture: false } });

    let conversions = 0;
    const numeric = {
      [Symbol.toPrimitive]() {
        conversions++;
        return 5n;
      },
    };
    expect(jsToIDL(numeric, binding.getConverter(binding.assembly.getIDLType(union(idlType.long, idlType.bigint))))).toBe(5n);
    expect(conversions).toBe(1);

    expect(jsToIDL(undefined, binding.getConverter(binding.assembly.getIDLType(union(nullable(idlType.DOMString), idlType.boolean))))).toBeNull();
  });

  it('reads current iterators and dictionary fields when reusing union candidates', () => {
    const options = defineDictionary({
      name: 'Options',
      members: [{ name: 'value', type: idlType.long }],
    });
    const { binding, realm } = createBinding([options]);
    const type = union(sequence(idlType.long), reference('Options'), idlType.boolean);
    let iterable = true;
    let iteratorGets = 0;
    let fieldGets = 0;
    const source = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return iterable ? function*() { yield '7'; } : undefined;
      },
      get value() { return String(++fieldGets); },
    };

    const sequenceValue = jsToIDL(source, binding.getConverter(binding.assembly.getIDLType(type)));
    expect(sequenceValue).toEqual([7]);
    expect(idlToJS(sequenceValue, binding.getConverter(binding.assembly.getIDLType(type)))).toBeInstanceOf(realm.intrinsics.array);
    expect(fieldGets).toBe(0);
    iterable = false;
    for (let i = 1; i <= 2; i++) {
      const dictionary = jsToIDL(source, binding.getConverter(binding.assembly.getIDLType(type)));
      expect(dictionary).toMatchObject({ record: { value: i } });
      const platform = idlToJS(dictionary, binding.getConverter(binding.assembly.getIDLType(type)));
      expect(platform).toEqual({ value: i });
      expect(Object.getPrototypeOf(platform)).toBe(realm.intrinsics.objectPrototype);
    }
    expect(iteratorGets).toBe(3);
    expect(jsToIDL(true, binding.getConverter(binding.assembly.getIDLType(type)))).toBe(true);
    expect(iteratorGets).toBe(3);
  });

  it('converts a union through its selected async sequence member', () => {
    const { binding } = createBinding();
    const asyncIterable = {
      [Symbol.asyncIterator]() {
        return { next: () => ({ done: true }) };
      },
    };
    const asyncSequenceUnion = union(
      asyncSequence(idlType.long),
      idlType.DOMString,
    );
    expect(idlToJS(jsToIDL(asyncIterable, binding.getConverter(binding.assembly.getIDLType(asyncSequenceUnion))), binding.getConverter(binding.assembly.getIDLType(asyncSequenceUnion)))).toBe(asyncIterable);
  });
});
