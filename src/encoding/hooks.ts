import {
  isomorphicEncode, labelToName, legacyHookDecode,
} from '@exodus/bytes/encoding.js';
import { percentEncodeAfterEncoding } from '@exodus/bytes/whatwg.js';

import { utf8Encode } from './utf-8';

/** Encoding Standard §4.2 — Get an encoding. */
export function getEncoding(label: string): string | null {
  return labelToName(label);
}

/** Encoding Standard §6.2 — Decode. */
export function decode(
  bytes: Uint8Array,
  fallbackEncoding: string,
): string {
  return legacyHookDecode(bytes, fallbackEncoding);
}

/** Encoding Standard §6.2 — Encode, with HTML error handling. */
export function encode(input: string, encoding: string): Uint8Array {
  if (encoding === 'UTF-8') return utf8Encode(input);

  /*
   * ACCOMMODATION(exodus-html-encode): the public URL encoder exposes the
   * required legacy encoder and HTML character-reference fallback. Undo its
   * percent escapes; escaping literal percent signs keeps this lossless.
   * See LIMITATIONS.md.
   */
  const encoded = percentEncodeAfterEncoding(encoding, input, '%');
  return isomorphicEncode(encoded.replace(/%([0-9A-F]{2})/g,
    (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
}
