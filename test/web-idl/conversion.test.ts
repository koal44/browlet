import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import {
  jsToIDL as convertDirectlyToIDL, idlToJS as convertDirectlyToJavaScript,
  createJSToIDLConverter, createIDLToJSConverter, createFrozenArray,
  createFrozenArrayFromIterable, type ConversionContext, type DictionaryCarrier,
} from '../../src/web-idl/conversion';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  annotated, asyncSequence, decimal, defineDictionary, defineEnumeration, defineProxyObject,
  defineInterface, definePartialDictionary, defineTypedef, emptyDictionary, emptySequence, frozenArray,
  idlType, integer, nullable, record, reference,
  sequence, union, xattr, type Definition,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';

describe.each(['direct', 'prepared'] as const)('Web IDL %s value conversion', (mode) => {
  const jsToIDL: typeof convertDirectlyToIDL = mode === 'direct'
    ? convertDirectlyToIDL
    : (value, type, context, options) => createJSToIDLConverter(type, context.binding.assembly, options)(value, context);
  const idlToJS: typeof convertDirectlyToJavaScript = mode === 'direct'
    ? convertDirectlyToJavaScript
    : (value, type, context, allocateBuffers) =>
      createIDLToJSConverter(type, context.binding.assembly, allocateBuffers)(value, context);

  it('preserves the identity of proxy object values', () => {
    const object = {};
    const definition = defineProxyObject({
      is: (value) => value === object,
      name: 'HostObject',
    });
    const { ctx, realm } = createContext([definition]);
    const type = reference('HostObject');

    expect(jsToIDL(object, type, ctx)).toBe(object);
    expect(idlToJS(object, type, ctx)).toBe(object);
    expect(jsToIDL(
      object,
      union(type, idlType.DOMString),
      ctx,
    )).toBe(object);
    expectRealmTypeError(
      () => jsToIDL({}, type, ctx),
      realm,
    );
  });

  it('converts primitive values and integer annotations', () => {
    const { ctx, realm } = createContext();
    const clamp = { kind: 'no-arguments', name: 'Clamp' } as const;
    const enforceRange = {
      kind: 'no-arguments', name: 'EnforceRange',
    } as const;

    expect(jsToIDL(257, idlType.byte, ctx)).toBe(1);
    expect(jsToIDL(-1, idlType.octet, ctx)).toBe(255);
    expect(jsToIDL(Infinity, idlType.long, ctx)).toBe(0);
    expect(jsToIDL(2.5, annotated(idlType.byte, xattr(clamp)), ctx))
      .toBe(2);
    expect(jsToIDL(3.5, annotated(idlType.byte, xattr(clamp)), ctx))
      .toBe(4);
    expect(jsToIDL(NaN, annotated(idlType.byte, xattr(clamp)), ctx))
      .toBe(0);
    expectRealmTypeError(
      () => jsToIDL(
        128,
        annotated(idlType.byte, xattr(enforceRange)),
        ctx,
      ),
      realm,
    );

    expect(jsToIDL(1.337, idlType.float, ctx)).toBe(Math.fround(1.337));
    expectRealmTypeError(
      () => jsToIDL(Infinity, idlType.double, ctx),
      realm,
    );
    expect(jsToIDL(true, idlType.bigint, ctx)).toBe(1n);
    expect(jsToIDL('10', idlType.bigint, ctx)).toBe(10n);
    expectRealmTypeError(
      () => jsToIDL({ valueOf: () => 1 }, idlType.bigint, ctx),
      realm,
    );
  });

  it('applies each conversion\'s attributes when a union descriptor is reused', () => {
    const { ctx, realm } = createContext();
    const type = union(idlType.byte, idlType.boolean);
    const clamped = annotated(type, xattr('Clamp'));
    const enforced = annotated(type, xattr('EnforceRange'));

    expect(jsToIDL(300, clamped, ctx)).toBe(127);
    expectRealmTypeError(() => jsToIDL(300, enforced, ctx), realm);
    expect(jsToIDL(300, type, ctx)).toBe(44);
    expect(jsToIDL(300, clamped, ctx)).toBe(127);
  });

  it('converts strings and enumerations with their distinct failure rules', () => {
    const choice = defineEnumeration({
      name: 'Choice',
      values: ['first', 'second'],
    });
    const { ctx, realm } = createContext([choice]);
    const legacyNull = {
      kind: 'no-arguments', name: 'LegacyNullToEmptyString',
    } as const;

    expect(jsToIDL(null, idlType.DOMString, ctx)).toBe('null');
    expect(jsToIDL(
      null,
      annotated(idlType.DOMString, xattr(legacyNull)),
      ctx,
    )).toBe('');
    expect(jsToIDL(
      null,
      annotated(idlType.USVString, xattr(legacyNull)),
      ctx,
    )).toBe('');
    expect(jsToIDL('\uD800', idlType.USVString, ctx)).toBe('\uFFFD');
    expect(jsToIDL('first', reference('Choice'), ctx)).toBe('first');
    expectRealmTypeError(
      () => jsToIDL(Symbol('value'), idlType.DOMString, ctx),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('😞', idlType.ByteString, ctx),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('third', reference('Choice'), ctx),
      realm,
    );
  });

  it('preserves author exceptions while realizing primitive-conversion failures', () => {
    const { ctx, realm } = createContext();
    const authorError = new TypeError('author conversion');
    const value = { toString() { throw authorError; } };

    for (const type of [
      idlType.DOMString, idlType.USVString, idlType.ByteString,
      idlType.long, idlType.double, idlType.bigint,
      union(idlType.long, idlType.bigint),
    ]) {
      let caught: unknown;
      try {
        jsToIDL(value, type, ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(authorError);
      expectRealmTypeError(
        () => jsToIDL({ [Symbol.toPrimitive]: () => ({}) }, type, ctx),
        realm,
      );
    }
  });

  it('uses each assembly\'s enumeration values for a shared union descriptor', () => {
    const type = union(idlType.long, reference('Choice'));
    const first = createContext([defineEnumeration({ name: 'Choice', values: ['', '__proto__'] })]);
    const second = createContext([defineEnumeration({ name: 'Choice', values: ['constructor'] })]);
    let text = '';
    let conversions = 0;
    const value = { toString() { conversions++; return text; } };

    for (let i = 0; i < 2; i++) {
      text = '';
      expect(jsToIDL(value, type, first.ctx)).toBe('');
      text = '__proto__';
      expect(jsToIDL(value, type, first.ctx)).toBe('__proto__');
      expectRealmTypeError(() => jsToIDL(value, type, second.ctx), second.realm);
      text = 'constructor';
      expect(jsToIDL(value, type, second.ctx)).toBe('constructor');
      expectRealmTypeError(() => jsToIDL(value, type, first.ctx), first.realm);
      expect(jsToIDL(12, type, first.ctx)).toBe(12);
      expect(jsToIDL(12, type, second.ctx)).toBe(12);
    }
    expect(conversions).toBe(10);
  });

  it('realizes BigInt syntax failures without replacing author SyntaxErrors', () => {
    const { ctx, realm } = createContext();
    expect(() => jsToIDL('not an integer', idlType.bigint, ctx))
      .toThrow(realm.intrinsics.syntaxError);

    const authorError = new SyntaxError('author conversion');
    let caught: unknown;
    try {
      jsToIDL({
        [Symbol.toPrimitive]() { throw authorError; },
      }, idlType.bigint, ctx);
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
    const { ctx } = createContext([child, parent]);
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

    const dictionary = jsToIDL(
      input,
      reference('Options'),
      ctx,
    ) as DictionaryCarrier;

    expect(reads).toEqual(['a', 'z', 'b', 'y']);
    expect(Object.entries(dictionary.record)).toEqual([
      ['a', 1], ['z', 2], ['b', true], ['y', 4],
    ]);

    const output = idlToJS(
      dictionary,
      reference('Options'),
      ctx,
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(output)).toBe(ctx.realm.intrinsics.objectPrototype);
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
    const { ctx, realm } = createContext([options]);

    const dictionary = jsToIDL(
      { name: 'example' },
      reference('Options'),
      ctx,
    ) as DictionaryCarrier;
    expect(Object.entries(dictionary.record)).toEqual([
      ['enabled', false], ['name', 'example'],
    ]);
    expectRealmTypeError(
      () => jsToIDL(undefined, reference('Options'), ctx),
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
    const { ctx } = createContext([
      partial, options, base, defineTypedef({ name: 'OptionsNumber', type: idlType.byte }),
    ]);
    const type = reference(options.name);
    let value = 300;
    let reads = 0;
    const input = { get value() { reads++; return value; }, wrapped: 300 };

    const first = jsToIDL(input, type, ctx) as DictionaryCarrier;
    expect(Object.entries(first.record)).toEqual([['value', 127], ['items', []], ['wrapped', 44]]);
    expect(idlToJS(first, type, ctx)).toEqual({ value: 127, items: [], wrapped: 44 });

    value = 3.5;
    const second = jsToIDL(input, type, ctx) as DictionaryCarrier;
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
    const { ctx } = createContext([options]);

    expect(jsToIDL(
      undefined,
      reference('Options'),
      ctx,
    )).toMatchObject({ record: { integer: 9007199254740993n, single: Math.fround(1.337) } });
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
    const { ctx } = createContext([options]);
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

    const converted = jsToIDL(input, type, ctx);
    expect(steps).toEqual(['get a', 'convert a', 'get b', 'get c', 'get d']);
    const result = idlToJS(converted, type, ctx);
    expect(result).toEqual({ a: 3, b: undefined, d: 7 });
    expect(Object.getPrototypeOf(result)).toBe(ctx.realm.intrinsics.objectPrototype);
    expect(Object.hasOwn(result as object, 'b')).toBe(true);
    expect(Object.hasOwn(result as object, 'c')).toBe(false);

    steps.length = 0;
    fail = true;
    expect(() => jsToIDL(input, type, ctx)).toThrow(failure);
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
    const { ctx } = createContext([options, holder]);
    let current = 3;
    const input = { child: { get value() { return current; } } };
    const first = jsToIDL(input, node, ctx) as DictionaryCarrier;
    current = 7;
    const second = jsToIDL(input, node, ctx) as DictionaryCarrier;
    expect((first.record.child as DictionaryCarrier).record.value).toBe(3);
    expect((second.record.child as DictionaryCarrier).record.value).toBe(7);
    expect(second.record.items).not.toBe(first.record.items);
    expect(second.record.items).not.toBe((second.record.child as DictionaryCarrier).record.items);

    const defaults = reference(holder.name);
    const a = (jsToIDL({}, defaults, ctx) as DictionaryCarrier).record.options as DictionaryCarrier;
    const b = (jsToIDL({}, defaults, ctx) as DictionaryCarrier).record.options as DictionaryCarrier;
    (a.record.items as unknown[]).push(1);
    expect(b.record.items).toEqual([]);
    expect(b).not.toBe(a);
  });

  it('uses the current conversion realm when a prepared dictionary member fails', () => {
    const options = defineDictionary({
      name: 'Options', members: [{ name: 'value', type: idlType.double }],
    });
    const { ctx, realm } = createContext([options]);
    const other = new Realm();
    const type = reference(options.name);
    expect(jsToIDL({ value: 3 }, type, ctx)).toMatchObject({ record: { value: 3 } });
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, type, { binding: ctx.binding, realm: other }), other);
    expectRealmTypeError(() => jsToIDL({ value: Infinity }, type, ctx), realm);
  });

  it('copies sequences and records without losing observable ordering', () => {
    const { ctx, realm } = createContext();
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

    const idlSequence = jsToIDL(
      iterable,
      sequence(idlType.long),
      ctx,
    );
    expect(idlSequence).toEqual([1, 2]);
    expect(iteratorGets).toBe(1);

    const jsSequence = idlToJS(
      idlSequence,
      sequence(idlType.long),
      ctx,
    );
    expect(jsSequence).toEqual([1, 2]);
    expect(jsSequence).toBeInstanceOf(realm.intrinsics.array);
    expect(jsSequence).not.toBe(idlSequence);

    const input = { d: '5', c: 6 };
    const idlRecord = jsToIDL(
      input,
      record(idlType.DOMString, idlType.double),
      ctx,
    );
    expect([...idlRecord]).toEqual([['d', 5], ['c', 6]]);

    const jsRecord = idlToJS(
      idlRecord,
      record(idlType.DOMString, idlType.double),
      ctx,
    ) as Record<string, unknown>;
    expect(Object.keys(jsRecord)).toEqual(['d', 'c']);
    expect(Object.getPrototypeOf(jsRecord)).toBe(realm.intrinsics.objectPrototype);
  });

  it('creates frozen arrays in the ctx realm and preserves their identity', () => {
    const { ctx, realm } = createContext();
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

    const value = jsToIDL(
      source,
      frozenArray(idlType.long),
      ctx,
    );

    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(value)).toBe(true);
    expect(iteratorGets).toBe(1);
    expect(idlToJS(
      value,
      frozenArray(idlType.long),
      ctx,
    )).toBe(value);
    expect(Reflect.set(value, '0', 3)).toBe(false);

    const frozenSource = Object.freeze(['3']);
    const copied = jsToIDL(
      frozenSource,
      frozenArray(idlType.long),
      ctx,
    );
    expect(copied).toEqual([3]);
    expect(copied).not.toBe(frozenSource);

    const created = createFrozenArray([4], idlType.long, ctx);
    expect(created).toEqual([4]);
    expect(created).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(created)).toBe(true);

    const iterable = new Set(['5']);
    const method = iterable[Symbol.iterator];
    expect(createFrozenArrayFromIterable(
      iterable,
      idlType.long,
      method,
      ctx,
    )).toEqual([5]);

    expect(jsToIDL(
      ['6'],
      union(frozenArray(idlType.long), idlType.DOMString),
      ctx,
    )).toEqual([6]);
    expectRealmTypeError(
      () => jsToIDL(1, frozenArray(idlType.long), ctx),
      realm,
    );
  });

  it('converts buffer source types by brand, backing buffer, and annotations', () => {
    const { ctx, realm } = createContext(webIDLCommonDefinitions);
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

    expect(jsToIDL(arrayBuffer, idlType.ArrayBuffer, ctx))
      .toBe(arrayBuffer);
    expect(idlToJS(arrayBuffer, idlType.ArrayBuffer, ctx))
      .toBe(arrayBuffer);
    expect(jsToIDL(uint8, idlType.Uint8Array, ctx)).toBe(uint8);
    expect(jsToIDL(detachedView, idlType.DataView, ctx))
      .toBe(detachedView);
    expectRealmTypeError(
      () => jsToIDL(uint8, idlType.Uint16Array, ctx),
      realm,
    );

    expectRealmTypeError(
      () => jsToIDL(resizable, idlType.ArrayBuffer, ctx),
      realm,
    );
    expect(jsToIDL(
      resizable,
      annotated(idlType.ArrayBuffer, xattr(allowResizable)),
      ctx,
    )).toBe(resizable);

    expect(jsToIDL(shared, idlType.SharedArrayBuffer, ctx))
      .toBe(shared);
    expectRealmTypeError(
      () => jsToIDL(growableShared, idlType.SharedArrayBuffer, ctx),
      realm,
    );
    expect(jsToIDL(
      growableShared,
      annotated(idlType.SharedArrayBuffer, xattr(allowResizable)),
      ctx,
    )).toBe(growableShared);
    expectRealmTypeError(
      () => jsToIDL(sharedView, idlType.Uint8Array, ctx),
      realm,
    );
    expect(jsToIDL(
      sharedView,
      annotated(idlType.Uint8Array, xattr(allowShared)),
      ctx,
    )).toBe(sharedView);
    expectRealmTypeError(
      () => jsToIDL(
        growableView,
        annotated(idlType.Uint8Array, xattr(allowShared)),
        ctx,
      ),
      realm,
    );
    expect(jsToIDL(
      growableView,
      annotated(idlType.Uint8Array, xattr(allowShared, allowResizable)),
      ctx,
    )).toBe(growableView);

    expect(jsToIDL(
      arrayBuffer,
      reference('BufferSource'),
      ctx,
    )).toBe(arrayBuffer);
    expect(jsToIDL(uint8, reference('BufferSource'), ctx)).toBe(uint8);
    expectRealmTypeError(
      () => jsToIDL(shared, reference('BufferSource'), ctx),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL(sharedView, reference('BufferSource'), ctx),
      realm,
    );
    expect(jsToIDL(
      shared,
      reference('AllowSharedBufferSource'),
      ctx,
    )).toBe(shared);
    expect(jsToIDL(
      sharedView,
      reference('AllowSharedBufferSource'),
      ctx,
    )).toBe(sharedView);
  });

  it('selects union members from the JavaScript value category', () => {
    const node = defineInterface({ name: 'Node', members: [] });
    const options = defineDictionary({
      name: 'Options',
      members: [{ default: false, name: 'capture', type: idlType.boolean }],
    });
    const { ctx } = createContext([node, options]);
    const assembled = ctx.binding.assembly.interfaces.get('Node');
    const platformObject = {};
    const implInst = {};
    if (!assembled) throw new Error('Missing Node interface');
    ctx.binding.initializePlatformObject(platformObject, assembled, implInst);

    expect(jsToIDL(
      platformObject,
      union(reference('Node'), idlType.DOMString),
      ctx,
    )).toBe(implInst);
    expect(jsToIDL(
      ['1', 2],
      union(sequence(idlType.long), idlType.DOMString),
      ctx,
    )).toEqual([1, 2]);
    expect(jsToIDL(
      undefined,
      union(reference('Options'), idlType.boolean),
      ctx,
    )).toMatchObject({ record: { capture: false } });

    let conversions = 0;
    const numeric = {
      [Symbol.toPrimitive]() {
        conversions++;
        return 5n;
      },
    };
    expect(jsToIDL(
      numeric,
      union(idlType.long, idlType.bigint),
      ctx,
    )).toBe(5n);
    expect(conversions).toBe(1);

    expect(jsToIDL(
      undefined,
      union(nullable(idlType.DOMString), idlType.boolean),
      ctx,
    )).toBeNull();
  });

  it('reads current iterators and dictionary fields when reusing union candidates', () => {
    const options = defineDictionary({
      name: 'Options',
      members: [{ name: 'value', type: idlType.long }],
    });
    const { ctx, realm } = createContext([options]);
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

    const sequenceValue = jsToIDL(source, type, ctx);
    expect(sequenceValue).toEqual([7]);
    expect(idlToJS(sequenceValue, type, ctx)).toBeInstanceOf(realm.intrinsics.array);
    expect(fieldGets).toBe(0);
    iterable = false;
    for (let i = 1; i <= 2; i++) {
      const dictionary = jsToIDL(source, type, ctx);
      expect(dictionary).toMatchObject({ record: { value: i } });
      const platform = idlToJS(dictionary, type, ctx);
      expect(platform).toEqual({ value: i });
      expect(Object.getPrototypeOf(platform)).toBe(realm.intrinsics.objectPrototype);
    }
    expect(iteratorGets).toBe(3);
    expect(jsToIDL(true, type, ctx)).toBe(true);
    expect(iteratorGets).toBe(3);
  });

  it('converts a union through its selected async sequence member', () => {
    const { ctx } = createContext();
    const asyncIterable = {
      [Symbol.asyncIterator]() {
        return { next: () => ({ done: true }) };
      },
    };
    const asyncSequenceUnion = union(
      asyncSequence(idlType.long),
      idlType.DOMString,
    );
    expect(idlToJS(
      jsToIDL(asyncIterable, asyncSequenceUnion, ctx),
      asyncSequenceUnion,
      ctx,
    )).toBe(asyncIterable);
  });
});

function createContext(
  definitions: Definition[] = [],
): { ctx: ConversionContext; realm: Realm; } {
  const realm = new Realm();
  const binding = new RealmBinding(
    new DefinitionAssembly(definitions),
    realm,
    new BindingWorld(definitions), (ctx) => ({ realm: ctx.realm }),
  );
  return { ctx: binding.defaultConversionContext, realm };
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
