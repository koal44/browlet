import { describe, expect, it } from 'vitest';

import {
  asciiDashMatch, asciiEndsWith, asciiEquals, hasAsciiWhitespaceToken, asciiIncludes, asciiStartsWith,
} from '../../src/infra/selector-matching';

describe('ASCII-insensitive string predicates', () => {
  describe('asciiEquals', () => {
    it('matches ASCII case-insensitively', () => {
      expect(asciiEquals('AlphaBeta', 'alphabeta')).toBe(true);
      expect(asciiEquals('ALPHABETA', 'alphabeta')).toBe(true);
      expect(asciiEquals('alphabeta', 'alphabeta')).toBe(true);
    });

    it('requires equal length and exact non-ASCII code units', () => {
      expect(asciiEquals('Alpha', 'alpha!')).toBe(false);
      expect(asciiEquals('föo', 'föo')).toBe(true);
      expect(asciiEquals('FöO', 'föo')).toBe(true);
      expect(asciiEquals('FÖO', 'föo')).toBe(false);
      expect(asciiEquals('FÖO', 'fÖo')).toBe(true);
    });

    it('handles empty strings', () => {
      expect(asciiEquals('', '')).toBe(true);
      expect(asciiEquals('x', '')).toBe(false);
      expect(asciiEquals('', 'x')).toBe(false);
    });
  });

  describe('asciiStartsWith', () => {
    it('matches ASCII prefixes case-insensitively', () => {
      expect(asciiStartsWith('Commit-Start', 'commit')).toBe(true);
      expect(asciiStartsWith('commit-start', 'commit')).toBe(true);
      expect(asciiStartsWith('xcommit-start', 'commit')).toBe(false);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiStartsWith('FöO-bar', 'föo')).toBe(true);
      expect(asciiStartsWith('FÖO-bar', 'föo')).toBe(false);
      expect(asciiStartsWith('FÖO-bar', 'fÖo')).toBe(true);
    });

    it('handles empty prefix consistently with startsWith', () => {
      expect(asciiStartsWith('abc', '')).toBe(true);
      expect(asciiStartsWith('', '')).toBe(true);
      expect(asciiStartsWith('', 'a')).toBe(false);
    });
  });

  describe('asciiEndsWith', () => {
    it('matches ASCII suffixes case-insensitively', () => {
      expect(asciiEndsWith('End-Commit', 'commit')).toBe(true);
      expect(asciiEndsWith('end-commit', 'commit')).toBe(true);
      expect(asciiEndsWith('end-commit-x', 'commit')).toBe(false);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiEndsWith('xx-FöO', 'föo')).toBe(true);
      expect(asciiEndsWith('xx-FÖO', 'föo')).toBe(false);
      expect(asciiEndsWith('xx-FÖO', 'fÖo')).toBe(true);
    });

    it('handles empty suffix consistently with endsWith', () => {
      expect(asciiEndsWith('abc', '')).toBe(true);
      expect(asciiEndsWith('', '')).toBe(true);
      expect(asciiEndsWith('', 'a')).toBe(false);
    });
  });

  describe('asciiIncludes', () => {
    it('matches ASCII substrings case-insensitively', () => {
      expect(asciiIncludes('/Repos/Example/Commits/ABC', 'commits')).toBe(true);
      expect(asciiIncludes('/repos/example/commits/abc', 'commits')).toBe(true);
      expect(asciiIncludes('/repos/example/branches/abc', 'commits')).toBe(false);
    });

    it('finds matches at beginning, middle, and end', () => {
      expect(asciiIncludes('ABCxxx', 'abc')).toBe(true);
      expect(asciiIncludes('xxxABCxxx', 'abc')).toBe(true);
      expect(asciiIncludes('xxxABC', 'abc')).toBe(true);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiIncludes('xxFöOxx', 'föo')).toBe(true);
      expect(asciiIncludes('xxFÖOxx', 'föo')).toBe(false);
      expect(asciiIncludes('xxFÖOxx', 'fÖo')).toBe(true);
    });

    it('treats empty expected as no match for selector-operator use', () => {
      expect(asciiIncludes('abc', '')).toBe(false);
      expect(asciiIncludes('', '')).toBe(false);
    });
  });

  describe('asciiDashMatch', () => {
    it('matches exact or prefix followed by hyphen', () => {
      expect(asciiDashMatch('en', 'en')).toBe(true);
      expect(asciiDashMatch('en-US', 'en')).toBe(true);
      expect(asciiDashMatch('english', 'en')).toBe(false);
      expect(asciiDashMatch('fr-US', 'en')).toBe(false);
    });

    it('matches ASCII case-insensitively', () => {
      expect(asciiDashMatch('EN', 'en')).toBe(true);
      expect(asciiDashMatch('EN-us', 'en')).toBe(true);
      expect(asciiDashMatch('eN-us', 'en')).toBe(true);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiDashMatch('föo-bar', 'föo')).toBe(true);
      expect(asciiDashMatch('FöO-bar', 'föo')).toBe(true);
      expect(asciiDashMatch('FÖO-bar', 'föo')).toBe(false);
      expect(asciiDashMatch('FÖO-bar', 'fÖo')).toBe(true);
    });

    it('handles empty expected according to dash-match selector semantics', () => {
      expect(asciiDashMatch('', '')).toBe(true);
      expect(asciiDashMatch('-', '')).toBe(true);
      expect(asciiDashMatch('-x', '')).toBe(true);
      expect(asciiDashMatch('x', '')).toBe(false);
      expect(asciiDashMatch('x-', '')).toBe(false);
    });

    it('uses UTF-16 indexing consistently for astral-plane prefixes', () => {
      expect(asciiDashMatch('a😀b', 'a😀b')).toBe(true);
      expect(asciiDashMatch('a😀b-c', 'a😀b')).toBe(true);
      expect(asciiDashMatch('a😀bc', 'a😀b')).toBe(false);

      expect(asciiDashMatch('😀', '😀')).toBe(true);
      expect(asciiDashMatch('😀-x', '😀')).toBe(true);
      expect(asciiDashMatch('😀x', '😀')).toBe(false);
    });
  });
});

