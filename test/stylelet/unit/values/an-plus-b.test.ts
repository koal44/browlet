import { describe, expect, it } from 'vitest';
import { withTrivia } from '../../../../src/stylelet/syntax/component-grammar';
import { parseAsComponentGrammar, parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { consumeAnPlusB, serializeAnPlusB } from '../../../../src/stylelet/values/an-plus-b';

describe('An+B grammar and serialization', () => {
  it.each([
    'odd', 'even', '0n+0', '-0n-0', 'n', '-n', 'n+3', 'n-3', '2n', '-2n',
    '1000000000000000000000n-3', 'n+1000000000000000000000',
    '-1000000000000000000000n-1000000000000000000000',
    String.raw`+/**/\6e - 3`, String.raw`2\6e -123`,
  ])('round-trips the interpreted coefficients of %s', (input) => {
    const value = parseAsComponentGrammar(input, withTrivia(consumeAnPlusB));
    expect(value).not.toBeNull();
    expect(parseAsComponentGrammar(serializeAnPlusB(value!), consumeAnPlusB)).toEqual(value);
  });

  const overflow = '9'.repeat(309);
  it.each([
    ['positive step', `${overflow}n`, { a: Number.MAX_VALUE, b: 0 }],
    ['negative step', `-${overflow}n`, { a: -Number.MAX_VALUE, b: 0 }],
    ['standalone offset', overflow, { a: 0, b: Number.MAX_VALUE }],
    ['positive offset', `n+${overflow}`, { a: 1, b: Number.MAX_VALUE }],
    ['embedded negative offset', `2n-${overflow}`, { a: 2, b: -Number.MAX_VALUE }],
    ['separated negative offset', `n - ${overflow}`, { a: 1, b: -Number.MAX_VALUE }],
  ] as const)('limits an overflowing %s during interpretation', (_name, input, expected) => {
    const value = parseAsComponentGrammar(input, consumeAnPlusB);
    expect(value).toEqual(expected);
    expect(parseAsComponentGrammar(serializeAnPlusB(value!), consumeAnPlusB)).toEqual(value);
  });

  it('leaves the following of-clause for the selector grammar', () => {
    const context = {};
    const cursor = new TokenCursor(parseListOfComponentValues('2n + 1 of .item'), context);
    expect(withTrivia(consumeAnPlusB)(cursor)).toEqual({ a: 2, b: 1 });
    expect(cursor.next()).toMatchObject({ type: TokenKind.Whitespace });
    expect(cursor.peek()).toMatchObject({ type: TokenKind.Ident, value: 'of' });
    expect(cursor.context).toBe(context);
  });

  it.each(['+ n', '2.0n', '1e0', 'unrelated'])('leaves the cursor untouched on failure: %s', (input) => {
    const cursor = new TokenCursor(parseListOfComponentValues(input), {});
    expect(consumeAnPlusB(cursor)).toBeNull();
    expect(cursor.pos()).toBe(0);
  });
});
