import { describe, expect, it, vi } from 'vitest';

import {
  arg, onError, cbDict, ctor, defineCallbackFunction, defineDictionary, defineInterface,
  definePartialDictionary, defineTypedef, dictMember, idlType, integer, impl, nullable, op, staticOp,
  promise as promiseType, roAttr, record, reference, sequence, union, xattr,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL implementation argument conversion', () => {
  it('keeps conversion attributes local to arguments across repeated and variadic calls', () => {
    class NumberConsumerImpl {
      constructor(public value: number) {}
      clamp(value: number) { return value; }
      wrap(value: number) { return value; }
      many(...values: number[]) { return values; }
    }
    const valueType = reference('NumberValue');
    const definition = defineInterface({
      name: 'NumberConsumer', exposed: '*', implementation: impl(NumberConsumerImpl),
      members: [
        ctor([arg('value', valueType, xattr('Clamp'))]),
        roAttr('value', idlType.long),
        op('clamp', idlType.long, [arg('value', valueType, {
          optional: true, default: integer(5), ...xattr('Clamp'),
        })]),
        op('wrap', idlType.long, [arg('value', valueType)]),
        op('many', sequence(idlType.long), [arg('values', valueType, {
          variadic: true, ...xattr('Clamp'),
        })]),
      ],
    });

    // The same declarations resolve their forward alias independently in each world.
    for (const [type, maximum, wrapped] of [
      [idlType.byte, 127, 44], [idlType.short, 300, 300],
    ] as const) {
      const realm = new Realm();
      const world = new BindingWorld([
        definition, defineTypedef({ name: 'NumberValue', type }),
      ]);
      world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
      const Constructor = Reflect.get(realm.global, 'NumberConsumer') as new(value: unknown) => {
        value: number;
        clamp(value?: unknown): number;
        wrap(value: unknown): number;
        many(...values: unknown[]): number[];
      };
      const object = new Constructor(300);
      expect(object.value).toBe(maximum);
      expect(object.clamp(300)).toBe(maximum);
      expect(object.wrap(300)).toBe(wrapped);
      expect(object.clamp()).toBe(5);
      expect(object.many(300, 2.5, 3.5)).toEqual([maximum, 2, 4]);
      expect(object.many()).toEqual([]);
      expect(object.many(3.5)).toEqual([4]);

      let value = 2.5;
      let reads = 0;
      const input = { valueOf() { reads++; return value; } };
      expect(object.clamp(input)).toBe(2);
      value = 3.5;
      expect(object.clamp(input)).toBe(4);
      expect(reads).toBe(2);
      expect(object.wrap(300)).toBe(wrapped);
    }
  });

  it('converts implementation references through the registered interface, including unions and overloads', async () => {
    class ValueImpl {
      constructor(public value: string) {}
    }
    class ConsumerImpl {}
    const valueIDL = defineInterface({
      name: 'RenamedValue', exposed: '*', implementation: impl(ValueImpl),
      members: [ctor([arg('value', idlType.DOMString)]), roAttr('value', idlType.DOMString)],
    });
    const consumerIDL = defineInterface({
      name: 'Consumer', exposed: '*', implementation: impl(ConsumerImpl),
      members: [
        staticOp('read', idlType.DOMString,
          [arg('value', reference(ValueImpl))],
          { invoke(_ctx, value) { return value.value; } },
        ),
        staticOp('read', idlType.DOMString,
          [arg('value', idlType.DOMString)],
          { invoke(_ctx, value) { return value.toUpperCase(); } },
        ),
        staticOp('echo', nullable(reference(ValueImpl)),
          [arg('value', nullable(reference(ValueImpl)))],
          { invoke(_ctx, value) { return value; } },
        ),
        staticOp('describe', idlType.DOMString,
          [arg('value', union(reference(ValueImpl), idlType.DOMString))],
          { invoke(_ctx, value) { return typeof value === 'string' ? value : value.value; } },
        ),
        staticOp('later', promiseType(reference('RenamedValue')),
          [arg('value', reference(ValueImpl))],
          { invoke(ctx, value) { return ctx.Promise.resolve(value, reference(ValueImpl)); } },
        ),
      ],
    });
    const world = new BindingWorld([consumerIDL, valueIDL]);
    const realm = new Realm();
    const otherRealm = new Realm();
    world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    world.register(otherRealm, (ctx) => ({ realm: ctx.realm })).install(otherRealm.global);
    const Value = Reflect.get(otherRealm.global, 'RenamedValue') as new(value: string) => object;
    const Consumer = Reflect.get(realm.global, 'Consumer') as {
      read(value: unknown): string;
      echo(value: unknown): object | null;
      describe(value: unknown): string;
      later(value: unknown): Promise<object>;
    };
    const value = new Value('value');

    expect(Consumer.read(value)).toBe('value');
    expect(Consumer.read('text')).toBe('TEXT');
    expect(Consumer.echo(value)).toBe(value);
    expect(Consumer.echo(null)).toBeNull();
    expect(() => Consumer.echo({ value: 'fake' })).toThrow(realm.intrinsics.typeError);
    expect(Consumer.describe(value)).toBe('value');
    expect(Consumer.describe('text')).toBe('text');
    expect(await Consumer.later(value)).toBe(value);
  });

  it('retains each dictionary input as callback receiver without changing callback identity', () => {
    type Options = { handler?: (value: unknown) => unknown; raw?: unknown; };
    class CallbackDictionaryImpl {
      #options: Options;

      constructor(options: Options) {
        this.#options = options;
      }

      get handler() { return this.#options.handler; }
      get raw() { return this.#options.raw; }
      run(value: unknown) { return this.#options.handler?.(value); }
      runFrom(options: Options, value: unknown) { return options.handler?.(value); }
    }
    const handlerIDL = defineCallbackFunction({
      name: 'Handler', returns: idlType.any, arguments: [arg('value', idlType.any)],
    });
    const baseIDL = defineDictionary({
      name: 'CallbackMembers',
      members: [dictMember('handler', reference('Handler'), onError('rethrow'))],
    });
    const optionsIDL = defineDictionary({
      name: 'CallbackOptions', inherits: baseIDL.name,
      members: [dictMember('raw', idlType.any)],
    });
    const definition = defineInterface({
      name: 'CallbackDictionary', exposed: '*', implementation: impl(CallbackDictionaryImpl),
      members: [
        ctor([arg('options', idlType.object, {
          optional: true, ...cbDict(optionsIDL.name),
        })]),
        roAttr('handler', reference('Function')),
        roAttr('raw', idlType.any),
        op('run', idlType.any, [arg('value', idlType.any)]),
        op('runFrom', idlType.any, [
          arg('options', idlType.object, cbDict(optionsIDL.name)),
          arg('value', idlType.any),
        ]),
      ],
    });
    const realm = new Realm();
    new BindingWorld([handlerIDL, baseIDL, optionsIDL, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new(input?: object) => {
      handler: unknown; raw: unknown;
      run(value: unknown): { receiver: unknown; value: unknown; } | undefined;
      runFrom(input: object, value: unknown): { receiver: unknown; value: unknown; };
    };
    const handler = function(this: unknown, value: unknown) { return { receiver: this, value }; };
    let reads = 0;
    const firstInput = { get handler() { reads++; return handler; }, raw: handler };
    const secondInput = { handler, raw: handler };
    const first = new Constructor(firstInput);
    const second = new Constructor(secondInput);
    const value = {};

    const result = first.run(value);
    expect(result?.receiver).toBe(firstInput);
    expect(result?.value).toBe(value);
    expect(second.run(value)?.receiver).toBe(secondInput);
    expect(first.runFrom(secondInput, value).receiver).toBe(secondInput);
    expect(first.handler).toBe(handler);
    expect(second.handler).toBe(handler);
    expect(first.raw).toBe(handler);
    expect(reads).toBe(1);
    expect(new Constructor().run(value)).toBeUndefined();
  });

  it('adapts dictionary values for explicit implementation steps', () => {
    const received: unknown[] = [];
    const settings = defineDictionary({
      name: 'Settings',
      members: [{ name: 'enabled', type: idlType.boolean }],
    });
    const interfaceIDL = defineInterface({
      name: 'DictionaryAdapter',
      exposed: ['Window'],
      implementation: impl(DictionaryAdapterImpl),
      members: [
        {
          arguments: [{ name: 'settings', type: reference('Settings') }],
          invoke(_context, settingsValue) { received.push(settingsValue); },
          kind: 'constructor',
        },
        {
          arguments: [{ name: 'settings', type: reference('Settings'), variadic: true }],
          invoke(_context, ...settingsValues) { received.push(...settingsValues); },
          kind: 'operation',
          name: 'apply',
          returns: idlType.undefined,
        },
      ],
    });

    const realm = new Realm();
    const world = new BindingWorld([settings, interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
    const DictionaryAdapter = Reflect.get(
      realm.global,
      'DictionaryAdapter',
    ) as InterfaceConstructor;
    const object = new DictionaryAdapter({ enabled: true });

    Reflect.apply(
      Reflect.get(object, 'apply') as CallableFunction,
      object,
      [{ enabled: false }, { enabled: 1 }, {}],
    );

    expect(received).toEqual([{ enabled: true }, { enabled: false }, { enabled: true }, {}]);
    expect(received.every((value) => !(value instanceof Map))).toBe(true);
  });

  it('preserves inherited and partial dictionary callback policies through a typedef and union', () => {
    type Options = { rethrow: () => void; report: () => void; fallback: () => void; };
    const received: Options[] = [];
    class CallbackPolicyImpl {
      accept(options: Options | string) {
        if (typeof options !== 'string') received.push(options);
      }
    }
    const callback = defineCallbackFunction({
      name: 'Handler', returns: idlType.undefined, arguments: [],
    });
    const base = defineDictionary({
      name: 'BaseOptions',
      members: [dictMember('rethrow', reference(callback.name), onError('rethrow'))],
    });
    const options = defineDictionary({
      name: 'Options', inherits: base.name,
      members: [dictMember('fallback', reference(callback.name))],
    });
    const partial = definePartialDictionary({
      name: options.name,
      members: [dictMember('report', reference(callback.name), onError('report'))],
    });
    const alias = defineTypedef({ name: 'OptionsAlias', type: reference(options.name) });
    const definition = defineInterface({
      name: 'CallbackPolicy', exposed: '*', implementation: impl(CallbackPolicyImpl),
      members: [
        ctor(),
        op('accept', idlType.undefined, [
          arg('options', union(idlType.DOMString, reference(alias.name)), onError('report')),
        ]),
      ],
    });
    const realm = new Realm();
    new BindingWorld([callback, base, options, partial, alias, definition])
      .register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      accept(options: Options | string): void;
    };
    const error = new Error('callback failure');
    const fail = () => { throw error; };
    const reportException = vi.spyOn(realm, 'reportException').mockImplementation(() => {});

    new Constructor().accept({ rethrow: fail, report: fail, fallback: fail });

    expect(received).toHaveLength(1);
    const adapted = received[0]!;
    expect(() => adapted.rethrow()).toThrow(error);
    expect(() => adapted.report()).not.toThrow();
    expect(() => adapted.fallback()).not.toThrow();
    expect(reportException.mock.calls).toEqual([[error], [error]]);
  });

  it('keeps dictionary records fresh and absent members out of their property order', () => {
    const received: Record<string, unknown>[] = [];
    class RecordReceiverImpl {
      accept(value: Record<string, unknown>) { received.push(value); }
    }
    const dictionary = defineDictionary({
      name: 'Members',
      members: [
        dictMember('z', idlType.DOMString, { default: 'default' }),
        dictMember('a', idlType.object),
        dictMember('m', idlType.object),
      ],
    });
    const definition = defineInterface({
      name: 'RecordReceiver', exposed: '*', implementation: impl(RecordReceiverImpl),
      members: [ctor(), op('accept', idlType.undefined, [arg('value', reference(dictionary.name))])],
    });
    const realm = new Realm();
    new BindingWorld([dictionary, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      accept(value: Record<string, unknown>): void;
    };
    const object = new Constructor();
    const value = {};
    object.accept({ a: value });
    received[0]!.z = 'changed';
    object.accept({ m: value });
    object.accept({});

    expect(received.map((record) => Object.keys(record))).toEqual([['a', 'z'], ['m', 'z'], ['z']]);
    expect(received[0]!.a).toBe(value);
    expect(received[1]!.m).toBe(value);
    expect(received[1]!.z).toBe('default');
    expect(received[2]!.z).toBe('default');
    expect(new Set(received).size).toBe(3);
    expect(received.every((record) => Object.getPrototypeOf(record) === Object.prototype)).toBe(true);
  });

  it('keeps defaulted and supplied primitive sequences independent across implementation calls', () => {
    type Options = { values: number[][]; };
    const received: Options[] = [];
    class SequenceReceiverImpl {
      accept(options: Options) {
        received.push(options);
        options.values.push([7]);
        options.values[0]!.push(8);
      }
    }
    const numbers = defineTypedef({ name: 'Numbers', type: sequence(idlType.long) });
    const dictionary = defineDictionary({
      name: 'Options',
      members: [dictMember('values', sequence(reference(numbers.name)), { default: { kind: 'empty-sequence' } })],
    });
    const definition = defineInterface({
      name: 'SequenceReceiver', exposed: '*', implementation: impl(SequenceReceiverImpl),
      members: [ctor(), op('accept', idlType.undefined, [arg('options', reference(dictionary.name))])],
    });
    const realm = new Realm();
    new BindingWorld([numbers, dictionary, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => { accept(options: { values?: unknown; }): void; };
    const receiver = new Constructor();
    receiver.accept({});
    receiver.accept({});
    const source = [['3']];
    receiver.accept({ values: source });
    receiver.accept({ values: source });

    expect(received.map((options) => options.values)).toEqual([[[7, 8]], [[7, 8]], [[3, 8], [7]], [[3, 8], [7]]]);
    expect(source).toEqual([['3']]);
    expect(received[0]!.values).not.toBe(received[1]!.values);
    expect(received[2]!.values[0]).not.toBe(received[3]!.values[0]);
  });

  it('converts nested dictionary sequences without sharing author inputs or losing callback policy', () => {
    type Entry = { callback: () => void; children: Entry[]; count: number; };
    const received: Entry[][][] = [];
    class SequenceReceiverImpl {
      accept(values: Entry[][]) {
        received.push(values);
        values[0]![0]!.count++;
      }
    }
    const callback = defineCallbackFunction({ name: 'Handler', returns: idlType.undefined, arguments: [] });
    const entry = defineDictionary({
      name: 'Entry',
      members: [
        dictMember('callback', reference(callback.name), { required: true, ...onError('rethrow') }),
        dictMember('children', sequence(reference('Entry')), { default: { kind: 'empty-sequence' } }),
        dictMember('count', idlType.long, { default: integer(2) }),
      ],
    });
    const entries = defineTypedef({ name: 'Entries', type: sequence(reference(entry.name)) });
    const definition = defineInterface({
      name: 'SequenceReceiver', exposed: '*', implementation: impl(SequenceReceiverImpl),
      members: [ctor(), op('accept', idlType.undefined, [arg('values', sequence(reference(entries.name)))])],
    });
    const realm = new Realm();
    new BindingWorld([callback, entry, entries, definition])
      .register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => { accept(values: unknown): void; };
    const receiver = new Constructor();
    const failure = new Error('callback failure');
    const fail = () => { throw failure; };
    const child = Object.freeze({ callback: fail });
    const source = Object.freeze([Object.freeze([
      Object.freeze({ callback: fail, children: Object.freeze([child]), count: '3' }),
    ])]);

    receiver.accept(source);
    receiver.accept(source);

    const first = received[0]![0]![0]!;
    const second = received[1]![0]![0]!;
    expect(first.count).toBe(4);
    expect(second.count).toBe(4);
    expect(first.children[0]!.count).toBe(2);
    expect(first.children[0]!.children).toEqual([]);
    expect(() => first.callback()).toThrow(failure);
    expect(() => first.children[0]!.callback()).toThrow(failure);
    expect(received[0]![0]).not.toBe(received[1]![0]);
    expect(first).not.toBe(second);
    expect(first.children).not.toBe(second.children);
    expect(first.children[0]!.children).not.toBe(second.children[0]!.children);
    expect(source[0]![0]!.count).toBe('3');
  });

  it.each(['dictionary', 'required dictionary', 'record'] as const)('preserves __proto__ as an own %s member when adapting arguments', (kind) => {
    let received: Record<string, unknown> | undefined;
    class MemberReceiverImpl {
      accept(value: Record<string, unknown>) { received = value; }
    }
    const dictionary = defineDictionary({
      name: 'Members', members: [dictMember('__proto__', idlType.object, { required: kind === 'required dictionary' })],
    });
    const definition = defineInterface({
      name: 'MemberReceiver', exposed: '*', implementation: impl(MemberReceiverImpl),
      members: [
        ctor(),
        op('accept', idlType.undefined, [
          arg('value', kind === 'record' ? record(idlType.DOMString, idlType.object) : reference(dictionary.name)),
        ]),
      ],
    });
    const realm = new Realm();
    new BindingWorld([dictionary, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      accept(value: Record<string, unknown>): void;
    };
    const member = { inherited: true };

    new Constructor().accept({ ['__proto__']: member });

    expect(Object.hasOwn(received!, '__proto__')).toBe(true);
    expect(received!['__proto__']).toBe(member);
    expect(Object.getPrototypeOf(received)).toBe(Object.prototype);
  });
});

type InterfaceConstructor = new (...argumentsList: unknown[]) => object;

class DictionaryAdapterImpl {}
