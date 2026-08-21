import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, idlType, type ConstructorMember, type OperationMember,
} from '../../../src/web-idl/definition';
import {
  ImplementationRegistry, registerInterfaceImplementation, type ValuePair,
} from '../../../src/web-idl/implementation';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL implementation registration', () => {
  it('declaratively connects an implementation to its interface behavior', () => {
    const constructor = {
      arguments: [{ name: 'value', type: idlType.DOMString }],
      kind: 'constructor',
    } satisfies ConstructorMember;
    const parse = {
      arguments: [{ name: 'value', type: idlType.DOMString }],
      kind: 'operation',
      name: 'parse',
      returns: idlType.DOMString,
      static: true,
    } satisfies OperationMember;
    const interfaceIDL = defineInterface({
      exposed: ['Window'],
      members: [
        constructor,
        { kind: 'attribute', name: 'value', type: idlType.DOMString },
        {
          arguments: [{ name: 'value', type: idlType.DOMString }],
          kind: 'operation',
          name: 'append',
          returns: idlType.undefined,
        },
        parse,
        { key: idlType.DOMString, kind: 'iterable', value: idlType.DOMString },
        { kind: 'stringifier' },
      ],
      name: 'DeclarativeExample',
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const interface_ = definitions.getInterface('DeclarativeExample');
    if (!interface_) throw new Error('DeclarativeExample was not assembled');
    const implementations = new ImplementationRegistry();

    registerInterfaceImplementation(
      implementations,
      interface_,
      DeclarativeExampleImpl,
      {
        construct(value) {
          DeclarativeExampleImpl.initialize(
            this as DeclarativeExampleImpl,
            value as string,
          );
        },
        create: { arguments: [constructionToken] },
        operations: {
          static: {
            parse(value) { return `bound:${String(value)}`; },
          },
        },
        stringify() {
          return DeclarativeExampleImpl.stringify(
            this as DeclarativeExampleImpl,
          );
        },
        valuePairs() {
          return DeclarativeExampleImpl.valuePairs(
            this as DeclarativeExampleImpl,
          );
        },
      },
    );

    const realm = new Realm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
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
});

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
