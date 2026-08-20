import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, idlType, integer, type AttributeMember,
  type OperationMember,
} from '../../../src/web-idl/definition';
import { ImplementationRegistry } from '../../../src/web-idl/implementation';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL global platform objects', () => {
  it('projects members and named properties at their specified levels', () => {
    const baseMethod = operation('baseMethod', idlType.DOMString);
    const title = {
      kind: 'attribute', name: 'title', readonly: true, type: idlType.DOMString,
    } satisfies AttributeMember;
    const ping = operation('ping', idlType.DOMString);
    const namedItem = namedGetter('namedItem');
    const base = defineInterface({
      exposed: ['Window'],
      members: [baseMethod],
      name: 'GlobalBase',
    });
    const window = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [identifier('Global', 'Window')],
      inherits: 'GlobalBase',
      members: [
        { kind: 'constant', name: 'ANSWER', type: idlType.long, value: integer(42) },
        title,
        ping,
        namedItem,
      ],
      name: 'Window',
    });
    const widget = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [{
        kind: 'identifier-list',
        name: 'LegacyWindowAlias',
        values: ['LegacyWidget', 'OldWidget'],
      }],
      members: [],
      name: 'Widget',
    });
    const values = new Map([
      ['alpha', 'named alpha'],
      ['baseMethod', 'named base method'],
      ['title', 'named title'],
      ['Widget', 'named widget'],
    ]);
    const implementations = new ImplementationRegistry();
    implementations.setOperationSteps(baseMethod, () => 'base');
    implementations.setAttributeSteps(title, { get: () => 'global title' });
    implementations.setOperationSteps(ping, () => 'pong');
    implementations.setOperationSteps(namedItem, (name) =>
      values.get(name as string));
    implementations.setNamedPropertySteps(namedItem, {
      getSupportedPropertyNames: () => new Set(values.keys()),
    });

    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([widget, window, base]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const implementation = Reflect.construct(realm.intrinsics.object, []);
    const record = binding.projectGlobalObject(implementation, 'Window');
    const global = record.object;
    const Window = binding.getInterfaceObject('Window');
    const Base = binding.getInterfaceObject('GlobalBase');
    const Widget = binding.getInterfaceObject('Widget');
    const globalPrototype = requireObject(Reflect.getPrototypeOf(global));
    const namedProperties = requireObject(
      Reflect.getPrototypeOf(globalPrototype),
    );

    expect(record.implementation).toBe(implementation);
    expect(global === implementation).toBe(false);
    expect(globalPrototype).toBe(Window.prototype);
    expect(Reflect.getPrototypeOf(namedProperties))
      .toBe(Base.prototype);
    expect(classString(realm, global)).toBe('[object Window]');
    expect(classString(realm, namedProperties))
      .toBe('[object WindowProperties]');

    expect(Object.hasOwn(global, 'title')).toBe(true);
    expect(Object.hasOwn(global, 'ping')).toBe(true);
    expect(Object.hasOwn(globalPrototype, 'title')).toBe(false);
    expect(Object.hasOwn(globalPrototype, 'ping')).toBe(false);
    expect(Reflect.get(global, 'title')).toBe('global title');
    expect(call(global, 'ping', global)).toBe('pong');
    expect(call(global, 'ping', undefined)).toBe('pong');
    expect(call(global, 'baseMethod', global)).toBe('base');
    expect(Reflect.get(global, 'ANSWER')).toBe(42);
    expect(Reflect.get(globalPrototype, 'ANSWER')).toBe(42);

    expect(Reflect.get(global, 'Window')).toBe(Window);
    expect(Reflect.get(global, 'Widget')).toBe(Widget);
    expect(Reflect.get(global, 'LegacyWidget')).toBe(Widget);
    expect(Reflect.get(global, 'OldWidget')).toBe(Widget);
    expect(Object.getOwnPropertyDescriptor(global, 'Widget')).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: true,
    });

    expect(Reflect.get(global, 'alpha')).toBe('named alpha');
    expect(Reflect.has(global, 'alpha')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(namedProperties, 'alpha')).toEqual({
      configurable: true,
      enumerable: true,
      value: 'named alpha',
      writable: true,
    });
    expect(Reflect.ownKeys(namedProperties)).not.toContain('alpha');
    expect(Reflect.ownKeys(global)).not.toContain('alpha');
    expect(Reflect.get(global, 'baseMethod')).toBeTypeOf('function');
    expect(Reflect.get(global, 'title')).toBe('global title');
    expect(Reflect.get(global, 'Widget')).toBe(Widget);

    expect(Reflect.set(global, 'alpha', 'shadowed')).toBe(true);
    expect(Object.hasOwn(global, 'alpha')).toBe(true);
    expect(Reflect.get(global, 'alpha')).toBe('shadowed');
    expect(Object.getOwnPropertyDescriptor(namedProperties, 'alpha'))
      .toBeUndefined();

    expect(Reflect.defineProperty(namedProperties, 'new', { value: 1 }))
      .toBe(false);
    expect(Reflect.deleteProperty(namedProperties, 'absent')).toBe(false);
    expect(Reflect.preventExtensions(namedProperties)).toBe(false);
    expect(Reflect.isExtensible(namedProperties)).toBe(true);
  });

  it('uses immutable prototype exotics by default', () => {
    const { binding, realm } = createGlobalBinding();
    const record = binding.projectGlobalObject(
      Reflect.construct(realm.intrinsics.object, []),
      'TestGlobal',
    );
    const global = record.object;
    const globalPrototype = requireObject(Reflect.getPrototypeOf(global));
    const namedProperties = requireObject(
      Reflect.getPrototypeOf(globalPrototype),
    );

    expect(Reflect.setPrototypeOf(global, globalPrototype)).toBe(true);
    expect(Reflect.setPrototypeOf(global, {})).toBe(false);
    expect(Reflect.setPrototypeOf(globalPrototype, namedProperties)).toBe(true);
    expect(Reflect.setPrototypeOf(globalPrototype, {})).toBe(false);
    expect(Reflect.setPrototypeOf(
      namedProperties,
      Reflect.getPrototypeOf(namedProperties),
    )).toBe(true);
    expect(Reflect.setPrototypeOf(namedProperties, {})).toBe(false);
  });

  it('omits the named-properties layer without a named getter', () => {
    const base = defineInterface({
      exposed: ['Window'], members: [], name: 'PlainBase',
    });
    const globalIDL = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [identifier('Global', 'PlainGlobal')],
      inherits: 'PlainBase',
      members: [],
      name: 'PlainGlobal',
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([globalIDL, base]),
      realm,
      new PlatformObjectRegistry(),
    );
    const global = binding.projectGlobalObject(
      Reflect.construct(realm.intrinsics.object, []),
      'PlainGlobal',
    ).object;
    const globalPrototype = requireObject(Reflect.getPrototypeOf(global));

    expect(Reflect.getPrototypeOf(globalPrototype))
      .toBe(binding.getInterfacePrototypeObject('PlainBase'));
  });

  it('allows prototype changes when the realm opts into them', () => {
    const { binding, realm } = createGlobalBinding(true);
    const record = binding.projectGlobalObject(
      Reflect.construct(realm.intrinsics.object, []),
      'TestGlobal',
    );
    const global = record.object;
    const globalPrototype = requireObject(Reflect.getPrototypeOf(global));
    const namedProperties = requireObject(
      Reflect.getPrototypeOf(globalPrototype),
    );
    const replacementGlobalPrototype = {};
    const replacementNamedPrototype = {};

    expect(Reflect.setPrototypeOf(global, replacementGlobalPrototype))
      .toBe(true);
    expect(Reflect.getPrototypeOf(global)).toBe(replacementGlobalPrototype);
    expect(Reflect.setPrototypeOf(namedProperties, replacementNamedPrototype))
      .toBe(true);
    expect(Reflect.getPrototypeOf(namedProperties))
      .toBe(replacementNamedPrototype);
  });
});

