import {
  defineCapability, type InterfaceDefinition,
} from '../../../web-idl/index';
import type { StructuredDataRecord } from './records';

export const transferable = defineCapability<TransferableSteps>(
  'Transferable',
  { validate: requireTransferableMarker },
);

export type TransferableSteps = {
  transferSteps(value: object, dataHolder: StructuredDataRecord): void;
  transferReceivingSteps(
    dataHolder: StructuredDataRecord,
    value: object,
  ): void;
};

export function isTransferableDetached(value: object): boolean {
  return detachedPlatformObjects.has(value);
}

export function markTransferableDetached(value: object): void {
  detachedPlatformObjects.add(value);
}

// HTML owns the platform object's [[Detached]] state; it is not Web IDL state.
const detachedPlatformObjects = new WeakSet<object>();

function requireTransferableMarker<Realm>(definition: InterfaceDefinition<Realm>): void {
  const markers = definition.extendedAttributes?.filter(
    (attribute) =>
      attribute.kind !== 'raw' && attribute.name === 'Transferable',
  ) ?? [];
  if (markers.length !== 1 || markers[0]?.kind !== 'no-arguments') {
    throw new TypeError(
      `${definition.name} must declare exactly one [Transferable] marker`,
    );
  }
}
