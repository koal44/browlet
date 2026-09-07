import { describe, expect, it } from 'vitest';

import { parseCacheControl, parseDeltaSeconds, parseVary } from '../../../src/http/cache/fields';

describe('Cache-Control field parsing (RFC 9111 §5.2)', () => {
  it('preserves order and duplicates while folding directive names', () => {
    expect(parseCacheControl('max-age=60, No-Cache, MAX-AGE="30", extension=Token')).toEqual([
      { name: 'max-age', value: '60' },
      { name: 'no-cache', value: null },
      { name: 'max-age', value: '30' },
      { name: 'extension', value: 'Token' },
    ]);
  });

  it('keeps quoted commas and unescapes quoted pairs, including obs-text', () => {
    expect(parseCacheControl('private="Set-Cookie, X-User", x="a\\"b\\\\c\\\xff\t", empty=""')).toEqual([
      { name: 'private', value: 'Set-Cookie, X-User' },
      { name: 'x', value: 'a"b\\c\xff\t' },
      { name: 'empty', value: '' },
    ]);
  });

  it('accepts the HTTP token alphabet', () => {
    const token = '!#$%&\'*+-.^_`|~0123456789Az';
    expect(parseCacheControl(`${token}=${token}`)).toEqual([
      { name: token.toLowerCase(), value: token },
    ]);
  });

  it.each(['', ' \t', ',, ,\t,'])('ignores empty list members in %j', (input) => {
    expect(parseCacheControl(input)).toEqual([]);
  });

  it('accepts whitespace and empty members around directives', () => {
    expect(parseCacheControl(' , max-age=60 \t, , no-store, ')).toEqual([
      { name: 'max-age', value: '60' }, { name: 'no-store', value: null },
    ]);
  });

  it.each([
    '=60', 'max-age=', 'max-age =60', 'max-age= 60', 'max-age=60 no-cache',
    'max-age=60; no-cache', 'x="unterminated', 'x="trailing\\',
    'x="closed"tail', 'x="a\rb"', 'x="a\nb"', 'x="\0"', 'x="\x7f"',
    'x="💩"', 'x="\\\x7f"', 'max-age=60\r\nno-store', '\u00a0max-age=60',
  ])('rejects malformed field syntax %j', (input) => {
    expect(parseCacheControl(input)).toBeNull();
  });
});

describe('delta-seconds (RFC 9111 §1.2.2)', () => {
  it.each([
    ['0', 0], ['00060', 60], ['2147483648', 2147483648],
    ['4294967296', 4294967296],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ['9007199254740992', Number.MAX_SAFE_INTEGER],
    ['9'.repeat(400), Number.MAX_SAFE_INTEGER],
  ])('parses %j without wraparound', (input, expected) => {
    expect(parseDeltaSeconds(input)).toBe(expected);
  });

  it.each(['', '-1', '+1', '1.5', '1e2', 'Infinity', '1x', ' 1', '1 ', '1\n', '１'])('rejects %j', (input) => {
    expect(parseDeltaSeconds(input)).toBeNull();
  });
});

describe('Vary field syntax (RFC 9110 §12.5.5)', () => {
  it('normalizes field names while preserving their order and duplicates', () => {
    expect(parseVary('Accept, ACCEPT-LANGUAGE, accept')).toEqual(['accept', 'accept-language', 'accept']);
  });

  it('accepts surrounding HTTP whitespace and empty list members', () => {
    expect(parseVary(' , Accept \t, , X-Variant, ')).toEqual(['accept', 'x-variant']);
    expect(parseVary(' , \t, ')).toEqual([]);
  });

  it('preserves wildcard members for the cache policy to reject matching', () => {
    expect(parseVary('*')).toEqual(['*']);
    expect(parseVary('Accept, *, X-Test')).toEqual(['accept', '*', 'x-test']);
    expect(parseVary('X-*')).toEqual(['x-*']);
  });

  it.each(['"Accept"', 'Accept Language', 'Accept;X-Test', 'Accept=X-Test', 'Accept\n', '\u00a0Accept', 'X-💩'])(
    'rejects malformed field names %j', (input) => {
      expect(parseVary(input)).toBeNull();
    },
  );
});
