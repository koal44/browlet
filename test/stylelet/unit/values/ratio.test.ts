import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { RatioValue, parseNumberOrRatio, consumeNumberOrRatio } from '../../../../src/stylelet/values/ratio';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { NumberLiteral } from '../../../../src/stylelet/values/numeric-literal/number';

describe('ratio', () => {
  it.each([
    ['3 / 2', new RatioValue({ numerator: 3, denominator: 2 })],
    ['3/2', new RatioValue({ numerator: 3, denominator: 2 })],
    ['1.5 / 2.5', new RatioValue({ numerator: 1.5, denominator: 2.5 })],
    ['3', new RatioValue({ numerator: 3, denominator: 1 })],
    ['0 / 0', new RatioValue({ numerator: 0, denominator: 0 })],
  ])('parses %j', (input, expected) => {
    expect(RatioValue.parse(input, {})).toEqual(expected);
  });

  it('accepts surrounding and component trivia', () => {
    expect(RatioValue.parse(' /* before */ 3 /* middle */ / 2 /* after */ ', {})).toEqual(new RatioValue({ numerator: 3, denominator: 2 }));
  });

  it.each([
    '',
    '-1',
    '1 / -2',
    '/ 2',
    '1 /',
    '1 / 2 / 3',
    '1 2',
    '1px / 2',
  ])('rejects %j as a ratio production', (input) => {
    expect(RatioValue.parse(input, {})).toBeNull();
  });

  it('consumes one ratio from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('3/2 4', {}), {});

    expect(RatioValue.consume(c)).toEqual(new RatioValue({ numerator: 3, denominator: 2 }));
    expect(c.pos()).toBe(3);
  });

  it('defaults an omitted denominator while leaving the next component', () => {
    const c = new TokenCursor(parseListOfComponentValues('3 4', {}), {});

    expect(RatioValue.consume(c)).toEqual(new RatioValue({ numerator: 3, denominator: 1 }));
    expect(c.pos()).toBe(1);
  });

  it('distinguishes number syntax from a ratio with an explicit slash', () => {
    expect(parseNumberOrRatio('3', {})).toEqual(new NumberValue(new NumberLiteral(3)));
    expect(parseNumberOrRatio('3 / 1', {})).toEqual(new RatioValue({ numerator: 3, denominator: 1 }));
    expect(parseNumberOrRatio('-3', {})).toEqual(new NumberValue(new NumberLiteral(-3)));
    expect(parseNumberOrRatio('calc(1 + 2)', {})!.serialize())
      .toBe('calc(3)');
    expect(parseNumberOrRatio('calc(1 + 2)', {})!.resolve(ValueStage.Computed, {}).serialize()).toBe('3');
  });

  it('consumes the reusable number-or-ratio union', () => {
    const numberCursor = new TokenCursor(parseListOfComponentValues('3 4', {}), {});
    const ratioCursor = new TokenCursor(parseListOfComponentValues('3 / 1 4', {}), {});

    expect(consumeNumberOrRatio(numberCursor)).toEqual(new NumberValue(new NumberLiteral(3)));
    expect(numberCursor.pos()).toBe(1);
    expect(consumeNumberOrRatio(ratioCursor)).toEqual(new RatioValue({ numerator: 3, denominator: 1 }));
    expect(ratioCursor.pos()).toBe(5);
  });

  it.each([
    [new RatioValue({ numerator: 0, denominator: 1 }), true],
    [new RatioValue({ numerator: 1, denominator: 0 }), true],
    [new RatioValue({ numerator: Infinity, denominator: 1 }), true],
    [new RatioValue({ numerator: 1, denominator: Infinity }), true],
    [new RatioValue({ numerator: 16, denominator: 9 }), false],
  ])('identifies whether %j is degenerate', (value, expected) => {
    expect(value.isDegenerate()).toBe(expected);
  });

  it.each([
    [new RatioValue({ numerator: 3, denominator: 2 }), '3 / 2'],
    [new RatioValue({ numerator: 3, denominator: 1 }), '3 / 1'],
    [new RatioValue({ numerator: 1.5, denominator: 2.25 }), '1.5 / 2.25'],
  ])('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('interpolates the logarithms of the resolved ratios', () => {
    const result = new RatioValue({ numerator: 5, denominator: 1 }).interpolate(new RatioValue({ numerator: 3, denominator: 2 }), 0.5);

    expect(result).toBeInstanceOf(RatioValue);
    expect(result.value.numerator).toBeCloseTo(Math.sqrt(7.5));
    expect(result.value.denominator).toBe(1);
  });

  it.each([
    [
      new RatioValue({ numerator: 0, denominator: 1 }),
      new RatioValue({ numerator: 1, denominator: 1 }),
    ],
    [
      new RatioValue({ numerator: 1, denominator: 1 }),
      new RatioValue({ numerator: 1, denominator: Infinity }),
    ],
  ])('does not interpolate a degenerate ratio', (a, b) => {
    expect(() => a.interpolate(b, 0.5)).toThrow(
      'Degenerate ratios cannot be interpolated',
    );
  });

  it.each([
    new RatioValue({ numerator: 3, denominator: 2 }),
    new RatioValue({ numerator: 1.5, denominator: 1 }),
    new RatioValue({ numerator: 0, denominator: 4 }),
  ])('round-trips the semantic ratio %j', (value) => {
    expect(RatioValue.parse(value.serialize(), {})).toEqual(value);
  });
});
