import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import {
  parseGeneralEnclosed,
  consumeGeneralEnclosed,
} from '../../../../src/stylelet/values/general-enclosed';

describe('<general-enclosed>', () => {
  it.each([
    ['future()', TokenKind.FunctionBlock],
    ['future(value)', TokenKind.FunctionBlock],
    ['future(value, {other})', TokenKind.FunctionBlock],
    ['()', TokenKind.ParensBlock],
    ['(value)', TokenKind.ParensBlock],
    ['(value, {other})', TokenKind.ParensBlock],
  ])('parses %s', (input, block) => {
    expect(parseGeneralEnclosed(input)).toMatchObject({
      type: 'general-enclosed',
      value: { type: block },
    });
  });

  it('distinguishes an omitted any-value from a present any-value', () => {
    expect(parseGeneralEnclosed('future()')?.value.value).toBeUndefined();
    expect(parseGeneralEnclosed('future(value)')?.value.value).toMatchObject({
      type: 'any-value',
    });
  });

  it.each([
    '',
    'future',
    '{value}',
    'future(])',
    '([)',
    'future() other',
  ])('rejects %j', (input) => {
    expect(parseGeneralEnclosed(input)).toBeNull();
  });

  it('consumes one block and leaves the following components', () => {
    const c = new TokenCursor(parseListOfComponentValues('future() other'));

    expect(consumeGeneralEnclosed(c)).toMatchObject({
      type: 'general-enclosed',
      value: {
        type: TokenKind.FunctionBlock,
        name: 'future',
      },
    });
    expect(c.pos()).toBe(1);
  });
});
