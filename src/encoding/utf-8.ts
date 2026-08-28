import {
  TextDecoder as ExodusTextDecoder,
  TextEncoder as ExodusTextEncoder,
} from '@exodus/bytes/encoding-lite.js';

/** Encoding Standard §8.1, UTF-8 decode. */
export function utf8Decode(input: Uint8Array): string {
  return utf8Decoder.decode(input);
}

/** Encoding Standard §8.2, UTF-8 decode without BOM. */
export function utf8DecodeWithoutBOM(input: Uint8Array): string {
  return utf8DecoderWithoutBOM.decode(input);
}

/** Encoding Standard §8.3, UTF-8 decode without BOM or fail. */
export function utf8DecodeWithoutBOMOrFail(
  input: Uint8Array,
): string | null {
  try {
    return fatalUtf8DecoderWithoutBOM.decode(input);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/** Encoding Standard §8.4, UTF-8 encode. */
export function utf8Encode(input: string): Uint8Array {
  return utf8Encoder.encode(input);
}

const utf8Decoder = new ExodusTextDecoder();
const utf8DecoderWithoutBOM = new ExodusTextDecoder('utf-8', {
  ignoreBOM: true,
});
const fatalUtf8DecoderWithoutBOM = new ExodusTextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});
const utf8Encoder = new ExodusTextEncoder();
