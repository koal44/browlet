import { assembleDefinitions, type DefinitionAssembly } from './assembly';
import { RealmBinding } from './realm-binding';
import type { BindingContext } from './binding-context';
import { webIDLCommonDefinitions } from './common-definitions';
import {
  CapabilityRegistry, type CapabilityRegistration,
} from './capability';
import type { Definition } from './core/index';
import type { HostDefinedInterface } from './conversion';
import type { WebIDLRealmHost } from './realm-host';
import {
  getImplementationRecord, getPlatformRecord, PlatformObjectRegistry,
  type StampedImplInstance, type StampedPlatformObject,
} from './platform-object';
import { registerDefinitionBindings } from './implementation-binding';
import { ImplementationRegistry } from './implementation-registry';
import type { RuntimeContext } from '../js-engine/runtime-context';

/**
 * Owns definitions and platform-object identity across registered realms.
 * Each realm binding owns its initial objects and implementation steps.
 */
export class BindingWorld<Realm extends WebIDLRealmHost = WebIDLRealmHost> {
  readonly #definitions: DefinitionAssembly;
  readonly #hostDefinedInterfaces: readonly HostDefinedInterface[];
  readonly #capabilities: CapabilityRegistry;
  readonly #platformObjects = new PlatformObjectRegistry();

  // Project helper: compose shared definition, capability, and platform-object registries.
  constructor(
    definitions: readonly Definition<Realm>[],
    options: BindingWorldOptions = {},
  ) {
    this.#definitions = getDefinitionAssembly(definitions);
    this.#hostDefinedInterfaces = options.hostDefinedInterfaces ?? [];
    this.#capabilities = new CapabilityRegistry(
      this.#definitions,
      options.capabilities ?? [],
    );
  }

  /** Register a realm in this world, returning its shared binding context. */
  register(realm: Realm, options: RealmRegistrationOptions<Realm> = {}): BindingContext<Realm> {
    const registered = this.forRealm(realm);
    if (registered) return registered;

    const binding = new RealmBinding(
      this.#definitions,
      realm,
      this.#platformObjects,
      new ImplementationRegistry(),
      [...this.#hostDefinedInterfaces],
      this.#capabilities,
      options.createRuntime,
    );
    registerDefinitionBindings(binding);
    return binding.context;
  }

  /** Find a realm's binding context in this world without registering it. */
  forRealm(realm: Realm): BindingContext<Realm> | undefined {
    // The registry key is the binding's own realm, retaining this host type.
    return this.#platformObjects.getRealmBinding(realm)?.context as BindingContext<Realm> | undefined;
  }

  // Project helper: retrieve the implementation paired with a platform object in this world.
  unwrap(platformObject: object): StampedImplInstance | undefined {
    const record = getPlatformRecord(platformObject);
    return record?.binding.platformObjects === this.#platformObjects ? record.implInst : undefined;
  }

  // Project helper: project an associated implementation using its owning realm.
  project(implInst: object): StampedPlatformObject | undefined {
    const record = getImplementationRecord(implInst);
    return record?.binding.platformObjects === this.#platformObjects ? record.project() : undefined;
  }

  // Project helper: retrieve the owning realm from either object identity.
  getRealm(value: object): WebIDLRealmHost | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.platformObjects === this.#platformObjects ? record.realm : undefined;
  }
}

export type BindingWorldOptions = {
  readonly capabilities?: readonly CapabilityRegistration[];
  readonly hostDefinedInterfaces?: readonly HostDefinedInterface[];
};

export type RealmRegistrationOptions<Realm extends WebIDLRealmHost = WebIDLRealmHost> = {
  readonly createRuntime?: (ctx: BindingContext<Realm>) => RuntimeContext;
};

const assemblies = new WeakMap<readonly Definition<never>[], DefinitionAssembly>();

// Project helper: cache assembled definitions with the common Web IDL definitions included.
function getDefinitionAssembly<Realm extends WebIDLRealmHost>(
  definitions: readonly Definition<Realm>[],
): DefinitionAssembly {
  let assembly = assemblies.get(definitions);
  if (!assembly) {
    assembly = assembleDefinitions([
      ...webIDLCommonDefinitions,
      // BindingWorld restricts registration to the realm required by these callbacks.
      // Assembly itself only combines declarations; it does not invoke the callbacks.
      ...(definitions as readonly Definition[]),
    ]);
    assemblies.set(definitions, assembly);
  }
  return assembly;
}
