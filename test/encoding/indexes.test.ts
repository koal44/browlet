import { describe, expect, it } from 'vitest';

import { EncodingIndex } from '../../src/encoding/indexes';
import { indexes } from '../../src/encoding/gen/indexes';

describe('Encoding §5: index lookups', () => {
  it.each([
    [0xfffe, 'hAEA/f8DBA=='],
    [0xffff, 'hAEA/v8DBA=='],
  ] as const)('preserves pointer %i alongside pointer zero', (last, packed) => {
    // U+0041 at zero, unmapped positions, then U+0042 at the last pointer.
    const index = new EncodingIndex(packed, last + 1, 2);
    expect(index.pointer(0x41)).toBe(0);
    expect(index.pointer(0x42)).toBe(last);
    expect(index.codePoint(last)).toBe(0x42);
    expect(index.pointer(0)).toBeNull();
  });

  it('distinguishes pointer zero from an unmapped code point or pointer', () => {
    expect(indexes.ibm866.codePoint(0)).toBe(0x0410);
    expect(indexes.ibm866.pointer(0x0410)).toBe(0);
    expect(indexes.ibm866.pointer(0)).toBeNull();
    expect(indexes.ibm866.pointer(0x1f4a9)).toBeNull();
    expect(indexes.ibm866.codePoint(128)).toBeNull();
    expect(indexes['iso-8859-3'].codePoint(0x25)).toBeNull();
  });

  it('uses the first JIS0208 pointer, excluding 8272..8835 for Shift_JIS', () => {
    // U+7E8A occurs at both 8272 and 10744 in index-jis0208.txt.
    expect(indexes.jis0208.pointer(0x7e8a)).toBe(8272);
    expect(indexes.jis0208.shiftJISPointer(0x7e8a)).toBe(10744);
    expect(indexes.jis0208.shiftJISPointer(0x3000)).toBe(0);
    expect(indexes.jis0208.shiftJISPointer(0x1f4a9)).toBeNull();
  });

  it.each([
    [0x2550, 18991], [0x255e, 18975], [0x2561, 18977],
    [0x256a, 18976], [0x5341, 5512], [0x5345, 5599],
  ])('uses the last Big5 pointer for U+%s', (point, pointer) => {
    expect(indexes.big5.pointer(point)).toBe(pointer);
    expect(indexes.big5.codePoint(pointer)).toBe(point);
  });

  it('keeps the excluded Big5 region available to decoding only', () => {
    expect(indexes.big5.codePoint(942)).toBe(0x43f0);
    expect(indexes.big5.pointer(0x43f0)).toBeNull();
    expect(indexes.big5.pointer(0)).toBeNull();
    expect(indexes.big5.pointer(0x10ffff)).toBeNull();
  });

  it.each([
    [0, 0x80], [7457, 0xe7c7], [39419, 0xffff],
    [189000, 0x10000], [1237575, 0x10ffff],
  ])('looks up GB18030 range pointer %i in both directions', (pointer, point) => {
    expect(indexes['gb18030-ranges'].codePoint(pointer)).toBe(point);
    expect(indexes['gb18030-ranges'].pointer(point)).toBe(pointer);
  });

  it.each([39420, 188999, 1237576])('rejects GB18030 range pointer %i', (pointer) => {
    expect(indexes['gb18030-ranges'].codePoint(pointer)).toBeNull();
  });
});
