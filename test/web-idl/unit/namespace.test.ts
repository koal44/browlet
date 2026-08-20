import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, defineNamespace, definePartialNamespace, idlType, integer,
} from '../../../src/web-idl/definition';
import { ImplementationRegistry } from '../../../src/web-idl/implementation';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL namespace objects', () => {
  it('projects namespace members and legacy-namespaced interfaces', () => {
    const version = {
      kind: 'attribute' as const,
      name: 'version',
      readonly: true,
      type: idlType.DOMString,
    };
    const echo = {
      arguments: [{ name: 'value', type: idlType.long }],
      kind: 'operation' as const,
      name: 'echo',
      returns: idlType.long,
    };
    const hidden = {
      arguments: [],
      kind: 'operation' as const,
      name: 'hidden',
      returns: idlType.undefined,
    };
    const namespace = defineNamespace({
      exposed: ['Window'],
      members: [
        version,
        echo,
        {
          kind: 'constant', name: 'READY', type: idlType.long,
          value: integer(7),
        },
      ],
      name: 'Tools',
    });
    const partial = definePartialNamespace({
      exposed: ['Worker'],
      members: [hidden],
      name: 'Tools',
    });
    const nested = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [{
        kind: 'identifier', name: 'LegacyNamespace', value: 'Tools',
      }],
      members: [],
      name: 'Nested',
    });
    const definitions = assembleDefinitions([partial, nested, namespace]);
    const implementations = new ImplementationRegistry();
    const receivers: Array<object | null> = [];
    implementations.setAttributeSteps(version, {
      get() {
        receivers.push(this);
        return '1.0';
      },
    });
    implementations.setOperationSteps(echo, function(value) {
      receivers.push(this);
      return value;
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );

    const installed = binding.install();
    const tools = requireObject(installed.get('Tools'));
    const Nested = requireObject(Reflect.get(tools, 'Nested'));

    expect([...installed.keys()]).toEqual(['Tools']);
    expect(Reflect.getPrototypeOf(tools)).toBe(realm.intrinsics.objectPrototype);
    expect(Object.prototype.toString.call(tools)).toBe('[object Tools]');
    expect(Reflect.get(tools, 'version')).toBe('1.0');
    expect(Reflect.apply(
      Reflect.get(tools, 'echo') as CallableFunction,
      {},
      [4.8],
    )).toBe(4);
    expect(receivers).toEqual([null, null]);
    expect(Reflect.get(tools, 'READY')).toBe(7);
    expect(Reflect.has(tools, 'hidden')).toBe(false);
    expect(Reflect.has(realm.global, 'Nested')).toBe(false);
    expect(Nested).toBe(binding.getInterfaceObject('Nested'));
    expect(binding.getNamespaceObject('Tools')).toBe(tools);

    expect(Reflect.getOwnPropertyDescriptor(tools, 'version')).toMatchObject({
      configurable: true,
      enumerable: true,
      set: undefined,
    });
    expect(Reflect.getOwnPropertyDescriptor(tools, 'echo')).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true,
    });
    expect(Reflect.getOwnPropertyDescriptor(tools, 'READY')).toEqual({
      configurable: false,
      enumerable: true,
      value: 7,
      writable: false,
    });
    expect(Reflect.getOwnPropertyDescriptor(tools, 'Nested')).toEqual({
      configurable: true,
      enumerable: false,
      value: Nested,
      writable: true,
    });
  });
});

function requireObject(value: unknown): object {
  if ((typeof value !== 'object' || value === null) &&
    typeof value !== 'function') {
    throw new Error('Expected a Web IDL object');
  }
  return value;
}
