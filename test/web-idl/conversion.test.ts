import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import {
  convertToIDL, convertToJavaScript, createFrozenArray,
  createFrozenArrayFromIterable, type ConversionContext,
  type HostDefinedInterface,
} from '../../src/web-idl/conversion';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  annotated, asyncSequence, decimal, defineDictionary, defineEnumeration,
  defineInterface, frozenArray, idlType, integer, nullable, record, reference,
  sequence, union, xattr, type Definition,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';

describe('Web IDL value conversion', () => {
  it('preserves the identity of host-defined interface values', () => {
    const object = {};
    const hostInterface: HostDefinedInterface = {
      is: (value) => value === object,
      name: 'HostObject',
    };
    const { ctx, realm } = createContext([], [hostInterface]);
    const type = reference('HostObject');

    expect(convertToIDL(object, type, ctx)).toBe(object);
    expect(convertToJavaScript(object, type, ctx)).toBe(object);
    expect(convertToIDL(
      object,
      union(type, idlType.DOMString),
      ctx,
    )).toBe(object);
    expectRealmTypeError(
      () => convertToIDL({}, type, ctx),
      realm,
    );
  });

  it('converts primitive values and integer annotations', () => {
    const { ctx, realm } = createContext();
    const clamp = { kind: 'no-arguments', name: 'Clamp' } as const;
    const enforceRange = {
      kind: 'no-arguments', name: 'EnforceRange',
    } as const;

    expect(convertToIDL(257, idlType.byte, ctx)).toBe(1);
    expect(convertToIDL(-1, idlType.octet, ctx)).toBe(255);
    expect(convertToIDL(Infinity, idlType.long, ctx)).toBe(0);
    expect(convertToIDL(2.5, annotated(idlType.byte, xattr(clamp)), ctx))
      .toBe(2);
    expect(convertToIDL(3.5, annotated(idlType.byte, xattr(clamp)), ctx))
      .toBe(4);
    expect(convertToIDL(NaN, annotated(idlType.byte, xattr(clamp)), ctx))
      .toBe(0);
    expectRealmTypeError(
      () => convertToIDL(
        128,
        annotated(idlType.byte, xattr(enforceRange)),
        ctx,
      ),
      realm,
    );

    expect(convertToIDL(1.337, idlType.float, ctx)).toBe(Math.fround(1.337));
    expectRealmTypeError(
      () => convertToIDL(Infinity, idlType.double, ctx),
      realm,
    );
    expect(convertToIDL(true, idlType.bigint, ctx)).toBe(1n);
    expect(convertToIDL('10', idlType.bigint, ctx)).toBe(10n);
    expectRealmTypeError(
      () => convertToIDL({ valueOf: () => 1 }, idlType.bigint, ctx),
      realm,
    );
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

    expect(convertToIDL(null, idlType.DOMString, ctx)).toBe('null');
    expect(convertToIDL(
      null,
      annotated(idlType.DOMString, xattr(legacyNull)),
      ctx,
    )).toBe('');
    expect(convertToIDL(
      null,
      annotated(idlType.USVString, xattr(legacyNull)),
      ctx,
    )).toBe('');
    expect(convertToIDL('\uD800', idlType.USVString, ctx)).toBe('\uFFFD');
    expect(convertToIDL('first', reference('Choice'), ctx)).toBe('first');
    expectRealmTypeError(
      () => convertToIDL(Symbol('value'), idlType.DOMString, ctx),
      realm,
    );
    expectRealmTypeError(
      () => convertToIDL('😞', idlType.ByteString, ctx),
      realm,
    );
    expectRealmTypeError(
      () => convertToIDL('third', reference('Choice'), ctx),
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
        convertToIDL(value, type, ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(authorError);
      expectRealmTypeError(
        () => convertToIDL({ [Symbol.toPrimitive]: () => ({}) }, type, ctx),
        realm,
      );
    }
  });

  it('realizes BigInt syntax failures without replacing author SyntaxErrors', () => {
    const { ctx, realm } = createContext();
    expect(() => convertToIDL('not an integer', idlType.bigint, ctx))
      .toThrow(realm.intrinsics.syntaxError);

    const authorError = new SyntaxError('author conversion');
    let caught: unknown;
    try {
      convertToIDL({
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

    const dictionary = convertToIDL(
      input,
      reference('Options'),
      ctx,
    ) as Map<string, unknown>;

    expect(reads).toEqual(['a', 'z', 'b', 'y']);
    expect([...dictionary]).toEqual([
      ['a', 1], ['z', 2], ['b', true], ['y', 4],
    ]);

    const output = convertToJavaScript(
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

    const dictionary = convertToIDL(
      { name: 'example' },
      reference('Options'),
      ctx,
    ) as Map<string, unknown>;
    expect([...dictionary]).toEqual([
      ['enabled', false], ['name', 'example'],
    ]);
    expectRealmTypeError(
      () => convertToIDL(undefined, reference('Options'), ctx),
      realm,
    );
  });

  it('associates applicable dictionary-member attributes with their types', () => {
    const options = defineDictionary({
      name: 'Options',
      members: [{
        extendedAttributes: [{ kind: 'no-arguments', name: 'Clamp' }],
        name: 'value',
        type: idlType.byte,
      }],
    });
    const { ctx } = createContext([options]);

    expect(convertToIDL(
      { value: 300 },
      reference('Options'),
      ctx,
    )).toEqual(new Map([['value', 127]]));
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

    expect(convertToIDL(
      undefined,
      reference('Options'),
      ctx,
    )).toEqual(new Map<string, unknown>([
      ['integer', 9007199254740993n],
      ['single', Math.fround(1.337)],
    ]));
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

    const idlSequence = convertToIDL(
      iterable,
      sequence(idlType.long),
      ctx,
    );
    expect(idlSequence).toEqual([1, 2]);
    expect(iteratorGets).toBe(1);

    const jsSequence = convertToJavaScript(
      idlSequence,
      sequence(idlType.long),
      ctx,
    );
    expect(jsSequence).toEqual([1, 2]);
    expect(jsSequence).toBeInstanceOf(realm.intrinsics.array);
    expect(jsSequence).not.toBe(idlSequence);

    const input = { d: '5', c: 6 };
    const idlRecord = convertToIDL(
      input,
      record(idlType.DOMString, idlType.double),
      ctx,
    ) as Map<string, unknown>;
    expect([...idlRecord]).toEqual([['d', 5], ['c', 6]]);

    const jsRecord = convertToJavaScript(
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

    const value = convertToIDL(
      source,
      frozenArray(idlType.long),
      ctx,
    ) as readonly unknown[];

    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(value)).toBe(true);
    expect(iteratorGets).toBe(1);
    expect(convertToJavaScript(
      value,
      frozenArray(idlType.long),
      ctx,
    )).toBe(value);
    expect(Reflect.set(value, '0', 3)).toBe(false);

    const frozenSource = Object.freeze(['3']);
    const copied = convertToIDL(
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

    expect(convertToIDL(
      ['6'],
      union(frozenArray(idlType.long), idlType.DOMString),
      ctx,
    )).toEqual([6]);
    expectRealmTypeError(
      () => convertToIDL(1, frozenArray(idlType.long), ctx),
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

    expect(convertToIDL(arrayBuffer, idlType.ArrayBuffer, ctx))
      .toBe(arrayBuffer);
    expect(convertToJavaScript(arrayBuffer, idlType.ArrayBuffer, ctx))
      .toBe(arrayBuffer);
    expect(convertToIDL(uint8, idlType.Uint8Array, ctx)).toBe(uint8);
    expect(convertToIDL(detachedView, idlType.DataView, ctx))
      .toBe(detachedView);
    expectRealmTypeError(
      () => convertToIDL(uint8, idlType.Uint16Array, ctx),
      realm,
    );

    expectRealmTypeError(
      () => convertToIDL(resizable, idlType.ArrayBuffer, ctx),
      realm,
    );
    expect(convertToIDL(
      resizable,
      annotated(idlType.ArrayBuffer, xattr(allowResizable)),
      ctx,
    )).toBe(resizable);

    expect(convertToIDL(shared, idlType.SharedArrayBuffer, ctx))
      .toBe(shared);
    expectRealmTypeError(
      () => convertToIDL(growableShared, idlType.SharedArrayBuffer, ctx),
      realm,
    );
    expect(convertToIDL(
      growableShared,
      annotated(idlType.SharedArrayBuffer, xattr(allowResizable)),
      ctx,
    )).toBe(growableShared);
    expectRealmTypeError(
      () => convertToIDL(sharedView, idlType.Uint8Array, ctx),
      realm,
    );
    expect(convertToIDL(
      sharedView,
      annotated(idlType.Uint8Array, xattr(allowShared)),
      ctx,
    )).toBe(sharedView);
    expectRealmTypeError(
      () => convertToIDL(
        growableView,
        annotated(idlType.Uint8Array, xattr(allowShared)),
        ctx,
      ),
      realm,
    );
    expect(convertToIDL(
      growableView,
      annotated(idlType.Uint8Array, xattr(allowShared, allowResizable)),
      ctx,
    )).toBe(growableView);

    expect(convertToIDL(
      arrayBuffer,
      reference('BufferSource'),
      ctx,
    )).toBe(arrayBuffer);
    expect(convertToIDL(uint8, reference('BufferSource'), ctx)).toBe(uint8);
    expectRealmTypeError(
      () => convertToIDL(shared, reference('BufferSource'), ctx),
      realm,
    );
    expectRealmTypeError(
      () => convertToIDL(sharedView, reference('BufferSource'), ctx),
      realm,
    );
    expect(convertToIDL(
      shared,
      reference('AllowSharedBufferSource'),
      ctx,
    )).toBe(shared);
    expect(convertToIDL(
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
    const primaryInterface = ctx.binding.definitions.getInterface('Node');
    const platformObject = {};
    const implInst = {};
    if (!primaryInterface) throw new Error('Missing Node interface');
    ctx.binding.initializePlatformObject(platformObject, primaryInterface, implInst);

    expect(convertToIDL(
      platformObject,
      union(reference('Node'), idlType.DOMString),
      ctx,
    )).toBe(implInst);
    expect(convertToIDL(
      ['1', 2],
      union(sequence(idlType.long), idlType.DOMString),
      ctx,
    )).toEqual([1, 2]);
    expect(convertToIDL(
      undefined,
      union(reference('Options'), idlType.boolean),
      ctx,
    )).toEqual(new Map([['capture', false]]));

    let conversions = 0;
    const numeric = {
      [Symbol.toPrimitive]() {
        conversions++;
        return 5n;
      },
    };
    expect(convertToIDL(
      numeric,
      union(idlType.long, idlType.bigint),
      ctx,
    )).toBe(5n);
    expect(conversions).toBe(1);

    expect(convertToIDL(
      undefined,
      union(nullable(idlType.DOMString), idlType.boolean),
      ctx,
    )).toBeNull();
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
    expect(convertToJavaScript(
      convertToIDL(asyncIterable, asyncSequenceUnion, ctx),
      asyncSequenceUnion,
      ctx,
    )).toBe(asyncIterable);
  });
});

function createContext(
  definitions: Definition[] = [],
  hostDefinedInterfaces: HostDefinedInterface[] = [],
): { ctx: ConversionContext; realm: Realm; } {
  const realm = new Realm();
  const binding = new RealmBinding(
    new DefinitionAssembly(definitions),
    realm,
    new BindingWorld([], { hostDefinedInterfaces }),
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
