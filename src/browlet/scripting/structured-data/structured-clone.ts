import type { ScriptingEnvironment } from '../environment';
import type { BindingContext } from '../../../web-idl/index';
import {
  structuredDeserializeWithTransfer, structuredSerializeWithTransfer,
} from './transfer';

/** HTML §2.7.10, structuredClone(value, options). */
export function structuredClone(
  value: unknown,
  transferList: unknown[],
  ctx: BindingContext<ScriptingEnvironment>,
): unknown {
  const serialized = structuredSerializeWithTransfer(
    value,
    transferList,
    ctx,
  );
  return structuredDeserializeWithTransfer(serialized, ctx)
    .deserialized;
}
