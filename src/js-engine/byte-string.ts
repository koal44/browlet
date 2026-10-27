import { Buffer } from 'node:buffer';
import { endianness } from 'node:os';

import { InternalError } from '../infra/internal-error';

/** Infra — Isomorphic decode maps each byte to the code point with the same value. */
export function isomorphicDecode(input: Uint8Array): string {
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('latin1');
}

/** Infra — Isomorphic encode requires code points in U+0000–U+00FF. */
export function isomorphicEncode(input: string): Uint8Array<ArrayBuffer> {
  // Buffer's Latin-1 writer truncates other code points rather than rejecting them.
  if (/[\u0100-\uffff]/.test(input)) throw new InternalError('Expected an isomorphic string');
  const bytes = new Uint8Array(input.length);
  Buffer.from(bytes.buffer).write(input, 'latin1');
  return bytes;
}

/** Materialize UTF-16 storage as a string without interpreting or replacing its code units. */
export function codeUnitsToString(units: Uint16Array, length = units.length): string {
  if (length === 0) return '';
  const bytes = Buffer.from(units.buffer, units.byteOffset, length * 2);
  return (littleEndian ? bytes : Buffer.from(bytes).swap16()).toString('utf16le');
}

const littleEndian = endianness() === 'LE';
