import { describe, expect, it } from 'vitest';

import {
  decimal, defineDictionary, definePartialDictionary, defineTypedef, emptyDictionary, emptySequence,
  idlType, integer, reference, sequence,
} from '../../../src/web-idl/core/index';
import type { IDLDictionary } from '../../../src/web-idl/values/dictionary';

import { TestRealm as Realm } from '../../support/web-idl-realm';
import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s dictionary conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('reads inherited dictionary members in specification order', () => {
    const parent = defineDictionary({
      name: 'ParentOptions',
      members: [
        { name: 'z', type: idlType.long },
        { name: 'a', type: idlType.long },
      ],
    });
    const child = defineDictionary({
      name: 'Options',
      inherits: 'ParentOptions',
      members: [
        { name: 'y', type: idlType.long },
        { default: false, name: 'b', type: idlType.boolean },
      ],
    });
    const { binding } = createBinding([child, parent]);
    const reads: string[] = [];
    const source = Object.fromEntries(['a', 'z', 'b', 'y'].map(
      (name, index) => [name, {
        enumerable: true,
        get() {
          reads.push(name);
          return index + 1;
        },
      }],
    ));
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(input, source);

    const dictionary = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(reference('Options')))) as IDLDictionary;

    expect(reads).toEqual(['a', 'z', 'b', 'y']);
    expect(Object.entries(dictionary.record)).toEqual([
      ['a', 1], ['z', 2], ['b', true], ['y', 4],
    ]);

    const output = idlToJS(dictionary, binding.getConverter(binding.assembly.getIDLType(reference('Options')))) as Record<string, unknown>;
    expect(Object.getPrototypeOf(output)).toBe(binding.realm.intrinsics.objectPrototype);
    expect(output).toMatchObject({ a: 1, b: true, y: 4, z: 2 });
  });

  it('applies dictionary defaults and reports missing required members', () => {
    const options = defineDictionary({
      name: 'Options',
      members: [
        { default: false, name: 'enabled', type: idlType.boolean },
        { name: 'name', required: true, type: idlType.DOMString },
      ],
    });
    const { binding, realm } = createBinding([options]);

    const dictionary = jsToIDL({ name: 'example' }, binding.getConverter(binding.assembly.getIDLType(reference('Options')))) as IDLDictionary;
    expect(Object.entries(dictionary.record)).toEqual([
      ['enabled', false], ['name', 'example'],
    ]);
    expectRealmTypeError(
      () => jsToIDL(undefined, binding.getConverter(binding.assembly.getIDLType(reference('Options')))),
      realm,
    );
  });

  it('preserves inherited and partial dictionary conversions while reading fresh values', () => {
    const valueType = reference('OptionsNumber');
    const base = defineDictionary({
      name: 'BaseOptions',
      members: [{
        extendedAttributes: [{ kind: 'no-arguments', name: 'Clamp' }],
        name: 'value',
        type: valueType,
      }],
    });
    const options = defineDictionary({
      name: 'Options', inherits: base.name,
      members: [{ name: 'items', type: sequence(idlType.long), default: emptySequence }],
    });
    const partial = definePartialDictionary({
      name: options.name,
      members: [{ name: 'wrapped', type: valueType }],
    });
    const { binding } = createBinding([
      partial, options, base, defineTypedef({ name: 'OptionsNumber', type: idlType.byte }),
    ]);
    const type = reference(options.name);
    let value = 300;
    let reads = 0;
    const input = { get value() { reads++; return value; }, wrapped: 300 };

    const first = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(type))) as IDLDictionary;
    expect(Object.entries(first.record)).toEqual([['value', 127], ['items', []], ['wrapped', 44]]);
    expect(idlToJS(first, binding.getConverter(binding.assembly.getIDLType(type)))).toEqual({ value: 127, items: [], wrapped: 44 });

    value = 3.5;
    const second = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(type))) as IDLDictionary;
    expect(Object.entries(second.record)).toEqual([['value', 4], ['items', []], ['wrapped', 44]]);
    expect(reads).toBe(2);
    expect(second.record.items).not.toBe(first.record.items);
    expect(first.record.value).toBe(127);
  });

  it('materializes numeric dictionary defaults in their declared IDL types', () => {
    const options = defineDictionary({
      name: 'Options',
      members: [
        { default: decimal('1.337'), name: 'single', type: idlType.float },
        {
          default: integer('9007199254740993'),
          name: 'integer',
          type: idlType.bigint,
        },
      ],
    });
    const { binding } = createBinding([options]);

    expect(jsToIDL(undefined, binding.getConverter(binding.assembly.getIDLType(reference('Options'))))).toMatchObject({ record: { integer: 9007199254740993n, single: Math.fround(1.337) } });
  });

  it('reads dictionary proxies once per member and preserves present undefined defaults', () => {
    const options = defineDictionary({
      name: 'Options', members: [
        { name: 'a', type: idlType.long, required: true },
        { name: 'b', type: idlType.any, default: { kind: 'undefined' } },
        { name: 'c', type: idlType.long },
        { name: 'd', type: idlType.long, required: true },
      ],
    });
    const { binding } = createBinding([options]);
    const type = reference(options.name);
    const steps: string[] = [];
    const failure = new Error('conversion failed');
    let fail = false;
    const input: object = new Proxy({
      a: { valueOf() { steps.push('convert a'); if (fail) throw failure; return 3; } },
      get d() { expect(this).toBe(input); return 7; },
    }, {
      get(target, name, receiver) {
        steps.push(`get ${String(name)}`);
        return Reflect.get(target, name, receiver) as unknown;
      },
      has() { throw new Error('Dictionary conversion must not test property presence'); },
      ownKeys() { throw new Error('Dictionary conversion must not enumerate its input'); },
    });

    const converted = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(type)));
    expect(steps).toEqual(['get a', 'convert a', 'get b', 'get c', 'get d']);
    const result = idlToJS(converted, binding.getConverter(binding.assembly.getIDLType(type)));
    expect(result).toEqual({ a: 3, b: undefined, d: 7 });
    expect(Object.getPrototypeOf(result)).toBe(binding.realm.intrinsics.objectPrototype);
    expect(Object.hasOwn(result as object, 'b')).toBe(true);
    expect(Object.hasOwn(result as object, 'c')).toBe(false);

    steps.length = 0;
    fail = true;
    expect(() => jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(type)))).toThrow(failure);
    expect(steps).toEqual(['get a', 'convert a']);
  });

  it.each([true, false])('preserves prototype-named dictionary members as own data properties (required: %s)', (required) => {
    const options = defineDictionary({
      name: 'PrototypeNames', members: [
        { name: '__proto__', type: idlType.object, required },
        { name: 'constructor', type: idlType.DOMString, required },
        { name: 'toString', type: idlType.long, required },
      ],
    });
    const { binding } = createBinding([options]);
    const converter = binding.getConverter(binding.assembly.getIDLType(reference(options.name)));
    const prototypeValue = {};
    const input = { ['__proto__']: prototypeValue, constructor: 'constructor', toString: '7' };
    const dictionary = jsToIDL(input, converter) as IDLDictionary;
    expect(Object.getPrototypeOf(dictionary.record)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(dictionary.record, '__proto__')).toEqual({
      value: prototypeValue, writable: true, enumerable: true, configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(dictionary.record, 'constructor')?.value).toBe('constructor');
    expect(Object.getOwnPropertyDescriptor(dictionary.record, 'toString')?.value).toBe(7);
    const output = idlToJS(dictionary, converter) as object;
    expect(Object.getPrototypeOf(output)).toBe(binding.realm.intrinsics.objectPrototype);
    expect(Object.getOwnPropertyDescriptor(output, '__proto__')?.value).toBe(prototypeValue);
    if (!required) {
      const empty = jsToIDL(null, converter) as IDLDictionary;
      expect(Object.keys(empty.record)).toEqual([]);
      expect(Object.keys(idlToJS(empty, converter) as object)).toEqual([]);
    }
  });

  it('keeps recursive dictionary values and nested mutable defaults independent', () => {
    const node = reference('RecursiveOptions');
    const options = defineDictionary({
      name: 'RecursiveOptions',
      members: [
        { name: 'child', type: node },
        { name: 'items', type: sequence(idlType.long), default: emptySequence },
        { name: 'value', type: idlType.long },
      ],
    });
    const holder = defineDictionary({
      name: 'Holder',
      members: [{ name: 'options', type: node, default: emptyDictionary }],
    });
    const { binding } = createBinding([options, holder]);
    let current = 3;
    const input = { child: { get value() { return current; } } };
    const first = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(node))) as IDLDictionary;
    current = 7;
    const second = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(node))) as IDLDictionary;
    expect((first.record.child as IDLDictionary).record.value).toBe(3);
    expect((second.record.child as IDLDictionary).record.value).toBe(7);
    expect(second.record.items).not.toBe(first.record.items);
    expect(second.record.items).not.toBe((second.record.child as IDLDictionary).record.items);

    const defaults = reference(holder.name);
    const a = (jsToIDL({}, binding.getConverter(binding.assembly.getIDLType(defaults))) as IDLDictionary).record.options as IDLDictionary;
    const b = (jsToIDL({}, binding.getConverter(binding.assembly.getIDLType(defaults))) as IDLDictionary).record.options as IDLDictionary;
    (a.record.items as unknown[]).push(1);
    expect(b.record.items).toEqual([]);
    expect(b).not.toBe(a);
  });

  it('uses the current conversion realm when a prepared dictionary member fails', () => {
    const options = defineDictionary({
      name: 'Options', members: [{ name: 'value', type: idlType.double }],
    });
    const { binding, realm } = createBinding([options]);
    const other = new Realm();
    const type = reference(options.name);
    expect(jsToIDL({ value: 3 }, binding.getConverter(binding.assembly.getIDLType(type)))).toMatchObject({ record: { value: 3 } });
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, binding.getConverter(binding.assembly.getIDLType(type), other)), other);
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, binding.getConverter(binding.assembly.getIDLType(type))), realm);
  });
});
