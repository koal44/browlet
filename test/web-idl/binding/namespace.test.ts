import { describe, expect, it } from 'vitest';

import {
  arg, atArg, impl, defineInterface, defineNamespace, definePartialNamespace, idlType, integer, op, roAttr,
} from '../../../src/web-idl/core/index';
import { DefinitionAssembly } from '../../../src/web-idl/assembly/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { RealmBinding } from '../../../src/web-idl/binding/realm';

import { getMemberBinding } from '../../support/web-idl-binding';
import { TestRealm as Realm } from '../../support/web-idl-realm';

describe('Web IDL namespace objects', () => {
  it('shares one ordinary implementation between primary and partial members in each realm', () => {
    type Environment = { realm: Realm; version: string; };
    let created = 0;
    class ToolsImpl {
      version: string;
      calls = 0;
      constructor(env: Environment) { this.version = env.version; created++; }
      double(value: number) { this.calls++; return value * 2; }
    }
    const namespace = defineNamespace<Environment>({
      name: 'Tools', exposed: ['Window'],
      implementation: impl(ToolsImpl, { constructWith: [atArg<Environment>(0, (env) => env)] }),
      members: [roAttr('version', idlType.DOMString), roAttr('calls', idlType.long)],
    });
    const partial = definePartialNamespace<Environment>({
      name: 'Tools', exposed: ['Window'],
      members: [op('twice', idlType.long, [arg('value', idlType.long)], { method: 'double' })],
    });
    const world = new BindingWorld<Environment>([namespace, partial]);
    const namespaces = ['one', 'two'].map((version) => {
      const realm = new Realm();
      world.register(realm, () => ({ realm, version }));
      const binding = world.getRealmBinding(realm)!;
      const tools = binding.installDefinitions().get('Tools')!;
      expect(binding.installDefinitions().get('Tools')).toBe(tools);
      expect(Reflect.getPrototypeOf(tools)).toBe(realm.objectPrototype);
      expect(Reflect.get(tools, 'version')).toBe(version);
      expect(Reflect.get(tools, 'calls')).toBe(0);
      expect(Reflect.apply(Reflect.get(tools, 'twice') as CallableFunction, {}, [4.8])).toBe(8);
      expect(Reflect.get(tools, 'calls')).toBe(1);
      expect(Reflect.getPrototypeOf(requireObject(Reflect.get(tools, 'twice')))).toBe(realm.functionPrototype);
      return tools;
    });
    expect(created).toBe(2);
    expect(namespaces[0]).not.toBe(namespaces[1]);
  });

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
      name: 'Tools',
      exposed: ['Window'],
      members: [
        version,
        echo,
        {
          kind: 'constant', name: 'READY', type: idlType.long,
          value: integer(7),
        },
      ],
    });
    const partial = definePartialNamespace({
      name: 'Tools',
      exposed: ['Worker'],
      members: [hidden],
    });
    const nested = defineInterface({
      name: 'Nested',
      exposed: ['Window'],
      extendedAttributes: [{
        kind: 'identifier', name: 'LegacyNamespace', value: 'Tools',
      }],
      members: [],
    });
    const assembly = new DefinitionAssembly([partial, nested, namespace]);

    const receivers: Array<object | null> = [];

    const realm = new Realm();
    const binding = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const namespaceBinding = binding.getImplementationBinding(assembly.namespaces.get(namespace.name)!);
    getMemberBinding(namespaceBinding, version).attributeSteps = {
      get(receiver) {
        receivers.push(receiver);
        return '1.0';
      },
    };
    getMemberBinding(namespaceBinding, echo).operationSteps = function(receiver, [value]) {
      receivers.push(receiver);
      return value;
    };

    const installed = binding.installDefinitions();
    const tools = requireObject(installed.get('Tools'));
    const Nested = requireObject(Reflect.get(tools, 'Nested'));

    expect([...installed.keys()]).toEqual(['Tools']);
    expect(Reflect.getPrototypeOf(tools)).toBe(realm.objectPrototype);
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
    expect(Reflect.has(realm.globalObject, 'Nested')).toBe(false);
    expect(Reflect.get(binding.getImplementationBinding(binding.resolveInterface('Nested')).getInterfacePrototypeObject(), 'constructor')).toBe(Nested);
    expect(Object.prototype.toString.call(
      requireObject(Reflect.get(Nested, 'prototype')),
    )).toBe('[object Tools.Nested]');
    expect(binding.getImplementationBinding(binding.assembly.namespaces.get('Tools')!).getNamespaceObject()).toBe(tools);

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
