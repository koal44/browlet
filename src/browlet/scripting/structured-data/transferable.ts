import { Stamper } from '../../../infra/stamper';
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

/** HTML's [[Detached]] marker, carried by the transferred implementation instance. */
export class DetachedTransferableStamper extends Stamper {
  #detached: undefined;

  private constructor(implInst: object) {
    super(implInst);
  }

  static stamp(implInst: object): void {
    if (!(#detached in implInst)) new DetachedTransferableStamper(implInst);
  }

  static has(implInst: object): boolean {
    return #detached in implInst;
  }
}

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
