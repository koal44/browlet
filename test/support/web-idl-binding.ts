import type { JSFunction } from '../../src/js-engine/index';
import {
  hasExtendedAttribute, type Definition, type InterfaceMember, type NamespaceMember, type NamedArgumentsExtendedAttribute,
  type PrimaryInterfaceDefinition,
} from '../../src/web-idl/core/index';
import { AssembledInterface, type AssembledNamespace } from '../../src/web-idl/assembly/index';
import { BindingWorld } from '../../src/web-idl/binding/world';
import type { RealmBinding } from '../../src/web-idl/binding/realm';
import type { ImplementationBinding } from '../../src/web-idl/binding/realm/implementation';
import type { MemberBinding } from '../../src/web-idl/binding/realm/member';

import { TestRealm } from './web-idl-realm';

/** Register declarations in a fresh test realm without installing global properties. */
export function createBinding(
  definitions: Definition[] = [],
): { binding: RealmBinding; realm: TestRealm; } {
  const realm = new TestRealm();
  const world = new BindingWorld(definitions);
  world.register(realm, (ctx) => ({ realm: ctx.realm }));
  return { binding: world.getRealmBinding(realm)!, realm };
}

/** Register a test realm in the supplied world and install its exposed definitions. */
export function installTestBindings(world: BindingWorld, realm = new TestRealm()) {
  const context = world.register(realm, (ctx) => ({ realm: ctx.realm }));
  const globalObject = realm.globalObject;
  context.install(globalObject);
  return { realm, context, globalObject };
}

/** Audit automatic members on a supplied implementation without putting internal checks on author calls. */
export function validateImplementationMembers<Env>(definition: PrimaryInterfaceDefinition<Env>, implementation: object): void {
  for (const member of definition.members) {
    let name: PropertyKey | undefined;
    let method = true;
    switch (member.kind) {
      case 'attribute':
        if (member.get || member.set || member.attributeFunction ||
          member.extendedAttributes?.some((attribute) => attribute.kind === 'reflection')) continue;
        method = false;
        name = member.name;
        break;
      case 'operation':
        if (member.invoke || hasExtendedAttribute(member.extendedAttributes, 'Default')) continue;
        name = member.name;
        break;
      case 'named-getter':
        if (typeof Reflect.get(implementation, 'getSupportedPropertyNames') !== 'function') {
          throw new Error(`Web IDL ${definition.name}.getSupportedPropertyNames has no implementation`);
        }
        name = member.method;
        break;
      case 'iterable':
        if (member.key !== undefined) name = 'getEntryList';
        break;
      case 'async-iterable': name = member.create; break;
      case 'stringifier': name = 'toString'; break;
      default: continue;
    }
    if (name === undefined) continue;
    const target = (member.kind === 'attribute' || member.kind === 'operation') && member.static
      ? implementation.constructor : implementation;
    let owner: object | null = target;
    while (owner !== null && owner !== Object.prototype && !Object.hasOwn(owner, name)) {
      owner = Reflect.getPrototypeOf(owner);
    }
    if (owner === null || owner === Object.prototype || method && typeof Reflect.get(target, name) !== 'function') {
      throw new Error(`Web IDL ${definition.name}.${String(name)} has no implementation`);
    }
  }
}

export function getInstalledInterface(
  installed: Map<string, object>,
  name: string,
): JSFunction & { prototype: object; } {
  const value = installed.get(name);
  if (typeof value !== 'function') throw new Error(`${name} was not installed as an interface object`);
  return value as JSFunction & { prototype: object; };
}

/** Locate a declaration's compiled member before attaching test-specific binding steps. */
export function getMemberBinding<Assembled extends AssembledInterface | AssembledNamespace>(
  binding: ImplementationBinding<Assembled>,
  declaration: InterfaceMember | NamespaceMember | NamedArgumentsExtendedAttribute,
): MemberBinding<Assembled> {
  const assembled = binding.assembled;
  if (declaration.kind === 'named-arguments' && assembled instanceof AssembledInterface) {
    let index = 0;
    for (const source of [assembled.primary, ...assembled.partials]) {
      for (const attribute of source.extendedAttributes ?? []) {
        if (attribute.kind !== 'named-arguments' || attribute.value !== declaration.value) continue;
        if (attribute === declaration) {
          const factory = assembled.getLegacyFactoryOverloads(declaration.value);
          return binding.getOrCreateMemberBinding(factory.callables[index]!);
        }
        index++;
      }
    }
  }
  const positions = new Map<object, number>();
  for (const { member, source } of assembled.members) {
    const index = positions.get(source) ?? 0;
    if (source.members[index] === declaration) return binding.getOrCreateMemberBinding(member);
    positions.set(source, index + 1);
  }
  throw new Error('The test declaration has no assembled member');
}
