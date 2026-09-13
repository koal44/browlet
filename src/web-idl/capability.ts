import type { DefinitionAssembly } from './assembly';
import type { InterfaceDefinition } from './core/definitions/interface';

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
    for(interface_: InterfaceDefinition<never>, value: Value) {
      options.validate?.(interface_);
      return { capability, interface_, value };
    },
    name,
  }) as Capability<Value>;
  return capability;
}

export type Capability<Value> = {
  readonly name: string;
  for(
    interface_: InterfaceDefinition<never>,
    value: Value,
  ): CapabilityRegistration;
  readonly [capabilityValueType]: Value;
};

// The definition is an identity key; capability lookup never invokes its callbacks.
export type CapabilityRegistration = {
  readonly capability: Capability<unknown>;
  readonly interface_: InterfaceDefinition<never>;
  readonly value: unknown;
};

export type CapabilityOptions = {
  readonly validate?: (interface_: InterfaceDefinition<never>) => void;
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
      const interface_ = definitions.getInterface(
        registration.interface_.name,
      );
      if (interface_?.definition !== registration.interface_) {
        throw new TypeError(
          `Capability ${registration.capability.name} targets unknown ` +
          `interface definition ${registration.interface_.name}`,
        );
      }

      let values = this.#values.get(registration.interface_);
      if (!values) {
        values = new Map();
        this.#values.set(registration.interface_, values);
      }
      if (values.has(registration.capability)) {
        throw new TypeError(
          `Interface ${registration.interface_.name} has a duplicate ` +
          `${registration.capability.name} capability registration`,
        );
      }
      values.set(registration.capability, registration.value);
    }
  }

  // Project helper: retrieve a capability value by interface and capability identity.
  get<Value>(
    interface_: InterfaceDefinition<never>,
    capability: Capability<Value>,
  ): Value | undefined {
    return this.#values.get(interface_)?.get(capability) as Value | undefined;
  }
}

declare const capabilityValueType: unique symbol;
