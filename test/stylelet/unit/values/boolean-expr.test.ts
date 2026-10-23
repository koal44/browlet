import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import {
  describe, expect,
  it,
} from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { AnyValue } from '../../../../src/stylelet/values/any-value';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { BooleanExprValue, type BooleanExprResult } from '../../../../src/stylelet/values/boolean-expr';
import { GeneralEnclosedValue } from '../../../../src/stylelet/values/general-enclosed';
import { createKeywordConsumer } from '../../../../src/stylelet/syntax/component-consumers';

const consumeTest = createKeywordConsumer('a', 'b', 'c');

describe('<boolean-expr[]>', () => {
  it.each([
    ['a', true, ['a']],
    ['NOT a', false, ['a']],
    ['a and b AND c', false, ['a', 'b']],
    ['a or b or c', true, ['a']],
    ['(a or b)', true, ['a']],
    ['(a and b) or c', true, ['a', 'b', 'c']],
  ] as const)('parses %s with the expected operators and grouping', (input, expected, calls) => {
    const expression = BooleanExprValue.parse(input, consumeTest, {})!;
    const queried: string[] = [];

    expect(expression.evaluate({
      evaluateTest: (test) => {
        queried.push(test);
        return test !== 'b';
      },
    })).toBe(expected);
    expect(queried).toEqual(calls);
  });

  it.each(['future()', '(future)', '(a and)'])('retains %s as opaque general-enclosed syntax', (input) => {
    const expression = BooleanExprValue.parse(input, consumeTest, {})!;
    const queried: GeneralEnclosedValue[] = [];
    expect(expression.evaluate({
      evaluateTest: () => { throw new Error('Expected general-enclosed'); },
      evaluateGeneralEnclosed: (value) => {
        queried.push(value);
        return 'unknown';
      },
      preserveUnknown: true,
    })).toBe('unknown');
    expect(queried).toHaveLength(1);
    const opaque = queried[0]!;
    expect(opaque).toBeInstanceOf(GeneralEnclosedValue);
    expect(opaque.serialize()).toBe(input);
    const block = opaque.repr;
    if (input === 'future()') expect(block.value).toBeUndefined();
    else expect(block.value).toBeInstanceOf(AnyValue);
  });

  it('gives the supplied test grammar priority over general-enclosed', () => {
    const expression = BooleanExprValue.parse('known(value)', GeneralEnclosedValue.consume, {})!;
    expect(expression.evaluate({
      evaluateTest: (test) => {
        expect(test.serialize()).toBe('known(value)');
        return true;
      },
      evaluateGeneralEnclosed: () => { throw new Error('The test grammar should take priority'); },
    })).toBe(true);
  });

  it('does not reparse successful tests while choosing boolean operators', () => {
    const parsed: string[] = [];
    const consumer = (c: TokenCursor) => {
      const test = consumeTest(c);
      if (test !== null) parsed.push(test);
      return test;
    };
    const expression = BooleanExprValue.parse('((a or b)) and c', consumer, {});

    expect(expression).not.toBeNull();
    expect(parsed).toEqual(['a', 'b', 'c']);
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
    expect(BooleanExprValue.parse(input, consumeTest, {})).toBeNull();
  });

  it.each([
    'a and',
    'a and b and',
    'a or',
    'a or b or',
  ])('rejects the incomplete tail in %j when parsing the complete grammar', (input) => {
    expect(BooleanExprValue.parse(input, consumeTest, {})).toBeNull();
  });

  it('leaves an incomplete Boolean tail for the enclosing grammar', () => {
    const c = new TokenCursor(parseListOfComponentValues('a and', {}), {});
    const consume = BooleanExprValue.createConsumer(consumeTest);

    expect(consume(c)?.evaluate({ evaluateTest: (test) => test === 'a' })).toBe(true);
    expect(c.peek()).toMatchObject({
      type: TokenKind.Whitespace,
    });
  });

  it('consumes one expression and leaves following components', () => {
    const c = new TokenCursor(parseListOfComponentValues('a and b trailing', {}), {});
    const consume = BooleanExprValue.createConsumer(consumeTest);

    expect(consume(c)?.evaluate({ evaluateTest: (test) => test === 'a' })).toBe(false);
    expect(c.peek()).toMatchObject({
      type: TokenKind.Whitespace,
    });
  });
});

