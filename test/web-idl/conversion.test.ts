import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import {
  jsToIDL as convertDirectlyToIDL, idlToJS as convertDirectlyToJavaScript,
  createFrozenArray,
  createFrozenArrayFromIterable, type DictionaryCarrier,
} from '../../src/web-idl/conversion';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  annotated, asyncSequence, decimal, defineCallbackFunction, defineDictionary, defineEnumeration, defineProxyObject,
  defineInterface, definePartialDictionary, defineTypedef, emptyDictionary, emptySequence, frozenArray,
  idlType, integer, nullable, record, reference,
  sequence, union, xattr, type Definition,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';

describe.each(['direct', 'prepared'] as const)('Web IDL %s value conversion', (mode) => {
  const jsToIDL: typeof convertDirectlyToIDL = mode === 'direct'
    ? convertDirectlyToIDL
    : (value, context) => context.getJSToIDLConverter()(value);
  const idlToJS: typeof convertDirectlyToJavaScript = mode === 'direct'
    ? convertDirectlyToJavaScript
    : (value, context) => context.getIDLToJSConverter()(value);

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
      const context = binding.getConversionContext(type);
      expectRealmTypeError(() => jsToIDL(1, context), realm);
      expectRealmTypeError(() => jsToIDL(object, context), realm);
      expect(jsToIDL(null, context)).toBeNull();
    }

    const nonnullable = binding.getConversionContext(reference('HandlerAlias'));
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
      const context = binding.getConversionContext(type);
      expectRealmTypeError(() => jsToIDL(value, context), realm);
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

    expect(jsToIDL(object, binding.getConversionContext(type))).toBe(object);
    expect(idlToJS(object, binding.getConversionContext(type))).toBe(object);
    expect(jsToIDL(object, binding.getConversionContext(union(type, idlType.DOMString)))).toBe(object);
    expectRealmTypeError(
      () => jsToIDL({}, binding.getConversionContext(type)),
      realm,
    );
  });

  it('converts primitive values and integer annotations', () => {
    const { binding, realm } = createBinding();
    const clamp = { kind: 'no-arguments', name: 'Clamp' } as const;
    const enforceRange = {
      kind: 'no-arguments', name: 'EnforceRange',
    } as const;

    expect(jsToIDL(257, binding.getConversionContext(idlType.byte))).toBe(1);
    expect(jsToIDL(-1, binding.getConversionContext(idlType.octet))).toBe(255);
    expect(jsToIDL(Infinity, binding.getConversionContext(idlType.long))).toBe(0);
    expect(jsToIDL(2.5, binding.getConversionContext(annotated(idlType.byte, xattr(clamp)))))
      .toBe(2);
    expect(jsToIDL(3.5, binding.getConversionContext(annotated(idlType.byte, xattr(clamp)))))
      .toBe(4);
    expect(jsToIDL(NaN, binding.getConversionContext(annotated(idlType.byte, xattr(clamp)))))
      .toBe(0);
    expectRealmTypeError(
      () => jsToIDL(128, binding.getConversionContext(annotated(idlType.byte, xattr(enforceRange)))),
      realm,
    );

    expect(jsToIDL(1.337, binding.getConversionContext(idlType.float))).toBe(Math.fround(1.337));
    expectRealmTypeError(
      () => jsToIDL(Infinity, binding.getConversionContext(idlType.double)),
      realm,
    );
    expect(jsToIDL(true, binding.getConversionContext(idlType.bigint))).toBe(1n);
    expect(jsToIDL('10', binding.getConversionContext(idlType.bigint))).toBe(10n);
    expectRealmTypeError(
      () => jsToIDL({ valueOf: () => 1 }, binding.getConversionContext(idlType.bigint)),
      realm,
    );
  });

  it('applies each conversion\'s attributes when a union descriptor is reused', () => {
    const { binding, realm } = createBinding();
    const type = union(idlType.byte, idlType.boolean);
    const clamped = annotated(type, xattr('Clamp'));
    const enforced = annotated(type, xattr('EnforceRange'));

    expect(jsToIDL(300, binding.getConversionContext(clamped))).toBe(127);
    expectRealmTypeError(() => jsToIDL(300, binding.getConversionContext(enforced)), realm);
    expect(jsToIDL(300, binding.getConversionContext(type))).toBe(44);
    expect(jsToIDL(300, binding.getConversionContext(clamped))).toBe(127);
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
      expect(jsToIDL(300, clamped.binding.getConversionContext(type, clamped.realm))).toBe(127);
      expectRealmTypeError(() => jsToIDL(300, enforced.binding.getConversionContext(type, enforced.realm)), enforced.realm);
      expect(jsToIDL(300, clamped.binding.getConversionContext(member, clamped.realm))).toBe(44);
      expect(jsToIDL(null, clamped.binding.getConversionContext(type, clamped.realm))).toBeNull();
      expect(jsToIDL(true, clamped.binding.getConversionContext(type, clamped.realm))).toBe(true);
    }
  });

  it('does not propagate container annotations to sequence elements or record values', () => {
    const { binding } = createBinding();
    const sequences = annotated(nullable(union(sequence(idlType.byte), idlType.boolean)), xattr('Clamp'));
    const records = annotated(record(idlType.DOMString, idlType.byte), xattr('Clamp'));

    expect(jsToIDL([300], binding.getConversionContext(sequences))).toEqual([44]);
    expect(jsToIDL({ value: 300 }, binding.getConversionContext(records))).toEqual(new Map([['value', 44]]));
    expect(jsToIDL([300], binding.getConversionContext(sequence(annotated(idlType.byte, xattr('Clamp')))))).toEqual([127]);
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

    expect(jsToIDL(null, binding.getConversionContext(idlType.DOMString))).toBe('null');
    expect(jsToIDL(null, binding.getConversionContext(annotated(idlType.DOMString, xattr(legacyNull))))).toBe('');
    expect(jsToIDL(null, binding.getConversionContext(annotated(idlType.USVString, xattr(legacyNull))))).toBe('');
    expect(jsToIDL('\uD800', binding.getConversionContext(idlType.USVString))).toBe('\uFFFD');
    expect(jsToIDL('first', binding.getConversionContext(reference('Choice')))).toBe('first');
    expectRealmTypeError(
      () => jsToIDL(Symbol('value'), binding.getConversionContext(idlType.DOMString)),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('😞', binding.getConversionContext(idlType.ByteString)),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('third', binding.getConversionContext(reference('Choice'))),
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
        jsToIDL(value, binding.getConversionContext(type));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(authorError);
      expectRealmTypeError(
        () => jsToIDL({ [Symbol.toPrimitive]: () => ({}) }, binding.getConversionContext(type)),
        realm,
      );
    }
  });

  it('realizes record key and value failures in the conversion realm', () => {
    const { binding } = createBinding();
    const realm = new Realm();
    const context = binding.getConversionContext(record(idlType.DOMString, idlType.double), realm);

    expectRealmTypeError(() => jsToIDL({ [Symbol('key')]: 1 }, context), realm);
    expectRealmTypeError(() => jsToIDL({ value: Symbol('value') }, context), realm);
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
      expect(jsToIDL(value, first.binding.getConversionContext(type, first.realm))).toBe('');
      text = '__proto__';
      expect(jsToIDL(value, first.binding.getConversionContext(type, first.realm))).toBe('__proto__');
      expectRealmTypeError(() => jsToIDL(value, second.binding.getConversionContext(type, second.realm)), second.realm);
      text = 'constructor';
      expect(jsToIDL(value, second.binding.getConversionContext(type, second.realm))).toBe('constructor');
      expectRealmTypeError(() => jsToIDL(value, first.binding.getConversionContext(type, first.realm)), first.realm);
      expect(jsToIDL(12, first.binding.getConversionContext(type, first.realm))).toBe(12);
      expect(jsToIDL(12, second.binding.getConversionContext(type, second.realm))).toBe(12);
    }
    expect(conversions).toBe(10);
  });

  it('realizes BigInt syntax failures without replacing author SyntaxErrors', () => {
    const { binding, realm } = createBinding();
    expect(() => jsToIDL('not an integer', binding.getConversionContext(idlType.bigint)))
      .toThrow(realm.intrinsics.syntaxError);

    const authorError = new SyntaxError('author conversion');
    let caught: unknown;
    try {
      jsToIDL({
        [Symbol.toPrimitive]() { throw authorError; },
      }, binding.getConversionContext(idlType.bigint));
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

    const dictionary = jsToIDL(input, binding.getConversionContext(reference('Options'))) as DictionaryCarrier;

    expect(reads).toEqual(['a', 'z', 'b', 'y']);
    expect(Object.entries(dictionary.record)).toEqual([
      ['a', 1], ['z', 2], ['b', true], ['y', 4],
    ]);

    const output = idlToJS(dictionary, binding.getConversionContext(reference('Options'))) as Record<string, unknown>;
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

    const dictionary = jsToIDL({ name: 'example' }, binding.getConversionContext(reference('Options'))) as DictionaryCarrier;
    expect(Object.entries(dictionary.record)).toEqual([
      ['enabled', false], ['name', 'example'],
    ]);
    expectRealmTypeError(
      () => jsToIDL(undefined, binding.getConversionContext(reference('Options'))),
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

    const first = jsToIDL(input, binding.getConversionContext(type)) as DictionaryCarrier;
    expect(Object.entries(first.record)).toEqual([['value', 127], ['items', []], ['wrapped', 44]]);
    expect(idlToJS(first, binding.getConversionContext(type))).toEqual({ value: 127, items: [], wrapped: 44 });

    value = 3.5;
    const second = jsToIDL(input, binding.getConversionContext(type)) as DictionaryCarrier;
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

    expect(jsToIDL(undefined, binding.getConversionContext(reference('Options')))).toMatchObject({ record: { integer: 9007199254740993n, single: Math.fround(1.337) } });
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

    const converted = jsToIDL(input, binding.getConversionContext(type));
    expect(steps).toEqual(['get a', 'convert a', 'get b', 'get c', 'get d']);
    const result = idlToJS(converted, binding.getConversionContext(type));
    expect(result).toEqual({ a: 3, b: undefined, d: 7 });
    expect(Object.getPrototypeOf(result)).toBe(binding.realm.intrinsics.objectPrototype);
    expect(Object.hasOwn(result as object, 'b')).toBe(true);
    expect(Object.hasOwn(result as object, 'c')).toBe(false);

    steps.length = 0;
    fail = true;
    expect(() => jsToIDL(input, binding.getConversionContext(type))).toThrow(failure);
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
    const first = jsToIDL(input, binding.getConversionContext(node)) as DictionaryCarrier;
    current = 7;
    const second = jsToIDL(input, binding.getConversionContext(node)) as DictionaryCarrier;
    expect((first.record.child as DictionaryCarrier).record.value).toBe(3);
    expect((second.record.child as DictionaryCarrier).record.value).toBe(7);
    expect(second.record.items).not.toBe(first.record.items);
    expect(second.record.items).not.toBe((second.record.child as DictionaryCarrier).record.items);

    const defaults = reference(holder.name);
    const a = (jsToIDL({}, binding.getConversionContext(defaults)) as DictionaryCarrier).record.options as DictionaryCarrier;
    const b = (jsToIDL({}, binding.getConversionContext(defaults)) as DictionaryCarrier).record.options as DictionaryCarrier;
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
    expect(jsToIDL({ value: 3 }, binding.getConversionContext(type))).toMatchObject({ record: { value: 3 } });
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, binding.getConversionContext(type, other)), other);
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, binding.getConversionContext(type)), realm);
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

    const idlSequence = jsToIDL(iterable, binding.getConversionContext(sequence(idlType.long)));
    expect(idlSequence).toEqual([1, 2]);
    expect(iteratorGets).toBe(1);

    const jsSequence = idlToJS(idlSequence, binding.getConversionContext(sequence(idlType.long)));
    expect(jsSequence).toEqual([1, 2]);
    expect(jsSequence).toBeInstanceOf(realm.intrinsics.array);
    expect(jsSequence).not.toBe(idlSequence);

    const input = { d: '5', c: 6 };
    const idlRecord = jsToIDL(input, binding.getConversionContext(record(idlType.DOMString, idlType.double)));
    expect([...idlRecord]).toEqual([['d', 5], ['c', 6]]);

    const jsRecord = idlToJS(idlRecord, binding.getConversionContext(record(idlType.DOMString, idlType.double))) as Record<string, unknown>;
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

    const value = jsToIDL(source, binding.getConversionContext(frozenArray(idlType.long)));

    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(value)).toBe(true);
    expect(iteratorGets).toBe(1);
    expect(idlToJS(value, binding.getConversionContext(frozenArray(idlType.long)))).toBe(value);
    expect(Reflect.set(value, '0', 3)).toBe(false);

    const frozenSource = Object.freeze(['3']);
    const copied = jsToIDL(frozenSource, binding.getConversionContext(frozenArray(idlType.long)));
    expect(copied).toEqual([3]);
    expect(copied).not.toBe(frozenSource);

    const created = createFrozenArray([4], binding.getConversionContext(idlType.long));
    expect(created).toEqual([4]);
    expect(created).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(created)).toBe(true);

    const iterable = new Set(['5']);
    const method = iterable[Symbol.iterator];
    expect(createFrozenArrayFromIterable(
      iterable,
      binding.getConversionContext(idlType.long),
      method,
    )).toEqual([5]);

    expect(jsToIDL(['6'], binding.getConversionContext(union(frozenArray(idlType.long), idlType.DOMString)))).toEqual([6]);
    expectRealmTypeError(
      () => jsToIDL(1, binding.getConversionContext(frozenArray(idlType.long))),
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

    const result = jsToIDL(source, binding.getConversionContext(type));

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

    expect(jsToIDL(arrayBuffer, binding.getConversionContext(idlType.ArrayBuffer)))
      .toBe(arrayBuffer);
    expect(idlToJS(arrayBuffer, binding.getConversionContext(idlType.ArrayBuffer)))
      .toBe(arrayBuffer);
    expect(jsToIDL(uint8, binding.getConversionContext(idlType.Uint8Array))).toBe(uint8);
    expect(jsToIDL(detachedView, binding.getConversionContext(idlType.DataView)))
      .toBe(detachedView);
    expectRealmTypeError(
      () => jsToIDL(uint8, binding.getConversionContext(idlType.Uint16Array)),
      realm,
    );

    expectRealmTypeError(
      () => jsToIDL(resizable, binding.getConversionContext(idlType.ArrayBuffer)),
      realm,
    );
    expect(jsToIDL(resizable, binding.getConversionContext(annotated(idlType.ArrayBuffer, xattr(allowResizable))))).toBe(resizable);

    expect(jsToIDL(shared, binding.getConversionContext(idlType.SharedArrayBuffer)))
      .toBe(shared);
    expectRealmTypeError(
      () => jsToIDL(growableShared, binding.getConversionContext(idlType.SharedArrayBuffer)),
      realm,
    );
    expect(jsToIDL(growableShared, binding.getConversionContext(annotated(idlType.SharedArrayBuffer, xattr(allowResizable))))).toBe(growableShared);
    expectRealmTypeError(
      () => jsToIDL(sharedView, binding.getConversionContext(idlType.Uint8Array)),
      realm,
    );
    expect(jsToIDL(sharedView, binding.getConversionContext(annotated(idlType.Uint8Array, xattr(allowShared))))).toBe(sharedView);
    expectRealmTypeError(
      () => jsToIDL(growableView, binding.getConversionContext(annotated(idlType.Uint8Array, xattr(allowShared)))),
      realm,
    );
    expect(jsToIDL(growableView, binding.getConversionContext(annotated(idlType.Uint8Array, xattr(allowShared, allowResizable))))).toBe(growableView);

    expect(jsToIDL(arrayBuffer, binding.getConversionContext(reference('BufferSource')))).toBe(arrayBuffer);
    expect(jsToIDL(uint8, binding.getConversionContext(reference('BufferSource')))).toBe(uint8);
    expectRealmTypeError(
      () => jsToIDL(shared, binding.getConversionContext(reference('BufferSource'))),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL(sharedView, binding.getConversionContext(reference('BufferSource'))),
      realm,
    );
    expect(jsToIDL(shared, binding.getConversionContext(reference('AllowSharedBufferSource')))).toBe(shared);
    expect(jsToIDL(sharedView, binding.getConversionContext(reference('AllowSharedBufferSource')))).toBe(sharedView);
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
      expect(jsToIDL(view, binding.getConversionContext(resizable))).toBe(view);
      expectRealmTypeError(() => jsToIDL(view, binding.getConversionContext(type)), realm);
      expectRealmTypeError(() => jsToIDL(view, binding.getConversionContext(idlType.Uint8Array)), realm);
      expect(jsToIDL(null, binding.getConversionContext(resizable))).toBeNull();
      expect(idlToJS(view, binding.getConversionContext(resizable))).toBe(view);
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

    expect(jsToIDL(platformObject, binding.getConversionContext(union(reference('Node'), idlType.DOMString)))).toBe(implInst);
    expect(jsToIDL(['1', 2], binding.getConversionContext(union(sequence(idlType.long), idlType.DOMString)))).toEqual([1, 2]);
    expect(jsToIDL(undefined, binding.getConversionContext(union(reference('Options'), idlType.boolean)))).toMatchObject({ record: { capture: false } });

    let conversions = 0;
    const numeric = {
      [Symbol.toPrimitive]() {
        conversions++;
        return 5n;
      },
    };
    expect(jsToIDL(numeric, binding.getConversionContext(union(idlType.long, idlType.bigint)))).toBe(5n);
    expect(conversions).toBe(1);

    expect(jsToIDL(undefined, binding.getConversionContext(union(nullable(idlType.DOMString), idlType.boolean)))).toBeNull();
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

    const sequenceValue = jsToIDL(source, binding.getConversionContext(type));
    expect(sequenceValue).toEqual([7]);
    expect(idlToJS(sequenceValue, binding.getConversionContext(type))).toBeInstanceOf(realm.intrinsics.array);
    expect(fieldGets).toBe(0);
    iterable = false;
    for (let i = 1; i <= 2; i++) {
      const dictionary = jsToIDL(source, binding.getConversionContext(type));
      expect(dictionary).toMatchObject({ record: { value: i } });
      const platform = idlToJS(dictionary, binding.getConversionContext(type));
      expect(platform).toEqual({ value: i });
      expect(Object.getPrototypeOf(platform)).toBe(realm.intrinsics.objectPrototype);
    }
    expect(iteratorGets).toBe(3);
    expect(jsToIDL(true, binding.getConversionContext(type))).toBe(true);
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
    expect(idlToJS(jsToIDL(asyncIterable, binding.getConversionContext(asyncSequenceUnion)), binding.getConversionContext(asyncSequenceUnion))).toBe(asyncIterable);
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
