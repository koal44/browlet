import {
  defineCapability, type ImplementationClass, type InterfaceDefinition,
} from '../../../web-idl/index';
import type { Realm } from '../realm';
import type { StructuredDataRecord } from './records';

export const serializable = defineCapability<SerializableSteps>(
  'Serializable',
  { validate: (interface_) => requireMarker(interface_, 'Serializable') },
);

export type SerializableSteps = {
  serializationSteps(
    value: object,
    serialized: StructuredDataRecord,
    forStorage: boolean,
    context: SerializationContext,
  ): void;
  deserializationSteps(
    serialized: StructuredDataRecord,
    value: object,
    targetRealm: Realm,
    context: DeserializationContext,
  ): void;
};

export type SerializationContext = {
  subserialize(value: unknown): unknown;
};

export type DeserializationContext = {
  getImplementation<T extends object>(
    value: unknown,
    implementation: ImplementationClass<T>,
  ): T | undefined;
  subdeserialize(serialized: unknown): unknown;
};

function requireMarker<Realm>(
  interface_: InterfaceDefinition<Realm>,
  name: string,
): void {
  const markers = interface_.extendedAttributes?.filter(
    (attribute) => attribute.kind !== 'raw' && attribute.name === name,
  ) ?? [];
  if (markers.length !== 1 || markers[0]?.kind !== 'no-arguments') {
    throw new TypeError(
      `${interface_.name} must declare exactly one [${name}] marker`,
    );
  }
}
