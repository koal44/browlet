import { assembleDefinitions, type DefinitionAssembly } from './assembly';
import { RealmBinding } from './binding';
import { webIDLCommonDefinitions } from './common-definitions';
import {
  type CapabilityImplementation, CapabilityRegistry,
} from './capability';
import type { Definition } from './declaration/index';
import type { HostDefinedInterface } from './conversion';
import type { WebIDLRealmHost } from './javascript-realm';
import { PlatformObjectRegistry } from './platform-object';
import {
  registerDefinitionBindings, type BindingContext,
} from './projection';
import { ImplementationRegistry } from './registry';

/*
 * Create one binding world for a specification contribution. A binding world
 * owns platform-object identity across its registered realms while each realm
 * registration owns its initial objects and implementation steps.
 */
export function createBindings(
  definitions: readonly Definition[],
  options: BindingOptions = {},
): BindingWorld {
  return new BindingWorld(
    getDefinitionAssembly(definitions),
    options,
  );
}

export type BindingOptions = {
  readonly capabilities?: readonly CapabilityImplementation[];
  readonly hostDefinedInterfaces?: readonly HostDefinedInterface[];
};

export class BindingWorld {
  readonly #definitions: DefinitionAssembly;
  readonly #hostDefinedInterfaces: readonly HostDefinedInterface[];
  readonly #capabilities: CapabilityRegistry;
  readonly #platformObjects = new PlatformObjectRegistry();
  readonly #realms = new WeakMap<
    WebIDLRealmHost,
    RealmBindings
  >();

  constructor(
    definitions: DefinitionAssembly,
    options: BindingOptions,
  ) {
    this.#definitions = definitions;
    this.#hostDefinedInterfaces = options.hostDefinedInterfaces ?? [];
    this.#capabilities = new CapabilityRegistry(
      definitions,
      options.capabilities ?? [],
    );
  }

  register(realm: WebIDLRealmHost): RealmBindings {
    let registered = this.#realms.get(realm);
    if (registered) return registered;

    const binding = new RealmBinding(
      this.#definitions,
      realm,
      this.#platformObjects,
      new ImplementationRegistry(),
      [...this.#hostDefinedInterfaces],
      this.#capabilities,
    );
    const context = registerDefinitionBindings(binding);
    registered = new RealmBindings(binding, context);
    this.#realms.set(realm, registered);
    return registered;
  }

  forRealm(
    realm: WebIDLRealmHost,
  ): RealmBindings | undefined {
    return this.#realms.get(realm);
  }

  getImplementationObject(value: object): object | undefined {
    return this.#platformObjects.getImplementationObject(value);
  }

  getPlatformObject(value: object): object | undefined {
    return this.#platformObjects.getPlatformObject(value) ??
      (this.#platformObjects.getImplementationOrigin(value)
        ? this.#platformObjects.projectImplementationOrigin(value)
        : undefined);
  }

  getRealm(value: object): WebIDLRealmHost | undefined {
    return (
      this.#platformObjects.getRecord(value) ??
      this.#platformObjects.getImplementationRecord(value) ??
      this.#platformObjects.getImplementationOrigin(value)
    )?.realm;
  }
}

export class RealmBindings {
  readonly context: BindingContext;
  readonly #binding: RealmBinding;

  constructor(
    binding: RealmBinding,
    context: BindingContext,
  ) {
    this.#binding = binding;
    this.context = context;
  }

  install(target: object): void {
    this.#binding.install(target);
  }

  projectGlobalObject(value: object, interfaceName: string): object {
    return this.#binding.projectGlobalObject(value, interfaceName).platformObject;
  }
}

const assemblies = new WeakMap<readonly Definition[], DefinitionAssembly>();

function getDefinitionAssembly(
  definitions: readonly Definition[],
): DefinitionAssembly {
  let assembly = assemblies.get(definitions);
  if (!assembly) {
    assembly = assembleDefinitions([
      ...webIDLCommonDefinitions,
      ...definitions,
    ]);
    assemblies.set(definitions, assembly);
  }
  return assembly;
}
