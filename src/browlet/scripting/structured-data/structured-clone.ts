import type { BindingContext } from '../../../web-idl/index';
import type { Realm } from '../realm';
import {
  structuredDeserializeWithTransfer, structuredSerializeWithTransfer,
} from './transfer';

/** HTML §2.7.10, structuredClone(value, options). */
export function structuredClone(
  value: unknown,
  transferList: readonly unknown[],
  ctx: BindingContext<Realm>,
): unknown {
  const serialized = structuredSerializeWithTransfer(
    value,
    transferList,
    ctx,
  );
  return structuredDeserializeWithTransfer(serialized, ctx)
    .deserialized;
}
