import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/adapter/assembly';
import {
  convertToIDL, convertToJavaScript, createFrozenArray,
  createFrozenArrayFromIterable, type ConversionContext,
  type HostDefinedInterface,
} from '../../../src/web-idl/conversion';
import { webIDLCommonDefinitions } from '../../../src/web-idl/common-definitions';
import {
  annotated, asyncSequence, decimal, defineDictionary, defineEnumeration,
  defineInterface, frozenArray, idlType, integer, nullable, record, reference,
  sequence, union, xattr,
} from '../../../src/web-idl/adapter/definition';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { ImplementationRegistry } from '../../../src/web-idl/adapter/registry';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL value conversion', () => {
  it('preserves the identity of host-defined interface values', () => {
    const object = {};
    const interface_: HostDefinedInterface = {
      is: (value) => value === object,
      name: 'HostObject',
    };
    const { binding, realm } = createBinding([], [interface_]);
    const type = reference('HostObject');

    expect(convertToIDL(object, type, binding)).toBe(object);
    expect(convertToJavaScript(object, type, binding)).toBe(object);
    expect(convertToIDL(
      object,
      union(type, idlType.DOMString),
      binding,
    )).toBe(object);
    expectRealmTypeError(
      () => convertToIDL({}, type, binding),
      realm,
    );
  });

  it('converts primitive values and integer annotations', () => {
    const { binding, realm } = createBinding();
    const clamp = { kind: 'no-arguments', name: 'Clamp' } as const;
    const enforceRange = {
      kind: 'no-arguments', name: 'EnforceRange',
    } as const;

    expect(convertToIDL(257, idlType.byte, binding)).toBe(1);
    expect(convertToIDL(-1, idlType.octet, binding)).toBe(255);
    expect(convertToIDL(Infinity, idlType.long, binding)).toBe(0);
    expect(convertToIDL(2.5, annotated(idlType.byte, xattr(clamp)), binding))
      .toBe(2);
    expect(convertToIDL(3.5, annotated(idlType.byte, xattr(clamp)), binding))
      .toBe(4);
    expect(convertToIDL(NaN, annotated(idlType.byte, xattr(clamp)), binding))
      .toBe(0);
    expectRealmTypeError(
      () => convertToIDL(
        128,
        annotated(idlType.byte, xattr(enforceRange)),
        binding,
      ),
      realm,
    );

    expect(convertToIDL(1.337, idlType.float, binding)).toBe(Math.fround(1.337));
    expectRealmTypeError(
      () => convertToIDL(Infinity, idlType.double, binding),
      realm,
    );
    expect(convertToIDL(true, idlType.bigint, binding)).toBe(1n);
    expect(convertToIDL('10', idlType.bigint, binding)).toBe(10n);
    expectRealmTypeError(
      () => convertToIDL({ valueOf: () => 1 }, idlType.bigint, binding),
      realm,
    );
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

    expect(convertToIDL(null, idlType.DOMString, binding)).toBe('null');
    expect(convertToIDL(
      null,
      annotated(idlType.DOMString, xattr(legacyNull)),
      binding,
    )).toBe('');
    expect(convertToIDL(
      null,
      annotated(idlType.USVString, xattr(legacyNull)),
      binding,
    )).toBe('');
    expect(convertToIDL('\uD800', idlType.USVString, binding)).toBe('\uFFFD');
    expect(convertToIDL('first', reference('Choice'), binding)).toBe('first');
    expectRealmTypeError(
      () => convertToIDL(Symbol('value'), idlType.DOMString, binding),
      realm,
    );
    expectRealmTypeError(
      () => convertToIDL('😞', idlType.ByteString, binding),
      realm,
    );
    expectRealmTypeError(
      () => convertToIDL('third', reference('Choice'), binding),
      realm,
    );
  });

  it('reads inherited dictionary members in specification order', () => {
    const parent = defineDictionary({
      members: [
        { name: 'z', type: idlType.long },
        { name: 'a', type: idlType.long },
      ],
      name: 'ParentOptions',
    });
    const child = defineDictionary({
      inherits: 'ParentOptions',
      members: [
        { name: 'y', type: idlType.long },
        { default: false, name: 'b', type: idlType.boolean },
      ],
      name: 'Options',
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

    const dictionary = convertToIDL(
      input,
      reference('Options'),
      binding,
    ) as Map<string, unknown>;

    expect(reads).toEqual(['a', 'z', 'b', 'y']);
    expect([...dictionary]).toEqual([
      ['a', 1], ['z', 2], ['b', true], ['y', 4],
    ]);

    const output = convertToJavaScript(
      dictionary,
      reference('Options'),
      binding,
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(output)).toBe(binding.realm.intrinsics.objectPrototype);
    expect(output).toMatchObject({ a: 1, b: true, y: 4, z: 2 });
  });

  it('applies dictionary defaults and reports missing required members', () => {
    const options = defineDictionary({
      members: [
        { default: false, name: 'enabled', type: idlType.boolean },
        { name: 'name', required: true, type: idlType.DOMString },
      ],
      name: 'Options',
    });
    const { binding, realm } = createBinding([options]);

    const dictionary = convertToIDL(
      { name: 'example' },
      reference('Options'),
      binding,
    ) as Map<string, unknown>;
    expect([...dictionary]).toEqual([
      ['enabled', false], ['name', 'example'],
    ]);
    expectRealmTypeError(
      () => convertToIDL(undefined, reference('Options'), binding),
      realm,
    );
  });

  it('associates applicable dictionary-member attributes with their types', () => {
    const options = defineDictionary({
      members: [{
        extendedAttributes: [{ kind: 'no-arguments', name: 'Clamp' }],
        name: 'value',
        type: idlType.byte,
      }],
      name: 'Options',
    });
    const { binding } = createBinding([options]);

    expect(convertToIDL(
      { value: 300 },
      reference('Options'),
      binding,
    )).toEqual(new Map([['value', 127]]));
  });

  it('materializes numeric dictionary defaults in their declared IDL types', () => {
    const options = defineDictionary({
      members: [
        { default: decimal('1.337'), name: 'single', type: idlType.float },
        {
          default: integer('9007199254740993'),
          name: 'integer',
          type: idlType.bigint,
        },
      ],
      name: 'Options',
    });
    const { binding } = createBinding([options]);

    expect(convertToIDL(
      undefined,
      reference('Options'),
      binding,
    )).toEqual(new Map<string, unknown>([
      ['integer', 9007199254740993n],
      ['single', Math.fround(1.337)],
    ]));
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

    const idlSequence = convertToIDL(
      iterable,
      sequence(idlType.long),
      binding,
    );
    expect(idlSequence).toEqual([1, 2]);
    expect(iteratorGets).toBe(1);

    const jsSequence = convertToJavaScript(
      idlSequence,
      sequence(idlType.long),
      binding,
    );
    expect(jsSequence).toEqual([1, 2]);
    expect(jsSequence).toBeInstanceOf(realm.intrinsics.array);
    expect(jsSequence).not.toBe(idlSequence);

    const input = { d: '5', c: 6 };
    const idlRecord = convertToIDL(
      input,
      record(idlType.DOMString, idlType.double),
      binding,
    ) as Map<string, unknown>;
    expect([...idlRecord]).toEqual([['d', 5], ['c', 6]]);

    const jsRecord = convertToJavaScript(
      idlRecord,
      record(idlType.DOMString, idlType.double),
      binding,
    ) as Record<string, unknown>;
    expect(Object.keys(jsRecord)).toEqual(['d', 'c']);
    expect(Object.getPrototypeOf(jsRecord)).toBe(realm.intrinsics.objectPrototype);
  });

  it('creates frozen arrays in the binding realm and preserves their identity', () => {
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

    const value = convertToIDL(
      source,
      frozenArray(idlType.long),
      binding,
    ) as readonly unknown[];

    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(value)).toBe(true);
    expect(iteratorGets).toBe(1);
    expect(convertToJavaScript(
      value,
      frozenArray(idlType.long),
      binding,
    )).toBe(value);
    expect(Reflect.set(value, '0', 3)).toBe(false);

    const frozenSource = Object.freeze(['3']);
    const copied = convertToIDL(
      frozenSource,
      frozenArray(idlType.long),
      binding,
    );
    expect(copied).toEqual([3]);
    expect(copied).not.toBe(frozenSource);

    const created = createFrozenArray([4], idlType.long, binding);
    expect(created).toEqual([4]);
    expect(created).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(created)).toBe(true);

    const iterable = new Set(['5']);
    const method = iterable[Symbol.iterator];
    expect(createFrozenArrayFromIterable(
      iterable,
      idlType.long,
      method,
      binding,
    )).toEqual([5]);

    expect(convertToIDL(
      ['6'],
      union(frozenArray(idlType.long), idlType.DOMString),
      binding,
    )).toEqual([6]);
    expectRealmTypeError(
      () => convertToIDL(1, frozenArray(idlType.long), binding),
      realm,
    );
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

    expect(convertToIDL(arrayBuffer, idlType.ArrayBuffer, binding))
      .toBe(arrayBuffer);
    expect(convertToJavaScript(arrayBuffer, idlType.ArrayBuffer, binding))
      .toBe(arrayBuffer);
    expect(convertToIDL(uint8, idlType.Uint8Array, binding)).toBe(uint8);
    expect(convertToIDL(detachedView, idlType.DataView, binding))
      .toBe(detachedView);
    expectRealmTypeError(
      () => convertToIDL(uint8, idlType.Uint16Array, binding),
      realm,
    );

    expectRealmTypeError(
      () => convertToIDL(resizable, idlType.ArrayBuffer, binding),
      realm,
    );
    expect(convertToIDL(
      resizable,
      annotated(idlType.ArrayBuffer, xattr(allowResizable)),
      binding,
    )).toBe(resizable);

    expect(convertToIDL(shared, idlType.SharedArrayBuffer, binding))
      .toBe(shared);
    expectRealmTypeError(
      () => convertToIDL(growableShared, idlType.SharedArrayBuffer, binding),
      realm,
    );
    expect(convertToIDL(
      growableShared,
      annotated(idlType.SharedArrayBuffer, xattr(allowResizable)),
      binding,
    )).toBe(growableShared);
    expectRealmTypeError(
      () => convertToIDL(sharedView, idlType.Uint8Array, binding),
      realm,
    );
    expect(convertToIDL(
      sharedView,
      annotated(idlType.Uint8Array, xattr(allowShared)),
      binding,
    )).toBe(sharedView);
    expectRealmTypeError(
      () => convertToIDL(
        growableView,
        annotated(idlType.Uint8Array, xattr(allowShared)),
        binding,
      ),
      realm,
    );
    expect(convertToIDL(
      growableView,
      annotated(idlType.Uint8Array, xattr(allowShared, allowResizable)),
      binding,
    )).toBe(growableView);

    expect(convertToIDL(
      arrayBuffer,
      reference('BufferSource'),
      binding,
    )).toBe(arrayBuffer);
    expect(convertToIDL(uint8, reference('BufferSource'), binding)).toBe(uint8);
    expectRealmTypeError(
      () => convertToIDL(shared, reference('BufferSource'), binding),
      realm,
    );
    expectRealmTypeError(
      () => convertToIDL(sharedView, reference('BufferSource'), binding),
      realm,
    );
    expect(convertToIDL(
      shared,
      reference('AllowSharedBufferSource'),
      binding,
    )).toBe(shared);
    expect(convertToIDL(
      sharedView,
      reference('AllowSharedBufferSource'),
      binding,
    )).toBe(sharedView);
  });

  it('selects union members from the JavaScript value category', () => {
    const node = defineInterface({ name: 'Node', members: [] });
    const options = defineDictionary({
      members: [{ default: false, name: 'capture', type: idlType.boolean }],
      name: 'Options',
    });
    const { binding } = createBinding([node, options]);
    const interface_ = binding.definitions.getInterface('Node');
    const platformObject = {};
    if (!interface_) throw new Error('Missing Node interface');
    binding.associatePlatformObject(platformObject, interface_);

    expect(convertToIDL(
      platformObject,
      union(reference('Node'), idlType.DOMString),
      binding,
    )).toBe(platformObject);
    expect(convertToIDL(
      ['1', 2],
      union(sequence(idlType.long), idlType.DOMString),
      binding,
    )).toEqual([1, 2]);
    expect(convertToIDL(
      undefined,
      union(reference('Options'), idlType.boolean),
      binding,
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
      binding,
    )).toBe(5n);
    expect(conversions).toBe(1);

    expect(convertToIDL(
      undefined,
      union(nullable(idlType.DOMString), idlType.boolean),
      binding,
    )).toBeNull();
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
    expect(convertToJavaScript(
      convertToIDL(asyncIterable, asyncSequenceUnion, binding),
      asyncSequenceUnion,
      binding,
    )).toBe(asyncIterable);
  });
});

function createBinding(
  definitions: Parameters<typeof assembleDefinitions>[0] = [],
  hostDefinedInterfaces: HostDefinedInterface[] = [],
): { binding: JavaScriptBinding & ConversionContext; realm: Realm; } {
  const realm = new Realm();
  const binding = new JavaScriptBinding(
    assembleDefinitions(definitions),
    realm,
    new PlatformObjectRegistry(),
    new ImplementationRegistry(),
    hostDefinedInterfaces,
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
