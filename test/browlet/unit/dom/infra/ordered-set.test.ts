import { describe, expect, it } from 'vitest';

import {
  parseOrderedSet, serializeOrderedSet, splitOnAsciiWhitespace,
} from '../../../../../src/browlet/dom/infra/ordered-set';

describe('DOM ordered sets', () => {
  it('splits on ASCII whitespace only', () => {
    expect(splitOnAsciiWhitespace(' one\ttwo\nthree\ffour\rfive '))
      .toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(splitOnAsciiWhitespace('one\u00a0two')).toEqual(['one\u00a0two']);
  });

  it('parses unique tokens in their original order', () => {
    expect([...parseOrderedSet('one two one three two')])
      .toEqual(['one', 'two', 'three']);
  });

  it('serializes tokens separated by spaces', () => {
    expect(serializeOrderedSet(new Set(['one', 'two', 'three'])))
      .toBe('one two three');
    expect(serializeOrderedSet(new Set())).toBe('');
  });
});
