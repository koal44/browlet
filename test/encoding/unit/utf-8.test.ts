import { describe, expect, it } from 'vitest';
import {
  utf8Decode, utf8DecodeWithoutBOM, utf8DecodeWithoutBOMOrFail, utf8Encode,
} from '../../../src/encoding/utf-8';

describe('Encoding Standard UTF-8 hooks', () => {
  it('encodes and decodes scalar values', () => {
    expect(Array.from(utf8Encode('A😀')))
      .toEqual([65, 240, 159, 152, 128]);
    expect(utf8Decode(Uint8Array.of(65, 240, 159, 152, 128)))
      .toBe('A😀');
  });

  it('distinguishes BOM handling', () => {
    const bytes = Uint8Array.of(0xEF, 0xBB, 0xBF, 65);
    expect(utf8Decode(bytes)).toBe('A');
    expect(utf8DecodeWithoutBOM(bytes)).toBe('\uFEFFA');
  });

  it('returns failure for malformed input in fatal mode', () => {
    expect(utf8DecodeWithoutBOMOrFail(Uint8Array.of(0xFF))).toBeNull();
    expect(utf8DecodeWithoutBOMOrFail(Uint8Array.of(65))).toBe('A');
  });
});
