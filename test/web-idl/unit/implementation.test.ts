import { describe, expect, it, vi } from 'vitest';

import { Realm } from '../../../src/browlet/scripting/realm';
import { throwDOMException } from '../../../src/shared/dom-exception';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { webIDLCommonDefinitions } from '../../../src/web-idl/common-definitions';
import {
  arg, atArg, attr, callback as projectCallback, ctor,
  defineCallbackFunction, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, defineTypedef, dictMember, idlType, contextValue,
  impl, iter,
  op, roAttr, record, reference, resolveArgs, sequence, stringifier,
  union, withArgs, withNew,
} from '../../../src/web-idl/declaration/index';
import {
  bind, registerDefinitionBindings,
} from '../../../src/web-idl/projection';
import { ImplementationRegistry } from '../../../src/web-idl/registry';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL implementation registration', () => {
  it('resolves shared mixin members through each including implementation', () => {
    class FirstImpl {
      readonly #value = 'first';
      get value(): string { return this.#value; }
      read(): string { return this.#value; }
    }
    class SecondImpl {
      readonly #value = 'second';
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
    const binding = new JavaScriptBinding(
      assembleDefinitions([
        common,
        first,
        second,
        defineIncludes({ interface: first.name, mixin: common.name }),
        defineIncludes({ interface: second.name, mixin: common.name }),
      ]),
      realm,
      new PlatformObjectRegistry(),
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
      readonly #value: string;

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
    const binding = new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const AutomaticConstructor = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as new(value: unknown) => { readonly value: string; };
    class Derived extends AutomaticConstructor {}
    let conversions = 0;
    const input = {
      toString() {
        conversions++;
        return 'converted';
      },
    };

    const instance = new Derived(input);

    expect(instance).toBeInstanceOf(Derived);
    expect(Object.getPrototypeOf(instance)).toBe(Derived.prototype);
    expect(instance.value).toBe('converted');
    expect(conversions).toBe(1);
  });

  it('uses contextual creation for a declaration-only empty constructor', () => {
    const token = Symbol('context-created');
    class ContextCreatedImpl {
      constructor(readonly value: symbol) {}
    }
    const interfaceIDL = defineInterface({
      name: 'ContextCreated',
      exposed: 'Window',
      implementation: {
        create(_context, newTarget) {
          if (!newTarget) throw new Error('Missing newTarget');
          return Reflect.construct(
            ContextCreatedImpl,
            [token],
            newTarget as InterfaceConstructor,
          );
        },
        implementation: ContextCreatedImpl,
      },
      members: [ctor()],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const ContextCreated = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as InterfaceConstructor;

    const instance = new ContextCreated() as ContextCreatedImpl;

    expect(instance.value).toBe(token);
  });

  it('constructs implementations with realm-created dependencies', () => {
    class DependencyImpl {}
    class OwnerImpl {
      readonly #dependency: DependencyImpl;

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
        ctor(withArgs(DependencyImpl)),
        roAttr('dependency', reference(dependencyIDL.name)),
      ],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([dependencyIDL, ownerIDL]),
      realm,
      new PlatformObjectRegistry(),
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

    const owner = new Owner() as { readonly dependency: object; };

    expect(owner.dependency).toBeInstanceOf(Dependency);
  });

  it('constructs implementations with contextual dependencies', () => {
    type Environment = { readonly global: object; };
    class ContextualDependencyImpl {
      readonly #environment: Environment;
      readonly #value: string;

      constructor(
        value: string | undefined,
        environment: Environment,
      ) {
        this.#environment = environment;
        this.#value = value ?? 'created';
      }

      get environment(): Environment {
        return this.#environment;
      }

      get value(): string {
        return this.#value;
      }

      static create(result: ContextualDependencyImpl) {
        return result;
      }
    }
    const environment = contextValue(
      (context: { readonly realm: { readonly global: object; }; }) => ({
        global: context.realm.global,
      }),
    );
    const interfaceIDL = defineInterface({
      name: 'ContextualDependency',
      exposed: 'Window',
      implementation: impl(ContextualDependencyImpl, {
        withArgs: [atArg(1, environment)],
      }),
      members: [
        ctor([arg('value', idlType.DOMString)]),
        op('create', reference('ContextualDependency'), [], {
          ...withNew(ContextualDependencyImpl),
          static: true,
        }),
        roAttr('environment', idlType.object),
        roAttr('value', idlType.DOMString),
      ],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
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

    expect(constructed.environment.global).toBe(realm.global);
    expect(constructed.value).toBe('explicit');
    expect(created.environment.global).toBe(realm.global);
    expect(created.value).toBe('created');
  });

  it('injects the current global into new operation results', () => {
    class ResultImpl {
      readonly #global: object;

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
        withArgs: ['current-global'],
      }),
      members: [
        op('create', reference('Result'), [], {
          ...withNew(ResultImpl),
          static: true,
        }),
        roAttr('global', idlType.object),
      ],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([resultIDL]),
      realm,
      new PlatformObjectRegistry(),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const Result = Reflect.get(realm.global, resultIDL.name) as {
      create(): { readonly global: object; };
    };

    const result = Result.create();

    expect(result.global).toBe(realm.global);
  });

  it('declaratively connects an implementation to its interface behavior', () => {
    const realm = new Realm();
    const constructor = ctor([arg('value', idlType.DOMString)], bind({
      invoke(context, value) {
        DeclarativeExampleImpl.initialize(
          this as DeclarativeExampleImpl,
          String(value),
        );
        expect(context.realm).toBe(realm);
      },
    }));
    const parse = op('parse', idlType.DOMString, [
      arg('value', idlType.DOMString),
    ], bind({
      invoke(context, value) {
        expect(context.realm).toBe(realm);
        return `bound:${String(value)}`;
      },
    }, {
      static: true,
    }));
    const interfaceIDL = defineInterface({
      name: 'DeclarativeExample',
      exposed: 'Window',
      implementation: bind(DeclarativeExampleImpl, {
        create(_context, newTarget) {
          if (!newTarget) throw new Error('Missing implementation newTarget');
          return Reflect.construct(
            DeclarativeExampleImpl,
            [constructionToken],
            newTarget as InterfaceConstructor,
          );
        },
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
    const definitions = assembleDefinitions([interfaceIDL]);
    const implementations = new ImplementationRegistry();

    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
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
          binding: {
            invoke(_context, settingsValue) { received.push(settingsValue); },
          },
          kind: 'constructor',
        },
        {
          arguments: [{ name: 'settings', type: reference('Settings') }],
          binding: {
            invoke(_context, settingsValue) { received.push(settingsValue); },
          },
          kind: 'operation',
          name: 'apply',
          returns: idlType.undefined,
        },
      ],
    });
    const definitions = assembleDefinitions([settings, interfaceIDL]);
    const implementations = new ImplementationRegistry();

    const realm = new Realm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
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
      [{ enabled: false }],
    );

    expect(received).toEqual([{ enabled: true }, { enabled: false }]);
    expect(received.every((value) => !(value instanceof Map))).toBe(true);
  });

  it('projects callback functions into ordinary implementation callables', () => {
    type Increment = (this: unknown, value: number) => number;
    type CallbackOptions = { readonly callback: Increment; };

    class CallbackProjectionImpl {
      #callback: Increment | null = null;

      get nativeCallback(): Increment {
        return (value) => value + 2;
      }

      get callback(): Increment {
        if (!this.#callback) throw new Error('Callback has not been set');
        return this.#callback;
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

      invokeSequence(callbacks: readonly Increment[]): number {
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

      construct(callback: CallableFunction): unknown {
        return Reflect.construct(callback, [4]) as unknown;
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
      members: [dictMember(
        'callback',
        reference(increment.name),
        { ...projectCallback('rethrow'), required: true },
      )],
    });
    const interfaceIDL = defineInterface({
      name: 'CallbackProjection',
      exposed: ['Window'],
      implementation: impl(CallbackProjectionImpl),
      members: [
        ctor([], bind({ invoke() {} })),
        roAttr('callback', reference(increment.name)),
        roAttr('nativeCallback', reference(increment.name)),
        op('invoke', idlType.long, [
          arg(
            'callback',
            reference(increment.name),
            projectCallback('rethrow'),
          ),
          arg('value', idlType.long),
          arg('thisArgument', idlType.object),
        ]),
        op('invokeUnion', idlType.long, [
          arg(
            'callback',
            reference(callbackOrString.name),
            projectCallback('rethrow'),
          ),
        ]),
        op('invokeDictionary', idlType.long, [
          arg('options', reference(callbackOptions.name)),
        ]),
        op('invokeSequence', idlType.long, [
          arg(
            'callbacks',
            sequence(reference(increment.name)),
            projectCallback('rethrow'),
          ),
        ]),
        op('invokeRecord', idlType.long, [
          arg(
            'callbacks',
            record(idlType.DOMString, reference(increment.name)),
            projectCallback('rethrow'),
          ),
        ]),
        op('preserveAny', idlType.any, [arg('value', idlType.any)]),
        op('report', idlType.undefined, [
          arg(
            'callback',
            reference(voidCallback.name),
            projectCallback('report'),
          ),
        ]),
        op('rethrow', idlType.undefined, [
          arg(
            'callback',
            reference(voidCallback.name),
            projectCallback('rethrow'),
          ),
        ]),
        op('construct', idlType.any, [
          arg('callback', reference(factory.name)),
        ]),
      ],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([
        increment,
        voidCallback,
        factory,
        callbackOrString,
        callbackOptions,
        interfaceIDL,
      ]),
      realm,
      new PlatformObjectRegistry(),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const CallbackProjection = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as new() => {
      readonly callback: unknown;
      construct(callback: unknown): unknown;
      invoke(callback: unknown, value: number, thisArgument: object): number;
      invokeDictionary(options: { callback: unknown; }): number;
      invokeRecord(callbacks: Record<string, unknown>): number;
      invokeSequence(callbacks: unknown[]): number;
      invokeUnion(callback: unknown): number;
      readonly nativeCallback: (value: number) => number;
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
    expect(instance.nativeCallback(4)).toBe(6);
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
    const reportException = vi.spyOn(realm.callbacks, 'reportException')
      .mockImplementation(() => {});
    expect(() => instance.report(() => { throw exception; })).not.toThrow();
    expect(reportException).toHaveBeenCalledExactlyOnceWith(exception);

    function Constructed(this: { value?: number; }, value: number) {
      this.value = value;
    }
    expect(instance.construct(Constructed)).toMatchObject({ value: 4 });
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
        ctor([arg('value', idlType.DOMString)], bind({
          invoke(_context, value) {
            ProductImpl.initialize(this as ProductImpl, String(value));
          },
        })),
        attr('value', idlType.DOMString),
        op('namedItem', idlType.DOMString, [
          arg('name', idlType.DOMString),
        ], bind({
          getSupportedPropertyNames() {
            return new Set(['label']);
          },
          invoke(_context, name) {
            return ProductImpl.namedItem(
              this as ProductImpl,
              String(name),
            );
          },
        }, { special: 'getter' })),
        op('copy', reference('Product'), [
          arg('value', idlType.any, resolveArgs(ProductImpl)),
        ], {
          static: true,
        }),
      ],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
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

  it('runs inherited interface lifecycle steps from parent to child', () => {
    const lifecycle: string[] = [];
    const realm = new Realm();
    const parentIDL = defineInterface({
      name: 'ParentLifecycle',
      exposed: ['Window'],
      implementation: {
        initialize(context, value) {
          expect(context.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          lifecycle.push('parent');
        },
        implementation: ParentLifecycleImpl,
      },
      members: [],
    });
    const childIDL = defineInterface({
      name: 'ChildLifecycle',
      inherits: 'ParentLifecycle',
      exposed: ['Window'],
      implementation: {
        initialize(context, value) {
          expect(context.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          lifecycle.push('child');
        },
        implementation: ChildLifecycleImpl,
      },
      members: [{
        arguments: [],
        binding: { invoke() {} },
        kind: 'constructor',
      }],
    });
    const definitions = assembleDefinitions([parentIDL, childIDL]);
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
    );
    registerDefinitionBindings(binding);
    binding.install();
    const ChildLifecycle = Reflect.get(
      realm.global,
      'ChildLifecycle',
    ) as InterfaceConstructor;

    const object = new ChildLifecycle();

    expect(object).toBeInstanceOf(ChildLifecycle);
    expect(lifecycle).toEqual(['parent', 'child']);
  });

  it('materializes only requested DOMExceptions in the binding realm', () => {
    const arbitrary = new DOMException('arbitrary', 'AbortError');
    const interfaceIDL = defineInterface({
      name: 'ExceptionSource',
      exposed: ['Window'],
      implementation: impl(ExceptionSourceImpl),
      members: [
        ctor([], bind({ invoke() {} })),
        op('requested', idlType.undefined, [], bind({
          invoke() {
            throwDOMException('InvalidStateError', 'requested');
          },
        }, { static: true })),
        op('arbitrary', idlType.undefined, [], bind({
          invoke() { throw arbitrary; },
        }, { static: true })),
      ],
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
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

  *entries(): IterableIterator<[string, string]> {
    yield ['value', this.#value];
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
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
