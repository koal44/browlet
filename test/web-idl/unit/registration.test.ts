import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/scripting/realm';
import {
  bind, defineInterface, registerInterfaceBindings,
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
});

class ExampleImpl {}

const exampleIDL = defineInterface({
  binding: bind(ExampleImpl),
  exposed: '*',
  members: [],
  name: 'Example',
});
