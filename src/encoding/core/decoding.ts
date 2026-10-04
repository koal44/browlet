import type { Encoding } from './labels';

/** Complete-input decoding supplied by the host that owns the consuming subsystem. */
export interface EncodingCapability {
  /** Decode with replacement errors, letting a leading Unicode BOM override the fallback. */
  decodeText(bytes: Uint8Array, fallbackEncoding: Encoding): string;
}

/** Native decoding for standalone hosts, with replacement and x-user-defined support. */
export function decodeNative(bytes: Uint8Array, fallbackEncoding: Encoding): string {
  const encoding = detectBOM(bytes) ?? fallbackEncoding;
  if (encoding === 'replacement') return bytes.length === 0 ? '' : '\uFFFD';
  if (encoding === 'x-user-defined') {
    let result = '';
    // https://encoding.spec.whatwg.org/#x-user-defined-decoder
    for (const byte of bytes) result += String.fromCodePoint(byte <= 0x7F ? byte : 0xF780 + byte - 0x80);
    return result;
  }
  return new NativeTextDecoder(encoding).decode(bytes);
}

/** The Encoding §6.1 BOM table, shared by immediate bytes and queue lookahead. */
export function detectBOM(bytes: Uint8Array | number[]): BOMEncoding | null {
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'UTF-8';
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'UTF-16BE';
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'UTF-16LE';
  return null;
}

export type BOMEncoding = 'UTF-8' | 'UTF-16BE' | 'UTF-16LE';

type NativeTextDecoderConstructor = {
  new (label: string): { decode(bytes: Uint8Array): string; };
};

// Hosts supplying their own decoding need no ambient TextDecoder during import.
const NativeTextDecoder = (globalThis as typeof globalThis & {
  TextDecoder: NativeTextDecoderConstructor;
}).TextDecoder;
