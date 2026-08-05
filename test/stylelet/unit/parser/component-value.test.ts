import { describe, expect, it } from 'vitest';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { hashToken, HashTokenFlag } from '../../../../src/stylelet/syntax/tokens';

describe('component value serialization', () => {
  it.each([
    'ident/**/ident',
    'ident/**/fn()',
    'ident/**/(value)',
    '#/**/ident',
    '-/**/ident',
    '1/**/ident',
    '1/**/%',
    '@/**/ident',
    './**/1',
    '+/**/1',
    '//**/*',
  ])('separates token pairs that would otherwise combine: %s', (input) => {
    expect(serializeComponentValues(parseListOfComponentValues(input))).toBe(input);
  });

  it.each([
    'ident*',
    '1-',
    '@1',
    '.ident',
    '+ident',
    '/%',
    '(value)ident',
  ])('does not separate token pairs that cannot combine: %s', (input) => {
    expect(serializeComponentValues(parseListOfComponentValues(input))).toBe(input);
  });

  it('preserves leading and trailing whitespace components', () => {
    expect(serializeComponentValues(parseListOfComponentValues(' ident '))).toBe(' ident ');
  });

  it('uses name escaping for unrestricted hashes and identifier escaping for ID hashes', () => {
    expect(serializeComponentValues([hashToken('1a', HashTokenFlag.Unrestricted)])).toBe('#1a');
    expect(serializeComponentValues([hashToken('1a', HashTokenFlag.Id)])).toBe('#\\31 a');
  });

  it.each([
    '#1\\?',
    'url(a\\20 b)',
    '1\\65 1m',
    'url(a")',
    '"\n',
    '\\\n',
  ])('round-trips the component structure of %j', (input) => {
    const components = parseListOfComponentValues(input);
    const serialized = serializeComponentValues(components);

    expect(parseListOfComponentValues(serialized)).toEqual(components);
  });
});
