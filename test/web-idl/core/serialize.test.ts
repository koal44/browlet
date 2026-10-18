import { describe, expect, it } from 'vitest';

import {
  annotated, arg, asyncIter, asyncSequence, attr, constant, ctor, decimal,
  defineCallbackFunction,
  defineCallbackInterface, defineDictionary, defineEnumeration, defineProxyObject,
  defineIncludes, defineInterface, defineInterfaceMixin,
  defineNamespace, definePartialDictionary, definePartialInterface,
  definePartialInterfaceMixin, definePartialNamespace, defineTypedef, dictMember,
  emptyDictionary, emptySequence, frozenArray, idlType, impl, integer, iter,
  maplike, nullable, observableArray, op, staticOp, promise, roAttr, record,
  reference, reflect, reflectSetter, reflectURL, reflectNonNegative, reflectPositive, reflectPositiveWithFallback,
  reflectEnumerated, reflectTokens, sequence, setlike, stringifier, undefinedDefault, union, xattr,
} from '../../../src/web-idl/core/index';
import {
  serializeDefinition, serializeDefinitions, serializeExtendedAttribute,
  serializeMember, serializeType,
} from '../../../src/web-idl/core/index';

describe('Web IDL declarations and serialization', () => {
  it('serializes implementation references using their declared IDL names', () => {
    class ExampleImpl {}
    class ConsumerImpl {}
    const definition = defineInterface({
      name: 'RenamedExample', implementation: impl(ExampleImpl), members: [],
    });
    const consumer = defineInterface({
      name: 'Consumer', implementation: impl(ConsumerImpl),
      members: [op('read', promise(nullable(reference(ExampleImpl))), [arg('values', sequence(reference(ExampleImpl)))])],
    });

    expect(serializeDefinitions([consumer, definition])).toContain(
      'Promise<RenamedExample?> read(sequence<RenamedExample> values);',
    );
    expect(() => serializeDefinitions([consumer])).toThrow('No interface declares the referenced implementation');
  });

  it('serializes proxy type references without inventing an interface declaration', () => {
    const proxy = defineProxyObject({ name: 'ProxyObject', getHandle: () => undefined, getProxy: () => undefined });
    const consumer = defineInterface({
      name: 'Consumer', members: [roAttr('value', reference('ProxyObject'))],
    });

    expect(serializeDefinition(proxy)).toBe('');
    expect(serializeDefinitions([proxy, consumer])).toBe(
      'interface Consumer {\n  readonly attribute ProxyObject value;\n};',
    );
  });

  it('represents the EventTarget fragment as structurally lossless data', () => {
    const definitions = [
      defineInterface({
        name: 'EventTarget',
        exposed: '*',
        members: [
          ctor(),
          op('addEventListener', idlType.undefined, [
            arg('type', idlType.DOMString),
            arg('callback', nullable(reference('EventListener'))),
            arg('options', union(reference('AddEventListenerOptions'), idlType.boolean),
              { default: emptyDictionary, optional: true },
            ),
          ]),
          op('removeEventListener', idlType.undefined, [
            arg('type', idlType.DOMString),
            arg('callback', nullable(reference('EventListener'))),
            arg('options', union(reference('EventListenerOptions'), idlType.boolean),
              { default: emptyDictionary, optional: true },
            ),
          ]),
          op('dispatchEvent', idlType.boolean, [
            arg('event', reference('Event')),
          ]),
        ],
      }),
      defineCallbackInterface({
        name: 'EventListener',
        members: [op('handleEvent', idlType.undefined, [
          arg('event', reference('Event')),
        ])],
      }),
      defineDictionary({
        name: 'EventListenerOptions',
        members: [dictMember('capture', idlType.boolean, { default: false })],
      }),
      defineDictionary({
        name: 'AddEventListenerOptions',
        inherits: 'EventListenerOptions',
        members: [
          dictMember('passive', idlType.boolean),
          dictMember('once', idlType.boolean, { default: false }),
          dictMember('signal', reference('AbortSignal')),
        ],
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
        name: 'Interface',
        inherits: 'Parent',
        exposed: ['Window', 'Worker'],
        members: [],
      }),
      definePartialInterface({ name: 'Interface', members: [] }),
      defineInterfaceMixin({ name: 'Mixin', members: [] }),
      definePartialInterfaceMixin({ name: 'Mixin', members: [] }),
      defineCallbackInterface({
        name: 'CallbackInterface',
        exposed: 'Window', members: [],
      }),
      defineNamespace({
        name: 'Namespace',
        exposed: ['Window'], members: [],
      }),
      definePartialNamespace({ name: 'Namespace', members: [] }),
      defineDictionary({
        name: 'D', inherits: 'ParentDictionary', members: [],
      }),
      definePartialDictionary({ name: 'D', members: [] }),
      defineEnumeration({ name: 'Choice', values: ['one', 'two'] }),
      defineCallbackFunction({
        name: 'Callback',
        returns: idlType.boolean,
        arguments: [{ name: 'value', type: idlType.long }],
      }),
      defineTypedef({ name: 'Alias', type: idlType.DOMString }),
      defineIncludes({ interface: 'Interface', mixin: 'Mixin' }),
    ];

    expect(definitions.map((definition) => serializeDefinition(definition))).toEqual([
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
      name: 'Interface',
      members: [
        ctor(),
        constant('ANSWER', idlType.long, integer(42)),
        attr('value', idlType.DOMString),
        roAttr('fixed', idlType.DOMString),
        attr('inherited', idlType.DOMString, { inherit: true }),
        attr('shared', idlType.DOMString, { static: true }),
        attr('text', idlType.DOMString, { stringifier: true }),
        op('run', idlType.undefined),
        op('run', idlType.undefined, [arg('value', idlType.long)]),
        op(undefined, idlType.object,
          [arg('name', idlType.DOMString)],
          {
            special: 'getter',
          },
        ),
        staticOp('create', reference('Interface'), []),
        stringifier(),
        iter(idlType.DOMString),
        iter(idlType.long, { key: idlType.DOMString }),
        asyncIter(idlType.DOMString),
        asyncIter(idlType.DOMString, { arguments: [], create: 'createIterator', return: true }),
        maplike(idlType.DOMString, idlType.long, { readonly: true }),
        setlike(idlType.DOMString),
      ],
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
    expect(Object.values(idlType).map((type) => serializeType(type))).toEqual([
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
    ].map((type) => serializeType(type))).toEqual([
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

  it('serializes nested reflection modifiers as separate IDL annotations without changing the declaration', () => {
    const reflection = reflect({ name: 'data-count', default: 0, range: [0, 1000] });
    const member = attr('count', idlType.unsignedLong, xattr('CEReactions', reflection));
    expect(serializeMember(member))
      .toBe('[CEReactions, Reflect="data-count", ReflectDefault=0, ReflectRange=(0, 1000)] attribute unsigned long count;');
    expect(member.extendedAttributes).toHaveLength(2);
    expect(member.extendedAttributes?.[1]).toBe(reflection);
    expect(reflection.default).toEqual(integer(0));
    expect(reflection.range).toEqual(['0', '1000']);
  });

  it('serializes reflection variants, renamed attributes, and retained numeric literal spelling', () => {
    expect([
      reflect(), reflect({ default: 1 }), reflect({ range: [0, 8] }),
      reflectSetter(), reflectSetter({ name: 'data-index' }),
      reflectURL(), reflectURL({ name: 'href' }),
      reflectNonNegative({ default: -1 }),
      reflectPositive({ default: decimal('1.0') }),
      reflectPositiveWithFallback({ default: 20 }),
      reflect({ default: integer('0x1'), range: ['0x0', '0x8'] }),
    ].map((reflection) => serializeExtendedAttribute(reflection))).toEqual([
      'Reflect', 'Reflect, ReflectDefault=1', 'Reflect, ReflectRange=(0, 8)',
      'ReflectSetter', 'ReflectSetter="data-index"',
      'ReflectURL', 'ReflectURL="href"',
      'ReflectNonNegative, ReflectDefault=-1',
      'ReflectPositive, ReflectDefault=1.0',
      'ReflectPositiveWithFallback, ReflectDefault=20',
      'Reflect, ReflectDefault=0x1, ReflectRange=(0x0, 0x8)',
    ]);
  });

  it('retains opaque reflection metadata without interpreting or serializing it', () => {
    const enumerated = { owner: 'HTML' };
    const annotation = reflectEnumerated(enumerated);
    const member = attr('loading', idlType.DOMString, xattr('CEReactions', annotation));
    expect(annotation.enumerated).toBe(enumerated);
    expect(member.extendedAttributes?.[1]).toBe(annotation);
    expect(member.get).toBeUndefined();
    expect(member.set).toBeUndefined();
    expect(serializeMember(member)).toBe('[CEReactions, ReflectEnumerated] attribute DOMString loading;');

    const tokenList = { name: 'tokens', supportedTokens: new Set(['render']) };
    const tokens = reflectTokens(tokenList);
    expect(tokens.tokenList).toBe(tokenList);
    expect(serializeMember(roAttr('blocking', reference('DOMTokenList'), xattr(tokens))))
      .toBe('[ReflectTokens] readonly attribute DOMTokenList blocking;');
    expect(serializeMember(roAttr('tokens', reference('DOMTokenList'), xattr(reflectTokens({ name: 'tokens', supportedTokens: null })))))
      .toBe('[ReflectTokens] readonly attribute DOMTokenList tokens;');
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

    expect(attributes.map((attribute) => serializeExtendedAttribute(attribute))).toEqual([
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
      name: 'dictionary',
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
