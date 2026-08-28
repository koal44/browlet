import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/scripting/realm';
import {
  arg, bind, createBindings, ctor, defineCapability, defineInterface,
  idlType, impl, op, roAttr, xattr,
} from '../../../src/web-idl/index';

describe('Web IDL interface registration', () => {
  it('shares platform-object identity across realm registrations', () => {
    const interfaces = createBindings([exampleIDL]);
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

  it('isolates platform-object identity between bindings', () => {
    const first = createBindings([exampleIDL]);
    const second = createBindings([exampleIDL]);
    const realm = new Realm();
    const implementation = first.register(realm).objects.create(ExampleImpl);
    const object = first.getPlatformObject(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(second.getImplementationObject(object)).toBeUndefined();
    expect(second.getPlatformObject(implementation)).toBeUndefined();
    expect(second.getRealm(object)).toBeUndefined();
  });

  it('projects default operations without implementation methods', () => {
    const interfaces = createBindings([jsonIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    const implementation = registration.objects.create(JsonImpl);
    const object = interfaces.getPlatformObject(implementation);
    if (!object) throw new Error('JSONExample was not projected');
    const toJSON = Reflect.get(object, 'toJSON') as CallableFunction;

    expect(Reflect.apply(toJSON, object, [])).toEqual({ value: 12 });
  });

  it('requires explicit bindings for unnamed operations', () => {
    const interfaces = createBindings([unnamedOperationIDL]);

    expect(() => interfaces.register(new Realm())).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
  });

  it('indexes capabilities by exact primary interface', () => {
    class ParentImpl {}
    class ChildImpl extends ParentImpl {}
    const parentIDL = defineInterface({
      name: 'CapabilityParent',
      exposed: '*',
      implementation: impl(ParentImpl),
      members: [],
    });
    const childIDL = defineInterface({
      name: 'CapabilityChild',
      inherits: parentIDL.name,
      exposed: '*',
      implementation: impl(ChildImpl),
      members: [],
    });
    const capability = defineCapability<string>('Test');
    const interfaces = createBindings(
      [parentIDL, childIDL],
      {
        capabilities: [
          capability.for(parentIDL, 'parent'),
          capability.for(childIDL, 'child'),
        ],
      },
    );
    const registration = interfaces.register(new Realm());
    const child = registration.interfaces.create(childIDL);

    expect(registration.interfaces.resolve(child.object)).toEqual(child);
    expect(child.primaryInterface).toBe(childIDL);
    expect(registration.interfaces.getCapability(
      child.primaryInterface,
      capability,
    )).toBe('child');
    expect(registration.interfaces.getCapability(parentIDL, capability))
      .toBe('parent');
  });

  it('creates internal instances without running public constructor steps', () => {
    let allocations = 0;
    let publicConstructions = 0;
    class InternalNewImpl {
      constructor() { allocations++; }
    }
    const interfaceIDL = defineInterface({
      name: 'InternalNewExample',
      exposed: '*',
      implementation: impl(InternalNewImpl),
      members: [ctor([], bind({
        invoke() { publicConstructions++; },
      }))],
    });
    const interfaces = createBindings([interfaceIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    registration.install(realm.global);

    const internal = registration.interfaces.create(interfaceIDL);

    expect(internal.primaryInterface).toBe(interfaceIDL);
    expect(internal.realm).toBe(realm);
    expect(allocations).toBe(1);
    expect(publicConstructions).toBe(0);

    const Constructor = Reflect.get(realm.global, interfaceIDL.name) as {
      new(): object;
    };
    const constructed = new Constructor();

    expect(registration.interfaces.resolve(constructed)?.primaryInterface)
      .toBe(interfaceIDL);
    expect(allocations).toBe(2);
    expect(publicConstructions).toBe(1);
  });

  it('rejects foreign, duplicate, and unexposed interface capabilities', () => {
    class RestrictedImpl {}
    const restrictedIDL = defineInterface({
      name: 'RestrictedCapability',
      exposed: ['Worker'],
      implementation: impl(RestrictedImpl),
      members: [],
    });
    const foreignIDL = defineInterface({
      name: restrictedIDL.name,
      members: [],
    });
    const capability = defineCapability<string>('Restricted');

    expect(() => createBindings(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(foreignIDL, 'foreign'),
        ],
      },
    )).toThrow('targets unknown interface definition RestrictedCapability');
    expect(() => createBindings(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(restrictedIDL, 'first'),
          capability.for(restrictedIDL, 'second'),
        ],
      },
    )).toThrow('has a duplicate Restricted capability implementation');

    const registration = createBindings(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(restrictedIDL, 'registered'),
        ],
      },
    ).register(new Realm());

    expect(registration.interfaces.isExposed(restrictedIDL)).toBe(false);
    expect(() => registration.interfaces.create(restrictedIDL)).toThrow(
      'Interface RestrictedCapability is not exposed in this realm',
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