describe('BooleanExprValue.evaluate', () => {
  const evaluateTest = (value: 'a' | 'b' | 'c'): BooleanExprResult => {
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
    ['c and b', false],
    ['a or c', true],
    ['b or b', false],
    ['b or c', 'unknown'],
    ['c or a', true],
    ['(a or c) and b', false],
    ['not (c and b)', true],
    ['not (c or a)', false],
  ] as const)('evaluates %s with three-valued logic', (input, expected) => {
    const value = BooleanExprValue.parse(input, consumeTest, {})!;

    expect(value.evaluate({
      evaluateTest,
      preserveUnknown: true,
    })).toBe(expected);
  });

  it('maps top-level unknown to false by default', () => {
    const value = BooleanExprValue.parse('c', consumeTest, {})!;

    expect(value.repr.evaluate({ evaluateTest })).toBe('unknown');
    expect(value.evaluate({ evaluateTest })).toBe(false);
  });

  it.each([
    'not c',
    'not (c and a)',
    'not (c or b)',
    'not future()',
  ])('preserves unknown inside %s until the whole expression is evaluated', (input) => {
    const expression = BooleanExprValue.parse(input, consumeTest, {})!;

    expect(expression.evaluate({ evaluateTest })).toBe(false);
    expect(expression.evaluate({ evaluateTest, preserveUnknown: true })).toBe('unknown');
  });

  it.each([
    ['b and a', false, ['b']],
    ['a or b', true, ['a']],
    ['c and b and a', false, ['c', 'b']],
    ['c or a or b', true, ['c', 'a']],
    ['(c or b) and b and a', false, ['c', 'b', 'b']],
  ] as const)('short-circuits %s only when its result is decided', (input, expected, calls) => {
    const expression = BooleanExprValue.parse(input, consumeTest, {})!;
    const queried: string[] = [];

    expect(expression.evaluate({
      evaluateTest: (test) => {
        queried.push(test);
        return evaluateTest(test);
      },
      preserveUnknown: true,
    })).toBe(expected);
    expect(queried).toEqual(calls);
  });

  it('uses the current evaluation context for every child', () => {
    const expression = BooleanExprValue.parse('not (a and b)', consumeTest, {})!;

    expect(expression.evaluate({ evaluateTest: () => true })).toBe(false);
    expect(expression.evaluate({ evaluateTest: () => false })).toBe(true);
    expect(expression.evaluate({ evaluateTest: () => 'unknown', preserveUnknown: true })).toBe('unknown');
  });

  it('treats general-enclosed as unknown by default', () => {
    const value = BooleanExprValue.parse('future()', consumeTest, {})!;

    expect(value.evaluate({
      evaluateTest,
      preserveUnknown: true,
    })).toBe('unknown');
  });

  it('allows the containing context to define general-enclosed as false', () => {
    const value = BooleanExprValue.parse('not future()', consumeTest, {})!;

    expect(value.evaluate({
      evaluateTest,
      evaluateGeneralEnclosed: () => false,
    })).toBe(true);
  });

  it('passes the retained opaque value to the current general-enclosed policy', () => {
    const expression = BooleanExprValue.parse('future()', consumeTest, {})!;
    const queried: GeneralEnclosedValue[] = [];

    expect(expression.evaluate({
      evaluateTest,
      evaluateGeneralEnclosed: (value) => {
        queried.push(value);
        return true;
      },
    })).toBe(true);
    expect(expression.evaluate({
      evaluateTest,
      evaluateGeneralEnclosed: (value) => {
        queried.push(value);
        return false;
      },
    })).toBe(false);
    expect(queried).toHaveLength(2);
    expect(queried[0]).toBe(queried[1]);
    expect(expression.evaluate({ evaluateTest, preserveUnknown: true })).toBe('unknown');
  });
});
