import { describe, expect, it } from 'vitest';

import { hasWhitespaceToken } from '../../src/infra/ascii';

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
