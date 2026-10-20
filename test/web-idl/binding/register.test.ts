import { describe, expect, it } from 'vitest';

import { DOMExceptionImpl, DOMExceptionNames } from '../../../src/web-idl/core/dom-exception';
import {
  arg, atArg, attr, ctor, defineIncludes, defineInterface, defineInterfaceMixin, idlType, impl, iter,
  op, staticOp, roAttr, reference, unwrapArg, stringifier, invokeWith,
} from '../../../src/web-idl/core/index';
import { getImplementationObject, getImplementationRecord } from '../../../src/web-idl/binding/platform';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import type { WebIDLEnvironment } from '../../../src/web-idl/environment';

import { installTestBindings } from '../../support/web-idl-binding';
import { TestRealm as Realm } from '../../support/web-idl-realm';

describe('Web IDL implementation registration', () => {
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
    const world = new BindingWorld([
      common,
      first,
      second,
      defineIncludes({ interface: first.name, mixin: common.name }),
      defineIncludes({ interface: second.name, mixin: common.name }),
    ]);
    const { globalObject } = installTestBindings(world);
    const First = Reflect.get(globalObject, first.name) as new() => FirstImpl;
    const Second = Reflect.get(globalObject, second.name) as new() => SecondImpl;

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
    const world = new BindingWorld([interfaceIDL]);
    const { globalObject } = installTestBindings(world);
    const AutomaticConstructor = Reflect.get(
      globalObject,
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
    const world = new BindingWorld([interfaceIDL]);
    const { globalObject } = installTestBindings(world);
    const ContextCreated = Reflect.get(
      globalObject,
      interfaceIDL.name,
    ) as InterfaceConstructor;

    const instance = new ContextCreated() as ContextCreatedImpl;
    const implementation = getImplementationObject(instance) as ContextCreatedImpl | undefined;

    expect(implementation?.value).toBe(token);
    expect(Reflect.get(instance, 'value')).toBeUndefined();
  });

  it('projects dependencies supplied during implementation construction', () => {
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
          { constructWith: [atArg(0, () => new DependencyImpl())] },
        ),
        roAttr('dependency', reference(dependencyIDL.name)),
      ],
    });
    const world = new BindingWorld([dependencyIDL, ownerIDL]);
    const { globalObject } = installTestBindings(world);
    const Owner = Reflect.get(
      globalObject,
      ownerIDL.name,
    ) as InterfaceConstructor;
    const Dependency = Reflect.get(
      globalObject,
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
    const interfaceIDL = defineInterface<WebIDLEnvironment>({
      name: 'ContextualDependency',
      exposed: 'Window',
      implementation: impl(ContextualDependencyImpl, {
        constructWith: [atArg(1, (env) => ({ global: env.realm.globalObject }))],
      }),
      members: [
        ctor([arg('value', idlType.DOMString)]),
        staticOp('create', reference('ContextualDependency'),
          [],
          invokeWith(atArg(0, (env) => new ContextualDependencyImpl(undefined, { global: env.realm.globalObject }))),
        ),
        roAttr('env', idlType.object),
        roAttr('value', idlType.DOMString),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([interfaceIDL]);
    installTestBindings(world, realm);
    const ContextualDependency = Reflect.get(
      realm.globalObject,
      interfaceIDL.name,
    ) as {
      create(): ContextualDependencyImpl;
      new(value: unknown): ContextualDependencyImpl;
    };

    const constructed = new ContextualDependency('explicit');
    const created = ContextualDependency.create();

    expect(constructed.env.global).toBe(realm.globalObject);
    expect(constructed.value).toBe('explicit');
    expect(created.env.global).toBe(realm.globalObject);
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
    const resultIDL = defineInterface<WebIDLEnvironment>({
      name: 'Result',
      exposed: 'Window',
      implementation: impl(ResultImpl, {
        constructWith: [atArg(0, (env) => env.realm.globalObject)],
      }),
      members: [
        staticOp('create', reference('Result'),
          [],
          invokeWith(atArg(0, (env) => new ResultImpl(env.realm.globalObject))),
        ),
        roAttr('global', idlType.object),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([resultIDL]);
    installTestBindings(world, realm);
    const Result = Reflect.get(realm.globalObject, resultIDL.name) as {
      create(): { global: object; };
    };

    const result = Result.create();

    expect(result.global).toBe(realm.globalObject);
  });

  it('declaratively connects an implementation to its interface behavior', () => {
    const realm = new Realm();
    const constructor = ctor(
      [arg('value', idlType.DOMString)],
      {
        invoke(env: WebIDLEnvironment, value) {
          DeclarativeExampleImpl.initialize(
            this as DeclarativeExampleImpl,
            String(value),
          );
          expect(env.realm).toBe(realm);
        },
      },
    );
    const parse = staticOp('parse', idlType.DOMString,
      [
        arg('value', idlType.DOMString),
      ],
      {
        invoke(env: WebIDLEnvironment, value) {
          expect(env.realm).toBe(realm);
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

    const world = new BindingWorld([interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    const installed = binding.installDefinitions();
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

      get value(): string {
        return this.#value;
      }

      set value(value: string) {
        this.#value = value;
      }

      namedItem(name: string): string {
        return name === 'label' ? this.#value : '';
      }

      getSupportedPropertyNames(): ReadonlySet<string> {
        return new Set(['label']);
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
            invoke(_env, value) {
              ProductImpl.initialize(this as ProductImpl, String(value));
            },
          },
        ),
        attr('value', idlType.DOMString),
        { kind: 'named-getter', name: 'namedItem', method: 'namedItem', returns: idlType.DOMString },
        staticOp('copy', reference('Product'),
          [
            arg('value', idlType.any, unwrapArg(ProductImpl)),
          ],
        ),
      ],
    });
    const world = new BindingWorld([interfaceIDL]);
    const { globalObject } = installTestBindings(world);
    const Product = Reflect.get(globalObject, 'Product') as {
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
    const environments: WebIDLEnvironment[] = [];
    const lifecycle: string[] = [];
    const realm = new Realm();
    const parentIDL = defineInterface<WebIDLEnvironment>({
      name: 'ParentLifecycle',
      exposed: ['Window'],
      implementation: impl(ParentLifecycleImpl, {
        initializeImplementation(env, value) {
          expect(env.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          environments.push(env);
          lifecycle.push('parent');
        },
      }),
      members: [],
    });
    const childIDL = defineInterface<WebIDLEnvironment>({
      name: 'ChildLifecycle',
      inherits: 'ParentLifecycle',
      exposed: ['Window'],
      implementation: impl(ChildLifecycleImpl, {
        initializeImplementation(env, value) {
          expect(env.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          environments.push(env);
          lifecycle.push('child');
        },
      }),
      members: [{
        arguments: [],
        invoke() {},
        kind: 'constructor',
      }],
    });
    const world = new BindingWorld([parentIDL, childIDL]);
    installTestBindings(world, realm);
    const ChildLifecycle = Reflect.get(
      realm.globalObject,
      'ChildLifecycle',
    ) as InterfaceConstructor;

    const object = new ChildLifecycle();

    expect(object).toBeInstanceOf(ChildLifecycle);
    expect(environments[0]).toBe(environments[1]);
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
    const realm = new Realm();
    const first = new BindingWorld([]);
    const second = new BindingWorld([]);
    const firstContext = first.register(realm, (ctx) => ({ realm: ctx.realm }));
    const secondContext = second.register(realm, (ctx) => ({ realm: ctx.realm }));

    expect(first.getBindingContext(realm)).toBe(firstContext);
    expect(second.getBindingContext(realm)).toBe(secondContext);
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
              throw new DOMExceptionImpl('requested', DOMExceptionNames.invalidState);
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
    const world = new BindingWorld([interfaceIDL]);
    const { globalObject } = installTestBindings(world);
    const ExceptionSource = Reflect.get(globalObject, 'ExceptionSource') as {
      new(): object;
      arbitrary(): void;
      requested(): void;
    };
    const DOMException_ = Reflect.get(globalObject, 'DOMException') as
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

class ParentLifecycleImpl {}

class ChildLifecycleImpl extends ParentLifecycleImpl {}

class ExceptionSourceImpl {
  constructor() {
    throw new DOMExceptionImpl('creation requested', DOMExceptionNames.notSupported);
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
