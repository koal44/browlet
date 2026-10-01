import type { ImplementationClass } from './types';

// https://html.spec.whatwg.org/multipage/structured-data.html#serializable-objects
// Declarations retain these hooks; HTML supplies graph traversal and invocation state.
/** An interface's complete state-saving and state-restoring algorithms. */
export type SerialSteps<
  Impl extends object = object,
  Fields extends object = Record<string, unknown>,
  Realm = unknown,
> = {
  /** Save implementation state, using the current operation for nested values. */
  serializationSteps(
    value: Impl,
    serialized: StructuredDataRecord<Fields>,
    forStorage: boolean,
    context: SerializationContext,
  ): void;
  /** Restore an already-created implementation in the destination realm. */
  deserializationSteps(
    serialized: StructuredDataRecord<Fields>,
    value: Impl,
    targetRealm: Realm,
    context: DeserializationContext,
  ): void;
};

// https://html.spec.whatwg.org/multipage/structured-data.html#transferable-objects
/** An interface's state-moving and state-receiving algorithms. */
export type TransferSteps<
  Impl extends object = object,
  Fields extends object = Record<string, unknown>,
> = {
  /** Move implementation state into the transfer record. */
  transferSteps(value: Impl, dataHolder: StructuredDataRecord<Fields>): void;
  /** Restore transferred state into the destination implementation. */
  transferReceivingSteps(dataHolder: StructuredDataRecord<Fields>, value: Impl): void;
};

/** Typed access to the Map populated by an interface's own serialization or transfer steps. */
// Deserialization receives the completed record from the matching writer, not author input.
// Required fields must be written before completion; optional fields include undefined in Fields.
export interface StructuredDataRecord<Fields extends object = Record<string, unknown>> {
  get<Key extends keyof Fields>(name: Key): Fields[Key];
  set<Key extends keyof Fields>(name: Key, value: Fields[Key]): void;
  has(name: keyof Fields): boolean;
}

/** Nested serialization within one operation's shared identity memory. */
export type SerializationContext = {
  /** Serialize a nested value; the returned record is opaque to the provider. */
  subserialize(value: unknown): object;
  // SPEC_MISMATCH: sub-serialization(value)
  /** Serialize an implementation through its declared interface, even before first projection. */
  subserialize<Impl extends object>(value: Impl, implClass: ImplementationClass<Impl>): object;
};

/** Nested reconstruction within one operation's destination and identity memory. */
export type DeserializationContext = {
  /** Retrieve the required implementation; a mismatch is an internal deserialization error. */
  unwrap<Impl extends object>(
    platformObject: unknown,
    implClass: ImplementationClass<Impl>,
  ): Impl;
  /** Reconstruct a nested record through the current deserialization operation. */
  subdeserialize(serialized: unknown): unknown;
};
