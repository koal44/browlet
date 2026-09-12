import { describe, expect, it } from 'vitest';

import {
  urlAlgorithms, type PercentEncodeSet,
} from './contract';

describe('URL Standard section 1.3: percent-encoded bytes', () => {
  for (const [input, output] of [
    [0x23, '%23'],
    [0x7f, '%7F'],
    [0x00, '%00'],
    [0xff, '%FF'],
  ] as const) {
    it(`percent-encodes byte 0x${input.toString(16)}`, () => {
      expect(urlAlgorithms().percentEncodeByte(input)).toBe(output);
    });
  }

  it('percent-decodes only complete ASCII hexadecimal triplets', () => {
    const input = [...new TextEncoder().encode('%25%s%1G')];
    const output = [...new TextEncoder().encode('%%s%1G')];

    expect(urlAlgorithms().percentDecodeBytes(input)).toEqual(output);
  });

  it('UTF-8 encodes a scalar-value string before percent-decoding it', () => {
    expect(urlAlgorithms().percentDecodeString('‽%25%2E')).toEqual([
      0xe2, 0x80, 0xbd, 0x25, 0x2e,
    ]);
  });

  for (const test of [
    ['Shift_JIS', ' ', 'special_query', '%20'],
    ['Shift_JIS', '≡', 'special_query', '%81%DF'],
    ['Shift_JIS', '‽', 'special_query', '%26%238253%3B'],
    ['ISO-2022-JP', '¥', 'special_query', '%1B(J\\%1B(B'],
    ['ISO-2022-JP', '¥😀¥', 'special_query', '%1B(J\\%26%23128512%3B\\%1B(B'],
    ['ISO-2022-JP', 'あ😀あ', 'special_query', '%1B$B$%22%1B(B%26%23128512%3B%1B$B$%22%1B(B'],
    ['ISO-2022-JP', '\x0e\x0f\x1b', 'special_query', '%26%2365533%3B%26%2365533%3B%26%2365533%3B'],
    ['x-user-defined', '\uf780\uf7ff\u0080', 'special_query', '%80%FF%26%23128%3B'],
    ['gb18030', '😀', 'special_query', '%949%FC6'],
    ['GBK', '😀', 'special_query', '%26%23128512%3B'],
    [
      'Shift_JIS', '1+1 ≡ 2%20‽', 'form_urlencoded',
      '1%2B1+%81%DF+2%2520%26%238253%3B',
    ],
  ] as const) {
    const [encoding, input, set, output] = test;

    it(`percent-encodes ${JSON.stringify(input)} after ${encoding}`, () => {
      expect(urlAlgorithms().percentEncodeAfterEncoding(
        encoding,
        input,
        set,
      )).toBe(output);
    });
  }

  for (const [input, set, output] of [
    ['≡', 'userinfo', '%E2%89%A1'],
    ['‽', 'userinfo', '%E2%80%BD'],
    ['Say what‽', 'userinfo', 'Say%20what%E2%80%BD'],
    ['#`', 'fragment', '#%60'],
    ['#`', 'query', '%23`'],
    ["'", 'special_query', '%27'],
    ['?^`{}', 'path', '%3F%5E%60%7B%7D'],
    ['/:;=@[]\\|', 'userinfo', '%2F%3A%3B%3D%40%5B%5D%5C%7C'],
    ['$%&+,', 'component', '%24%25%26%2B%2C'],
    ['AZaz09*-._', 'form_urlencoded', 'AZaz09*-._'],
    [' ~', 'form_urlencoded', '+%7E'],
  ] as const satisfies readonly (
    readonly [string, PercentEncodeSet, string]
  )[]) {
    it(`applies the ${set} percent-encode set`, () => {
      expect(urlAlgorithms().utf8PercentEncode(input, set)).toBe(output);
    });
  }
});
