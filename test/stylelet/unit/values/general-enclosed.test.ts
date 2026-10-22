import { describe, expect, it } from 'vitest';
import { AnyValue } from '../../../../src/stylelet/values/any-value';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { GeneralEnclosedValue } from '../../../../src/stylelet/values/general-enclosed';

describe('<general-enclosed>', () => {
  it.each([
    ['future()', TokenKind.FunctionBlock],
    ['future(value)', TokenKind.FunctionBlock],
    ['future(value, {other})', TokenKind.FunctionBlock],
    ['()', TokenKind.ParensBlock],
    ['(value)', TokenKind.ParensBlock],
    ['(value, {other})', TokenKind.ParensBlock],
  ])('parses %s', (input, block) => {
    const parsed = GeneralEnclosedValue.parse(input, {});
    expect(parsed).toBeInstanceOf(GeneralEnclosedValue);
    expect(parsed).toMatchObject({
      value: { type: block },
    });
  });

  it('distinguishes an omitted any-value from a present any-value', () => {
    const empty = GeneralEnclosedValue.parse('future()', {})!.value;
    const present = GeneralEnclosedValue.parse('future(value)', {})!.value;
    expect(empty.value).toBeUndefined();
    expect(present.value).toBeInstanceOf(AnyValue);
  });

  it.each([
    '',
    'future',
    '{value}',
    'future(])',
    '([)',
    'future() other',
  ])('rejects %j', (input) => {
    expect(GeneralEnclosedValue.parse(input, {})).toBeNull();
  });

  it('consumes one block and leaves the following components', () => {
    const c = new TokenCursor(parseListOfComponentValues('future() other', {}), {});

    expect(GeneralEnclosedValue.consume(c)).toMatchObject({
      value: {
        type: TokenKind.FunctionBlock,
        name: 'future',
      },
    });
    expect(c.pos()).toBe(1);
  });

  it('preserves opaque calculations through resolution and serialization', () => {
    const condition = GeneralEnclosedValue.parse('future(calc(1em + 2px))', {})!;
    const resolved = condition.resolve(ValueStage.Computed, { length: { em: 16 } });

    expect(resolved).toBe(condition);
    expect(resolved.serialize()).toBe('future(calc(1em + 2px))');
  });
});
