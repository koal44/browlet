import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import { parseListOfComponentValues, BlockKind } from '../../../../src/stylelet/parser/syntax';
import { TokenKind } from '../../../../src/stylelet/parser/tokens';
import {
  createBooleanExprConsumer,
  parseBooleanExpr,
  resolveBooleanExpr,
  type BooleanExprResult,
} from '../../../../src/stylelet/values/boolean-expr';
import { tryConsumeGeneralEnclosed } from '../../../../src/stylelet/values/general-enclosed';
import { createKeywordConsumer } from '../../../../src/stylelet/values/keyword';

const tryConsumeTest = createKeywordConsumer('a', 'b', 'c');

describe('<boolean-expr[]>', () => {
  it('wraps the generic test value', () => {
    expect(parseBooleanExpr('a', tryConsumeTest)).toEqual({
      type: 'boolean-test',
      value: 'a',
    });
  });

  it('parses not with one group operand', () => {
    expect(parseBooleanExpr('NOT a', tryConsumeTest)).toEqual({
      type: 'boolean-not',
      value: {
        type: 'boolean-test',
        value: 'a',
      },
    });
  });

  it('keeps and operands in one flat expression', () => {
    expect(parseBooleanExpr('a and b AND c', tryConsumeTest)).toEqual({
      type: 'boolean-and',
      values: [
        { type: 'boolean-test', value: 'a' },
        { type: 'boolean-test', value: 'b' },
        { type: 'boolean-test', value: 'c' },
      ],
    });
  });

  it('does not let the nullable and tail mask an or expression', () => {
    expect(parseBooleanExpr('a or b or c', tryConsumeTest)).toEqual({
      type: 'boolean-or',
      values: [
        { type: 'boolean-test', value: 'a' },
        { type: 'boolean-test', value: 'b' },
        { type: 'boolean-test', value: 'c' },
      ],
    });
  });

  it('chooses the nonempty tail recursively inside parentheses', () => {
    expect(parseBooleanExpr('(a or b)', tryConsumeTest)).toEqual({
      type: 'block',
      block: BlockKind.Parens,
      value: {
        type: 'boolean-or',
        values: [
          { type: 'boolean-test', value: 'a' },
          { type: 'boolean-test', value: 'b' },
        ],
      },
    });
  });

  it('retains grouping as a parsed parentheses block', () => {
    expect(parseBooleanExpr('(a and b) or c', tryConsumeTest)).toEqual({
      type: 'boolean-or',
      values: [
        {
          type: 'block',
          block: BlockKind.Parens,
          value: {
            type: 'boolean-and',
            values: [
              { type: 'boolean-test', value: 'a' },
              { type: 'boolean-test', value: 'b' },
            ],
          },
        },
        { type: 'boolean-test', value: 'c' },
      ],
    });
  });

  it('uses general-enclosed for unknown function and parentheses blocks', () => {
    expect(parseBooleanExpr('future()', tryConsumeTest)).toMatchObject({
      type: 'general-enclosed',
      value: {
        block: BlockKind.Function,
        name: 'future',
        value: undefined,
      },
    });
    expect(parseBooleanExpr('(future)', tryConsumeTest)).toMatchObject({
      type: 'general-enclosed',
      value: {
        block: BlockKind.Parens,
        value: { type: 'any-value' },
      },
    });
  });

  it('gives the supplied test grammar priority over general-enclosed', () => {
    expect(parseBooleanExpr('known(value)', tryConsumeGeneralEnclosed)).toMatchObject({
      type: 'boolean-test',
      value: {
        type: 'general-enclosed',
        value: {
          block: BlockKind.Function,
          name: 'known',
        },
      },
    });
  });

  it('falls back to general-enclosed when grouped boolean parsing fails', () => {
    expect(parseBooleanExpr('(a and)', tryConsumeTest)).toMatchObject({
      type: 'general-enclosed',
      value: {
        block: BlockKind.Parens,
        value: { type: 'any-value' },
      },
    });
  });

  it.each([
    '',
    'not',
    'not not a',
    'a and b or c',
    'a or b and c',
    'a b',
    'future(])',
  ])('rejects %j as a complete expression', (input) => {
    expect(parseBooleanExpr(input, tryConsumeTest)).toBeNull();
  });

  it.each([
    'a and',
    'a and b and',
    'a or',
    'a or b or',
  ])('rejects the incomplete tail in %j when parsing the complete grammar', (input) => {
    expect(parseBooleanExpr(input, tryConsumeTest)).toBeNull();
  });

  it('leaves an incomplete Boolean tail for the enclosing grammar', () => {
    const c = new ComponentCursor(parseListOfComponentValues('a and'));
    const tryConsume = createBooleanExprConsumer(tryConsumeTest);

    expect(tryConsume(c)).toMatchObject({
      type: 'boolean-test',
      value: 'a',
    });
    expect(c.peek()).toMatchObject({
      type: 'token',
      kind: TokenKind.Whitespace,
    });
  });

  it('consumes one expression and leaves following components', () => {
    const c = new ComponentCursor(parseListOfComponentValues('a and b trailing'));
    const tryConsume = createBooleanExprConsumer(tryConsumeTest);

    expect(tryConsume(c)).toMatchObject({
      type: 'boolean-and',
    });
    expect(c.peek()).toMatchObject({
      type: 'token',
      kind: TokenKind.Whitespace,
    });
  });
});

describe('resolveBooleanExpr', () => {
  const resolveTest = (value: 'a' | 'b' | 'c'): BooleanExprResult => {
    switch (value) {
      case 'a': return true;
      case 'b': return false;
      case 'c': return 'unknown';
    }
  };

  it.each([
    ['a', true],
    ['b', false],
    ['c', 'unknown'],
    ['not a', false],
    ['not b', true],
    ['not c', 'unknown'],
    ['a and a', true],
    ['a and b', false],
    ['a and c', 'unknown'],
    ['b and c', false],
    ['a or c', true],
    ['b or b', false],
    ['b or c', 'unknown'],
    ['(a or c) and b', false],
  ] as const)('resolves %s with three-valued logic', (input, expected) => {
    const value = parseBooleanExpr(input, tryConsumeTest)!;

    expect(resolveBooleanExpr(value, {
      resolveTest,
      preserveUnknown: true,
    })).toBe(expected);
  });

  it('resolves top-level unknown to false by default', () => {
    const value = parseBooleanExpr('c', tryConsumeTest)!;

    expect(resolveBooleanExpr(value, { resolveTest })).toBe(false);
  });

  it('treats general-enclosed as unknown by default', () => {
    const value = parseBooleanExpr('future()', tryConsumeTest)!;

    expect(resolveBooleanExpr(value, {
      resolveTest,
      preserveUnknown: true,
    })).toBe('unknown');
  });

  it('allows the containing context to define general-enclosed as false', () => {
    const value = parseBooleanExpr('not future()', tryConsumeTest)!;

    expect(resolveBooleanExpr(value, {
      resolveTest,
      resolveGeneralEnclosed: () => false,
    })).toBe(true);
  });
});
