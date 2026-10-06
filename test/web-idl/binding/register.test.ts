import { describe, expect, it } from 'vitest';

import { DOMExceptionImpl, DOMExceptionNames } from '../../../src/web-idl/core/dom-exception';
import {
  arg, atArg, attr, ctor, defineIncludes, defineInterface, defineInterfaceMixin, idlType, impl, iter,
  op, staticOp, roAttr, reference, unwrapArg, stringifier, invokeWith,
} from '../../../src/web-idl/core/index';
import { getImplementationObject, getImplementationRecord } from '../../../src/web-idl/binding/platform';
import { BindingWorld } from '../../../src/web-idl/binding/world';

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
    const realm = new Realm();
    const world = new BindingWorld([
      common,
      first,
      second,
      defineIncludes({ interface: first.name, mixin: common.name }),
      defineIncludes({ interface: second.name, mixin: common.name }),
    ]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const world = new BindingWorld([interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const world = new BindingWorld([interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const world = new BindingWorld([dependencyIDL, ownerIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const world = new BindingWorld([interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const world = new BindingWorld([resultIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
    const Result = Reflect.get(realm.global, resultIDL.name) as {
      create(): { global: object; };
    };

    const result = Result.create();

    expect(result.global).toBe(realm.global);
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
    const world = new BindingWorld([interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const world = new BindingWorld([parentIDL, childIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
    const realm = new Realm();
    const world = new BindingWorld([interfaceIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
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
