import { assembleDefinitions, type DefinitionAssembly } from './assembly';
import { RealmBinding } from './binding';
import { BindingContext } from './binding-context';
import { webIDLCommonDefinitions } from './common-definitions';
import {
  CapabilityRegistry, type CapabilityRegistration,
} from './capability';
import type { Definition } from './core/index';
import type { HostDefinedInterface } from './conversion';
import type { WebIDLRealmHost } from './js-realm';
import { PlatformObjectRegistry } from './platform-object';
import { registerDefinitionBindings } from './projection';
import { ImplementationRegistry } from './registry';
import type { RuntimeContext } from '../js-engine/runtime-context';

// Project helper: create a binding world for the supplied definitions.
/*
 * Create one binding world for a specification contribution. A binding world
 * owns platform-object identity across its registered realms while each realm
 * binding owns its initial objects and implementation steps.
 */
export function createBindingWorld<Realm extends WebIDLRealmHost = WebIDLRealmHost>(
  definitions: readonly Definition<Realm>[],
  options: BindingWorldOptions = {},
): BindingWorld<Realm> {
  return new BindingWorld(
    definitions,
    options,
  );
}

export type BindingWorldOptions = {
  readonly capabilities?: readonly CapabilityRegistration[];
  readonly hostDefinedInterfaces?: readonly HostDefinedInterface[];
};

export type RealmRegistrationOptions<Realm extends WebIDLRealmHost = WebIDLRealmHost> = {
  readonly createRuntime?: (ctx: BindingContext<Realm>) => RuntimeContext;
};

export class BindingWorld<Realm extends WebIDLRealmHost = WebIDLRealmHost> {
  readonly #definitions: DefinitionAssembly;
  readonly #hostDefinedInterfaces: readonly HostDefinedInterface[];
  readonly #capabilities: CapabilityRegistry;
  readonly #platformObjects = new PlatformObjectRegistry();
  readonly #realms = new WeakMap<Realm, BindingContext<Realm>>();

  // Project helper: compose shared definition, capability, and platform-object registries.
  constructor(
    definitions: readonly Definition<Realm>[],
    options: BindingWorldOptions,
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
    const registered = this.#realms.get(realm);
    if (registered) return registered;

    const binding = new RealmBinding(
      this.#definitions,
      realm,
      this.#platformObjects,
      new ImplementationRegistry(),
      [...this.#hostDefinedInterfaces],
      this.#capabilities,
    );
    const context = new BindingContext(binding, options.createRuntime);
    registerDefinitionBindings(binding, context);
    this.#realms.set(realm, context);
    return context;
  }

  /** Find a realm's binding context in this world without registering it. */
  forRealm(realm: Realm): BindingContext<Realm> | undefined {
    return this.#realms.get(realm);
  }

  // Project helper: retrieve the implementation paired with a platform object in this world.
  unwrap(value: object): object | undefined {
    return this.#platformObjects.getImplementationObject(value);
  }

  // Project helper: retrieve an implementation's platform object, projecting its recorded origin if needed.
  project(value: object): object | undefined {
    return this.#platformObjects.getPlatformObject(value) ??
      (this.#platformObjects.getImplementationOrigin(value)
        ? this.#platformObjects.projectFromOrigin(value)
        : undefined);
  }

  // Project helper: retrieve the realm from a platform record or implementation origin.
  getRealm(value: object): WebIDLRealmHost | undefined {
    return (
      this.#platformObjects.getRecord(value) ??
      this.#platformObjects.getImplementationRecord(value) ??
      this.#platformObjects.getImplementationOrigin(value)
    )?.realm;
  }
}

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
