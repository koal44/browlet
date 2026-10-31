import { describe, expect, expectTypeOf, it } from 'vitest';

import type { JSFunction } from '../../../src/js-engine/index';
import {
  BindingWorld, attr, ctor, defineIncludes, defineInterface, defineInterfaceMixin, defineTypedef,
  hasExtendedAttribute, idlType, impl, reference, reflect, xattr,
  type AttributeBinding, type ExtendedAttributeHooks, type WebIDLEnvironment,
} from '../../../src/web-idl/index';
import { TestRealm } from '../../support/web-idl-realm';
import { getInstalledInterface } from '../../support/web-idl-binding';

describe('Web IDL extended-attribute integration', () => {
  it('finishes own members before attaching the final platform identity on every construction path', () => {
    class CreatedBaseImpl { inherited = 3; }
    class CreatedImpl extends CreatedBaseImpl { value = 7; }
    const base = defineInterface({
      name: 'CreatedBase', implementation: impl(CreatedBaseImpl),
      members: [attr('inherited', idlType.long, xattr('LegacyUnforgeable'))],
    });
    const definition = defineInterface({
      name: 'Created', inherits: 'CreatedBase', implementation: impl(CreatedImpl),
      members: [ctor(), attr('value', idlType.long, xattr('LegacyUnforgeable'))],
    });
    let preparations = 0;
    const allocations: object[] = [];
    const world = new BindingWorld([base, definition], {
      extendedAttributes: {
        preparePlatformObject(owner) {
          if (owner.primary.name !== 'Created') return;
          preparations++;
          return (ctx, object) => {
            expect(Object.getOwnPropertyDescriptor(object, 'value')).toMatchObject({
              get: expect.any(Function) as unknown, configurable: false,
            });
            expect(Object.getOwnPropertyDescriptor(object, 'inherited')).toMatchObject({
              get: expect.any(Function) as unknown, configurable: false,
            });
            expect(world.unwrap(object)).toBeUndefined();
            expect(Reflect.getPrototypeOf(object)).toBe(ctx.getPlatformObjectPrototype(owner));
            allocations.push(object);
            return new Proxy(object, {});
          };
        },
      },
    });
    for (let index = 0; index < 2; index++) {
      const ctx = world.register(new TestRealm(), (binding) => ({ realm: binding.realm }));
      const installed = world.getRealmBinding(ctx.realm)!.installDefinitions();
      const Constructor = getInstalledInterface(installed, 'Created');
      const implementation = ctx.construct(CreatedImpl);
      const lazy = world.project(implementation)!;
      const constructed = Reflect.construct(Constructor, []) as object;
      const internal = ctx.createPlatformRecord('Created')!.platformObject!;
      expect(world.project(implementation)).toBe(lazy);
      for (const object of [lazy, constructed, internal]) {
        expect(allocations).not.toContain(object);
        expect(world.getRealm(object)).toBe(ctx.realm);
        expect(world.unwrap(object)).toBeInstanceOf(CreatedImpl);
        expect(Reflect.get(object, 'value')).toBe(7);
        expect(Reflect.get(object, 'inherited')).toBe(3);
        expect(Reflect.set(object, 'value', 9)).toBe(true);
        expect(ctx.unwrap(object, CreatedImpl)?.value).toBe(9);
      }
    }
    expect(preparations).toBe(1);
    expect(allocations).toHaveLength(6);
    for (const object of allocations) expect(world.unwrap(object)).toBeUndefined();
  });

  it('can retry projection when additional creation steps fail before identity is attached', () => {
    let fail = true;
    const world = new BindingWorld(definitions, {
      extendedAttributes: {
        preparePlatformObject(owner) {
          if (owner.primary.name !== 'Example') return;
          return (_ctx, object) => {
            if (fail) throw new Error('Creation failed');
            return object;
          };
        },
      },
    });
    const ctx = world.register(new TestRealm(), (binding) => ({ realm: binding.realm }));
    const implementation = ctx.construct(ExampleImpl);
    expect(() => world.project(implementation)).toThrow('Creation failed');
    fail = false;
    const object = world.project(implementation)!;
    expect(world.unwrap(object)).toBe(implementation);
    expect(world.project(implementation)).toBe(object);
  });

  it('prepares resolved members once per world and uses the receiver environment across realms', () => {
    let preparations = 0;
    const invocations: WebIDLEnvironment[] = [];
    const extendedAttributes: ExtendedAttributeHooks = {
      prepareAttribute(member, owners) {
        if (!hasExtendedAttribute(member.extendedAttributes, 'Reflect')) return;
        preparations++;
        expect(member.type.kind).toBe('integer');
        expect(owners.map((owner) => owner.implementations.map(({ implClass }) => implClass))).toEqual([[ExampleImpl]]);
        const accessors: AttributeBinding<WebIDLEnvironment, ExampleImpl> = {
          get(ctx) {
            expectTypeOf(this).toEqualTypeOf<ExampleImpl>();
            invocations.push(ctx.getEnvironment());
            return this.value * 2;
          },
          set(ctx, value) {
            expectTypeOf(this).toEqualTypeOf<ExampleImpl>();
            invocations.push(ctx.getEnvironment());
            expect(typeof value).toBe('number');
            this.value = (value as number) / 2;
          },
        };
        // The owners above establish the receiver required by these typed accessors.
        return new Map(owners.map((owner) => [owner, accessors as AttributeBinding]));
      },
    };
    const world = new BindingWorld(definitions, { extendedAttributes });
    expect(preparations).toBe(1);
    const first = project(world);
    const second = project(world);
    const borrowed = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(second.object), 'value')!;
    const input = { valueOf() { return 15.9; } };
    borrowed.set!.call(first.object, input);
    expect(first.implementation.value).toBe(7.5);
    expect(borrowed.get!.call(first.object)).toBe(15);
    expect(first.object.value).toBe(15);
    expect(invocations).toEqual([first.env, first.env, first.env]);
    expect(second.implementation.value).toBe(3);
    expect(first.object.label).toBe('ordinary');
    expect(() => { borrowed.get!.call({}); }).toThrow(second.env.realm.TypeError);
    expect(preparations).toBe(1);

    // Preparation must not replace the declaration's type or mutate shared getter/setter metadata.
    expect(valueMember.type).toEqual(reference('Count'));
    expect(valueMember.get).toBeUndefined();
    expect(valueMember.set).toBeUndefined();
    const ordinary = project(new BindingWorld(definitions));
    expect(ordinary.object.value).toBe(3);
  });

  it('prepares a shared mixin member once with different accessors for its includers', () => {
    class FirstImpl extends ExampleImpl {}
    class SecondImpl extends ExampleImpl {}
    let preparations = 0;
    const world = new BindingWorld([
      defineInterfaceMixin({ name: 'Shared', members: [attr('value', idlType.long, xattr(reflect()))] }),
      defineInterface({ name: 'First', implementation: impl(FirstImpl), members: [] }),
      defineInterface({ name: 'Second', implementation: impl(SecondImpl), members: [] }),
      defineIncludes({ interface: 'First', mixin: 'Shared' }),
      defineIncludes({ interface: 'Second', mixin: 'Shared' }),
    ], {
      extendedAttributes: {
        prepareAttribute(member, owners) {
          if (!hasExtendedAttribute(member.extendedAttributes, 'Reflect')) return;
          preparations++;
          expect(owners.map((owner) => owner.implementations.map(({ implClass }) => implClass))).toEqual([[FirstImpl], [SecondImpl]]);
          return new Map(owners.map((owner) => {
            const multiplier = owner.implementations[0]!.implClass === FirstImpl ? 2 : 3;
            const accessors: AttributeBinding<WebIDLEnvironment, ExampleImpl> = {
              get() { return this.value * multiplier; },
            };
            return [owner, accessors as AttributeBinding];
          }));
        },
      },
    });
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    for (const implementation of [FirstImpl, SecondImpl]) {
      const object = context.project(implementation, context.construct(implementation));
      expect(Reflect.get(object, 'value')).toBe(implementation === FirstImpl ? 6 : 9);
    }
    expect(preparations).toBe(1);
  });

  it('rejects an invalid extension during world preparation, before any realm is registered', () => {
    const failure = new Error('Invalid extended attribute');
    expect(() => new BindingWorld(definitions, {
      extendedAttributes: {
        prepareAttribute(member) {
          if (hasExtendedAttribute(member.extendedAttributes, 'Reflect')) throw failure;
        },
      },
    })).toThrow(failure);
  });

  it('prepares HTML constructor rules once, passing the invoking realm and constructor identities', () => {
    let preparations = 0;
    const calls: { env: WebIDLEnvironment; newTarget: JSFunction | undefined; activeFunction: JSFunction; }[] = [];
    const result = {};
    const world = new BindingWorld([htmlConstructorDefinition], {
      extendedAttributes: {
        prepareHTMLConstructor(owner) {
          if (owner.primary.name !== 'HTMLExample') return;
          preparations++;
          return (ctx, newTarget, activeFunction) => {
            calls.push({ env: ctx.getEnvironment(), newTarget, activeFunction });
            return result;
          };
        },
      },
    });
    for (let index = 0; index < 2; index++) {
      const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
      const installed = world.getRealmBinding(context.realm)!.installDefinitions();
      const Constructor = getInstalledInterface(installed, 'HTMLExample');
      const Target = function Target() {};
      expect(Reflect.construct(Constructor, [], Target)).toBe(result);
      expect(Reflect.apply(Constructor, null, [])).toBe(result);
      expect(calls.splice(0)).toEqual([
        { env: context.getEnvironment(), newTarget: Target, activeFunction: Constructor },
        { env: context.getEnvironment(), newTarget: undefined, activeFunction: Constructor },
      ]);
    }
    expect(preparations).toBe(1);
  });

  it('requires HTML constructor integration instead of silently using ordinary construction', () => {
    const world = new BindingWorld([htmlConstructorDefinition]);
    expect(() => world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm })))
      .toThrow('[HTMLConstructor] requires HTML constructor hooks');
  });
});

class ExampleImpl {
  value = 3;
  label = 'ordinary';
}

const valueMember = attr('value', reference('Count'), xattr(reflect()));
const definitions = [
  defineInterface({
    name: 'Example', exposed: '*', implementation: impl(ExampleImpl),
    members: [valueMember, attr('label', idlType.DOMString, xattr('Unrecognized'))],
  }),
  defineTypedef({ name: 'Count', type: idlType.long }),
];

const htmlConstructorDefinition = defineInterface({
  name: 'HTMLExample', exposed: '*', implementation: impl(ExampleImpl),
  members: [ctor([], xattr('HTMLConstructor'))],
});

function project(world: BindingWorld) {
  const env = { realm: new TestRealm() };
  const context = world.register(env.realm, () => env);
  const implementation = context.construct(ExampleImpl);
  const object = context.project(ExampleImpl, implementation) as unknown as { value: number; label: string; };
  return { env, context, implementation, object };
}