function createGlobalBinding(isGlobalPrototypeChainMutable = false): {
  binding: JavaScriptBinding;
  realm: Realm;
} {
  const getter = namedGetter(undefined);
  const interface_ = defineInterface({
    exposed: ['Window'],
    extendedAttributes: [identifier('Global', 'TestGlobal')],
    members: [getter],
    name: 'TestGlobal',
  });
  const implementations = new ImplementationRegistry();
  implementations.setOperationSteps(getter, () => undefined);
  implementations.setNamedPropertySteps(getter, {
    getSupportedPropertyNames: () => new Set(),
  });
  const realm = new Realm({ isGlobalPrototypeChainMutable });
  return {
    binding: new JavaScriptBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    ),
    realm,
  };
}

function operation(
  name: string,
  returns: OperationMember['returns'],
): OperationMember {
  return { arguments: [], kind: 'operation', name, returns };
}

function namedGetter(name: string | undefined): OperationMember {
  return {
    arguments: [{ name: 'name', type: idlType.DOMString }],
    kind: 'operation',
    name,
    returns: idlType.DOMString,
    special: 'getter',
  };
}

function identifier(name: string, value: string) {
  return { kind: 'identifier', name, value } as const;
}

function call(
  target: object,
  name: PropertyKey,
  receiver: unknown,
  ...argumentsList: unknown[]
): unknown {
  const method = Reflect.get(target, name) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(name)} is not callable`);
  return Reflect.apply(method, receiver, argumentsList);
}

function requireObject(value: object | null): object {
  if (!value) throw new Error('Expected an object');
  return value;
}

function classString(realm: Realm, value: object): string {
  const toString = Reflect.get(
    realm.intrinsics.objectPrototype,
    'toString',
  ) as (this: unknown) => string;
  return Reflect.apply(toString, value, []);
}
