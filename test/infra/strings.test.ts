import { describe, expect, it } from 'vitest';

import { normalizeNewlines } from '../../src/infra/strings';

describe('Infra newline normalization', () => {
  it.each([
    ['', ''],
    ['one\r\ntwo\rthree\nfour', 'one\ntwo\nthree\nfour'],
    ['\r\r\n\n\r', '\n\n\n\n'],
    ['\n\r', '\n\n'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeNewlines(input)).toBe(expected);
  });

  it('preserves other whitespace, nulls, Unicode, and unpaired surrogates', () => {
    const text = ' \t\f\v\u0085\u2028\u2029\0é😀\uD800 ';
    expect(normalizeNewlines(text)).toBe(text);
  });
});
