import type { StructuredDataEnvironment } from './environment';
import {
  structuredDeserializeWithTransfer, structuredSerializeWithTransfer,
} from './transfer';

/** HTML §2.7.10, structuredClone(value, options). */
export function structuredClone(
  value: unknown,
  transferList: readonly unknown[],
  environment: StructuredDataEnvironment,
): unknown {
  const serialized = structuredSerializeWithTransfer(
    value,
    transferList,
    environment,
  );
  return structuredDeserializeWithTransfer(serialized, environment)
    .deserialized;
}
