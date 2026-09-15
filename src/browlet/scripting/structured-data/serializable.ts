import {
  defineCapability, type StampedImplInstance, type ImplementationClass, type InterfaceDefinition,
} from '../../../web-idl/index';
import type { Realm } from '../realm';
import type { SerializedRecord, StructuredDataRecord } from './records';

export const serializable = defineCapability<SerializableSteps>(
  'Serializable',
  { validate: (definition) => requireMarker(definition, 'Serializable') },
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
  subserialize(value: unknown): SerializedRecord;
};

export type DeserializationContext = {
  unwrap<T extends object>(
    platformObject: object,
    implClass: ImplementationClass<T>,
  ): StampedImplInstance<T> | undefined;
  subdeserialize(serialized: unknown): unknown;
};

function requireMarker<Realm>(
  definition: InterfaceDefinition<Realm>,
  name: string,
): void {
  const markers = definition.extendedAttributes?.filter(
    (attribute) => attribute.kind !== 'raw' && attribute.name === name,
  ) ?? [];
  if (markers.length !== 1 || markers[0]?.kind !== 'no-arguments') {
    throw new TypeError(
      `${definition.name} must declare exactly one [${name}] marker`,
    );
  }
}