describe('hasAsciiWhitespaceToken', () => {
  it('matches whole ASCII whitespace-separated tokens ASCII-insensitively', () => {
    expect(hasAsciiWhitespaceToken('foo UnitTest bar', 'unittest')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo UNITTEST bar', 'unittest')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo unittest bar', 'unittest')).toBe(true);
  });

  it('does not match substrings inside tokens', () => {
    expect(hasAsciiWhitespaceToken('foo UnitTest bar', 'unit')).toBe(false);
    expect(hasAsciiWhitespaceToken('foo UnitTest bar', 'test')).toBe(false);
    expect(hasAsciiWhitespaceToken('fooUnitTestbar', 'unittest')).toBe(false);
  });

  it('uses ASCII whitespace only', () => {
    expect(hasAsciiWhitespaceToken('foo\tBAR', 'bar')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo\nBAR', 'bar')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo\fBAR', 'bar')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo\rBAR', 'bar')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo BAR', 'bar')).toBe(true);

    // U+000B vertical tab is not ASCII whitespace.
    expect(hasAsciiWhitespaceToken('foo\vBAR', 'bar')).toBe(false);
    expect(hasAsciiWhitespaceToken('foo\vBAR', 'foo\vbar')).toBe(true);
  });

  it('handles leading, trailing, and repeated ASCII whitespace', () => {
    expect(hasAsciiWhitespaceToken('  FOO   BAR  ', 'foo')).toBe(true);
    expect(hasAsciiWhitespaceToken('  FOO   BAR  ', 'bar')).toBe(true);
    expect(hasAsciiWhitespaceToken('     ', 'foo')).toBe(false);
  });

  it('does not match an empty token', () => {
    expect(hasAsciiWhitespaceToken('foo bar', '')).toBe(false);
    expect(hasAsciiWhitespaceToken('', '')).toBe(false);
  });

  it('does not Unicode-fold non-ASCII characters', () => {
    expect(hasAsciiWhitespaceToken('foo FöO bar', 'föo')).toBe(true);
    expect(hasAsciiWhitespaceToken('foo FÖO bar', 'föo')).toBe(false);
    expect(hasAsciiWhitespaceToken('foo FÖO bar', 'fÖo')).toBe(true);
  });
});
