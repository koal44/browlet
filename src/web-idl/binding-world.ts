import { DefinitionAssembly } from './assembly';
import { RealmBinding } from './realm-binding';
import type { BindingContext } from './binding-context';
import { webIDLCommonDefinitions } from './common-definitions';
import type { CapabilityRegistration } from './capability';
import type { Definition } from './core/index';
import type { HostDefinedInterface } from './conversion';
import type { WebIDLRealmHost } from './realm-host';
import {
  getImplementationRecord, getPlatformRecord,
  type StampedImplInstance, type StampedPlatformObject,
} from './platform-object';
import { registerDefinitionBindings } from './implementation-binding';
import { ImplementationRegistry } from './implementation-registry';
import type { RuntimeContext } from '../js-engine/runtime-context';
import type { JSRealm } from '../js-engine/index';

/**
 * Owns definitions and platform-object identity across registered realms.
 * Each realm binding owns its initial objects and implementation steps.
 */
export class BindingWorld<Realm extends WebIDLRealmHost = WebIDLRealmHost> {
  #definitions: DefinitionAssembly;
  #hostDefinedInterfaces: HostDefinedInterface[];
  #realmBindings = new WeakMap<JSRealm, RealmBinding>();

  // Project helper: compose definitions and capabilities shared across realm bindings.
  constructor(
    definitions: Definition<Realm>[],
    options: BindingWorldOptions = {},
  ) {
    this.#definitions = new DefinitionAssembly([
      ...webIDLCommonDefinitions,
      // BindingWorld restricts registration to the realm required by these callbacks.
      // Assembly itself only combines declarations; it does not invoke the callbacks.
      ...(definitions as Definition[]),
    ], options.capabilities);
    this.#hostDefinedInterfaces = options.hostDefinedInterfaces ?? [];
  }

  /** Register a realm in this world, returning its shared binding context. */
  register(realm: Realm, options: RealmRegistrationOptions<Realm> = {}): BindingContext<Realm> {
    const registered = this.forRealm(realm);
    if (registered) return registered;

    const binding = new RealmBinding(
      this.#definitions,
      realm,
      this,
      new ImplementationRegistry(),
      [...this.#hostDefinedInterfaces],
      options.createRuntime,
    );
    registerDefinitionBindings(binding);
    return binding.context;
  }

  /** Find a realm's binding context in this world without registering it. */
  forRealm(realm: Realm): BindingContext<Realm> | undefined {
    // The key is the binding's own realm, retaining this host type.
    return this.#realmBindings.get(realm)?.context as BindingContext<Realm> | undefined;
  }

  /** Publish a realm binding after its declaration setup succeeds. */
  registerRealm(binding: RealmBinding): void {
    if (this.#realmBindings.has(binding.realm)) {
      throw new TypeError('Realm already has a registered binding');
    }
    this.#realmBindings.set(binding.realm, binding);
  }

  /** Find a realm's binding, including for constructor prototype selection. */
  getRealmBinding(realm: JSRealm): RealmBinding | undefined {
    return this.#realmBindings.get(realm);
  }

  // Project helper: retrieve the implementation paired with a platform object in this world.
  unwrap(platformObject: object): StampedImplInstance | undefined {
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this ? record.implInst : undefined;
  }

  // Project helper: project an associated implementation using its owning realm.
  project(implInst: object): StampedPlatformObject | undefined {
    const record = getImplementationRecord(implInst);
    return record?.binding.world === this ? record.project() : undefined;
  }

  // Project helper: retrieve the owning realm from either object identity.
  getRealm(value: object): WebIDLRealmHost | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this ? record.realm : undefined;
  }
}

export type BindingWorldOptions = {
  capabilities?: CapabilityRegistration[];
  hostDefinedInterfaces?: HostDefinedInterface[];
};

export type RealmRegistrationOptions<Realm extends WebIDLRealmHost = WebIDLRealmHost> = {
  createRuntime?: (ctx: BindingContext<Realm>) => RuntimeContext;
};
