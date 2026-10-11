import { describe, expect, it } from 'vitest';

import { asciiLower, asciiUpper, hasWhitespaceToken } from '../../src/infra/ascii';

describe('ASCII case conversion', () => {
  it('changes only the corresponding ASCII letter range', () => {
    const input = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)).join('');
    expect(asciiUpper(input)).toBe(input.toUpperCase());
    expect(asciiLower(input)).toBe(input.toLowerCase());
  });

  it('preserves non-ASCII letters, astral characters, and lone surrogates', () => {
    const unchanged = 'éÉßİıK😀\uD800';
    expect(asciiUpper(`${unchanged}aZ`)).toBe(`${unchanged}AZ`);
    expect(asciiLower(`${unchanged}aZ`)).toBe(`${unchanged}az`);
  });

  it('handles empty and already normalized strings', () => {
    expect(asciiUpper('')).toBe('');
    expect(asciiLower('')).toBe('');
    expect(asciiUpper('MY-ELEMENT:123')).toBe('MY-ELEMENT:123');
    expect(asciiLower('my-element:123')).toBe('my-element:123');
  });
});

describe('hasWhitespaceToken', () => {
  it('matches whole whitespace-separated tokens', () => {
    expect(hasWhitespaceToken('foo octicon bar', 'octicon')).toBe(true);
    expect(hasWhitespaceToken('foo octicon bar', 'foo')).toBe(true);
    expect(hasWhitespaceToken('foo octicon bar', 'bar')).toBe(true);
  });

  it('does not match substrings inside tokens', () => {
    expect(hasWhitespaceToken('foo octicon bar', 'oct')).toBe(false);
    expect(hasWhitespaceToken('foo octicon bar', 'icon')).toBe(false);
    expect(hasWhitespaceToken('foobar', 'foo')).toBe(false);
  });

  it('uses ASCII whitespace only', () => {
    expect(hasWhitespaceToken('foo\tbar', 'bar')).toBe(true);
    expect(hasWhitespaceToken('foo\nbar', 'bar')).toBe(true);
    expect(hasWhitespaceToken('foo\fbar', 'bar')).toBe(true);
    expect(hasWhitespaceToken('foo\rbar', 'bar')).toBe(true);
    expect(hasWhitespaceToken('foo bar', 'bar')).toBe(true);

    // Vertical tab U+000B is not ASCII whitespace.
    expect(hasWhitespaceToken('foo\vbar', 'bar')).toBe(false);
    expect(hasWhitespaceToken('foo\vbar', 'foo\vbar')).toBe(true);
  });

  it('handles leading, trailing, and repeated ASCII whitespace', () => {
    expect(hasWhitespaceToken('  foo   bar  ', 'foo')).toBe(true);
    expect(hasWhitespaceToken('  foo   bar  ', 'bar')).toBe(true);
    expect(hasWhitespaceToken('     ', 'foo')).toBe(false);
  });

  it('does not match an empty token', () => {
    expect(hasWhitespaceToken('foo bar', '')).toBe(false);
    expect(hasWhitespaceToken('', '')).toBe(false);
  });

  it('is case-sensitive by itself', () => {
    expect(hasWhitespaceToken('foo UnitTest bar', 'UnitTest')).toBe(true);
    expect(hasWhitespaceToken('foo UnitTest bar', 'unittest')).toBe(false);
  });
});
