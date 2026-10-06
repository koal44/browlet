import { describe, expect, it } from 'vitest';

import {
  arg, ctor, defineDictionary, defineProxyObject, defineInterface, emptySequence,
  frozenArray, idlType, impl, nullable, reference, sequence, staticOp, union, xattr,
  type Definition, type OperationMember,
} from '../../../../src/web-idl/core/index';
import {
  DefinitionAssembly, AssembledArgument, AssembledCallable, AssembledOverloads, type IDLOperation,
} from '../../../../src/web-idl/assembly/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';
import { RealmBinding } from '../../../../src/web-idl/binding/realm';
import { createOverloadResolver, resolveOverload } from '../../../../src/web-idl/binding/realm/overload';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL effective overload sets', () => {
  it.each(['direct', 'prepared'] as const)('fills optional defaults before an omitted or repeated variadic argument (%s)', (mode) => {
    const binding = createBinding([]);
    const callable = operation([
      { name: 'label', type: idlType.DOMString },
      { name: 'mode', optional: true, default: 'default', type: idlType.DOMString },
      { name: 'values', type: idlType.double, variadic: true },
    ], binding);
    const overloads = new AssembledOverloads([callable]);
    const resolve = mode === 'prepared'
      ? createOverloadResolver(overloads, binding, 'variadic')
      : (values: unknown[]) => resolveOverload(overloads, values, binding);
    const resolveArguments = (...values: unknown[]) => resolve(values).values;

    expect(resolveArguments('label')).toEqual(['label', 'default']);
    expect(resolveArguments('label', undefined, 2.5, '3')).toEqual(['label', 'default', 2.5, 3]);
    expect(resolveArguments('label', 'explicit')).toEqual(['label', 'explicit']);
    expect(() => resolveArguments()).toThrow(binding.realm.intrinsics.typeError);
  });

  it('keeps mutable defaults fresh and leaves omitted arguments without defaults undefined', () => {
    const binding = createBinding([]);
    const callable = operation([
      { name: 'values', optional: true, default: emptySequence, type: sequence(idlType.double) },
      { name: 'label', optional: true, type: idlType.DOMString },
    ], binding);
    const resolve = createOverloadResolver(new AssembledOverloads([callable]), binding, 'defaults');
    const first = resolve([]).values;
    const values = first[0] as number[];
    values.push(99);
    expect(first[1]).toBeUndefined();
    expect(resolve([]).values).toEqual([[], undefined]);
    expect(resolve([undefined, 'label']).values).toEqual([[], 'label']);
    expect(resolve([[1, '2'], null, Symbol('ignored')]).values).toEqual([[1, 2], 'null']);
  });

  it('does not read author array prototype getters for omitted arguments', () => {
    class OptionalArgumentImpl {}
    const definition = defineInterface({
      name: 'OptionalArgument', exposed: '*', implementation: impl(OptionalArgumentImpl),
      members: [staticOp('read', idlType.DOMString,
        [arg('value', idlType.DOMString, { optional: true, default: 'fallback' })],
        { invoke(_ctx, value) { return value; } },
      )],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const OptionalArgument = Reflect.get(realm.global, definition.name) as { read(value?: unknown): string; };
    let reads = 0;
    Object.defineProperty(realm.intrinsics.array.prototype, '0', {
      configurable: true,
      get() { reads++; return 'prototype'; },
    });
    let result: string;
    try {
      result = OptionalArgument.read();
    } finally {
      Reflect.deleteProperty(realm.intrinsics.array.prototype, '0');
    }
    expect({ result, reads }).toEqual({ result: 'fallback', reads: 0 });
  });

  it('selects by value category and converts the selected arguments', () => {
    const options = defineDictionary({ name: 'Options', members: [] });
    const binding = createBinding([options]);
    const string = namedOperation('string', idlType.DOMString, binding);
    const boolean = namedOperation('boolean', idlType.boolean, binding);
    const dictionary = namedOperation('dictionary', reference('Options'), binding);
    const sequence_ = namedOperation('sequence', sequence(idlType.long), binding);
    const overloads = new AssembledOverloads([string, boolean, dictionary, sequence_]);
    const resolveArguments = (...values: unknown[]) =>
      resolveOverload(overloads, values, binding);

    expect(resolveArguments('value').callable).toBe(string);
    expect(resolveArguments(false)).toEqual({
      callable: boolean,
      values: [false],
    });
    expect(resolveArguments({})).toMatchObject({
      callable: dictionary,
      values: [{ record: {} }],
    });

    let iteratorGets = 0;
    let firstValue = '1';
    const iterable = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield firstValue;
          yield 2;
        };
      },
    };
    expect(resolveArguments(iterable)).toEqual({
      callable: sequence_,
      values: [[1, 2]],
    });
    expect(iteratorGets).toBe(1);
    firstValue = '3';
    expect(resolveArguments(iterable)).toEqual({
      callable: sequence_,
      values: [[3, 2]],
    });
    expect(iteratorGets).toBe(2);
    expect(resolveArguments(false).callable).toBe(boolean);
  });

  it('resolves repeated calls with fixed arguments and variadic tails', () => {
    class OverloadedImpl {}
    const definition = defineInterface({
      name: 'Overloaded', exposed: '*', implementation: impl(OverloadedImpl),
      members: [
        staticOp('choose', idlType.DOMString,
          [arg('prefix', idlType.long), arg('value', idlType.DOMString)],
          { invoke(_ctx, prefix, value) { return `string:${prefix}:${value}`; } },
        ),
        staticOp('choose', idlType.DOMString,
          [arg('prefix', idlType.long), arg('value', idlType.boolean), arg('values', idlType.long, { variadic: true })],
          { invoke(_ctx, prefix, value, ...values) { return `boolean:${prefix}:${value}:${values.join(',')}`; } },
        ),
        staticOp('choose', idlType.DOMString,
          [arg('prefix', idlType.long), arg('value', idlType.long), arg('values', idlType.long, { variadic: true })],
          { invoke(_ctx, prefix, value, ...values) { return `number:${prefix}:${value}:${values.join(',')}`; } },
        ),
        staticOp('fixed', idlType.long,
          [arg('value', idlType.long)],
          { invoke(_ctx, value) { return value; } },
        ),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([definition]);
    world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Overloaded = Reflect.get(realm.global, 'Overloaded') as {
      choose(...values: unknown[]): string;
      fixed(...values: unknown[]): number;
    };

    expect(Overloaded.choose.length).toBe(2);
    expect(() => Overloaded.choose(1)).toThrow(realm.intrinsics.typeError);
    expect(Overloaded.choose(1.8, 'first')).toBe('string:1:first');
    expect(Overloaded.choose(2, true)).toBe('boolean:2:true:');
    expect(Overloaded.choose(3, false, '4')).toBe('boolean:3:false:4');
    const tail = Array.from({ length: 128 }, (_, index) => index + 0.5);
    expect(Overloaded.choose(4, true, ...tail))
      .toBe(`boolean:4:true:${tail.map(Math.trunc).join(',')}`);
    expect(Overloaded.choose(4, 9, ...tail))
      .toBe(`number:4:9:${tail.map(Math.trunc).join(',')}`);
    expect(Overloaded.choose(5, 'last')).toBe('string:5:last');
    expect(Overloaded.choose(6, false)).toBe('boolean:6:false:');
    expect(Overloaded.fixed('7', Symbol('ignored extra argument'))).toBe(7);

    const conversions: string[] = [];
    expect(Overloaded.choose(
      { valueOf() { conversions.push('prefix'); return 8; } },
      { toString() { conversions.push('value'); return 'converted'; } },
    )).toBe('string:8:converted');
    expect(conversions).toEqual(['prefix', 'value']);
  });

  it('materializes constructor defaults separately for every invocation', () => {
    const received: number[][] = [];
    class DefaultsImpl {
      constructor(values: number[]) { received.push(values); }
    }
    const definition = defineInterface({
      name: 'Defaults', exposed: '*', implementation: impl(DefaultsImpl),
      members: [ctor([arg('values', sequence(idlType.long), { optional: true, default: emptySequence })])],
    });
    const realm = new Realm();
    const world = new BindingWorld([definition]);
    world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Defaults = Reflect.get(realm.global, 'Defaults') as new(values?: unknown) => object;

    expect(Defaults.length).toBe(0);
    new Defaults();
    received[0]!.push(1);
    new Defaults(undefined);
    new Defaults(['2']);
    new Defaults();
    expect(received).toEqual([[1], [], [2], []]);
    expect(received[1]).not.toBe(received[3]);
  });

  it('keeps overload selection and function length local to each realm\'s exposure', () => {
    class ExposedOverloadsImpl {}
    const definition = defineInterface({
      name: 'ExposedOverloads', exposed: '*', implementation: impl(ExposedOverloadsImpl),
      members: [
        staticOp('choose', idlType.DOMString,
          [arg('value', idlType.DOMString)],
          { invoke(_ctx, value) { return `string:${value}`; } },
        ),
        staticOp('choose', idlType.DOMString,
          [arg('value', idlType.boolean, { optional: true, default: false })],
          { ...xattr('SecureContext'), invoke(_ctx, value) { return `boolean:${value}`; } },
        ),
      ],
    });
    const world = new BindingWorld([definition]);
    for (const secureContext of [true, false, true]) {
      const realm = new Realm({ secureContext });
      world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
      const ExposedOverloads = Reflect.get(realm.global, 'ExposedOverloads') as {
        choose(value?: unknown): string;
      };
      expect(ExposedOverloads.choose.length).toBe(secureContext ? 0 : 1);
      expect(ExposedOverloads.choose(true)).toBe(secureContext ? 'boolean:true' : 'string:true');
      expect(ExposedOverloads.choose('text')).toBe('string:text');
      if (secureContext) expect(ExposedOverloads.choose()).toBe('boolean:false');
      else expect(() => ExposedOverloads.choose()).toThrow(realm.intrinsics.typeError);
    }
  });

  it('associates applicable argument attributes with their types', () => {
    const binding = createBinding([]);
    const callable = operation([{
      extendedAttributes: [{ kind: 'no-arguments', name: 'Clamp' }],
      name: 'value',
      type: idlType.byte,
    }], binding);

    expect(resolve([callable], [300], binding)).toEqual({
      callable,
      values: [127],
    });
  });

  it('selects and converts a frozen-array overload for an iterable object', () => {
    const binding = createBinding([]);
    const string = namedOperation('string', idlType.DOMString, binding);
    const frozen = namedOperation('frozen', frozenArray(idlType.long), binding);
    let iteratorGets = 0;
    const iterable = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield '1';
          yield 2;
        };
      },
    };

    const result = resolve([string, frozen], [iterable], binding);

    expect(result.callable).toBe(frozen);
    expect(result.values).toEqual([[1, 2]]);
    expect(Object.isFrozen(result.values[0])).toBe(true);
    expect(iteratorGets).toBe(1);
  });

  it.each([
    ['sequence', sequence(idlType.double)],
    ['frozen array', frozenArray(idlType.double)],
  ] as const)('realizes %s element conversion errors after overload selection', (_name, type) => {
    const binding = createBinding([]);
    const string = namedOperation('string', idlType.DOMString, binding);
    const iterable = namedOperation('iterable', type, binding);

    expect(() => resolve([string, iterable], [[Symbol('element')]], binding))
      .toThrow(binding.realm.intrinsics.typeError);
  });

  it.each([
    ['sequence', sequence(idlType.double)],
    ['frozen array', frozenArray(idlType.double)],
  ] as const)('throws %s conversion errors from an overloaded constructor in its realm', (_name, type) => {
    class ConvertedImpl {}
    const definition = defineInterface({
      name: 'Converted', exposed: '*', implementation: impl(ConvertedImpl),
      members: [
        ctor([arg('value', idlType.DOMString)]),
        ctor([arg('value', type)]),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([definition]);
    world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Converted = Reflect.get(realm.global, 'Converted') as new(value: unknown) => object;

    expect(() => new Converted([Symbol('element')])).toThrow(realm.intrinsics.typeError);
  });

  it.each([
    ['symbol', idlType.symbol],
    ['nullable symbol', nullable(idlType.symbol)],
    ['union containing symbol', union(idlType.symbol, idlType.long)],
  ] as const)('selects a %s overload before the string fallback', (_name, type) => {
    const binding = createBinding([]);
    const symbol = namedOperation('symbol', type, binding);
    const string = namedOperation('string', idlType.DOMString, binding);
    const value = Symbol('value');

    for (const callables of [[symbol, string], [string, symbol]]) {
      const resolver = createOverloadResolver(new AssembledOverloads(callables), binding, 'symbol');
      expect(resolver([value])).toEqual({ callable: symbol, values: [value] });
      expect(resolver(['value'])).toEqual({ callable: string, values: ['value'] });
      expect(() => resolver([Object(value)])).toThrow(binding.realm.intrinsics.typeError);
    }
  });

  it('retains string conversion failures when no overload accepts symbols', () => {
    const binding = createBinding([]);
    const string = namedOperation('string', idlType.DOMString, binding);
    const numeric = namedOperation('numeric', idlType.long, binding);

    expect(() => resolve([string, numeric], [Symbol('value')], binding))
      .toThrow(binding.realm.intrinsics.typeError);
  });

  it('selects optional and platform-object overloads', () => {
    const nodeIDL = defineInterface({ name: 'Node', members: [] });
    const binding = createBinding([nodeIDL]);
    const optional = assembleOperation({
      arguments: [{ name: 'value', optional: true, type: idlType.DOMString }],
      kind: 'operation',
      name: 'optional',
      returns: idlType.undefined,
    } satisfies OperationMember, binding);
    const numeric = namedOperation('numeric', idlType.long, binding);

    expect(resolve([optional, numeric], [undefined], binding)).toEqual({
      callable: optional,
      values: [undefined],
    });

    const assembled = binding.assembly.interfaces.get('Node');
    const platformObject = {};
    const implInst = {};
    if (!assembled) throw new Error('Missing Node interface');
    binding.initializePlatformObject(platformObject, assembled, implInst);

    const node = namedOperation('node', reference('Node'), binding);
    const string = namedOperation('string', idlType.DOMString, binding);
    const selected = resolve([node, string], [platformObject], binding);
    expect(selected.callable).toBe(node);
    expect(selected.values).toHaveLength(1);
    expect(selected.values[0]).toBe(implInst);

    const hostObject = {};
    const hostBinding = createBinding([defineProxyObject({
      is: (value) => value === hostObject,
      name: 'HostObject',
    })]);
    const host = namedOperation('host', reference('HostObject'), hostBinding);
    expect(resolve([host, string], [hostObject], hostBinding)).toEqual({
      callable: host,
      values: [hostObject],
    });
  });

  it('fills omitted optional arguments after selecting the callable', () => {
    const binding = createBinding([]);
    const callable = assembleOperation({
      arguments: [
        { default: false, name: 'enabled', optional: true, type: idlType.boolean },
        { name: 'label', optional: true, type: idlType.DOMString },
      ],
      kind: 'operation',
      name: 'configure',
      returns: idlType.undefined,
    } satisfies OperationMember, binding);

    expect(resolve([callable], [], binding)).toEqual({
      callable,
      values: [false, undefined],
    });
  });

  it('reuses interface matches across instances and realms without admitting another world', () => {
    class BaseImpl {
      constructor(public label: string) {}
    }
    class DerivedImpl extends BaseImpl {}
    class ChooserImpl {}
    const definitions = [
      defineInterface({ name: 'Base', exposed: '*', implementation: impl(BaseImpl), members: [] }),
      defineInterface({ name: 'Derived', exposed: '*', inherits: 'Base', implementation: impl(DerivedImpl), members: [] }),
      defineInterface({
        name: 'Chooser', exposed: '*', implementation: impl(ChooserImpl),
        members: [
          staticOp('choose', idlType.DOMString,
            [arg('prefix', idlType.DOMString), arg('value', union(reference(BaseImpl), idlType.long))],
            { invoke(_ctx, prefix, value) { return `${prefix}:matched:${typeof value === 'number' ? value : value.label}`; } },
          ),
          staticOp('choose', idlType.DOMString,
            [arg('prefix', idlType.DOMString), arg('value', idlType.DOMString)],
            { invoke(_ctx, prefix, value) { return `${prefix}:string:${value}`; } },
          ),
        ],
      }),
    ];
    const world = new BindingWorld(definitions);
    const realm = new Realm();
    const binding = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    binding.install(realm.global);
    const otherRealm = new Realm();
    const otherBinding = world.register(otherRealm, (ctx) => ({ realm: ctx.realm }));
    const foreignBinding = new BindingWorld(definitions).register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const first = binding.project(BaseImpl, new BaseImpl('first'));
    const second = binding.project(BaseImpl, new BaseImpl('second'));
    const derived = otherBinding.project(DerivedImpl, new DerivedImpl('derived'));
    const foreign = foreignBinding.project(BaseImpl, new BaseImpl('foreign'));
    const Chooser = Reflect.get(realm.global, 'Chooser') as { choose(prefix: unknown, value: unknown): string; };
    const trace: string[] = [];
    Object.defineProperty(foreign, 'toString', { value() { trace.push('value'); return 'foreign'; } });
    Object.defineProperty(derived, Symbol.iterator, { get() { throw new Error('Must select the interface first'); } });

    for (let repeat = 0; repeat < 3; repeat++) {
      expect(Chooser.choose('p', first)).toBe('p:matched:first');
      expect(Chooser.choose('p', second)).toBe('p:matched:second');
      expect(Chooser.choose('p', derived)).toBe('p:matched:derived');
      expect(Chooser.choose('p', 4.8)).toBe('p:matched:4');
      expect(Chooser.choose('p', 'text')).toBe('p:string:text');
      trace.length = 0;
      expect(Chooser.choose({ toString() { trace.push('prefix'); return 'p'; } }, foreign))
        .toBe('p:string:foreign');
      expect(trace).toEqual(['prefix', 'value']);
    }
    expect(() => Chooser.choose('p', Symbol('value'))).toThrow(realm.intrinsics.typeError);
  });

  it('keeps proxy recognition dependent on the value when ordinary interface matches are reused', () => {
    const first = {};
    const second = {};
    let recognized: object = first;
    const binding = createBinding([
      defineInterface({ name: 'Node', members: [] }),
      defineProxyObject({ name: 'LiveProxy', is: (value) => value === recognized }),
    ]);
    const assembled = binding.assembly.interfaces.get('Node')!;
    binding.initializePlatformObject(first, assembled, {});
    binding.initializePlatformObject(second, assembled, {});
    const proxy = namedOperation('proxy', reference('LiveProxy'), binding);
    const string = namedOperation('string', idlType.DOMString, binding);
    const resolveArguments = createOverloadResolver(new AssembledOverloads([proxy, string]), binding, 'live proxy');

    expect(resolveArguments([first])).toEqual({ callable: proxy, values: [first] });
    expect(resolveArguments([second])).toEqual({ callable: string, values: ['[object Object]'] });
    recognized = second;
    expect(resolveArguments([first])).toEqual({ callable: string, values: ['[object Object]'] });
    expect(resolveArguments([second])).toEqual({ callable: proxy, values: [second] });
  });
});

function operation(
  argumentsList: OperationMember['arguments'],
  binding: RealmBinding,
): IDLOperation {
  return assembleOperation({
    arguments: argumentsList,
    kind: 'operation',
    name: 'f',
    returns: idlType.undefined,
  }, binding);
}

function namedOperation(
  name: string,
  type: OperationMember['arguments'][number]['type'],
  binding: RealmBinding,
): IDLOperation {
  return assembleOperation({
    arguments: [{ name: 'value', type }],
    kind: 'operation',
    name,
    returns: idlType.undefined,
  }, binding);
}

function assembleOperation(member: OperationMember, binding: RealmBinding): IDLOperation {
  const { arguments: argumentsList, returns, ...metadata } = member;
  return Object.assign(new AssembledCallable(
    argumentsList.map((argument) => new AssembledArgument(argument, binding.assembly)),
    binding.assembly.getIDLType(returns),
  ), metadata);
}

function createBinding(
  definitions: Definition[],
): RealmBinding {
  return new RealmBinding(
    new DefinitionAssembly(definitions),
    new Realm(),
    new BindingWorld(definitions), (ctx) => ({ realm: ctx.realm }),
  );
}

function resolve(
  callables: IDLOperation[],
  argumentsList: unknown[],
  binding: RealmBinding,
) {
  return resolveOverload(
    new AssembledOverloads(callables),
    argumentsList,
    binding,
  );
}
