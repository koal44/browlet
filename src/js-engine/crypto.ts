import { createHash, randomUUID as nativeRandomUUID } from 'node:crypto';

/** Hash exactly the supplied byte view using a native algorithm selected by the caller. */
export function computeHash(algorithm: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return createHash(algorithm).update(bytes).digest();
}

/** Generate a UUID using the native cryptographic source. */
export function randomUUID(): string {
  return nativeRandomUUID();
}
