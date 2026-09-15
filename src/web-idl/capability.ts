import type { DefinitionAssembly } from './assembly';
import type { InterfaceDefinition } from './core/declarations';

// Project helper: declare a typed key for behavior supplied by another subsystem.
/**
 * Define a typed capability which specifications can implement for exact
 * primary interface definitions.
 *
 * Web IDL preserves and indexes each registered value without interpreting
 * it. The specification which defines the capability owns that value's type
 * and behavior.
 */
export function defineCapability<Value>(
  name: string,
  options: CapabilityOptions = {},
): Capability<Value> {
  const capability: Capability<Value> = Object.freeze({
    // Project helper: associate a capability value with an interface definition.
    for(definition: InterfaceDefinition<never>, value: Value) {
      options.validate?.(definition);
      return { capability, definition, value };
    },
    name,
  }) as Capability<Value>;
  return capability;
}

export type Capability<Value> = {
  readonly name: string;
  for(
    definition: InterfaceDefinition<never>,
    value: Value,
  ): CapabilityRegistration;
  readonly [capabilityValueType]: Value;
};

// The definition is an identity key; capability lookup never invokes its callbacks.
export type CapabilityRegistration = {
  readonly capability: Capability<unknown>;
  readonly definition: InterfaceDefinition<never>;
  readonly value: unknown;
};

export type CapabilityOptions = {
  readonly validate?: (definition: InterfaceDefinition<never>) => void;
};

export class CapabilityRegistry {
  readonly #values = new WeakMap<
    InterfaceDefinition<never>,
    Map<Capability<unknown>, unknown>
  >();

  // Project helper: validate and index capability registrations.
  constructor(
    definitions: DefinitionAssembly,
    registrations: readonly CapabilityRegistration[],
  ) {
    for (const registration of registrations) {
      const primaryInterface = definitions.getInterface(
        registration.definition.name,
      );
      if (primaryInterface?.definition !== registration.definition) {
        throw new TypeError(
          `Capability ${registration.capability.name} targets unknown ` +
          `interface definition ${registration.definition.name}`,
        );
      }

      let values = this.#values.get(registration.definition);
      if (!values) {
        values = new Map();
        this.#values.set(registration.definition, values);
      }
      if (values.has(registration.capability)) {
        throw new TypeError(
          `Interface ${registration.definition.name} has a duplicate ` +
          `${registration.capability.name} capability registration`,
        );
      }
      values.set(registration.capability, registration.value);
    }
  }

  // Project helper: retrieve a capability value by interface and capability identity.
  get<Value>(
    definition: InterfaceDefinition<never>,
    capability: Capability<Value>,
  ): Value | undefined {
    return this.#values.get(definition)?.get(capability) as Value | undefined;
  }
}

declare const capabilityValueType: unique symbol;
