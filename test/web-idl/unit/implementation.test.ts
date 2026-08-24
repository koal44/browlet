import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { throwDOMException } from '../../../src/shared/dom-exception';
import { assembleDefinitions } from '../../../src/web-idl/adapter/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { webIDLCommonDefinitions } from '../../../src/web-idl/common-definitions';
import {
  arg, attr, ctor, defineDictionary, defineInterface, idlType, iterable, op,
  reference, stringifier,
} from '../../../src/web-idl/adapter/definition';
import {
  bind, registerInterfaceBindings,
} from '../../../src/web-idl/adapter/projection';
import { ImplementationRegistry } from '../../../src/web-idl/adapter/registry';
import type { ValuePair } from '../../../src/web-idl/iterable';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL implementation registration', () => {
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
      binding: bind(DeclarativeExampleImpl, {
        create(_context, newTarget) {
          if (!newTarget) throw new Error('Missing implementation newTarget');
          return Reflect.construct(
            DeclarativeExampleImpl,
            [constructionToken],
            newTarget as InterfaceConstructor,
          );
        },
      }),
      exposed: 'Window',
      members: [
        constructor,
        attr('value', idlType.DOMString),
        op('append', idlType.undefined, [arg('value', idlType.DOMString)]),
        parse,
        iterable(idlType.DOMString, bind({
          invoke() {
            return DeclarativeExampleImpl.valuePairs(
              this as DeclarativeExampleImpl,
            );
          },
        }, {
          key: idlType.DOMString,
        })),
        stringifier(bind({
          invoke() {
            return DeclarativeExampleImpl.stringify(
              this as DeclarativeExampleImpl,
            );
          },
        })),
      ],
      name: 'DeclarativeExample',
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const implementations = new ImplementationRegistry();

    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    registerInterfaceBindings(binding, [interfaceIDL]);
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
      members: [{ name: 'enabled', type: idlType.boolean }],
      name: 'Settings',
    });
    const interfaceIDL = defineInterface({
      binding: { implementation: DictionaryAdapterImpl },
      exposed: ['Window'],
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
      name: 'DictionaryAdapter',
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
    registerInterfaceBindings(binding, [interfaceIDL]);
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

  it('provides platform-object capabilities through declarative bindings', () => {
    class ProductImpl {
      #value = '';

      get value(): string {
        return this.#value;
      }

      set value(value: string) {
        this.#value = value;
      }
    }

    const interfaceIDL = defineInterface({
      binding: bind(ProductImpl),
      exposed: ['Window'],
      members: [
        ctor([arg('value', idlType.DOMString)], bind({
          invoke(_context, value) {
            (this as ProductImpl).value = String(value);
          },
        })),
        attr('value', idlType.DOMString),
        op('copy', reference('Product'), [
          arg('value', idlType.any),
        ], bind({
          invoke(context, value) {
            const source = context.objects.getImplementation(
              value,
              ProductImpl,
            );
            if (!source) throw new TypeError('Value is not a Product');

            const copy = context.objects.create(ProductImpl);
            copy.value = source.value;
            return copy;
          },
        }, {
          static: true,
        })),
      ],
      name: 'Product',
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
    );
    registerInterfaceBindings(binding, [interfaceIDL]);
    binding.install();
    const Product = Reflect.get(realm.global, 'Product') as {
      new(value: string): { value: string; };
      copy(value: unknown): { value: string; };
    };
    const original = new Product('original');

    const copy = Product.copy(original);

    expect(copy).toBeInstanceOf(Product);
    expect(copy).not.toBe(original);
    expect(copy.value).toBe('original');
    expect(() => Product.copy({ value: 'impostor' })).toThrow(TypeError);
  });

  it('runs inherited interface lifecycle steps from parent to child', () => {
    const lifecycle: string[] = [];
    const realm = new Realm();
    const parentIDL = defineInterface({
      binding: {
        initialize(context, value) {
          expect(context.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          lifecycle.push('parent');
        },
        implementation: ParentLifecycleImpl,
      },
      exposed: ['Window'],
      members: [],
      name: 'ParentLifecycle',
    });
    const childIDL = defineInterface({
      binding: {
        initialize(context, value) {
          expect(context.realm).toBe(realm);
          expect(value).toBeTypeOf('object');
          lifecycle.push('child');
        },
        implementation: ChildLifecycleImpl,
      },
      exposed: ['Window'],
      inherits: 'ParentLifecycle',
      members: [{
        arguments: [],
        binding: { invoke() {} },
        kind: 'constructor',
      }],
      name: 'ChildLifecycle',
    });
    const definitions = assembleDefinitions([parentIDL, childIDL]);
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
    );
    registerInterfaceBindings(binding, [parentIDL, childIDL]);
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
      binding: bind(ExceptionSourceImpl),
      exposed: ['Window'],
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
      name: 'ExceptionSource',
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
    );
    registerInterfaceBindings(binding, webIDLCommonDefinitions);
    registerInterfaceBindings(binding, [interfaceIDL]);
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

  static stringify(value: DeclarativeExampleImpl): string {
    return value.#value;
  }

  static valuePairs(
    value: DeclarativeExampleImpl,
  ): readonly ValuePair[] {
    return [{ key: 'value', value: value.#value }];
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
