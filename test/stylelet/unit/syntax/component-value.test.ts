import { describe, expect, it } from 'vitest';
import { serializeComponentValues, serializeCssIdentifier } from '../../../../src/stylelet/syntax/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { hashToken, HashTokenFlag, TokenKind } from '../../../../src/stylelet/syntax/tokens';

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
    expect(serializeComponentValues(parseListOfComponentValues(input).tokens)).toBe(input);
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
    expect(serializeComponentValues(parseListOfComponentValues(input).tokens)).toBe(input);
  });

  it('preserves leading and trailing whitespace components', () => {
    expect(serializeComponentValues(parseListOfComponentValues(' ident ').tokens)).toBe(' ident ');
  });

  it('uses name escaping for unrestricted hashes and identifier escaping for ID hashes', () => {
    expect(serializeComponentValues([hashToken('1a', HashTokenFlag.Unrestricted)])).toBe('#1a');
    expect(serializeComponentValues([hashToken('1a', HashTokenFlag.Id)])).toBe('#\\31 a');
  });

  it.each([0x80, 0xa0, 0xd7, 0x37e, 0x200e, 0x2060, 0x3000, 0xfdd0, 0xffff])(
    'escapes excluded non-ASCII identifier code point %i in every token context', (code) => {
      const character = String.fromCodePoint(code);
      expect(serializeCssIdentifier(character)).toBe(`\\${character}`);
      for (const prefix of ['', '@', '#', '#1', '1']) {
        const list = parseListOfComponentValues(`${prefix}\\${code.toString(16)} `);
        const serialized = serializeComponentValues(list.tokens);
        expect(parseListOfComponentValues(serialized).tokens).toEqual(list.tokens);
      }

      const list = parseListOfComponentValues(`\\${code.toString(16)} ()`);
      const serialized = serializeComponentValues(list.tokens);
      expect(serialized).toBe(`\\${character}()`);
      expect(parseListOfComponentValues(serialized).tokens).toMatchObject([
        { type: TokenKind.FunctionBlock, name: character, value: { tokens: [] } },
      ]);
    },
  );

  it.each([0xb7, 0xc0, 0xd6, 0x200c, 0x203f, 0x3001, 0xfffd, 0x1f600])(
    'keeps allowed non-ASCII identifier code point %i literal', (code) => {
      const character = String.fromCodePoint(code);
      expect(serializeCssIdentifier(character)).toBe(character);
    },
  );

  it.each([
    '#1\\?',
    'url(a\\20 b)',
    '1\\65 1m',
    '+01',
    '-0',
    '1.0',
    '1e0',
    '1000000000000000000000',
    '-1000000000000000000000px',
    '+1000000000000000000000',
    '1e999',
    '-1e999%',
    '+1e999px',
    '9'.repeat(309),
    `-${'9'.repeat(309)}px`,
    '5e-324',
    '-1e-999',
    '+1.0%',
    '2.0n',
    '4e3e2',
    'url(a")',
    '"\n',
    '\\\n',
    '</**/!/**/--',
    '</**/!/**/--name',
    String.raw`\80 `,
    String.raw`@\a0 `,
    String.raw`#\200e `,
    String.raw`1\d7 `,
  ])('round-trips the component structure of %j', (input) => {
    const list = parseListOfComponentValues(input);
    const serialized = serializeComponentValues(list.tokens);

    expect(parseListOfComponentValues(serialized).tokens).toEqual(list.tokens);
  });
});
