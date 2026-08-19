import { describe, expect, it } from 'vitest';

import {
  assembleInterfaceMembers, attribute, bindInterface, constant,
  defineInterface, defineMixin, definePartialInterface, operation,
  readonlyAttribute,
} from '../../../src/web-idl/binding';

describe('Web IDL interface binding', () => {
  it('assembles interface, mixin, and partial members explicitly', () => {
    const mixin = defineMixin({
      name: 'Shared',
      members: {
        shared: readonlyAttribute(),
      },
    });
    const interface_ = defineInterface({
      name: 'Example',
      includes: [mixin],
      members: {
        run: operation(),
      },
    });
    const mixinPartial = definePartialInterface({
      target: mixin,
      members: {
        mutable: attribute(),
      },
    });
    const interfacePartial = definePartialInterface({
      target: interface_,
      members: {
        extended: operation(),
      },
    });

    expect([
      ...assembleInterfaceMembers(
        interface_,
        [mixinPartial, interfacePartial],
      ),
    ]).toEqual([
      ['shared', { kind: 'attribute', readonly: true }],
      ['mutable', { kind: 'attribute', readonly: false }],
      ['run', { kind: 'operation' }],
      ['extended', { kind: 'operation' }],
    ]);
  });

  it('installs interface members with Web IDL property attributes', () => {
    class ExampleImpl {
      static get ANSWER(): number { return 42; }

      get value(): string { return 'value'; }
      set value(_value: string) {}
      get fixed(): string { return 'fixed'; }
      run(): void {}
    }

    const interface_ = defineInterface({
      name: 'Example',
      members: {
        ANSWER: constant(),
        value: attribute(),
        fixed: readonlyAttribute(),
        run: operation(),
      },
    });
    const Interface = bindInterface({
      interface: interface_,
      implementation: ExampleImpl,
    }, undefined);
    const operationDescriptor = Object.getOwnPropertyDescriptor(
      Interface.prototype,
      'run',
    );
    const attributeDescriptor = Object.getOwnPropertyDescriptor(
      Interface.prototype,
      'value',
    );
    const readonlyDescriptor = Object.getOwnPropertyDescriptor(
      Interface.prototype,
      'fixed',
    );
    const constantDescriptor = {
      configurable: false,
      enumerable: true,
      value: 42,
      writable: false,
    };

    expect({
      configurable: operationDescriptor?.configurable,
      enumerable: operationDescriptor?.enumerable,
      function: typeof operationDescriptor?.value === 'function',
      writable: operationDescriptor?.writable,
    }).toEqual({
      configurable: true,
      enumerable: true,
      function: true,
      writable: true,
    });
    expect({
      configurable: attributeDescriptor?.configurable,
      enumerable: attributeDescriptor?.enumerable,
      getter: typeof attributeDescriptor?.get === 'function',
      setter: typeof attributeDescriptor?.set === 'function',
    }).toEqual({
      configurable: true,
      enumerable: true,
      getter: true,
      setter: true,
    });
    expect({
      configurable: readonlyDescriptor?.configurable,
      enumerable: readonlyDescriptor?.enumerable,
      getter: typeof readonlyDescriptor?.get === 'function',
      readonly: readonlyDescriptor?.set === undefined,
    }).toEqual({
      configurable: true,
      enumerable: true,
      getter: true,
      readonly: true,
    });
    expect(Object.getOwnPropertyDescriptor(Interface, 'ANSWER'))
      .toEqual(constantDescriptor);
    expect(Object.getOwnPropertyDescriptor(Interface.prototype, 'ANSWER'))
      .toEqual(constantDescriptor);
    expect(Object.getOwnPropertyDescriptor(
      Interface.prototype,
      Symbol.toStringTag,
    )).toEqual({
      configurable: true,
      enumerable: false,
      value: 'Example',
      writable: false,
    });
    expect(Object.prototype.toString.call(Object.create(Interface.prototype)))
      .toBe('[object Example]');
  });
});
