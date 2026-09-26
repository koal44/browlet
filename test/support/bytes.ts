import { Buffer } from 'node:buffer';
import { expect } from 'vitest';

/** Compare complete byte views without copying, with a detailed diff on failure. */
export function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  const actualBytes = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
  const expectedBytes = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
  if (!actualBytes.equals(expectedBytes)) expect(actualBytes).toEqual(expectedBytes);
}
