import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/scripting/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, definePartialInterface, idlType, integer,
  type AttributeMember, type OperationMember, type StringifierMember,
} from '../../../src/web-idl/declaration/index';
import { ImplementationRegistry } from '../../../src/web-idl/registry';
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
    expect(Object.hasOwn(global, 'ANSWER')).toBe(false);
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

  it('inherits unenumerable named properties', () => {
    const namedItem = namedGetter('namedItem');
    const base = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [
        noArguments('LegacyUnenumerableNamedProperties'),
      ],
      members: [namedItem],
      name: 'NamedBase',
    });
    const window = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [identifier('Global', 'Window')],
      inherits: 'NamedBase',
      members: [],
      name: 'Window',
    });
    const implementations = new ImplementationRegistry();
    implementations.setOperationSteps(namedItem, () => 'named value');
    implementations.setNamedPropertySteps(namedItem, {
      getSupportedPropertyNames: () => new Set(['named']),
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([window, base]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const global = binding.projectGlobalObject(
      Reflect.construct(realm.intrinsics.object, []),
      'Window',
    ).object;
    const globalPrototype = requireObject(Reflect.getPrototypeOf(global));
    const namedProperties = requireObject(
      Reflect.getPrototypeOf(globalPrototype),
    );

    expect(Reflect.get(global, 'named')).toBe('named value');
    expect(Object.getOwnPropertyDescriptor(namedProperties, 'named'))
      .toEqual({
        configurable: true,
        enumerable: false,
        value: 'named value',
        writable: true,
      });
  });

  it('uses the projected global for nullish attribute receivers', () => {
    const value = attribute('value', idlType.DOMString);
    const replaceable = attribute('replaceable', idlType.DOMString, true, [
      noArguments('Replaceable'),
    ]);
    const forwarded = attribute('forwarded', idlType.object, true, [{
      kind: 'identifier', name: 'PutForwards', value: 'value',
    }]);
    const interface_ = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [identifier('Global', 'Window')],
      members: [value, replaceable, forwarded],
      name: 'Window',
    });
    const values = new WeakMap<object, string>();
    const forwardedTarget = { value: 'original' };
    const implementations = new ImplementationRegistry();
    implementations.setAttributeSteps(value, {
      get() { return values.get(this as object) ?? ''; },
      set(next) { values.set(this as object, next as string); },
    });
    implementations.setAttributeSteps(replaceable, {
      get: () => 'original',
    });
    implementations.setAttributeSteps(forwarded, {
      get: () => forwardedTarget,
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const implementation = Reflect.construct(realm.intrinsics.object, []);
    values.set(implementation, 'initial');
    const global = binding.projectGlobalObject(
      implementation,
      'Window',
    ).object;
    const valueDescriptor = requireAccessor(global, 'value');
    const replaceableDescriptor = requireAccessor(global, 'replaceable');
    const forwardedDescriptor = requireAccessor(global, 'forwarded');

    expect(Reflect.apply(valueDescriptor.get, undefined, []))
      .toBe('initial');
    Reflect.apply(valueDescriptor.set, null, ['updated']);
    expect(Reflect.apply(valueDescriptor.get, null, []))
      .toBe('updated');

    Reflect.apply(replaceableDescriptor.set, undefined, ['shadowed']);
    expect(Object.getOwnPropertyDescriptor(global, 'replaceable'))
      .toMatchObject({ value: 'shadowed' });
    expect(Object.hasOwn(realm.global, 'replaceable')).toBe(false);

    Reflect.apply(forwardedDescriptor.set, null, ['forwarded']);
    expect(forwardedTarget.value).toBe('forwarded');
  });

  it('rejects nullish global stringifier receivers', () => {
    const stringifier = { kind: 'stringifier' } satisfies StringifierMember;
    const interface_ = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [identifier('Global', 'Window')],
      members: [stringifier],
      name: 'Window',
    });
    const implementations = new ImplementationRegistry();
    implementations.setStringificationBehavior(
      stringifier,
      () => 'global stringifier',
    );
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const global = binding.projectGlobalObject(
      Reflect.construct(realm.intrinsics.object, []),
      'Window',
    ).object;
    const toString = Reflect.get(global, 'toString') as unknown;
    if (typeof toString !== 'function') {
      throw new Error('Missing global stringifier');
    }

    expect(Reflect.apply(toString, global, [])).toBe('global stringifier');
    expect(() => { Reflect.apply(toString, null, []); })
      .toThrow(realm.intrinsics.typeError);
    expect(() => { Reflect.apply(toString, undefined, []); })
      .toThrow(realm.intrinsics.typeError);
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

  it('projects a global declared by the partial containing its named getter', () => {
    const getter = namedGetter(undefined);
    const interface_ = defineInterface({
      exposed: ['PartialGlobal'],
      members: [],
      name: 'PartialGlobal',
    });
    const partial = definePartialInterface({
      extendedAttributes: [identifier('Global', 'PartialGlobal')],
      members: [getter],
      name: 'PartialGlobal',
    });
    const implementations = new ImplementationRegistry();
    implementations.setOperationSteps(getter, (name) =>
      name === 'answer' ? 'named answer' : undefined);
    implementations.setNamedPropertySteps(getter, {
      getSupportedPropertyNames: () => new Set(['answer']),
    });
    const realm = new Realm({ globalNames: ['PartialGlobal'] });
    const binding = new JavaScriptBinding(
      assembleDefinitions([interface_, partial]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const global = binding.projectGlobalObject(
      Reflect.construct(realm.intrinsics.object, []),
      'PartialGlobal',
    ).object;

    expect(Reflect.get(global, 'answer')).toBe('named answer');
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

function attribute(
  name: string,
  type: AttributeMember['type'],
  readonly = false,
  extendedAttributes?: AttributeMember['extendedAttributes'],
): AttributeMember {
  return { extendedAttributes, kind: 'attribute', name, readonly, type };
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

function noArguments(name: string) {
  return { kind: 'no-arguments', name } as const;
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

function requireAccessor(
  object: object,
  name: string,
): { get: CallableFunction; set: CallableFunction; } {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!descriptor?.get || !descriptor.set) {
    throw new Error(`Expected ${name} accessor`);
  }
  return descriptor as { get: CallableFunction; set: CallableFunction; };
}

function classString(realm: Realm, value: object): string {
  const toString = Reflect.get(
    realm.intrinsics.objectPrototype,
    'toString',
  ) as (this: unknown) => string;
  return Reflect.apply(toString, value, []);
}
