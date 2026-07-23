import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import {
  accumulateNumbers, addNumbers, createNumberConsumer, interpolateNumbers,
  parseNumber, serializeNumber, tryConsumeNumber,
} from '../../../src/stylelet/values/number';

describe('number values', () => {
  it('parses a number literal', () => {
    expect(parseNumber('1.25')).toEqual({
      type: 'number',
      value: 1.25,
    });
  });

  it('parses and serializes a number-valued math function', () => {
    const value = parseNumber('calc(1 + 2)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'number',
        value: 3,
      },
    });
    expect(serializeNumber(value!)).toBe('calc(3)');
    expect(serializeNumber(value!, { stage: 'computed' })).toBe('3');
  });

  it('rejects a math function with a non-number result', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(1px)'),
    );

    expect(tryConsumeNumber(c)).toMatchObject({ kind: 'bad' });
  });

  it('applies consumer ranges to literals and math functions at their stages', () => {
    const consume = createNumberConsumer({ min: 0, max: 1 });
    const literal = new ComponentCursor(parseListOfComponentValues('2'));
    const specifiedMath = new ComponentCursor(
      parseListOfComponentValues('calc(2)'),
    );
    const computedMath = new ComponentCursor(
      parseListOfComponentValues('calc(2)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).toMatchObject({ kind: 'ok' });
    expect(consume(computedMath)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'number',
          value: 1,
        },
      },
    });
  });

  it('does not mutate the surrounding calculation context', () => {
    const context = { stage: 'computed' } as const;
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(1 + 2)'),
      { context },
    );

    expect(tryConsumeNumber(c)).toMatchObject({ kind: 'ok' });
    expect(c.context).toBe(context);
  });

  it('combines two literals without creating a math value', () => {
    const a = parseNumber('2')!;
    const b = parseNumber('4')!;

    expect(addNumbers(a, b)).toEqual({ type: 'number', value: 6 });
    expect(interpolateNumbers(a, b, 0.25))
      .toEqual({ type: 'number', value: 2.5 });
    expect(accumulateNumbers(a, b))
      .toEqual({ type: 'number', value: 6 });
  });

  it('promotes a literal when adding it to a math value', () => {
    const literal = parseNumber('2')!;
    const math = parseNumber('calc(4)')!;

    const forward = addNumbers(literal, math);
    const reverse = addNumbers(math, literal);

    expect(forward.type).toBe('math');
    expect(reverse.type).toBe('math');
    expect(serializeNumber(forward)).toBe('calc(6)');
    expect(serializeNumber(reverse)).toBe('calc(6)');
  });

  it('promotes literals for interpolation and accumulation with math values', () => {
    const literal = parseNumber('2')!;
    const math = parseNumber('calc(4)')!;
    const interpolated = interpolateNumbers(literal, math, 0.25);
    const accumulated = accumulateNumbers(literal, math);

    expect(interpolated.type).toBe('math');
    expect(accumulated.type).toBe('math');
    expect(serializeNumber(interpolated)).toBe('calc(2.5)');
    expect(serializeNumber(accumulated)).toBe('calc(6)');
  });
});
