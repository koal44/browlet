import type { AssembledInterface, AttributeBinding, IDLAttribute } from '../../../web-idl/index';

import type { MessageEventImpl, MessagePortImpl } from '../../communication/index';
import type { BrowletEnvironment } from '../../environment';

/** Retain the projected ports array until legacy initialization replaces the snapshot. */
export function prepareMessageEventPorts(
  member: IDLAttribute, owners: AssembledInterface[],
): Map<AssembledInterface, AttributeBinding<BrowletEnvironment, MessageEventImpl>> | undefined {
  if (member.name !== 'ports' || member.type.kind !== 'frozen-array') return;
  const owner = owners.find((owner) => owner.name === 'MessageEvent');
  if (!owner) return;
  const type = member.type;
  const cache = new WeakMap<readonly MessagePortImpl[], readonly unknown[]>();
  return new Map([[owner, {
    get(ctx) {
      let array = cache.get(this.ports);
      if (!array) {
        array = ctx.createFrozenArray(this.ports, type);
        cache.set(this.ports, array);
      }
      return array;
    },
  }]]);
}
