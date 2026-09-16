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
  capability: Capability<unknown>;
  definition: InterfaceDefinition<never>;
  value: unknown;
};

export type CapabilityOptions = {
  validate?: (definition: InterfaceDefinition<never>) => void;
};

declare const capabilityValueType: unique symbol;
