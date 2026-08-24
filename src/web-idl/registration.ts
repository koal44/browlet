import { assembleDefinitions, type DefinitionAssembly } from './assembly';
import { JavaScriptBinding } from './binding';
import { webIDLCommonDefinitions } from './common-definitions';
import type { Definition } from './declaration/index';
import type { HostDefinedInterface } from './conversion';
import type { WebIDLRealmHost } from './javascript-realm';
import { PlatformObjectRegistry } from './platform-object';
import {
  createPlatformObjectAdapter, registerDefinitionBindings,
  type PlatformObjectAdapter,
} from './projection';
import { ImplementationRegistry } from './registry';

/*
 * Prepare one specification contribution for installation in any number of
 * realms. The returned binding domain owns platform-object identity across
 * those realms while each realm registration owns its initial objects and
 * implementation steps.
 */
export function registerInterfaceBindings(
  definitions: readonly Definition[],
  options: InterfaceRegistrationOptions = {},
): InterfaceBindingDomain {
  return new InterfaceBindingDomain(
    getDefinitionAssembly(definitions),
    options,
  );
}

type InterfaceRegistrationOptions = {
  readonly hostDefinedInterfaces?: readonly HostDefinedInterface[];
};

export class InterfaceBindingDomain {
  readonly #definitions: DefinitionAssembly;
  readonly #hostDefinedInterfaces: readonly HostDefinedInterface[];
  readonly #platformObjects = new PlatformObjectRegistry();
  readonly #realms = new WeakMap<
    WebIDLRealmHost,
    RegisteredRealmInterfaceBindings
  >();

  constructor(
    definitions: DefinitionAssembly,
    options: InterfaceRegistrationOptions,
  ) {
    this.#definitions = definitions;
    this.#hostDefinedInterfaces = options.hostDefinedInterfaces ?? [];
  }

  register(realm: WebIDLRealmHost): RegisteredRealmInterfaceBindings {
    let registered = this.#realms.get(realm);
    if (registered) return registered;

    const binding = new JavaScriptBinding(
      this.#definitions,
      realm,
      this.#platformObjects,
      new ImplementationRegistry(),
      [...this.#hostDefinedInterfaces],
    );
    registerDefinitionBindings(binding);
    registered = new RegisteredRealmInterfaceBindings(binding);
    this.#realms.set(realm, registered);
    return registered;
  }

  forRealm(
    realm: WebIDLRealmHost,
  ): RegisteredRealmInterfaceBindings | undefined {
    return this.#realms.get(realm);
  }

  getImplementationObject(value: object): object | undefined {
    return this.#platformObjects.getImplementationObject(value);
  }

  getPlatformObject(value: object): object | undefined {
    return this.#platformObjects.getPlatformObject(value);
  }

  getRealm(value: object): WebIDLRealmHost | undefined {
    return (
      this.#platformObjects.getRecord(value) ??
      this.#platformObjects.getImplementationRecord(value)
    )?.realm;
  }
}

export class RegisteredRealmInterfaceBindings {
  readonly objects: PlatformObjectAdapter;
  readonly #binding: JavaScriptBinding;

  constructor(binding: JavaScriptBinding) {
    this.#binding = binding;
    this.objects = createPlatformObjectAdapter(binding);
  }

  install(target: object): void {
    this.#binding.install(target);
  }

  projectGlobalObject(value: object, interfaceName: string): object {
    return this.#binding.projectGlobalObject(value, interfaceName).object;
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
