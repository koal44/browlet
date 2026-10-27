/** Encoding §6.1 BOM table used by complete-input decoding and queue lookahead. */
export function detectBOM(bytes: Uint8Array | number[]): BOMEncoding | null {
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'UTF-8';
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'UTF-16BE';
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'UTF-16LE';
  return null;
}

export type BOMEncoding = 'UTF-8' | 'UTF-16BE' | 'UTF-16LE';
