import {
  defineCapability, type InterfaceDefinition, type WebIDLRealmHost,
} from '../../../web-idl/index';
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
    targetRealm: WebIDLRealmHost,
    context: DeserializationContext,
  ): void;
};

export type SerializationContext = {
  subserialize(value: unknown): unknown;
};

export type DeserializationContext = {
  subdeserialize(serialized: unknown): unknown;
};

function requireMarker(
  interface_: InterfaceDefinition,
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
