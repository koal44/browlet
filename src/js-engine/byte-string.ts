import { Buffer, isUtf8 } from 'node:buffer';
import { endianness } from 'node:os';
import { TextEncoder } from 'node:util';

/** Infra — Isomorphic decode maps each byte to the code point with the same value. */
export function isomorphicDecode(input: Uint8Array): string {
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('latin1');
}

/** Infra — Isomorphic encode requires code points in U+0000–U+00FF. */
export function isomorphicEncode(input: string): Uint8Array<ArrayBuffer> {
  // Buffer's Latin-1 writer truncates other code points rather than rejecting them.
  if (/[\u0100-\uffff]/.test(input)) throw new TypeError('Expected an isomorphic string');
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

/** Count UTF-8 bytes, replacing unpaired surrogate code units with U+FFFD. */
export function utf8ByteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

/** Write complete UTF-8 sequences into existing storage and return the byte count. */
export function writeUTF8(input: string, destination: Uint8Array): number {
  return Buffer.from(destination.buffer, destination.byteOffset, destination.byteLength).write(input, 'utf8');
}

/** Write complete UTF-8 sequences and report UTF-16 code units read and bytes written. */
export function writeUTF8Into(source: string, destination: Uint8Array): { read: number; written: number; } {
  const result = encoder.encodeInto(source, destination);
  if (result.read === source.length || result.written === destination.length) return result;
  // ACCOMMODATION(node-utf8-encode-into): Node's fitting can stop too soon at
  // two-byte scalars or surrogate pairs. Its prefix is correct; finish from the
  // reported positions, retaining native conversion for the bulk of the input.
  let { read, written } = result;
  while (read < source.length) {
    let point = source.codePointAt(read)!;
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    const length = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (written + length > destination.length) break;
    read += point > 0xffff ? 2 : 1;
    if (length === 1) {
      destination[written++] = point;
    } else {
      if (length === 2) {
        destination[written++] = 0xc0 | (point >> 6);
      } else {
        if (length === 3) {
          destination[written++] = 0xe0 | (point >> 12);
        } else {
          destination[written++] = 0xf0 | (point >> 18);
          destination[written++] = 0x80 | ((point >> 12) & 0x3f);
        }
        destination[written++] = 0x80 | ((point >> 6) & 0x3f);
      }
      destination[written++] = 0x80 | (point & 0x3f);
    }
  }
  result.read = read;
  result.written = written;
  return result;
}

/** Decode valid, complete UTF-8; undefined leaves invalid or incomplete input to the caller. */
export function decodeValidUTF8(input: Uint8Array): string | undefined {
  if (!isUtf8(input)) return;
  return readUTF8(input);
}

/** Decode complete UTF-8, preserving U+FEFF and replacing malformed sequences. */
export function readUTF8(input: Uint8Array): string {
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('utf8');
}

const littleEndian = endianness() === 'LE';
const encoder = new TextEncoder();
