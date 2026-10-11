import { describe, expect, it } from 'vitest';

import { parseOrderedSet, serializeOrderedSet, splitOnAsciiWhitespace } from '../../../../src/browlet/dom/infra/index';
import { parseCommaSeparatedTokens } from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML space-separated tokens', () => {
  it.each([
    ['', []], [' \t\r\n\f', []], ['one', ['one']],
    ['  one\ttwo\nthree\ffour\rfive  ', ['one', 'two', 'three', 'four', 'five']],
    ['one one ONE', ['one', 'one', 'ONE']], ['one,two', ['one,two']],
    ['one\u00a0two \vthree\u2028four', ['one\u00a0two', '\vthree\u2028four']],
  ] as const)('uses the existing ASCII splitter for %j', (input, expected) => {
    expect(splitOnAsciiWhitespace(input)).toEqual(expected);
  });

  it('retains first-occurrence order when a consumer calls for a unique ordered set', () => {
    const tokens = parseOrderedSet(' two one two THREE three one ');
    expect([...tokens]).toEqual(['two', 'one', 'THREE', 'three']);
    expect(serializeOrderedSet(tokens)).toBe('two one THREE three');
  });

  it('leaves the choice of case comparison to the consuming attribute', () => {
    expect([...parseOrderedSet('A a A')]).toEqual(['A', 'a']);
  });
});

describe('HTML comma-separated token fields', () => {
  it.each([
    ['', ['']], [' ', ['']], [',', ['', '']], [',,', ['', '', '']],
    ['a', ['a']], ['a,', ['a', '']], [',a', ['', 'a']], ['a,,', ['a', '', '']],
    [' a ,b,,d d ', ['a', 'b', '', 'd d']], ['a, \t, b,\n', ['a', '', 'b', '']],
    [' a\t b , c\n d ', ['a\t b', 'c\n d']], ['A,a,A', ['A', 'a', 'A']],
    ['\u00a0a\u00a0,\vb\v,\ufeffc\ufeff', ['\u00a0a\u00a0', '\vb\v', '\ufeffc\ufeff']],
    ['"a,b",c', ['"a', 'b"', 'c']], ['a，b', ['a，b']],
    ['a\0b,c', ['a\0b', 'c']],
  ] as const)('preserves the fields in %j', (input, expected) => {
    expect(parseCommaSeparatedTokens(input)).toEqual(expected);
  });
});
