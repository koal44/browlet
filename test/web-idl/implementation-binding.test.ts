import { assert, describe, expect, it, vi } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { throwDOMException } from '../../src/web-idl/core/dom-exception';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  arg, atArg, attr, attrFn, onError, cbDict, ctor,
  defineCallbackFunction, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, definePartialDictionary, defineTypedef, dictMember, idlType, integer,
  impl, implementationType, indexedGetter, iter, namedGetter, nullable, op, staticOp,
  promise as promiseType, roAttr, record, reference, unwrapArg, sequence,
  stringifier,
  union, invokeWith, xattr,
} from '../../src/web-idl/core/index';
import { registerDefinitionBindings } from '../../src/web-idl/implementation-binding';
import { getImplementationObject, getImplementationRecord } from '../../src/web-idl/platform-object';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { CallbackFunctionStamper, type StampedCallbackFunction } from '../../src/web-idl/callback';
import type { WebIDLRealm } from '../../src/web-idl/index';

describe('Web IDL implementation bindings', () => {
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

  it('creates shared function-valued attributes with ordinary call behavior', () => {
    class AttributeFunctionImpl {}
    const callback = function(this: unknown, ...args: unknown[]) {
      return { receiver: this, args };
    };
    const definition = defineInterface({
      name: 'AttributeFunction', exposed: '*', implementation: impl(AttributeFunctionImpl),
      members: [
        ctor(),
        roAttr('first', reference('Function'), attrFn(() => callback)),
        roAttr('second', reference('Function'), attrFn(() => callback)),
      ],
    });
    const realm = new Realm();
    const bindings = new BindingWorld([definition]);
    bindings.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => object;
    const first = new Constructor();
    const second = new Constructor();
    const function_ = Reflect.get(first, 'first') as CallableFunction;

    expect(function_).toBe(Reflect.get(first, 'first'));
    expect(function_).toBe(Reflect.get(second, 'first'));
    expect(function_).not.toBe(Reflect.get(first, 'second'));
    expect(function_).toBeInstanceOf(realm.intrinsics.function);
    expect(function_.name).toBe('first');
    expect(function_.length).toBe(callback.length);
    expect(Object.hasOwn(function_, 'prototype')).toBe(false);
    expect(() => { Reflect.construct(function_, []); }).toThrow(TypeError);
    const receiver = {};
    const argument = {};
    const result = Reflect.apply(function_, receiver, [argument, 7, 'extra']) as {
      receiver: unknown; args: unknown[];
    };
    expect(result.receiver).toBe(receiver);
    expect(result.args).toEqual([argument, 7, 'extra']);
    expect(result.args[0]).toBe(argument);
    expect(Reflect.apply(function_, undefined, [])).toEqual({ receiver: undefined, args: [] });
  });

  it('calls the declared setter of a function-valued attribute', () => {
    class AttributeFunctionImpl {}
    let assignedResult: unknown;
    const definition = defineInterface({
      name: 'AttributeFunction', exposed: '*', implementation: impl(AttributeFunctionImpl),
      members: [
        ctor(),
        attr('handler', reference('Function'), {
          ...attrFn(() => () => 1),
          ...onError('rethrow'),
          set(_context, value) { assignedResult = (value as () => unknown)(); },
        }),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      handler: () => number;
    };
    const object = new Constructor();
    const initial = object.handler;
    const replacement = () => 2;

    object.handler = replacement;

    expect(assignedResult).toBe(2);
    expect(object.handler).toBe(initial);
    expect(object.handler()).toBe(1);
  });

  it('resolves shared mixin members through each including implementation', () => {
    class FirstImpl {
      #value = 'first';
      get value(): string { return this.#value; }
      read(): string { return this.#value; }
    }
    class SecondImpl {
      #value = 'second';
      get value(): string { return this.#value; }
      read(): string { return this.#value; }
    }
    const common = defineInterfaceMixin({
      name: 'Common',
      members: [
        roAttr('value', idlType.DOMString),
        op('read', idlType.DOMString),
      ],
    });
    const first = defineInterface({
      name: 'First',
      exposed: 'Window',
      implementation: impl(FirstImpl),
      members: [ctor()],
    });
    const second = defineInterface({
      name: 'Second',
      exposed: 'Window',
      implementation: impl(SecondImpl),
      members: [ctor()],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([
        common,
        first,
        second,
        defineIncludes({ interface: first.name, mixin: common.name }),
        defineIncludes({ interface: second.name, mixin: common.name }),
      ]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const First = Reflect.get(realm.global, first.name) as new() => FirstImpl;
    const Second = Reflect.get(realm.global, second.name) as new() => SecondImpl;

    expect(new First().value).toBe('first');
    expect(new Second().value).toBe('second');
    expect(new First().read()).toBe('first');
    expect(new Second().read()).toBe('second');
  });

  it('constructs declared implementations with converted arguments and newTarget', () => {
    class AutomaticConstructorImpl {
      #value: string;

      constructor(value: string) {
        this.#value = value;
      }

      get value(): string {
        return this.#value;
      }
    }

    const interfaceIDL = defineInterface({
      name: 'AutomaticConstructor',
      exposed: ['Window'],
      implementation: impl(AutomaticConstructorImpl),
      members: [
        ctor([arg('value', idlType.DOMString)]),
        roAttr('value', idlType.DOMString),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const AutomaticConstructor = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as new(value: unknown) => { value: string; };
    class Derived extends AutomaticConstructor {}
    let conversions = 0;
    const input = {
      toString() {
        conversions++;
        return 'converted';
      },
    };

    const instance = new Derived(input);
    const implementation = getImplementationObject(instance);

    expect(instance).toBeInstanceOf(Derived);
    expect(Object.getPrototypeOf(instance)).toBe(Derived.prototype);
    expect(instance).not.toBe(implementation);
    expect(instance).not.toBeInstanceOf(AutomaticConstructorImpl);
    expect(implementation).toBeInstanceOf(AutomaticConstructorImpl);
    expect(Object.getPrototypeOf(implementation))
      .toBe(AutomaticConstructorImpl.prototype);
    expect(instance.value).toBe('converted');
    expect(conversions).toBe(1);
  });

  it('binds implementation fields with IDL conversion and readonly exposure', () => {
    class FieldsImpl {
      count = 1;
      label = 'initial';
      next: FieldsImpl | null = null;
      optional: unknown = undefined;
      internal = 'implementation only';
    }
    const definition = defineInterface({
      name: 'Fields', exposed: '*', implementation: impl(FieldsImpl),
      members: [
        ctor(), attr('count', idlType.long), roAttr('label', idlType.DOMString),
        attr('next', nullable(reference('Fields'))), roAttr('optional', idlType.any),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Fields = Reflect.get(realm.global, definition.name) as new() => {
      count: number; label: string; next: object | null; optional: unknown;
    };
    const object = new Fields();
    const next = new Fields();
    const implementation = getImplementationObject(object);
    assert(implementation instanceof FieldsImpl);

    expect(object.count).toBe(1);
    expect(object.optional).toBeUndefined();
    Reflect.set(object, 'count', { valueOf: () => 7.9 });
    expect(implementation.count).toBe(7);
    expect(object.count).toBe(7);
    object.next = next;
    expect(implementation.next).toBe(getImplementationObject(next));
    expect(object.next).toBe(next);
    implementation.label = 'updated';
    expect(object.label).toBe('updated');
    expect(Reflect.set(object, 'label', 'author assignment')).toBe(false);
    expect(implementation.label).toBe('updated');
    expect(typeof Object.getOwnPropertyDescriptor(Fields.prototype, 'count')?.get).toBe('function');
    expect('internal' in object).toBe(false);
  });

  it('retains implementation accessors and supports static fields', () => {
    class BaseImpl {
      #value = 2;
      get value(): number { return this.#value * 2; }
      set value(value: number) { this.#value = value; }
    }
    class AttributesImpl extends BaseImpl {
      static label = 'initial';
      static get alias(): string { return this.label; }
    }
    const definition = defineInterface({
      name: 'Attributes', exposed: '*', implementation: impl(AttributesImpl),
      members: [
        ctor(), attr('value', idlType.long),
        attr('label', idlType.DOMString, { static: true }),
        roAttr('alias', idlType.DOMString, { static: true }),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Attributes = Reflect.get(realm.global, definition.name) as {
      new(): { value: number; }; label: string; alias: string;
    };
    const object = new Attributes();

    expect(object.value).toBe(4);
    object.value = 3;
    expect(object.value).toBe(6);
    Reflect.set(Attributes, 'label', { toString: () => 'updated' });
    expect(AttributesImpl.label).toBe('updated');
    expect(Attributes.label).toBe('updated');
    expect(Attributes.alias).toBe('updated');
  });

  it('reports missing implementation fields when an attribute is accessed', () => {
    class MissingImpl {}
    const definition = defineInterface({
      name: 'Missing', exposed: '*', implementation: impl(MissingImpl),
      members: [ctor(), attr('value', idlType.long)],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Missing = Reflect.get(realm.global, definition.name) as new() => { value: number; };
    const object = new Missing();

    expect(() => object.value).toThrow('Web IDL attribute value has no implementation');
    expect(() => { object.value = 1; }).toThrow('Web IDL attribute value has no implementation');
  });

  it('injects contextual dependencies into an empty constructor', () => {
    const token = Symbol('context-created');
    class ContextCreatedImpl {
      constructor(public value: symbol) {}
    }
    const interfaceIDL = defineInterface({
      name: 'ContextCreated',
      exposed: 'Window',
      implementation: impl(ContextCreatedImpl, {
        constructWith: [atArg(0, () => token)],
      }),
      members: [ctor()],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const ContextCreated = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as InterfaceConstructor;

    const instance = new ContextCreated() as ContextCreatedImpl;
    const implementation = getImplementationObject(instance) as ContextCreatedImpl | undefined;

    expect(implementation?.value).toBe(token);
    expect(Reflect.get(instance, 'value')).toBeUndefined();
  });

  it('constructs implementations with realm-created dependencies', () => {
    class DependencyImpl {}
    class OwnerImpl {
      #dependency: DependencyImpl;

      constructor(dependency: DependencyImpl) {
        this.#dependency = dependency;
      }

      get dependency(): DependencyImpl {
        return this.#dependency;
      }
    }
    const dependencyIDL = defineInterface({
      name: 'Dependency',
      exposed: 'Window',
      implementation: impl(DependencyImpl),
      members: [],
    });
    const ownerIDL = defineInterface({
      name: 'Owner',
      exposed: 'Window',
      implementation: impl(OwnerImpl),
      members: [
        ctor(
          [],
          { constructWith: [atArg(0, (ctx) => ctx.construct(DependencyImpl))] },
        ),
        roAttr('dependency', reference(dependencyIDL.name)),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([dependencyIDL, ownerIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const Owner = Reflect.get(
      realm.global,
      ownerIDL.name,
    ) as InterfaceConstructor;
    const Dependency = Reflect.get(
      realm.global,
      dependencyIDL.name,
    ) as InterfaceConstructor;

    const owner = new Owner() as { dependency: object; };

    expect(owner.dependency).toBeInstanceOf(Dependency);
  });

  it('constructs implementations with contextual dependencies', () => {
    type Environment = { global: object; };
    class ContextualDependencyImpl {
      #env: Environment;
      #value: string;

      constructor(
        value: string | undefined,
        env: Environment,
      ) {
        this.#env = env;
        this.#value = value ?? 'created';
      }

      get env(): Environment {
        return this.#env;
      }

      get value(): string {
        return this.#value;
      }

      static create(result: ContextualDependencyImpl) {
        return result;
      }
    }
    const interfaceIDL = defineInterface({
      name: 'ContextualDependency',
      exposed: 'Window',
      implementation: impl(ContextualDependencyImpl, {
        constructWith: [atArg(1, (ctx) => ({ global: ctx.realm.global }))],
      }),
      members: [
        ctor([arg('value', idlType.DOMString)]),
        staticOp('create', reference('ContextualDependency'),
          [],
          invokeWith(atArg(0, (ctx) => ctx.construct(ContextualDependencyImpl))),
        ),
        roAttr('env', idlType.object),
        roAttr('value', idlType.DOMString),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const ContextualDependency = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as {
      create(): ContextualDependencyImpl;
      new(value: unknown): ContextualDependencyImpl;
    };

    const constructed = new ContextualDependency('explicit');
    const created = ContextualDependency.create();

    expect(constructed.env.global).toBe(realm.global);
    expect(constructed.value).toBe('explicit');
    expect(created.env.global).toBe(realm.global);
    expect(created.value).toBe('created');
  });

  it('injects the current global into new operation results', () => {
    class ResultImpl {
      #global: object;

      constructor(global: object) {
        this.#global = global;
      }

      static create(result: ResultImpl): ResultImpl {
        return result;
      }

      get global(): object {
        return this.#global;
      }
    }
    const resultIDL = defineInterface({
      name: 'Result',
      exposed: 'Window',
      implementation: impl(ResultImpl, {
        constructWith: [atArg(0, (ctx) => ctx.realm.global)],
      }),
      members: [
        staticOp('create', reference('Result'),
          [],
          invokeWith(atArg(0, (ctx) => ctx.construct(ResultImpl))),
        ),
        roAttr('global', idlType.object),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([resultIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const Result = Reflect.get(realm.global, resultIDL.name) as {
      create(): { global: object; };
    };

    const result = Result.create();

    expect(result.global).toBe(realm.global);
  });

  it('projects nested implementation results without exposing their identity', async () => {
    class NestedResultImpl {
      #label: string;

      constructor(label: string) {
        this.#label = label;
      }

      get label(): string {
        return this.#label;
      }
    }
    class NestedResultOwnerImpl {}

    const nestedResultIDL = defineInterface({
      name: 'NestedResult',
      exposed: 'Window',
      implementation: impl(NestedResultImpl),
      members: [roAttr('label', idlType.DOMString)],
    });
    const resultType = implementationType<unknown>(reference(nestedResultIDL.name));
    const nestedResultCallbackIDL = defineCallbackFunction({
      name: 'NestedResultCallback',
      returns: idlType.undefined,
      arguments: [
        arg('direct', resultType),
        arg('union', union(resultType, idlType.DOMString)),
      ],
    });
    const resultDictionaryIDL = defineDictionary({
      name: 'NestedResultDictionary',
      members: [
        dictMember('first', resultType),
        dictMember('second', resultType),
      ],
    });
    const implementations = new Map<string, NestedResultImpl>();
    const createResult = (label: string): NestedResultImpl => {
      const value = new NestedResultImpl(label);
      implementations.set(label, value);
      return value;
    };
    const ownerIDL = defineInterface({
      name: 'NestedResultOwner',
      exposed: 'Window',
      implementation: impl(NestedResultOwnerImpl),
      members: [
        ctor(),
        op('nullableResult', nullable(resultType),
          [],
          {
            invoke() { return createResult('nullable'); },
          },
        ),
        op('unionResult', union(resultType, idlType.DOMString),
          [],
          {
            invoke() { return createResult('union'); },
          },
        ),
        op('sequenceResult', sequence(resultType),
          [],
          {
            invoke() {
              const value = createResult('sequence');
              return [value, value];
            },
          },
        ),
        op('dictionaryResult', reference(resultDictionaryIDL.name),
          [],
          {
            invoke() {
              const value = createResult('dictionary');
              return { first: value, second: value };
            },
          },
        ),
        op('createdPromiseResult', promiseType(resultType),
          [],
          {
            invoke(context) {
              return context.Promise.resolve(createResult('created promise'), resultType);
            },
          },
        ),
        op('resolvedPromiseResult', promiseType(resultType),
          [],
          {
            invoke(context) {
              const result = context.Promise.withResolvers(resultType);
              result.resolve(createResult('resolved promise'));
              return result.promise;
            },
          },
        ),
        op('reactedPromiseResult', promiseType(resultType),
          [],
          {
            invoke(context) {
              return context.Promise.resolve(undefined, idlType.undefined).then(() => createResult('reacted promise'), undefined, resultType);
            },
          },
        ),
        op('callbackArguments', idlType.undefined,
          [
            arg('callback', reference(nestedResultCallbackIDL.name),
              onError('rethrow'),
            ),
          ],
          {
            invoke(_context, callback) {
              (callback as (
                direct: NestedResultImpl,
                union: NestedResultImpl,
              ) => void)(
                createResult('callback direct'),
                createResult('callback union'),
              );
            },
          },
        ),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([
        nestedResultIDL,
        nestedResultCallbackIDL,
        resultDictionaryIDL,
        ownerIDL,
      ]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    type NestedResult = { label: string; };
    const NestedResultOwner = Reflect.get(realm.global, ownerIDL.name) as {
      new(): {
        callbackArguments(
          callback: (
            direct: NestedResult,
            union: NestedResult | string,
          ) => void,
        ): void;
        createdPromiseResult(): Promise<NestedResult>;
        dictionaryResult(): { first: NestedResult; second: NestedResult; };
        nullableResult(): NestedResult | null;
        reactedPromiseResult(): Promise<NestedResult>;
        resolvedPromiseResult(): Promise<NestedResult>;
        sequenceResult(): NestedResult[];
        unionResult(): NestedResult | string;
      };
    };
    const owner = new NestedResultOwner();
    const expectProjection = (label: string, object: NestedResult): void => {
      const implementation = implementations.get(label);
      expect(implementation).toBeInstanceOf(NestedResultImpl);
      expect(object).not.toBe(implementation);
      expect(getImplementationObject(object))
        .toBe(implementation);
      expect(object.label).toBe(label);
    };

    const nullableResult = owner.nullableResult();
    if (!nullableResult) throw new Error('Missing nullable result');
    expectProjection('nullable', nullableResult);

    const unionResult = owner.unionResult();
    if (typeof unionResult === 'string') throw new Error('Wrong union result');
    expectProjection('union', unionResult);

    const sequenceResult = owner.sequenceResult();
    expect(sequenceResult[0]).toBe(sequenceResult[1]);
    expectProjection('sequence', sequenceResult[0]!);

    const dictionaryResult = owner.dictionaryResult();
    expect(dictionaryResult.first).toBe(dictionaryResult.second);
    expectProjection('dictionary', dictionaryResult.first);

    expectProjection(
      'created promise',
      await owner.createdPromiseResult(),
    );
    expectProjection(
      'resolved promise',
      await owner.resolvedPromiseResult(),
    );
    expectProjection(
      'reacted promise',
      await owner.reactedPromiseResult(),
    );

    owner.callbackArguments((direct, unionResult) => {
      expectProjection('callback direct', direct);
      if (typeof unionResult === 'string') {
        throw new Error('Wrong callback union value');
      }
      expectProjection('callback union', unionResult);
    });
  });

  it('declaratively connects an implementation to its interface behavior', () => {
    const realm = new Realm();
    const constructor = ctor(
      [arg('value', idlType.DOMString)],
      {
        invoke(context, value) {
          DeclarativeExampleImpl.initialize(
            this as DeclarativeExampleImpl,
            String(value),
          );
          expect(context.realm).toBe(realm);
        },
      },
    );
    const parse = staticOp('parse', idlType.DOMString,
      [
        arg('value', idlType.DOMString),
      ],
      {
        invoke(context, value) {
          expect(context.realm).toBe(realm);
          return `bound:${String(value)}`;
        },
      },
    );
    const interfaceIDL = defineInterface({
      name: 'DeclarativeExample',
      exposed: 'Window',
      implementation: impl(DeclarativeExampleImpl, {
        constructWith: [atArg(0, () => constructionToken)],
      }),
      members: [
        constructor,
        attr('value', idlType.DOMString),
        op('append', idlType.undefined, [arg('value', idlType.DOMString)]),
        parse,
        iter(idlType.DOMString, {
          key: idlType.DOMString,
        }),
        stringifier(),
      ],
    });
    const assembly = new DefinitionAssembly([interfaceIDL]);

    const binding = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    const installed = binding.install();
    const DeclarativeExample = installed.get('DeclarativeExample');
    if (typeof DeclarativeExample !== 'function') {
      throw new Error('DeclarativeExample was not installed');
    }
    const instance = Reflect.construct(DeclarativeExample, ['start']) as {
      append(value: string): void;
      value: string;
    };

    instance.append(':end');

    expect(instance.value).toBe('start:end');
    expect([...instance as unknown as Iterable<[string, string]>]).toEqual([
      ['value', 'start:end'],
    ]);
    expect(Reflect.apply(
      Reflect.get(instance, 'toString') as CallableFunction,
      instance,
      [],
    )).toBe('start:end');
    expect(Reflect.apply(
      Reflect.get(DeclarativeExample, 'parse') as CallableFunction,
      DeclarativeExample,
      ['input'],
    )).toBe('bound:input');
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
    const assembly = new DefinitionAssembly([settings, interfaceIDL]);

    const realm = new Realm();
    const binding = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
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

  it('projects implementation-provided callbacks without invoking their property traps', () => {
    const callback = new Proxy(() => 1, {
      get() { throw new Error('Unexpected callback property read'); },
      has() { throw new Error('Unexpected callback property check'); },
    });
    class CallbackOwnerImpl {
      callback = callback;
      callbackUnion = callback;
    }
    const result = defineCallbackFunction({ name: 'Result', returns: idlType.long, arguments: [] });
    const definition = defineInterface({
      name: 'CallbackOwner', exposed: ['Window'], implementation: impl(CallbackOwnerImpl),
      members: [
        ctor([]),
        roAttr('callback', reference(result.name)),
        roAttr('callbackUnion', union(idlType.DOMString, reference(result.name))),
      ],
    });
    const realm = new Realm();
    new BindingWorld([result, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, 'CallbackOwner') as new() => {
      callback: unknown; callbackUnion: unknown;
    };
    const owner = new Constructor();
    expect(owner.callback).toBe(callback);
    expect(owner.callbackUnion).toBe(callback);
  });

  it('projects callbacks whose return type is the same callback type', () => {
    type Next = () => Next;
    class RecursiveCallbacksImpl {
      next(callback: Next): Next { return callback(); }
    }
    const callback = defineCallbackFunction({
      name: 'Next', returns: reference('Next'), arguments: [],
    });
    const definition = defineInterface({
      name: 'RecursiveCallbacks', exposed: '*', implementation: impl(RecursiveCallbacksImpl),
      members: [
        ctor(),
        op('next', reference(callback.name), [arg('callback', reference(callback.name), onError('rethrow'))]),
      ],
    });
    const realm = new Realm();
    new BindingWorld([callback, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => { next(callback: Next): Next; };
    const next: Next = () => next;
    expect(new Constructor().next(next)).toBe(next);
  });

  it('projects callback functions into ordinary implementation callables', () => {
    type Increment = (this: unknown, value: number) => number;
    type CallbackOptions = { callback: Increment; };

    class CallbackProjectionImpl {
      #callback: Increment | null = null;

      get nativeCallback(): Increment {
        return (value) => value + 2;
      }

      get nativeCallbackUnion(): Increment {
        return (value) => value + 3;
      }

      get callback(): Increment {
        if (!this.#callback) throw new Error('Callback has not been set');
        return this.#callback;
      }

      get callbackUnion(): string | Increment {
        return this.callback;
      }

      invoke(
        callback: Increment,
        value: number,
        thisArgument: object,
      ): number {
        this.#callback = callback;
        return Reflect.apply(callback, thisArgument, [value]);
      }

      invokeUnion(callback: string | Increment): number {
        return typeof callback === 'string'
          ? callback.length
          : callback(2);
      }

      invokeDictionary(options: CallbackOptions): number {
        return options.callback(3);
      }

      invokeSequence(callbacks: Increment[]): number {
        return callbacks.reduce((sum, callback) =>
          sum + callback(sum), 0);
      }

      invokeRecord(
        callbacks: Readonly<Record<string, Increment>>,
      ): number {
        return Object.values(callbacks).reduce((sum, callback) =>
          sum + callback(sum), 0);
      }

      preserveAny(value: unknown): unknown {
        return value;
      }

      report(callback: () => void): void {
        callback();
      }

      rethrow(callback: () => void): void {
        callback();
      }

      construct(callback: StampedCallbackFunction, realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(callback).construct([4], realm);
      }
    }

    const increment = defineCallbackFunction({
      name: 'Increment',
      returns: idlType.long,
      arguments: [arg('value', idlType.long)],
    });
    const voidCallback = defineCallbackFunction({
      name: 'VoidCallback',
      returns: idlType.undefined,
      arguments: [],
    });
    const factory = defineCallbackFunction({
      name: 'Factory',
      returns: idlType.any,
      arguments: [arg('value', idlType.long)],
    });
    const callbackOrString = defineTypedef({
      name: 'CallbackOrString',
      type: union(idlType.DOMString, reference(increment.name)),
    });
    const callbackOptions = defineDictionary({
      name: 'CallbackOptions',
      members: [dictMember('callback', reference(increment.name),
        { ...onError('rethrow'), required: true },
      )],
    });
    const interfaceIDL = defineInterface({
      name: 'CallbackProjection',
      exposed: ['Window'],
      implementation: impl(CallbackProjectionImpl),
      members: [
        ctor([], { invoke() {} }),
        roAttr('callback', reference(increment.name)),
        roAttr('callbackUnion', reference(callbackOrString.name)),
        roAttr('nativeCallback', reference(increment.name)),
        roAttr('nativeCallbackUnion', reference(callbackOrString.name)),
        op('invoke', idlType.long, [
          arg('callback', reference(increment.name),
            onError('rethrow'),
          ),
          arg('value', idlType.long),
          arg('thisArgument', idlType.object),
        ]),
        op('invokeUnion', idlType.long, [
          arg('callback', reference(callbackOrString.name),
            onError('rethrow'),
          ),
        ]),
        op('invokeDictionary', idlType.long, [
          arg('options', reference(callbackOptions.name)),
        ]),
        op('invokeSequence', idlType.long, [
          arg('callbacks', sequence(reference(increment.name)),
            onError('rethrow'),
          ),
        ]),
        op('invokeRecord', idlType.long, [
          arg('callbacks', record(idlType.DOMString, reference(increment.name)),
            onError('rethrow'),
          ),
        ]),
        op('preserveAny', idlType.any, [arg('value', idlType.any)]),
        op('report', idlType.undefined, [
          arg('callback', reference(voidCallback.name),
            onError('report'),
          ),
        ]),
        op('rethrow', idlType.undefined, [
          arg('callback', reference(voidCallback.name),
            onError('rethrow'),
          ),
        ]),
        op('construct', idlType.any,
          [arg('callback', reference(factory.name))],
          invokeWith(atArg(1, (_receiver, method) => method.realm)),
        ),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([
        increment,
        voidCallback,
        factory,
        callbackOrString,
        callbackOptions,
        interfaceIDL,
      ]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const CallbackProjection = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as new() => {
      callback: unknown;
      callbackUnion: unknown;
      construct(callback: unknown): unknown;
      invoke(callback: unknown, value: number, thisArgument: object): number;
      invokeDictionary(options: { callback: unknown; }): number;
      invokeRecord(callbacks: Record<string, unknown>): number;
      invokeSequence(callbacks: unknown[]): number;
      invokeUnion(callback: unknown): number;
      nativeCallback: (value: number) => number;
      nativeCallbackUnion: (value: number) => number;
      preserveAny(value: unknown): unknown;
      report(callback: unknown): void;
      rethrow(callback: unknown): void;
    };
    const instance = new CallbackProjection();
    const expectedThis = {};
    let receivedExpectedThis = false;
    const callback = function(this: unknown, value: number) {
      receivedExpectedThis = this === expectedThis;
      return value + 1;
    };

    expect(instance.invoke(callback, 4.8, expectedThis)).toBe(5);
    expect(receivedExpectedThis).toBe(true);
    expect(instance.callback).toBe(callback);
    expect(instance.callbackUnion).toBe(callback);
    expect(instance.nativeCallback(4)).toBe(6);
    expect(instance.nativeCallbackUnion(4)).toBe(7);
    expect(instance.invokeUnion(callback)).toBe(3);
    expect(instance.invokeUnion('word')).toBe(4);
    expect(instance.invokeDictionary({ callback })).toBe(4);
    expect(instance.invokeSequence([callback, callback])).toBe(3);
    expect(instance.invokeRecord({ first: callback, second: callback }))
      .toBe(3);
    const array = [callback];
    const map = new Map([['callback', callback]]);
    expect(instance.preserveAny(array)).toBe(array);
    expect(instance.preserveAny(map)).toBe(map);

    const exception = new Error('callback failure');
    expect(() => instance.invoke(
      () => { throw exception; },
      0,
      expectedThis,
    )).toThrow(exception);
    expect(() => instance.rethrow(() => { throw exception; }))
      .toThrow(exception);
    const reportException = vi.spyOn(realm, 'reportException')
      .mockImplementation(() => {});
    expect(() => instance.report(() => { throw exception; })).not.toThrow();
    expect(reportException).toHaveBeenCalledExactlyOnceWith(exception);

    function Constructed(this: { value?: number; }, value: number) {
      this.value = value;
    }
    expect(instance.construct(Constructed)).toMatchObject({ value: 4 });
  });

  it('constructs adapted callbacks whose converted result is a primitive', () => {
    class FactoryOwnerImpl {
      construct(callback: StampedCallbackFunction, realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(callback).construct([4], realm);
      }
    }
    const factory = defineCallbackFunction({
      name: 'NumberFactory', returns: idlType.double,
      arguments: [arg('value', idlType.long)],
    });
    const definition = defineInterface({
      name: 'FactoryOwner', exposed: '*', implementation: impl(FactoryOwnerImpl),
      members: [
        ctor(),
        op('construct', idlType.double,
          [arg('callback', reference(factory.name))],
          invokeWith(atArg(1, (_receiver, method) => method.realm)),
        ),
      ],
    });
    const realm = new Realm();
    new BindingWorld([factory, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      construct(callback: (value: number) => object): number;
    };
    function Build(value: number) {
      expect(new.target).toBe(Build);
      return { valueOf: () => value + 2 };
    }

    expect(new Constructor().construct(Build)).toBe(6);
  });

  it('retains callback realms and captured contexts through explicit construction', () => {
    class FactoryOwnerImpl {
      construct(callback: StampedCallbackFunction, realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(callback).construct([4], realm);
      }
    }
    const factory = defineCallbackFunction({
      name: 'NumberFactory', returns: idlType.double,
      arguments: [arg('value', idlType.long)],
    });
    const definition = defineInterface({
      name: 'FactoryOwner', exposed: '*', implementation: impl(FactoryOwnerImpl),
      members: [
        ctor(),
        op('construct', idlType.double,
          [arg('callback', reference(factory.name))],
          invokeWith(atArg(1, (_receiver, method) => method.realm)),
        ),
      ],
    });
    const realm = new Realm();
    const callbackRealm = new Realm();
    new BindingWorld([factory, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => { construct(callback: unknown): number; };
    const owner = new Constructor();
    const prototypeReads = { count: 0 };
    Reflect.set(callbackRealm.global, 'prototypeReads', prototypeReads);
    const callback = callbackRealm.evaluate(`new Proxy(function Build(value) {
      return { valueOf: () => globalThis.fail ? Infinity : value };
    }, {
      get(target, property, receiver) {
        if (property === 'prototype') prototypeReads.count++;
        return Reflect.get(target, property, receiver);
      }
    })`, 'adapted-constructor.js');
    const firstContext = {};
    const secondContext = {};
    vi.spyOn(realm.callbacks, 'captureContext').mockReturnValueOnce(firstContext).mockReturnValueOnce(secondContext);
    const prepareScript = vi.spyOn(callbackRealm.callbacks, 'prepareToRunScript');
    const cleanScript = vi.spyOn(callbackRealm.callbacks, 'cleanUpAfterRunningScript');
    const prepareCallback = vi.spyOn(callbackRealm.callbacks, 'prepareToRunCallback');
    const cleanCallback = vi.spyOn(callbackRealm.callbacks, 'cleanUpAfterRunningCallback');

    expect(owner.construct(callback)).toBe(4);
    expect(prototypeReads.count).toBe(1);
    Reflect.set(callbackRealm.global, 'fail', true);
    expect(() => owner.construct(callback)).toThrow(callbackRealm.intrinsics.typeError);
    expect(prototypeReads.count).toBe(2);
    expect(prepareCallback.mock.calls).toEqual([[firstContext], [secondContext]]);
    expect(cleanCallback.mock.calls).toEqual(prepareCallback.mock.calls);
    expect(prepareScript).toHaveBeenCalledTimes(2);
    expect(cleanScript).toHaveBeenCalledTimes(2);

    const arrow = callbackRealm.evaluate('() => ({})', 'adapted-non-constructor.js');
    expect(() => owner.construct(arrow)).toThrow(realm.intrinsics.typeError);
    expect(prepareScript).toHaveBeenCalledTimes(2);
  });

  it('uses the construction method realm when a retained callback is not a constructor', () => {
    class FactoryOwnerImpl {
      constructor(public callback: StampedCallbackFunction) {}

      construct(realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(this.callback).construct([], realm);
      }
    }
    const factory = defineCallbackFunction({ name: 'Factory', returns: idlType.any, arguments: [] });
    const definition = defineInterface({
      name: 'FactoryOwner', exposed: '*', implementation: impl(FactoryOwnerImpl),
      members: [
        ctor([arg('callback', reference(factory.name))]),
        op('construct', idlType.any, [], invokeWith(atArg(0, (_receiver, method) => method.realm))),
      ],
    });
    const conversionRealm = new Realm();
    const constructionRealm = new Realm();
    const callbackRealm = new Realm();
    const world = new BindingWorld([factory, definition]);
    world.register(conversionRealm, (ctx) => ({ realm: ctx.realm })).install(conversionRealm.global);
    world.register(constructionRealm, (ctx) => ({ realm: ctx.realm })).install(constructionRealm.global);
    type FactoryOwner = { construct(): unknown; };
    const Constructor = Reflect.get(conversionRealm.global, definition.name) as {
      new(callback: unknown): FactoryOwner;
      prototype: FactoryOwner;
    };
    const OtherConstructor = Reflect.get(constructionRealm.global, definition.name) as typeof Constructor;
    const arrow = callbackRealm.evaluate('() => ({})', 'retained-non-constructor.js');
    const owner = new Constructor(arrow);
    const prepareScript = vi.spyOn(callbackRealm.callbacks, 'prepareToRunScript');

    // The callback is not converted again when another realm's method constructs it.
    // https://webidl.spec.whatwg.org/#construct-a-callback-function
    expect(() => OtherConstructor.prototype.construct.call(owner)).toThrow(constructionRealm.intrinsics.typeError);
    expect(prepareScript).not.toHaveBeenCalled();
  });

  it('provides platform-object capabilities through declarative bindings', () => {
    class ProductImpl {
      #value: string;

      constructor(value = '') {
        this.#value = value;
      }

      static copy(value: unknown): ProductImpl {
        if (
          value === null ||
          typeof value !== 'object' ||
          !(#value in value)
        ) {
          throw new TypeError('Value is not a Product');
        }
        return new ProductImpl(value.#value);
      }

      static initialize(value: ProductImpl, input: string): void {
        value.#value = input;
      }

      static namedItem(value: ProductImpl, name: string): string {
        return name === 'label' ? value.#value : '';
      }

      get value(): string {
        return this.#value;
      }

      set value(value: string) {
        this.#value = value;
      }
    }

    const interfaceIDL = defineInterface({
      name: 'Product',
      exposed: ['Window'],
      implementation: impl(ProductImpl),
      members: [
        ctor(
          [arg('value', idlType.DOMString)],
          {
            invoke(_context, value) {
              ProductImpl.initialize(this as ProductImpl, String(value));
            },
          },
        ),
        attr('value', idlType.DOMString),
        op('namedItem', idlType.DOMString,
          [
            arg('name', idlType.DOMString),
          ],
          {
            special: 'getter',
            getSupportedPropertyNames() {
              return new Set(['label']);
            },
            invoke(_context, name) {
              return ProductImpl.namedItem(
                this as ProductImpl,
                String(name),
              );
            },
          },
        ),
        staticOp('copy', reference('Product'),
          [
            arg('value', idlType.any, unwrapArg(ProductImpl)),
          ],
        ),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const Product = Reflect.get(realm.global, 'Product') as {
      new(value: string): { value: string; };
      copy(value: unknown): { value: string; };
    };
    const original = new Product('original');

    const copy = Product.copy(original);

    expect(Reflect.get(original, 'label')).toBe('original');
    expect(copy).toBeInstanceOf(Product);
    expect(copy).not.toBe(original);
    expect(copy.value).toBe('original');
    expect(() => Product.copy({ value: 'impostor' })).toThrow(TypeError);
  });

  it.each([null, undefined])('uses an explicit %s result for unsupported indices', (unsupportedValue) => {
    class CollectionImpl {
      item(index: number): string | null | undefined {
        return index === 2 ? 'second' : unsupportedValue;
      }
    }

    const definition = defineInterface({
      name: 'Collection', exposed: '*', implementation: impl(CollectionImpl),
      members: [
        ctor(),
        op('item', idlType.any,
          [arg('index', idlType.unsignedLong)],
          indexedGetter(() => [2], { unsupportedValue }),
        ),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Collection = Reflect.get(realm.global, 'Collection') as new() => {
      item(index: number): string | null | undefined;
      [index: number]: string | undefined;
    };
    const collection = new Collection();

    expect(collection[2]).toBe('second');
    expect(collection[0]).toBeUndefined();
    expect(collection.item(0)).toBe(unsupportedValue);
    expect(Reflect.has(collection, '2')).toBe(true);
    expect(Reflect.has(collection, '0')).toBe(false);
    expect(Object.keys(collection)).toEqual(['2']);
    expect(Reflect.deleteProperty(collection, '2')).toBe(false);
    expect(Reflect.deleteProperty(collection, '0')).toBe(true);

    Object.defineProperty(Collection.prototype, '0', { value: 'inherited' });
    expect(collection[0]).toBe('inherited');
    expect(Object.hasOwn(collection, '0')).toBe(false);
    expect(collection.item(0)).toBe(unsupportedValue);
  });

  it('uses an index predicate when supported entries can be null or undefined', () => {
    class CollectionImpl {
      values = new Map<number, unknown>([[3, null], [0, undefined]]);

      item(index: number): unknown {
        if (!this.values.has(index)) throw new Error('Unsupported index');
        return this.values.get(index);
      }
    }

    const definition = defineInterface({
      name: 'Collection', exposed: '*', implementation: impl(CollectionImpl),
      members: [
        ctor(),
        op('item', idlType.any,
          [arg('index', idlType.unsignedLong)],
          indexedGetter(
            (collection: CollectionImpl) => collection.values.keys(),
            { supportsIndex: (collection, index) => collection.values.has(index) },
          ),
        ),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Collection = Reflect.get(realm.global, 'Collection') as new() => object;
    const collection = new Collection();

    expect(Reflect.get(collection, '3')).toBeNull();
    expect(Object.hasOwn(collection, '3')).toBe(true);
    expect(Object.hasOwn(collection, '0')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(collection, '0')?.value).toBeUndefined();
    expect(Reflect.get(collection, '1')).toBeUndefined();
    expect(Object.hasOwn(collection, '1')).toBe(false);
    expect(Reflect.ownKeys(collection)).toEqual(['0', '3']);
    expect(Reflect.deleteProperty(collection, '0')).toBe(false);
    expect(Reflect.deleteProperty(collection, '1')).toBe(true);
  });

  it('combines declarative legacy hooks with automatic operation binding', () => {
    class CollectionImpl {
      values = ['first', 'second'];

      item(index: number): string | null {
        return this.values[index] ?? null;
      }

      namedItem(name: string): string | null {
        return name === 'first' ? this.values[0]! : null;
      }
    }

    const collectionIDL = defineInterface({
      name: 'Collection',
      exposed: 'Window',
      implementation: impl(CollectionImpl),
      members: [
        ctor(),
        op('item', nullable(idlType.DOMString),
          [arg('index', idlType.unsignedLong)],
          indexedGetter(
            (collection: CollectionImpl) => collection.values.keys(),
            { unsupportedValue: null },
          ),
        ),
        op('namedItem', nullable(idlType.DOMString),
          [arg('name', idlType.DOMString)],
          namedGetter(() => new Set(['first'])),
        ),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([collectionIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const Collection = Reflect.get(realm.global, collectionIDL.name) as {
      new(): {
        [index: number]: string;
        [name: string]: unknown;
        item(index: number): string | null;
        namedItem(name: string): string | null;
      };
    };

    const collection = new Collection();

    expect(collection.item(1)).toBe('second');
    expect(collection.namedItem('first')).toBe('first');
    expect(collection[1]).toBe('second');
    expect(collection.first).toBe('first');
  });

  it('runs inherited interface lifecycle steps from parent to child', () => {
    const contexts: object[] = [];
    const lifecycle: string[] = [];
    const realm = new Realm();
    const parentIDL = defineInterface({
      name: 'ParentLifecycle',
      exposed: ['Window'],
      implementation: impl(ParentLifecycleImpl, {
        initializeImplementation(context, value) {
          expect(context.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          contexts.push(context);
          lifecycle.push('parent');
        },
      }),
      members: [],
    });
    const childIDL = defineInterface({
      name: 'ChildLifecycle',
      inherits: 'ParentLifecycle',
      exposed: ['Window'],
      implementation: impl(ChildLifecycleImpl, {
        initializeImplementation(context, value) {
          expect(context.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          contexts.push(context);
          lifecycle.push('child');
        },
      }),
      members: [{
        arguments: [],
        invoke() {},
        kind: 'constructor',
      }],
    });
    const assembly = new DefinitionAssembly([parentIDL, childIDL]);
    const binding = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const ChildLifecycle = Reflect.get(
      realm.global,
      'ChildLifecycle',
    ) as InterfaceConstructor;

    const object = new ChildLifecycle();

    expect(object).toBeInstanceOf(ChildLifecycle);
    expect(contexts[0]).toBe(contexts[1]);
    expect(lifecycle).toEqual(['parent', 'child']);
  });

  it.each(['construct', 'project'] as const)('runs inherited initializers once through %s', (path) => {
    class ParentImpl {}
    class ChildImpl extends ParentImpl {}
    const calls: string[] = [];
    const world = new BindingWorld([
      defineInterface({
        name: 'Parent', exposed: '*', members: [], implementation: impl(ParentImpl, {
          initializeImplementation() { calls.push('parent'); },
        }),
      }),
      defineInterface({
        name: 'Child', exposed: '*', inherits: 'Parent', members: [], implementation: impl(ChildImpl, {
          initializeImplementation() { calls.push('child'); },
        }),
      }),
    ]);
    const ctx = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const child = path === 'construct' ? ctx.construct(ChildImpl) : new ChildImpl();
    if (path === 'construct') expect(calls).toEqual(['parent', 'child']);
    const platform = ctx.project(ChildImpl, child);
    expect(ctx.project(ChildImpl, child)).toBe(platform);
    expect(calls).toEqual(['parent', 'child']);
  });

  it('does not retain an incomplete record when initialization throws', () => {
    class ExampleImpl {}
    let ready = false;
    const failure = new Error('Initializer is not ready');
    const world = new BindingWorld([
      defineInterface({
        name: 'Example', exposed: '*', members: [], implementation: impl(ExampleImpl, {
          initializeImplementation() { if (!ready) throw failure; },
        }),
      }),
    ]);
    const ctx = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const instance = new ExampleImpl();
    expect(() => ctx.project(ExampleImpl, instance)).toThrow(failure);
    expect(getImplementationRecord(instance) === undefined).toBe(true);
    ready = true;
    expect(ctx.project(ExampleImpl, instance)).toBe(getImplementationRecord(instance)?.platformObject);
  });

  it('keeps binding contexts distinct within the same realm', () => {
    const assembly = new DefinitionAssembly([]);
    const realm = new Realm();
    const first = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const second = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );

    const firstContext = first.context;
    const secondContext = second.context;
    registerDefinitionBindings(first);
    registerDefinitionBindings(second);

    expect(first.world.getRealmBinding(realm)?.context).toBe(firstContext);
    expect(second.world.getRealmBinding(realm)?.context).toBe(secondContext);
    expect(firstContext).not.toBe(secondContext);
  });

  it('materializes only requested DOMExceptions in the binding realm', () => {
    const arbitrary = new DOMException('arbitrary', 'AbortError');
    const interfaceIDL = defineInterface({
      name: 'ExceptionSource',
      exposed: ['Window'],
      implementation: impl(ExceptionSourceImpl),
      members: [
        ctor([], { invoke() {} }),
        staticOp('requested', idlType.undefined,
          [],
          {
            invoke() {
              throwDOMException('InvalidStateError', 'requested');
            },
          },
        ),
        staticOp('arbitrary', idlType.undefined,
          [],
          {
            invoke() { throw arbitrary; },
          },
        ),
      ],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([...webIDLCommonDefinitions, interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const ExceptionSource = Reflect.get(realm.global, 'ExceptionSource') as {
      new(): object;
      arbitrary(): void;
      requested(): void;
    };
    const DOMException_ = Reflect.get(realm.global, 'DOMException') as
      typeof DOMException;

    const requested = getThrown(() => ExceptionSource.requested());
    expect(requested).toBeInstanceOf(DOMException_);
    expect(requested).not.toBeInstanceOf(DOMException);
    expect(requested).toMatchObject({
      message: 'requested',
      name: 'InvalidStateError',
    });
    const creation = getThrown(() => new ExceptionSource());
    expect(creation).toBeInstanceOf(DOMException_);
    expect(creation).toMatchObject({
      message: 'creation requested',
      name: 'NotSupportedError',
    });
    expect(getThrown(() => ExceptionSource.arbitrary())).toBe(arbitrary);
  });
});

type InterfaceConstructor = new (...argumentsList: unknown[]) => object;

const constructionToken = Symbol('DeclarativeExample construction');

class DeclarativeExampleImpl {
  #value = '';

  constructor(token: symbol) {
    if (token !== constructionToken) throw new TypeError('Invalid construction');
  }

  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    this.#value = value;
  }

  append(value: string): void {
    this.#value += value;
  }

  static initialize(value: DeclarativeExampleImpl, input: string): void {
    value.#value = input;
  }

  getEntryList(): [string, string][] {
    return [['value', this.#value]];
  }

  toString(): string {
    return this.#value;
  }
}

class DictionaryAdapterImpl {}

class ParentLifecycleImpl {}

class ChildLifecycleImpl extends ParentLifecycleImpl {}

class ExceptionSourceImpl {
  constructor() {
    throwDOMException('NotSupportedError', 'creation requested');
  }
}

function getThrown(callback: () => unknown): unknown {
  try {
    callback();
  } catch (exception) {
    return exception;
  }
  throw new Error('Expected callback to throw');
}
