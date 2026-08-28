import type { DefinitionAssembly } from './assembly';
import type { InterfaceDefinition } from './declaration/definition';

/**
 * Define a typed capability which specifications can implement for exact
 * primary interface definitions.
 *
 * Web IDL preserves and indexes each implementation without interpreting its
 * value. The specification which defines the capability owns that value's
 * type and behavior.
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
  ): CapabilityImplementation;
  readonly [capabilityValueType]: Value;
};

export type CapabilityImplementation = {
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
    implementations: readonly CapabilityImplementation[],
  ) {
    for (const implementation of implementations) {
      const interface_ = definitions.getInterface(
        implementation.interface_.name,
      );
      if (interface_?.definition !== implementation.interface_) {
        throw new TypeError(
          `Capability ${implementation.capability.name} targets unknown ` +
          `interface definition ${implementation.interface_.name}`,
        );
      }

      let values = this.#values.get(implementation.interface_);
      if (!values) {
        values = new Map();
        this.#values.set(implementation.interface_, values);
      }
      if (values.has(implementation.capability)) {
        throw new TypeError(
          `Interface ${implementation.interface_.name} has a duplicate ` +
          `${implementation.capability.name} capability implementation`,
        );
      }
      values.set(implementation.capability, implementation.value);
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
