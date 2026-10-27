import { InternalError } from '../../infra/index';
import type { JSRealm } from '../../js-engine/index';
import { webIDLCommonDefinitions, type Definition } from '../core/index';

import type { WebIDLEnvironment, WebIDLRealm } from '../environment';
import { DefinitionAssembly, type AssembledInterface, type IDLAttribute } from '../assembly/index';
import {
  getImplementationRecord, getPlatformRecord, type StampedImplInstance, type StampedPlatformObject,
} from './platform';

import { RealmBinding } from './realm';
import { registerImplementationBindings } from './register';
import type { AttributeBinding, ExtendedAttributeHooks, HTMLConstructorBinding } from './extended-attributes';

/**
 * Owns definitions and platform-object identity across registered realms.
 * Each realm binding owns its initial objects and implementation steps.
 */
// A weaker world type would permit registrations its declarations cannot use.
export class BindingWorld<in out Env extends WebIDLEnvironment = WebIDLEnvironment> {
  #assembly: DefinitionAssembly;
  #realmBindings = new WeakMap<JSRealm, RealmBinding>();
  /** Prepared cross-specification accessors shared by every realm in this world. */
  #attributeBindings = new Map<IDLAttribute, Map<AssembledInterface, AttributeBinding>>();
  /** HTML constructor rules prepared once; invocation selects the current realm. */
  #htmlConstructors = new Map<AssembledInterface, HTMLConstructorBinding>();

  constructor(definitions: Definition<Env>[], options: BindingWorldOptions<Env> = {}) {
    this.#assembly = new DefinitionAssembly([
      ...webIDLCommonDefinitions,
      // BindingWorld restricts registration to the environment required by these callbacks.
      // Assembly itself only combines declarations; it does not invoke the callbacks.
      ...(definitions as Definition[]),
    ]);
    const prepare = options.extendedAttributes?.prepareReflectedAttribute;
    if (prepare) {
      // A shared mixin member must be prepared against all its includers, not just the first.
      const owners = new Map<IDLAttribute, AssembledInterface[]>();
      for (const assembled of this.#assembly.interfaces.values()) {
        for (const { member } of assembled.members) {
          if (member.kind !== 'attribute') continue;
          const includers = owners.get(member);
          if (includers) includers.push(assembled);
          else owners.set(member, [assembled]);
        }
      }
      for (const [member, includers] of owners) {
        const accessors = prepare(member, includers);
        // As with declaration callbacks, registration enforces this world's Env contract.
        if (accessors) this.#attributeBindings.set(member, accessors as Map<AssembledInterface, AttributeBinding>);
      }
    }
    const prepareHTMLConstructor = options.extendedAttributes?.prepareHTMLConstructor;
    if (prepareHTMLConstructor) {
      for (const assembled of this.#assembly.interfaces.values()) {
        const construct = prepareHTMLConstructor(assembled);
        // Registration enforces this world's environment contract, as for attribute bindings.
        if (construct) this.#htmlConstructors.set(assembled, construct as HTMLConstructorBinding);
      }
    }
  }

  /** Compose a realm's environment and binding context, reusing an existing registration. */
  register(
    realm: Env['realm'],
    createEnvironment: (ctx: BindingContext<Env>) => Env,
  ): BindingContext<Env> {
    const registered = this.getBindingContext(realm);
    if (registered) return registered;

    const binding = new RealmBinding<Env>(
      this.#assembly,
      realm,
      // Realm bindings retain world identity and registry operations. Registration
      // above is the boundary that checks the declaration's environment contract.
      this as unknown as BindingWorld,
      createEnvironment,
    );
    registerImplementationBindings(binding);
    if (this.#realmBindings.has(realm)) {
      throw new InternalError('Realm already has a registered binding');
    }
    this.#realmBindings.set(realm, binding);
    return binding;
  }

  /** Find this world's prepared accessors for a member on its declaring or including interface. */
  getAttributeBinding(member: IDLAttribute, owner: AssembledInterface): AttributeBinding | undefined {
    return this.#attributeBindings.get(member)?.get(owner);
  }

  /** Find HTML's prepared override for an interface in this world. */
  getHTMLConstructorBinding(owner: AssembledInterface): HTMLConstructorBinding | undefined {
    return this.#htmlConstructors.get(owner);
  }

  /** Find a realm's binding context in this world without registering it. */
  getBindingContext(realm: Env['realm']): BindingContext<Env> | undefined {
    // Registration checked the environment retained by this realm's binding.
    return this.#realmBindings.get(realm) as BindingContext<Env> | undefined;
  }

  /** Find a realm's binding, including for constructor prototype selection. */
  getRealmBinding(realm: JSRealm): RealmBinding | undefined {
    return this.#realmBindings.get(realm);
  }

  /** Retrieve the implementation paired with a platform object in this world. */
  unwrap(platformObject: object): StampedImplInstance | undefined {
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this ? record.implInst : undefined;
  }

  /** Retrieve or create a platform object if its implementation is already associated with this world. */
  project(implInst: object): StampedPlatformObject | undefined {
    const record = getImplementationRecord(implInst);
    return record?.binding.world === this ? record.project() : undefined;
  }

  /** Find the owning realm from an implementation or platform object associated with this world. */
  getRealm(value: object): WebIDLRealm | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this ? record.realm : undefined;
  }
}

/** Cross-specification integrations supplied by the composition root owning this world. */
export type BindingWorldOptions<Env extends WebIDLEnvironment = WebIDLEnvironment> = {
  extendedAttributes?: ExtendedAttributeHooks<Env>;
};

/** Public operations of a realm binding; this type does not introduce another runtime object. */
export type BindingContext<Env extends WebIDLEnvironment = WebIDLEnvironment> = Pick<RealmBinding<Env>,
  | 'realm' | 'InternalPromise' | 'DOMException' | 'getEnvironment'
  | 'install' | 'projectGlobalObject' | 'createPlatformRecord' | 'isInterfaceExposed'
  | 'jsToImpl' | 'implToJS' | 'createFrozenArray' | 'realizeException'
  | 'construct' | 'resolveArguments' | 'getObjectRecord' | 'associate' | 'project' | 'unwrap'
  | 'getPlatformObjectPrototype'
>;
