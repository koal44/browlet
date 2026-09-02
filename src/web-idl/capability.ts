import type { DefinitionAssembly } from './assembly';
import type { InterfaceDefinition } from './declaration/definition';

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
    for(interface_: InterfaceDefinition, value: Value) {
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
    interface_: InterfaceDefinition,
    value: Value,
  ): CapabilityRegistration;
  readonly [capabilityValueType]: Value;
};

export type CapabilityRegistration = {
  readonly capability: Capability<unknown>;
  readonly interface_: InterfaceDefinition;
  readonly value: unknown;
};

export type CapabilityOptions = {
  readonly validate?: (interface_: InterfaceDefinition) => void;
};

export class CapabilityRegistry {
  readonly #values = new WeakMap<
    InterfaceDefinition,
    Map<Capability<unknown>, unknown>
  >();

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

  get<Value>(
    interface_: InterfaceDefinition,
    capability: Capability<Value>,
  ): Value | undefined {
    return this.#values.get(interface_)?.get(capability) as Value | undefined;
  }
}

declare const capabilityValueType: unique symbol;
