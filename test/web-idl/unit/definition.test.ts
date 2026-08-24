import { describe, expect, it } from 'vitest';

import {
  annotated, arg, asyncIterable, asyncSequence, attr, constant, ctor, decimal,
  defineCallbackFunction,
  defineCallbackInterface, defineDictionary, defineEnumeration,
  defineIncludes, defineInterface, defineInterfaceMixin,
  defineNamespace, definePartialDictionary, definePartialInterface,
  definePartialInterfaceMixin, definePartialNamespace, defineTypedef, dictMember,
  emptyDictionary, emptySequence, frozenArray, idlType, integer, iterable,
  maplike, nullable, observableArray, op, promise, readonlyAttr, record,
  reference, sequence, setlike, stringifier, undefinedDefault, union, xattr,
} from '../../../src/web-idl/declaration/index';
import {
  serializeDefinition, serializeDefinitions, serializeExtendedAttribute,
  serializeType,
} from '../../../src/web-idl/declaration/index';

describe('Web IDL definitions', () => {
  it('represents the EventTarget fragment as structurally lossless data', () => {
    const definitions = [
      defineInterface({
        exposed: '*',
        members: [
          ctor(),
          op('addEventListener', idlType.undefined, [
            arg('type', idlType.DOMString),
            arg('callback', nullable(reference('EventListener'))),
            arg(
              'options',
              union(reference('AddEventListenerOptions'), idlType.boolean),
              { default: emptyDictionary, optional: true },
            ),
          ]),
          op('removeEventListener', idlType.undefined, [
            arg('type', idlType.DOMString),
            arg('callback', nullable(reference('EventListener'))),
            arg(
              'options',
              union(reference('EventListenerOptions'), idlType.boolean),
              { default: emptyDictionary, optional: true },
            ),
          ]),
          op('dispatchEvent', idlType.boolean, [
            arg('event', reference('Event')),
          ]),
        ],
        name: 'EventTarget',
      }),
      defineCallbackInterface({
        members: [op('handleEvent', idlType.undefined, [
          arg('event', reference('Event')),
        ])],
        name: 'EventListener',
      }),
      defineDictionary({
        members: [dictMember('capture', idlType.boolean, { default: false })],
        name: 'EventListenerOptions',
      }),
      defineDictionary({
        inherits: 'EventListenerOptions',
        members: [
          dictMember('passive', idlType.boolean),
          dictMember('once', idlType.boolean, { default: false }),
          dictMember('signal', reference('AbortSignal')),
        ],
        name: 'AddEventListenerOptions',
      }),
    ];

    expect(serializeDefinitions(definitions)).toBe(`
[Exposed=*]
interface EventTarget {
  constructor();
  undefined addEventListener(DOMString type, EventListener? callback, optional (AddEventListenerOptions or boolean) options = {});
  undefined removeEventListener(DOMString type, EventListener? callback, optional (EventListenerOptions or boolean) options = {});
  boolean dispatchEvent(Event event);
};

callback interface EventListener {
  undefined handleEvent(Event event);
};

dictionary EventListenerOptions {
  boolean capture = false;
};

dictionary AddEventListenerOptions : EventListenerOptions {
  boolean passive;
  boolean once = false;
  AbortSignal signal;
};`.trim());
    expect(() => JSON.stringify(definitions)).not.toThrow();
  });

  it('serializes every definition form', () => {
    const definitions = [
      defineInterface({
        exposed: ['Window', 'Worker'],
        inherits: 'Parent',
        members: [],
        name: 'Interface',
      }),
      definePartialInterface({ members: [], name: 'Interface' }),
      defineInterfaceMixin({ members: [], name: 'Mixin' }),
      definePartialInterfaceMixin({ members: [], name: 'Mixin' }),
      defineCallbackInterface({
        exposed: 'Window', members: [], name: 'CallbackInterface',
      }),
      defineNamespace({
        exposed: ['Window'], members: [], name: 'Namespace',
      }),
      definePartialNamespace({ members: [], name: 'Namespace' }),
      defineDictionary({ inherits: 'ParentDictionary', members: [], name: 'D' }),
      definePartialDictionary({ members: [], name: 'D' }),
      defineEnumeration({ name: 'Choice', values: ['one', 'two'] }),
      defineCallbackFunction({
        arguments: [{ name: 'value', type: idlType.long }],
        name: 'Callback',
        returns: idlType.boolean,
      }),
      defineTypedef({ name: 'Alias', type: idlType.DOMString }),
      defineIncludes({ interface: 'Interface', mixin: 'Mixin' }),
    ];

    expect(definitions.map(serializeDefinition)).toEqual([
      '[Exposed=(Window, Worker)]\ninterface Interface : Parent {\n};',
      'partial interface Interface {\n};',
      'interface mixin Mixin {\n};',
      'partial interface mixin Mixin {\n};',
      '[Exposed=Window]\ncallback interface CallbackInterface {\n};',
      '[Exposed=(Window)]\nnamespace Namespace {\n};',
      'partial namespace Namespace {\n};',
      'dictionary D : ParentDictionary {\n};',
      'partial dictionary D {\n};',
      'enum Choice { "one", "two" };',
      'callback Callback = boolean(long value);',
      'typedef DOMString Alias;',
      'Interface includes Mixin;',
    ]);
  });

  it('serializes every interface member form without losing ordered overloads', () => {
    const definition = defineInterface({
      members: [
        ctor(),
        constant('ANSWER', idlType.long, integer(42)),
        attr('value', idlType.DOMString),
        readonlyAttr('fixed', idlType.DOMString),
        attr('inherited', idlType.DOMString, { inherit: true }),
        attr('shared', idlType.DOMString, { static: true }),
        attr('text', idlType.DOMString, { stringifier: true }),
        op('run', idlType.undefined),
        op('run', idlType.undefined, [arg('value', idlType.long)]),
        op(undefined, idlType.object, [arg('name', idlType.DOMString)], {
          special: 'getter',
        }),
        op('create', reference('Interface'), [], { static: true }),
        stringifier(),
        iterable(idlType.DOMString),
        iterable(idlType.long, { key: idlType.DOMString }),
        asyncIterable(idlType.DOMString),
        asyncIterable(idlType.DOMString, { arguments: [] }),
        maplike(idlType.DOMString, idlType.long, { readonly: true }),
        setlike(idlType.DOMString),
      ],
      name: 'Interface',
    });

    expect(serializeDefinition(definition)).toContain(`
  undefined run();
  undefined run(long value);
  getter object(DOMString name);
  static Interface create();
  stringifier;
  iterable<DOMString>;
  iterable<DOMString, long>;
  async_iterable<DOMString>;
  async_iterable<DOMString>();
  readonly maplike<DOMString, long>;
  setlike<DOMString>;`);
  });

  it('serializes the complete type vocabulary and type composition', () => {
    expect(Object.values(idlType).map(serializeType)).toEqual([
      'any', 'undefined', 'boolean', 'byte', 'octet', 'short',
      'unsigned short', 'long', 'unsigned long', 'long long',
      'unsigned long long', 'float', 'unrestricted float', 'double',
      'unrestricted double', 'bigint', 'DOMString', 'ByteString', 'USVString',
      'object', 'symbol', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
      'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array',
      'Uint32Array', 'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array',
      'Float16Array', 'Float32Array', 'Float64Array',
    ]);
    expect([
      nullable(reference('Thing')),
      union(idlType.DOMString, idlType.long),
      sequence(idlType.long),
      asyncSequence(idlType.long),
      record(idlType.DOMString, idlType.long),
      promise(idlType.undefined),
      frozenArray(idlType.long),
      observableArray(idlType.long),
      annotated(idlType.long, xattr('Clamp')),
    ].map(serializeType)).toEqual([
      'Thing?',
      '(DOMString or long)',
      'sequence<long>',
      'async_sequence<long>',
      'record<DOMString, long>',
      'Promise<undefined>',
      'FrozenArray<long>',
      'ObservableArray<long>',
      '[Clamp] long',
    ]);
  });

  it('preserves arguments, dictionary defaults, and extended attribute forms', () => {
    const { extendedAttributes: attributes } = xattr(
      'SameObject',
      { arguments: [], kind: 'arguments', name: 'Constructor' },
      ['PutForwards', 'value'],
      { kind: 'string', name: 'Description', value: 'quoted' },
      { kind: 'integer', name: 'Minimum', value: '-1' },
      { kind: 'decimal', name: 'Scale', value: '1.5' },
      ['Exposed', '*'],
      ['Exposed', ['Window', 'Worker']],
      { kind: 'integer-list', name: 'Codes', values: ['1', '2'] },
      {
        arguments: [arg('width', idlType.unsignedLong)],
        kind: 'named-arguments', name: 'LegacyFactoryFunction', value: 'Image',
      },
      { kind: 'raw', value: 'Future={balanced(tokens)}' },
    );

    expect(attributes.map(serializeExtendedAttribute)).toEqual([
      'SameObject',
      'Constructor()',
      'PutForwards=value',
      'Description="quoted"',
      'Minimum=-1',
      'Scale=1.5',
      'Exposed=*',
      'Exposed=(Window, Worker)',
      'Codes=(1, 2)',
      'LegacyFactoryFunction=Image(unsigned long width)',
      'Future={balanced(tokens)}',
    ]);

    const dictionary = defineDictionary({
      members: [
        { name: 'requiredValue', required: true, type: idlType.long },
        { name: 'integer', type: idlType.long, default: integer('0x10') },
        { name: 'decimal', type: idlType.double, default: decimal('-0.5') },
        { name: 'text', type: idlType.DOMString, default: 'value' },
        { name: 'nothing', type: nullable(idlType.object), default: null },
        { name: 'missing', type: idlType.any, default: undefinedDefault },
        { name: 'items', type: sequence(idlType.long), default: emptySequence },
        { name: 'options', type: reference('Options'), default: emptyDictionary },
      ],
      name: 'dictionary',
    });

    expect(serializeDefinition(dictionary)).toContain(`
  required long requiredValue;
  long integer = 0x10;
  double decimal = -0.5;
  DOMString text = "value";
  object? nothing = null;
  any missing = undefined;
  sequence<long> items = [];
  Options options = {};`);
    expect(serializeDefinition(dictionary)).toMatch(/^dictionary _dictionary/);
  });
});
