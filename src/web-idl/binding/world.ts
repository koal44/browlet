import { InternalError } from '../../infra/index';
import { getCreationRealm, isObject, type JSRealm } from '../../js-engine/index';
import { webIDLCommonDefinitions, type Definition } from '../core/index';

import { DefinitionAssembly, type AssembledInterface, type IDLAttribute } from '../assembly/index';
import {
  getImplementationRecord, getPlatformRecord, PlatformRecord, type StampedImplInstance,
} from '../values/index';
import type { WebIDLEnvironment, WebIDLRealm } from '../environment';

import { RealmBinding } from './realm';
import { registerImplementationBindings } from './register';
import type {
  AttributeBinding, ExtendedAttributeHooks, HTMLConstructorBinding, ProjectionOverride,
  PlatformObjectBinding, SecurityCheckBinding,
} from './extended-attributes';

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
  /** Invocation policies selected by the receiver's interface, independent of the member's owner. */
  #securityChecks = new Map<AssembledInterface, SecurityCheckBinding>();
  /** Additional platform creation steps owned by the interface's specification. */
  #platformObjects = new Map<AssembledInterface, PlatformObjectBinding>();
  /** Outward projection rules prepared once for each participating interface. */
  #projectionOverrides = new Map<AssembledInterface, ProjectionOverride>();
  /** Host lookup shared by this world's registered realm bindings. */
  #incumbentEnvironment?: (methodEnv: WebIDLEnvironment) => WebIDLEnvironment | undefined;

  constructor(definitions: Definition<Env>[], options: BindingWorldOptions<Env> = {}) {
    // Registration enforces Env, as for the other composition callbacks retained here.
    this.#incumbentEnvironment = options.getIncumbentEnvironment as
      ((methodEnv: WebIDLEnvironment) => WebIDLEnvironment | undefined) | undefined;
    this.#assembly = new DefinitionAssembly([
      ...webIDLCommonDefinitions,
      // BindingWorld restricts registration to the environment required by these callbacks.
      // Assembly itself only combines declarations; it does not invoke the callbacks.
      ...(definitions as Definition[]),
    ]);
    const prepare = options.extendedAttributes?.prepareAttribute;
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
    const prepareSecurityCheck = options.extendedAttributes?.prepareSecurityCheck;
    if (prepareSecurityCheck) {
      for (const assembled of this.#assembly.interfaces.values()) {
        const check = prepareSecurityCheck(assembled);
        // Registration enforces this world's environment contract, as for attribute bindings.
        if (check) this.#securityChecks.set(assembled, check as SecurityCheckBinding);
      }
    }
    const preparePlatformObject = options.extendedAttributes?.preparePlatformObject;
    if (preparePlatformObject) {
      for (const assembled of this.#assembly.interfaces.values()) {
        const create = preparePlatformObject(assembled);
        if (create) {
          if (assembled.isGlobal()) throw new InternalError('Global objects require explicit global allocation');
          // Registration enforces this world's environment contract.
          this.#platformObjects.set(assembled, create as PlatformObjectBinding);
        }
      }
    }
    const prepareProjectionOverride = options.extendedAttributes?.prepareProjectionOverride;
    if (prepareProjectionOverride) {
      for (const assembled of this.#assembly.interfaces.values()) {
        const project = prepareProjectionOverride(assembled);
        if (project) this.#projectionOverrides.set(assembled, project);
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

  /** Retrieve the host incumbent; direct host invocations may have none. */
  getIncumbentEnvironment(methodEnv: Env): Env | undefined {
    if (!this.#incumbentEnvironment) throw new InternalError('BindingWorld has no incumbent environment provider');
    return this.#incumbentEnvironment(methodEnv) as Env | undefined;
  }

  /** Find this world's prepared accessors for a member on its declaring or including interface. */
  getAttributeBinding(member: IDLAttribute, owner: AssembledInterface): AttributeBinding | undefined {
    return this.#attributeBindings.get(member)?.get(owner);
  }

  /** Find HTML's prepared override for an interface in this world. */
  getHTMLConstructorBinding(owner: AssembledInterface): HTMLConstructorBinding | undefined {
    return this.#htmlConstructors.get(owner);
  }

  /** Find the prepared security check for the receiver's actual interface. */
  getSecurityCheckBinding(owner: AssembledInterface): SecurityCheckBinding | undefined {
    return this.#securityChecks.get(owner);
  }

  /** Find additional creation steps for a non-global platform object. */
  getPlatformObjectBinding(owner: AssembledInterface): PlatformObjectBinding | undefined {
    return this.#platformObjects.get(owner);
  }

  /** Find outward projection steps for an implementation's actual interface. */
  getProjectionOverride(owner: AssembledInterface): ProjectionOverride | undefined {
    return this.#projectionOverrides.get(owner);
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

  /** Find the record for either side of a platform/implementation pair in this world, associating native objects when possible. */
  getObjectRecord(platformObjectOrImplInst: unknown): PlatformRecord | undefined {
    const existing = getPlatformRecord(platformObjectOrImplInst) ??
      getImplementationRecord(platformObjectOrImplInst);
    // Registration retains this same world with its environment type erased.
    if (existing) return existing.binding.world === (this as unknown as BindingWorld) ? existing : undefined;
    if (!isObject(platformObjectOrImplInst)) return;
    const platformObject = platformObjectOrImplInst;
    const assembled = this.#assembly.interfaces.findForNativeObject(platformObject);
    if (!assembled) return;
    // ACCOMMODATION(node-v8-object-realms): Never turn stock Node's prototype or
    // active-realm guesses into permanent ownership. Native values remain usable.
    const realm = getCreationRealm(platformObject);
    const binding = realm && this.getRealmBinding(realm);
    return binding ? new PlatformRecord(platformObject, assembled, binding, platformObject) : undefined;
  }

  /** Retrieve the implementation paired with a platform object in this world. */
  unwrap(platformObject: object): StampedImplInstance | undefined {
    const record = this.getObjectRecord(platformObject);
    return record?.platformObject === platformObject ? record.implInst : undefined;
  }

  /** Project an implementation, associating native objects when their creation realm belongs to this world. */
  project(implInst: object): object | null | undefined {
    const record = this.getObjectRecord(implInst);
    return record?.implInst === implInst ? record.project() : undefined;
  }

  /** Find the owning realm from an implementation or platform object associated with this world. */
  getRealm(platformObjectOrImplInst: object): WebIDLRealm | undefined {
    return this.getObjectRecord(platformObjectOrImplInst)?.realm;
  }
}

/** Cross-specification integrations supplied by the composition root owning this world. */
export type BindingWorldOptions<Env extends WebIDLEnvironment = WebIDLEnvironment> = {
  extendedAttributes?: ExtendedAttributeHooks<Env>;
  /** Required by declarations requesting an incumbent input; supplied by the host composition root. */
  getIncumbentEnvironment?: (methodEnv: Env) => Env | undefined;
};

/** Public operations of a realm binding; this type does not introduce another runtime object. */
export type BindingContext<Env extends WebIDLEnvironment = WebIDLEnvironment> = Pick<RealmBinding<Env>,
  | 'realm' | 'InternalPromise' | 'DOMException' | 'getEnvironment' | 'getBindingContext'
  | 'install' | 'projectGlobalObject' | 'createPlatformRecord' | 'isInterfaceExposed'
  | 'jsToImpl' | 'implToJS' | 'createCallbackFunction' | 'createFrozenArray' | 'realizeException'
  | 'construct' | 'resolveArguments' | 'getObjectRecord' | 'associate' | 'project' | 'unwrap'
  | 'getPlatformObjectPrototype' | 'createMemberFunction' | 'resolveInterface' | 'performSecurityCheck'
>;
