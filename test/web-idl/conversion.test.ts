import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import type { Converter } from '../../src/web-idl/converters/converter';
import type { IDLValue } from '../../src/web-idl/values/value';
import type { WebIDLType } from '../../src/web-idl/core/index';
import type { FrozenArrayConverter } from '../../src/web-idl/converters/sequence';
import type { IDLDictionary } from '../../src/web-idl/values/dictionary';
import { webIDLCommonDefinitions } from '../../src/web-idl/core/common';
import {
  annotated, asyncSequence, decimal, defineCallbackFunction, defineDictionary, defineEnumeration, defineProxyObject,
  defineInterface, definePartialDictionary, defineTypedef, emptyDictionary, emptySequence, frozenArray,
  idlType, integer, nullable, record, reference,
  sequence, union, xattr, type Definition,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { RealmBinding } from '../../src/web-idl/binding/realm';

describe.each(['direct', 'prepared'] as const)('Web IDL %s value conversion', (mode) => {
  const jsToIDL = <Type extends WebIDLType>(value: unknown, converter: Converter<Type>): IDLValue<Type> =>
    mode === 'direct' ? converter.jsToIDL(value) : converter.getJSToIDLSteps()(value);
  const idlToJS = (value: unknown, converter: Converter): unknown =>
    mode === 'direct' ? converter.idlToJS(value) : converter.getIDLToJSSteps()(value);

  it('requires callable legacy callbacks through nullable aliases outside assignment', () => {
    const { binding, realm } = createBinding([
      defineCallbackFunction({
        name: 'Handler', returns: idlType.undefined, arguments: [],
        ...xattr('LegacyTreatNonObjectAsNull'),
      }),
      defineTypedef({ name: 'HandlerAlias', type: reference('Handler') }),
      defineTypedef({ name: 'OptionalHandler', type: nullable(reference('HandlerAlias')) }),
    ]);
    const object = {};
    for (const type of [nullable(reference('Handler')), reference('OptionalHandler')]) {
      const converter = binding.getConverter(type);
      expectRealmTypeError(() => jsToIDL(1, converter), realm);
      expectRealmTypeError(() => jsToIDL(object, converter), realm);
      expect(jsToIDL(null, converter)).toBeNull();
    }

    const nonnullable = binding.getConverter(reference('HandlerAlias'));
    expectRealmTypeError(() => jsToIDL(object, nonnullable), realm);
  });

  it('rejects non-callable legacy callbacks inside collections', () => {
    const { binding, realm } = createBinding([defineCallbackFunction({
      name: 'Handler', returns: idlType.undefined, arguments: [],
      ...xattr('LegacyTreatNonObjectAsNull'),
    })]);
    const callback = nullable(reference('Handler'));
    const cases = [
      { type: sequence(callback), value: [{}] },
      { type: record(idlType.DOMString, callback), value: { handler: {} } },
    ];
    for (const { type, value } of cases) {
      const converter = binding.getConverter(type);
      expectRealmTypeError(() => jsToIDL(value, converter), realm);
    }
  });

  it('preserves the identity of proxy object values', () => {
    const object = {};
    const definition = defineProxyObject({
      is: (value) => value === object,
      name: 'HostObject',
    });
    const { binding, realm } = createBinding([definition]);
    const type = reference('HostObject');

    expect(jsToIDL(object, binding.getConverter(type))).toBe(object);
    expect(idlToJS(object, binding.getConverter(type))).toBe(object);
    expect(jsToIDL(object, binding.getConverter(union(type, idlType.DOMString)))).toBe(object);
    expectRealmTypeError(
      () => jsToIDL({}, binding.getConverter(type)),
      realm,
    );
  });

  it('converts primitive values and integer annotations', () => {
    const { binding, realm } = createBinding();
    const clamp = { kind: 'no-arguments', name: 'Clamp' } as const;
    const enforceRange = {
      kind: 'no-arguments', name: 'EnforceRange',
    } as const;

    expect(jsToIDL(257, binding.getConverter(idlType.byte))).toBe(1);
    expect(jsToIDL(-1, binding.getConverter(idlType.octet))).toBe(255);
    expect(jsToIDL(Infinity, binding.getConverter(idlType.long))).toBe(0);
    expect(jsToIDL(2.5, binding.getConverter(annotated(idlType.byte, xattr(clamp)))))
      .toBe(2);
    expect(jsToIDL(3.5, binding.getConverter(annotated(idlType.byte, xattr(clamp)))))
      .toBe(4);
    expect(jsToIDL(NaN, binding.getConverter(annotated(idlType.byte, xattr(clamp)))))
      .toBe(0);
    expectRealmTypeError(
      () => jsToIDL(128, binding.getConverter(annotated(idlType.byte, xattr(enforceRange)))),
      realm,
    );

    expect(jsToIDL(1.337, binding.getConverter(idlType.float))).toBe(Math.fround(1.337));
    expectRealmTypeError(
      () => jsToIDL(Infinity, binding.getConverter(idlType.double)),
      realm,
    );
    expect(jsToIDL(true, binding.getConverter(idlType.bigint))).toBe(1n);
    expect(jsToIDL('10', binding.getConverter(idlType.bigint))).toBe(10n);
    expectRealmTypeError(
      () => jsToIDL({ valueOf: () => 1 }, binding.getConverter(idlType.bigint)),
      realm,
    );
  });

  it('applies each conversion\'s attributes when a union descriptor is reused', () => {
    const { binding, realm } = createBinding();
    const type = union(idlType.byte, idlType.boolean);
    const clamped = annotated(type, xattr('Clamp'));
    const enforced = annotated(type, xattr('EnforceRange'));

    expect(jsToIDL(300, binding.getConverter(clamped))).toBe(127);
    expectRealmTypeError(() => jsToIDL(300, binding.getConverter(enforced)), realm);
    expect(jsToIDL(300, binding.getConverter(type))).toBe(44);
    expect(jsToIDL(300, binding.getConverter(clamped))).toBe(127);
  });

  it('keeps annotation rules scoped to each use of a nullable alias', () => {
    const type = reference('Value');
    const member = nullable(union(idlType.byte, idlType.boolean));
    const clamped = createBinding([
      defineTypedef({ name: 'Value', type: annotated(member, xattr('Clamp')) }),
    ]);
    const enforced = createBinding([
      defineTypedef({ name: 'Value', type: annotated(member, xattr('EnforceRange')) }),
    ]);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(jsToIDL(300, clamped.binding.getConverter(type, clamped.realm))).toBe(127);
      expectRealmTypeError(() => jsToIDL(300, enforced.binding.getConverter(type, enforced.realm)), enforced.realm);
      expect(jsToIDL(300, clamped.binding.getConverter(member, clamped.realm))).toBe(44);
      expect(jsToIDL(null, clamped.binding.getConverter(type, clamped.realm))).toBeNull();
      expect(jsToIDL(true, clamped.binding.getConverter(type, clamped.realm))).toBe(true);
    }
  });

  it('does not propagate container annotations to sequence elements or record values', () => {
    const { binding } = createBinding();
    const sequences = annotated(nullable(union(sequence(idlType.byte), idlType.boolean)), xattr('Clamp'));
    const records = annotated(record(idlType.DOMString, idlType.byte), xattr('Clamp'));

    expect(jsToIDL([300], binding.getConverter(sequences))).toEqual([44]);
    expect(jsToIDL({ value: 300 }, binding.getConverter(records))).toEqual(new Map([['value', 44]]));
    expect(jsToIDL([300], binding.getConverter(sequence(annotated(idlType.byte, xattr('Clamp')))))).toEqual([127]);
  });

  it('converts strings and enumerations with their distinct failure rules', () => {
    const choice = defineEnumeration({
      name: 'Choice',
      values: ['first', 'second'],
    });
    const { binding, realm } = createBinding([choice]);
    const legacyNull = {
      kind: 'no-arguments', name: 'LegacyNullToEmptyString',
    } as const;

    expect(jsToIDL(null, binding.getConverter(idlType.DOMString))).toBe('null');
    expect(jsToIDL(null, binding.getConverter(annotated(idlType.DOMString, xattr(legacyNull))))).toBe('');
    expect(jsToIDL(null, binding.getConverter(annotated(idlType.USVString, xattr(legacyNull))))).toBe('');
    expect(jsToIDL('\uD800', binding.getConverter(idlType.USVString))).toBe('\uFFFD');
    expect(jsToIDL('first', binding.getConverter(reference('Choice')))).toBe('first');
    expectRealmTypeError(
      () => jsToIDL(Symbol('value'), binding.getConverter(idlType.DOMString)),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('😞', binding.getConverter(idlType.ByteString)),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('third', binding.getConverter(reference('Choice'))),
      realm,
    );
  });

  it('preserves author exceptions while realizing primitive-conversion failures', () => {
    const { binding, realm } = createBinding();
    const authorError = new TypeError('author conversion');
    const value = { toString() { throw authorError; } };

    for (const type of [
      idlType.DOMString, idlType.USVString, idlType.ByteString,
      idlType.long, idlType.double, idlType.bigint,
      union(idlType.long, idlType.bigint),
    ]) {
      let caught: unknown;
      try {
        jsToIDL(value, binding.getConverter(type));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(authorError);
      expectRealmTypeError(
        () => jsToIDL({ [Symbol.toPrimitive]: () => ({}) }, binding.getConverter(type)),
        realm,
      );
    }
  });

  it('realizes record key and value failures in the conversion realm', () => {
    const { binding } = createBinding();
    const realm = new Realm();
    const converter = binding.getConverter(record(idlType.DOMString, idlType.double), realm);

    expectRealmTypeError(() => jsToIDL({ [Symbol('key')]: 1 }, converter), realm);
    expectRealmTypeError(() => jsToIDL({ value: Symbol('value') }, converter), realm);
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
      expect(jsToIDL(value, first.binding.getConverter(type, first.realm))).toBe('');
      text = '__proto__';
      expect(jsToIDL(value, first.binding.getConverter(type, first.realm))).toBe('__proto__');
      expectRealmTypeError(() => jsToIDL(value, second.binding.getConverter(type, second.realm)), second.realm);
      text = 'constructor';
      expect(jsToIDL(value, second.binding.getConverter(type, second.realm))).toBe('constructor');
      expectRealmTypeError(() => jsToIDL(value, first.binding.getConverter(type, first.realm)), first.realm);
      expect(jsToIDL(12, first.binding.getConverter(type, first.realm))).toBe(12);
      expect(jsToIDL(12, second.binding.getConverter(type, second.realm))).toBe(12);
    }
    expect(conversions).toBe(10);
  });

  it('realizes BigInt syntax failures without replacing author SyntaxErrors', () => {
    const { binding, realm } = createBinding();
    expect(() => jsToIDL('not an integer', binding.getConverter(idlType.bigint)))
      .toThrow(realm.intrinsics.syntaxError);

    const authorError = new SyntaxError('author conversion');
    let caught: unknown;
    try {
      jsToIDL({
        [Symbol.toPrimitive]() { throw authorError; },
      }, binding.getConverter(idlType.bigint));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(authorError);
  });

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

    const dictionary = jsToIDL(input, binding.getConverter(reference('Options'))) as IDLDictionary;

    expect(reads).toEqual(['a', 'z', 'b', 'y']);
    expect(Object.entries(dictionary.record)).toEqual([
      ['a', 1], ['z', 2], ['b', true], ['y', 4],
    ]);

    const output = idlToJS(dictionary, binding.getConverter(reference('Options'))) as Record<string, unknown>;
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

    const dictionary = jsToIDL({ name: 'example' }, binding.getConverter(reference('Options'))) as IDLDictionary;
    expect(Object.entries(dictionary.record)).toEqual([
      ['enabled', false], ['name', 'example'],
    ]);
    expectRealmTypeError(
      () => jsToIDL(undefined, binding.getConverter(reference('Options'))),
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

    const first = jsToIDL(input, binding.getConverter(type)) as IDLDictionary;
    expect(Object.entries(first.record)).toEqual([['value', 127], ['items', []], ['wrapped', 44]]);
    expect(idlToJS(first, binding.getConverter(type))).toEqual({ value: 127, items: [], wrapped: 44 });

    value = 3.5;
    const second = jsToIDL(input, binding.getConverter(type)) as IDLDictionary;
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

    expect(jsToIDL(undefined, binding.getConverter(reference('Options')))).toMatchObject({ record: { integer: 9007199254740993n, single: Math.fround(1.337) } });
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

    const converted = jsToIDL(input, binding.getConverter(type));
    expect(steps).toEqual(['get a', 'convert a', 'get b', 'get c', 'get d']);
    const result = idlToJS(converted, binding.getConverter(type));
    expect(result).toEqual({ a: 3, b: undefined, d: 7 });
    expect(Object.getPrototypeOf(result)).toBe(binding.realm.intrinsics.objectPrototype);
    expect(Object.hasOwn(result as object, 'b')).toBe(true);
    expect(Object.hasOwn(result as object, 'c')).toBe(false);

    steps.length = 0;
    fail = true;
    expect(() => jsToIDL(input, binding.getConverter(type))).toThrow(failure);
    expect(steps).toEqual(['get a', 'convert a']);
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
    const first = jsToIDL(input, binding.getConverter(node)) as IDLDictionary;
    current = 7;
    const second = jsToIDL(input, binding.getConverter(node)) as IDLDictionary;
    expect((first.record.child as IDLDictionary).record.value).toBe(3);
    expect((second.record.child as IDLDictionary).record.value).toBe(7);
    expect(second.record.items).not.toBe(first.record.items);
    expect(second.record.items).not.toBe((second.record.child as IDLDictionary).record.items);

    const defaults = reference(holder.name);
    const a = (jsToIDL({}, binding.getConverter(defaults)) as IDLDictionary).record.options as IDLDictionary;
    const b = (jsToIDL({}, binding.getConverter(defaults)) as IDLDictionary).record.options as IDLDictionary;
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
    expect(jsToIDL({ value: 3 }, binding.getConverter(type))).toMatchObject({ record: { value: 3 } });
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, binding.getConverter(type, other)), other);
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, binding.getConverter(type)), realm);
  });

  it('copies sequences and records without losing observable ordering', () => {
    const { binding, realm } = createBinding();
    let iteratorGets = 0;
    const iterable = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield 1;
          yield '2';
        };
      },
    };

    const idlSequence = jsToIDL(iterable, binding.getConverter(sequence(idlType.long)));
    expect(idlSequence).toEqual([1, 2]);
    expect(iteratorGets).toBe(1);

    const jsSequence = idlToJS(idlSequence, binding.getConverter(sequence(idlType.long)));
    expect(jsSequence).toEqual([1, 2]);
    expect(jsSequence).toBeInstanceOf(realm.intrinsics.array);
    expect(jsSequence).not.toBe(idlSequence);

    const input = { d: '5', c: 6 };
    const idlRecord = jsToIDL(input, binding.getConverter(record(idlType.DOMString, idlType.double)));
    expect([...idlRecord]).toEqual([['d', 5], ['c', 6]]);

    const jsRecord = idlToJS(idlRecord, binding.getConverter(record(idlType.DOMString, idlType.double))) as Record<string, unknown>;
    expect(Object.keys(jsRecord)).toEqual(['d', 'c']);
    expect(Object.getPrototypeOf(jsRecord)).toBe(realm.intrinsics.objectPrototype);
  });

  it('creates frozen arrays in the ctx realm and preserves their identity', () => {
    const { binding, realm } = createBinding();
    let iteratorGets = 0;
    const source = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield '1';
          yield 2;
        };
      },
    };

    const value = jsToIDL(source, binding.getConverter(frozenArray(idlType.long)));

    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(value)).toBe(true);
    expect(iteratorGets).toBe(1);
    expect(idlToJS(value, binding.getConverter(frozenArray(idlType.long)))).toBe(value);
    expect(Reflect.set(value, '0', 3)).toBe(false);

    const frozenSource = Object.freeze(['3']);
    const copied = jsToIDL(frozenSource, binding.getConverter(frozenArray(idlType.long)));
    expect(copied).toEqual([3]);
    expect(copied).not.toBe(frozenSource);

    const frozenType = frozenArray(idlType.long);
    const converter = binding.getConverter(frozenType) as FrozenArrayConverter<typeof frozenType>;
    const created = converter.createFrozenArray([4]);
    expect(created).toEqual([4]);
    expect(created).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(created)).toBe(true);

    const iterable = new Set(['5']);
    const method = iterable[Symbol.iterator];
    expect(converter.jsToIDLIterable(iterable, method)).toEqual([5]);

    expect(jsToIDL(['6'], binding.getConverter(union(frozenArray(idlType.long), idlType.DOMString)))).toEqual([6]);
    expectRealmTypeError(
      () => jsToIDL(1, binding.getConverter(frozenArray(idlType.long))),
      realm,
    );
  });

  it('uses the iterator method already read when selecting a frozen-array union member', () => {
    const { binding, realm } = createBinding();
    let iteratorGets = 0;
    const source = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() { yield '7.9'; };
      },
    };
    const type = union(frozenArray(idlType.long), idlType.DOMString);

    const result = jsToIDL(source, binding.getConverter(type));

    expect(result).toEqual([7]);
    expect(result).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(result)).toBe(true);
    expect(iteratorGets).toBe(1);
  });

  it('converts buffer source types by brand, backing buffer, and annotations', () => {
    const { binding, realm } = createBinding(webIDLCommonDefinitions);
    const allowResizable = {
      kind: 'no-arguments', name: 'AllowResizable',
    } as const;
    const allowShared = {
      kind: 'no-arguments', name: 'AllowShared',
    } as const;
    const arrayBuffer = realm.evaluate(
      'new ArrayBuffer(4)',
      'buffer-source-array-buffer.js',
    ) as object;
    const resizable = realm.evaluate(
      'new ArrayBuffer(4, { maxByteLength: 8 })',
      'buffer-source-resizable.js',
    ) as object;
    const uint8 = realm.evaluate(
      'new Uint8Array(new ArrayBuffer(4))',
      'buffer-source-uint8.js',
    ) as object;
    const shared = realm.evaluate(
      'new SharedArrayBuffer(4)',
      'buffer-source-shared.js',
    ) as object;
    const growableShared = realm.evaluate(
      'new SharedArrayBuffer(4, { maxByteLength: 8 })',
      'buffer-source-growable-shared.js',
    ) as object;
    const sharedView = realm.evaluate(
      'new Uint8Array(new SharedArrayBuffer(4))',
      'buffer-source-shared-view.js',
    ) as object;
    const growableView = realm.evaluate(
      'new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 }))',
      'buffer-source-growable-view.js',
    ) as object;
    const detachedView = realm.evaluate(
      `(() => {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        buffer.transfer();
        return view;
      })()`,
      'buffer-source-detached-view.js',
    ) as object;

    expect(jsToIDL(arrayBuffer, binding.getConverter(idlType.ArrayBuffer)))
      .toBe(arrayBuffer);
    expect(idlToJS(arrayBuffer, binding.getConverter(idlType.ArrayBuffer)))
      .toBe(arrayBuffer);
    expect(jsToIDL(uint8, binding.getConverter(idlType.Uint8Array))).toBe(uint8);
    expect(jsToIDL(detachedView, binding.getConverter(idlType.DataView)))
      .toBe(detachedView);
    expectRealmTypeError(
      () => jsToIDL(uint8, binding.getConverter(idlType.Uint16Array)),
      realm,
    );

    expectRealmTypeError(
      () => jsToIDL(resizable, binding.getConverter(idlType.ArrayBuffer)),
      realm,
    );
    expect(jsToIDL(resizable, binding.getConverter(annotated(idlType.ArrayBuffer, xattr(allowResizable))))).toBe(resizable);

    expect(jsToIDL(shared, binding.getConverter(idlType.SharedArrayBuffer)))
      .toBe(shared);
    expectRealmTypeError(
      () => jsToIDL(growableShared, binding.getConverter(idlType.SharedArrayBuffer)),
      realm,
    );
    expect(jsToIDL(growableShared, binding.getConverter(annotated(idlType.SharedArrayBuffer, xattr(allowResizable))))).toBe(growableShared);
    expectRealmTypeError(
      () => jsToIDL(sharedView, binding.getConverter(idlType.Uint8Array)),
      realm,
    );
    expect(jsToIDL(sharedView, binding.getConverter(annotated(idlType.Uint8Array, xattr(allowShared))))).toBe(sharedView);
    expectRealmTypeError(
      () => jsToIDL(growableView, binding.getConverter(annotated(idlType.Uint8Array, xattr(allowShared)))),
      realm,
    );
    expect(jsToIDL(growableView, binding.getConverter(annotated(idlType.Uint8Array, xattr(allowShared, allowResizable))))).toBe(growableView);

    expect(jsToIDL(arrayBuffer, binding.getConverter(reference('BufferSource')))).toBe(arrayBuffer);
    expect(jsToIDL(uint8, binding.getConverter(reference('BufferSource')))).toBe(uint8);
    expectRealmTypeError(
      () => jsToIDL(shared, binding.getConverter(reference('BufferSource'))),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL(sharedView, binding.getConverter(reference('BufferSource'))),
      realm,
    );
    expect(jsToIDL(shared, binding.getConverter(reference('AllowSharedBufferSource')))).toBe(shared);
    expect(jsToIDL(sharedView, binding.getConverter(reference('AllowSharedBufferSource')))).toBe(sharedView);
  });

  it('combines buffer annotations through aliases, nullable types, and union members', () => {
    const { binding, realm } = createBinding([
      defineTypedef({
        name: 'SharedView', type: annotated(idlType.Uint8Array, xattr('AllowShared')),
      }),
    ]);
    const type = nullable(union(reference('SharedView'), idlType.boolean));
    const resizable = annotated(type, xattr('AllowResizable'));
    const view = new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 }));

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(jsToIDL(view, binding.getConverter(resizable))).toBe(view);
      expectRealmTypeError(() => jsToIDL(view, binding.getConverter(type)), realm);
      expectRealmTypeError(() => jsToIDL(view, binding.getConverter(idlType.Uint8Array)), realm);
      expect(jsToIDL(null, binding.getConverter(resizable))).toBeNull();
      expect(idlToJS(view, binding.getConverter(resizable))).toBe(view);
    }
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

    expect(jsToIDL(platformObject, binding.getConverter(union(reference('Node'), idlType.DOMString)))).toBe(implInst);
    expect(jsToIDL(['1', 2], binding.getConverter(union(sequence(idlType.long), idlType.DOMString)))).toEqual([1, 2]);
    expect(jsToIDL(undefined, binding.getConverter(union(reference('Options'), idlType.boolean)))).toMatchObject({ record: { capture: false } });

    let conversions = 0;
    const numeric = {
      [Symbol.toPrimitive]() {
        conversions++;
        return 5n;
      },
    };
    expect(jsToIDL(numeric, binding.getConverter(union(idlType.long, idlType.bigint)))).toBe(5n);
    expect(conversions).toBe(1);

    expect(jsToIDL(undefined, binding.getConverter(union(nullable(idlType.DOMString), idlType.boolean)))).toBeNull();
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

    const sequenceValue = jsToIDL(source, binding.getConverter(type));
    expect(sequenceValue).toEqual([7]);
    expect(idlToJS(sequenceValue, binding.getConverter(type))).toBeInstanceOf(realm.intrinsics.array);
    expect(fieldGets).toBe(0);
    iterable = false;
    for (let i = 1; i <= 2; i++) {
      const dictionary = jsToIDL(source, binding.getConverter(type));
      expect(dictionary).toMatchObject({ record: { value: i } });
      const platform = idlToJS(dictionary, binding.getConverter(type));
      expect(platform).toEqual({ value: i });
      expect(Object.getPrototypeOf(platform)).toBe(realm.intrinsics.objectPrototype);
    }
    expect(iteratorGets).toBe(3);
    expect(jsToIDL(true, binding.getConverter(type))).toBe(true);
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
    expect(idlToJS(jsToIDL(asyncIterable, binding.getConverter(asyncSequenceUnion)), binding.getConverter(asyncSequenceUnion))).toBe(asyncIterable);
  });
});

function createBinding(
  definitions: Definition[] = [],
): { binding: RealmBinding; realm: Realm; } {
  const realm = new Realm();
  const binding = new RealmBinding(
    new DefinitionAssembly(definitions),
    realm,
    new BindingWorld(definitions), (ctx) => ({ realm: ctx.realm }),
  );
  return { binding, realm };
}

function expectRealmTypeError(
  callback: () => unknown,
  realm: Realm,
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(realm.intrinsics.typeError);
    expect(error).not.toBeInstanceOf(TypeError);
    return;
  }
  throw new Error('Expected a target-realm TypeError');
}
