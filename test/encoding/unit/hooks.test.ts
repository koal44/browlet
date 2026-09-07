import { isomorphicEncode } from '@exodus/bytes/encoding-lite.js';
import { describe, expect, it } from 'vitest';

import { encode } from '../../../src/encoding/hooks';

describe('Encoding §6.2: encode with HTML error handling', () => {
  it.each([
    ['UTF-8', 'é💩\0', [0xc3, 0xa9, 0xf0, 0x9f, 0x92, 0xa9, 0]],
    ['windows-1252', 'é€', [0xe9, 0x80]],
    ['latin1', '€', [0x80]],
    ['Shift_JIS', '日本', [0x93, 0xfa, 0x96, 0x7b]],
    ['x-user-defined', '\uf780', [0x80]],
  ] satisfies [string, string, number[]][])('encodes %s', (encoding, value, bytes) => {
    expect(encode(value, encoding)).toEqual(Uint8Array.from(bytes));
  });

  it('uses decimal references without decoding literal percent escapes', () => {
    expect(encode('💩 %80 %0A %26 &#123; +\0\r\n', 'windows-1252'))
      .toEqual(isomorphicEncode('&#128169; %80 %0A %26 &#123; +\0\r\n'));
  });

  it('retains stateful encoding transitions around an unrepresentable character', () => {
    expect(encode('日💩本', 'ISO-2022-JP')).toEqual(isomorphicEncode(
      '\x1b$BF|\x1b(B&#128169;\x1b$BK\\\x1b(B',
    ));
  });

  it.each(['replacement', 'UTF-16LE', 'UTF-16BE', 'unknown-encoding'])(
    'requires an encoding with an encoder: %s',
    (encoding) => expect(() => encode('text', encoding)).toThrow(RangeError),
  );
});
