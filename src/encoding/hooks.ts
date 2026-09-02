import {
  labelToName, legacyHookDecode,
} from '@exodus/bytes/encoding.js';

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
