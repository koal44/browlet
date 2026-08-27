import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/scripting/realm';
import {
  arg, defineInterface, idlType, impl, op, roAttr,
  registerInterfaceBindings, xattr,
} from '../../../src/web-idl/index';

describe('Web IDL interface registration', () => {
  it('shares platform-object identity across realm registrations', () => {
    const interfaces = registerInterfaceBindings([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register(firstRealm);
    const second = interfaces.register(secondRealm);

    first.install(firstRealm.global);
    second.install(secondRealm.global);

    const implementation = first.objects.create(ExampleImpl);
    const object = interfaces.getPlatformObject(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(interfaces.register(firstRealm)).toBe(first);
    expect(interfaces.getImplementationObject(object)).toBe(implementation);
    expect(interfaces.getRealm(object)).toBe(firstRealm);
    expect(second.objects.getImplementation(object, ExampleImpl))
      .toBe(implementation);
    expect(Reflect.get(firstRealm.global, 'Example')).not
      .toBe(Reflect.get(secondRealm.global, 'Example'));
  });

  it('isolates platform-object identity between binding domains', () => {
    const first = registerInterfaceBindings([exampleIDL]);
    const second = registerInterfaceBindings([exampleIDL]);
    const realm = new Realm();
    const implementation = first.register(realm).objects.create(ExampleImpl);
    const object = first.getPlatformObject(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(second.getImplementationObject(object)).toBeUndefined();
    expect(second.getPlatformObject(implementation)).toBeUndefined();
    expect(second.getRealm(object)).toBeUndefined();
  });

  it('projects default operations without implementation methods', () => {
    const interfaces = registerInterfaceBindings([jsonIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    const implementation = registration.objects.create(JsonImpl);
    const object = interfaces.getPlatformObject(implementation);
    if (!object) throw new Error('JSONExample was not projected');
    const toJSON = Reflect.get(object, 'toJSON') as CallableFunction;

    expect(Reflect.apply(toJSON, object, [])).toEqual({ value: 12 });
  });

  it('requires explicit bindings for unnamed operations', () => {
    const interfaces = registerInterfaceBindings([unnamedOperationIDL]);

    expect(() => interfaces.register(new Realm())).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
  });
});

class ExampleImpl {}

class JsonImpl {
  get value(): number { return 12; }
}

const exampleIDL = defineInterface({
  name: 'Example',
  exposed: '*',
  implementation: impl(ExampleImpl),
  members: [],
});

const jsonIDL = defineInterface({
  name: 'JSONExample',
  exposed: '*',
  implementation: impl(JsonImpl),
  members: [
    roAttr('value', idlType.long),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

const unnamedOperationIDL = defineInterface({
  name: 'UnnamedOperationExample',
  exposed: '*',
  implementation: impl(ExampleImpl),
  members: [op(
    undefined,
    idlType.object,
    [arg('name', idlType.DOMString)],
    { special: 'getter' },
  )],
});
