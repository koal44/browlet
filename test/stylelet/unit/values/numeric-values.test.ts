import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import {
  accumulateNumbers, addNumbers, createNumberConsumer, interpolateNumbers, parseNumber,
  resolveNumber, serializeNumber, consumeNumber,
} from '../../../../src/stylelet/values/number';
import {
  accumulateAngles, addAngles, interpolateAngles, parseAngle, resolveAngle, serializeAngle,
  consumeAngle,
} from '../../../../src/stylelet/values/angle';
import {
  accumulateFrequencies, addFrequencies, interpolateFrequencies, parseFrequency, resolveFrequency,
  serializeFrequency, consumeFrequency,
} from '../../../../src/stylelet/values/frequency';
import {
  accumulateLengths, addLengths, createLengthConsumer, interpolateLengths, parseLength,
  resolveLength, serializeLength, consumeLength,
} from '../../../../src/stylelet/values/length';
import {
  accumulateResolutions, addResolutions, interpolateResolutions, parseResolution, resolveResolution,
  serializeResolution, consumeResolution,
} from '../../../../src/stylelet/values/resolution';
import {
  accumulateTimes, addTimes, interpolateTimes, parseTime, resolveTime, serializeTime,
  consumeTime,
} from '../../../../src/stylelet/values/time';
import {
  parseDimension, resolveDimension, serializeDimension,
} from '../../../../src/stylelet/values/dimension';
import {
  accumulateIntegers, addIntegers, createIntegerConsumer, interpolateIntegers, parseInteger,
  resolveInteger, serializeInteger, consumeInteger,
} from '../../../../src/stylelet/values/integer';
import {
  accumulatePercentages, addPercentages, createPercentageConsumer, interpolatePercentages,
  parsePercentage, resolvePercentage, serializePercentage, consumePercentage,
} from '../../../../src/stylelet/values/percentage';
import {
  accumulateAnglePercentages, addAnglePercentages, createAnglePercentageConsumer,
  interpolateAnglePercentages, parseAnglePercentage, resolveAnglePercentage,
  serializeAnglePercentage, consumeAnglePercentage,
} from '../../../../src/stylelet/values/angle-percentage';
import {
  accumulateLengthPercentages, addLengthPercentages, createLengthPercentageConsumer,
  interpolateLengthPercentages, parseLengthPercentage, resolveLengthPercentage,
  serializeLengthPercentage, consumeLengthPercentage,
} from '../../../../src/stylelet/values/length-percentage';
import {
  accumulateFrequencyPercentages, addFrequencyPercentages, createFrequencyPercentageConsumer,
  interpolateFrequencyPercentages, parseFrequencyPercentage, resolveFrequencyPercentage,
  serializeFrequencyPercentage, consumeFrequencyPercentage,
} from '../../../../src/stylelet/values/frequency-percentage';
import {
  accumulateTimePercentages, addTimePercentages, createTimePercentageConsumer,
  interpolateTimePercentages, parseTimePercentage, resolveTimePercentage, serializeTimePercentage,
  consumeTimePercentage,
} from '../../../../src/stylelet/values/time-percentage';
import type { MathContext } from '../../../../src/stylelet/values/math-value';

function expectLiteralResolution<Value>(
  parse: (input: string) => Value | null,
  resolve: (value: Value, stage: ValueStage, context: MathContext) => Value,
  input: string,
  computed: unknown,
  context: MathContext = {},
): void {
  const value = parse(input);

  expect(value).not.toBeNull();
  expect(resolve(value!, ValueStage.Specified, context)).toBe(value);
  expect(resolve(value!, ValueStage.Computed, context)).toEqual(computed);
}

describe('dimensional value literals', () => {
  it.each([
    ['angle', () => expectLiteralResolution(
      parseAngle,
      resolveAngle,
      '0.5turn',
      { type: 'angle', value: 180, unit: 'deg' },
    )],
    ['frequency', () => expectLiteralResolution(
      parseFrequency,
      resolveFrequency,
      '1khz',
      { type: 'frequency', value: 1_000, unit: 'hz' },
    )],
    ['length', () => expectLiteralResolution(
      parseLength,
      resolveLength,
      '1in',
      { type: 'length', value: 96, unit: 'px' },
    )],
    ['resolution', () => expectLiteralResolution(
      parseResolution,
      resolveResolution,
      '96dpi',
      { type: 'resolution', value: 1, unit: 'dppx' },
    )],
    ['time', () => expectLiteralResolution(
      parseTime,
      resolveTime,
      '250ms',
      { type: 'time', value: 0.25, unit: 's' },
    )],
  ])('canonicalizes a literal %s at computed-value time', (_name, test) => {
    test();
  });

  it('preserves a relative length until its context is available', () => {
    const value = parseLength('2em')!;

    expect(resolveLength(value, ValueStage.Specified, {
      length: { em: 16 },
    })).toBe(value);
    expect(resolveLength(value, ValueStage.Computed)).toBe(value);
    expect(resolveLength(value, ValueStage.Computed, {
      length: { em: 16 },
    })).toEqual({ type: 'length', value: 32, unit: 'px' });
  });
});

describe('dimension values', () => {
  it('delegates recognized dimension categories to their value modules', () => {
    const length = parseDimension('1in')!;
    const resolution = parseDimension('96dpi')!;
    const math = parseDimension('calc(1in + 96px)')!;

    expect(serializeDimension(length)).toBe('1in');
    expect(serializeDimension(resolveDimension(length, ValueStage.Computed)))
      .toBe('96px');
    expect(serializeDimension(resolveDimension(resolution, ValueStage.Computed)))
      .toBe('1dppx');
    expect(serializeDimension(math)).toBe('calc(192px)');
    expect(serializeDimension(resolveDimension(math, ValueStage.Computed)))
      .toBe('192px');
  });

  it('preserves an unrecognized dimension as the generic fallback', () => {
    const value = parseDimension('1unknown')!;

    expect(value).toEqual({ type: 'dimension', value: 1, unit: 'unknown' });
    expect(resolveDimension(value, ValueStage.Computed)).toBe(value);
    expect(serializeDimension(value)).toBe('1unknown');
  });
});

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
    expect(serializeNumber(
      resolveNumber(value!, ValueStage.Computed),
    )).toBe('3');
  });

  it('resolves a math value to a number at computed-value time', () => {
    const value = parseNumber('calc(1 + 2)')!;

    expect(resolveNumber(value, ValueStage.Declared)).toEqual(value);
    expect(resolveNumber(value, ValueStage.Declared, { unwrapMathAt: ValueStage.Declared })).toEqual({
      type: 'number',
      value: 3,
    });
    expect(resolveNumber(value, ValueStage.Computed)).toEqual({
      type: 'number',
      value: 3,
    });
  });

  it('accepts math functions other than calc()', () => {
    expect(parseNumber('min(1, 2)')).toMatchObject({
      type: 'math',
      calculation: {
        type: 'number',
        value: 1,
      },
    });
  });

  it('rejects a math function with a non-number result', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('calc(1px)'),
    );

    expect(consumeNumber(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('applies consumer ranges to literals and math functions at their stages', () => {
    const consume = createNumberConsumer({ min: 0, max: 1 });
    const literal = new TokenCursor(parseListOfComponentValues('2'));
    const specifiedMath = new TokenCursor(
      parseListOfComponentValues('calc(2)'),
    );
    const math = parseNumber('calc(2)')!;

    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).not.toBeNull();
    expect(resolveNumber(math, ValueStage.Specified, {
      range: [0, 1],
    })).toBe(math);
    expect(resolveNumber(math, ValueStage.Computed, {
      range: [0, 1],
    })).toEqual({
      type: 'number',
      value: 1,
    });
  });

  it('does not mutate the surrounding calculation context', () => {
    const context = { marker: true } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(1 + 2)'),
      { context },
    );

    expect(consumeNumber(c)).not.toBeNull();
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

describe('angle values', () => {
  it('accepts angle-valued math and rejects other categories', () => {
    const value = parseAngle('min(1deg, 2deg)');
    const other = new TokenCursor(
      parseListOfComponentValues('calc(1s)'),
    );

    expect(serializeAngle(value!)).toBe('calc(1deg)');
    expect(consumeAngle(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical angles at the computed-value stage', () => {
    const value = parseAngle('calc(.5turn + 180deg)')!;

    expect(resolveAngle(value, ValueStage.Declared)).toEqual(value);
    expect(resolveAngle(value, ValueStage.Computed)).toEqual({
      type: 'angle',
      value: 360,
      unit: 'deg',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parseAngle('1deg')!;
    const b = parseAngle('2deg')!;
    const math = parseAngle('calc(2deg)')!;

    expect(addAngles(a, b))
      .toEqual({ type: 'angle', value: 3, unit: 'deg' });
    expect(serializeAngle(addAngles(a, math))).toBe('calc(3deg)');
    expect(serializeAngle(interpolateAngles(a, math, 0.5)))
      .toBe('calc(1.5deg)');
    expect(serializeAngle(accumulateAngles(a, math))).toBe('calc(3deg)');
  });
});

describe('frequency values', () => {
  it('accepts frequency-valued math and rejects other categories', () => {
    const value = parseFrequency('min(1hz, 2hz)');
    const other = new TokenCursor(
      parseListOfComponentValues('calc(1s)'),
    );

    expect(serializeFrequency(value!)).toBe('calc(1hz)');
    expect(consumeFrequency(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical frequencies at the computed-value stage', () => {
    const value = parseFrequency('calc(1khz + 500hz)')!;

    expect(resolveFrequency(value, ValueStage.Declared)).toEqual(value);
    expect(resolveFrequency(value, ValueStage.Computed)).toEqual({
      type: 'frequency',
      value: 1500,
      unit: 'hz',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parseFrequency('1hz')!;
    const b = parseFrequency('2hz')!;
    const math = parseFrequency('calc(2hz)')!;

    expect(addFrequencies(a, b))
      .toEqual({ type: 'frequency', value: 3, unit: 'hz' });
    expect(serializeFrequency(addFrequencies(a, math))).toBe('calc(3hz)');
    expect(serializeFrequency(interpolateFrequencies(a, math, 0.5)))
      .toBe('calc(1.5hz)');
    expect(serializeFrequency(accumulateFrequencies(a, math)))
      .toBe('calc(3hz)');
  });
});

describe('length values', () => {
  it('accepts length-valued math and rejects other categories', () => {
    const value = parseLength('min(1px, 2px)');
    const other = new TokenCursor(
      parseListOfComponentValues('calc(1deg)'),
    );

    expect(serializeLength(value!)).toBe('calc(1px)');
    expect(consumeLength(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical lengths at the computed-value stage', () => {
    const value = parseLength('calc(1in + 96px)')!;

    expect(resolveLength(value, ValueStage.Declared)).toEqual(value);
    expect(resolveLength(value, ValueStage.Computed)).toEqual({
      type: 'length',
      value: 192,
      unit: 'px',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parseLength('1px')!;
    const b = parseLength('2px')!;
    const math = parseLength('calc(2px)')!;

    expect(addLengths(a, b))
      .toEqual({ type: 'length', value: 3, unit: 'px' });
    expect(serializeLength(addLengths(a, math))).toBe('calc(3px)');
    expect(serializeLength(interpolateLengths(a, math, 0.5)))
      .toBe('calc(1.5px)');
    expect(serializeLength(accumulateLengths(a, math))).toBe('calc(3px)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = createLengthConsumer({ min: 0 });
    const specified = new TokenCursor(
      parseListOfComponentValues('calc(-1px)'),
    );
    const math = parseLength('calc(-1px)')!;

    expect(consume(specified)).not.toBeNull();
    expect(resolveLength(math, ValueStage.Computed, {
      range: [0, Infinity],
    })).toEqual({
      type: 'length',
      value: 0,
      unit: 'px',
    });
  });
});

describe('resolution values', () => {
  it('accepts resolution-valued math and rejects other categories', () => {
    const value = parseResolution('min(1dppx, 2dppx)');
    const other = new TokenCursor(
      parseListOfComponentValues('calc(1hz)'),
    );

    expect(serializeResolution(value!)).toBe('calc(1dppx)');
    expect(consumeResolution(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical resolutions at the computed-value stage', () => {
    const value = parseResolution('calc(96dpi + 1dppx)')!;

    expect(resolveResolution(value, ValueStage.Declared)).toEqual(value);
    expect(resolveResolution(value, ValueStage.Computed)).toEqual({
      type: 'resolution',
      value: 2,
      unit: 'dppx',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parseResolution('1dppx')!;
    const b = parseResolution('2dppx')!;
    const math = parseResolution('calc(2dppx)')!;

    expect(addResolutions(a, b))
      .toEqual({ type: 'resolution', value: 3, unit: 'dppx' });
    expect(serializeResolution(addResolutions(a, math)))
      .toBe('calc(3dppx)');
    expect(serializeResolution(interpolateResolutions(a, math, 0.5)))
      .toBe('calc(1.5dppx)');
    expect(serializeResolution(accumulateResolutions(a, math)))
      .toBe('calc(3dppx)');
  });

  it('clamps math results to the nonnegative resolution range', () => {
    const value = resolveResolution(
      parseResolution('calc(-1dppx)')!,
      ValueStage.Computed,
      {
        range: [0, Infinity],
        unwrapMathAt: ValueStage.Actual,
      },
    );

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'dimension',
        value: 0,
        unit: 'dppx',
      },
    });
  });
});

describe('time values', () => {
  it('accepts time-valued math and rejects other categories', () => {
    const value = parseTime('min(1s, 2s)');
    const other = new TokenCursor(
      parseListOfComponentValues('calc(1hz)'),
    );

    expect(serializeTime(value!)).toBe('calc(1s)');
    expect(consumeTime(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical times at the computed-value stage', () => {
    const value = parseTime('calc(1000ms + 1s)')!;

    expect(resolveTime(value, ValueStage.Declared)).toEqual(value);
    expect(resolveTime(value, ValueStage.Computed)).toEqual({
      type: 'time',
      value: 2,
      unit: 's',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parseTime('1s')!;
    const b = parseTime('2s')!;
    const math = parseTime('calc(2s)')!;

    expect(addTimes(a, b))
      .toEqual({ type: 'time', value: 3, unit: 's' });
    expect(serializeTime(addTimes(a, math))).toBe('calc(3s)');
    expect(serializeTime(interpolateTimes(a, math, 0.5)))
      .toBe('calc(1.5s)');
    expect(serializeTime(accumulateTimes(a, math))).toBe('calc(3s)');
  });
});

describe('integer values', () => {
  it('parses integer literals and number-valued math functions', () => {
    expect(parseInteger('2')).toEqual({
      type: 'integer',
      value: 2,
    });

    const value = parseInteger('calc(1.5)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'number',
        value: 1.5,
      },
    });
    expect(serializeInteger(value!)).toBe('calc(1.5)');
  });

  it('rounds math results at the computed-value stage', () => {
    const value = resolveInteger(
      parseInteger('calc(1.5)')!,
      ValueStage.Computed,
      { unwrapMathAt: ValueStage.Actual },
    );

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'number',
        value: 2,
      },
    });
    expect(serializeInteger(
      resolveInteger(value, ValueStage.Computed),
    )).toBe('2');
  });

  it('resolves math values as integers at the computed-value stage', () => {
    const value = parseInteger('calc(1.5)')!;

    expect(resolveInteger(value, ValueStage.Declared)).toEqual(value);
    expect(resolveInteger(value, ValueStage.Computed)).toEqual({
      type: 'integer',
      value: 2,
    });
  });

  it('rejects non-number math results', () => {
    for (const input of ['calc(1px)', 'calc(1%)']) {
      const c = new TokenCursor(parseListOfComponentValues(input));

      expect(consumeInteger(c)).toBeNull();
      expect(c.pos()).toBe(0);
    }
  });

  it('applies ranges to literals and math functions at their stages', () => {
    const consume = createIntegerConsumer({ min: 0, max: 2 });
    const literal = new TokenCursor(parseListOfComponentValues('3'));
    const specifiedMath = new TokenCursor(
      parseListOfComponentValues('calc(3)'),
    );
    const math = parseInteger('calc(3)')!;

    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).not.toBeNull();
    expect(resolveInteger(math, ValueStage.Computed, {
      range: [0, 2],
    })).toEqual({
      type: 'integer',
      value: 2,
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parseInteger('1')!;
    const b = parseInteger('2')!;
    const math = parseInteger('calc(2)')!;

    expect(addIntegers(a, b)).toEqual({ type: 'integer', value: 3 });
    expect(interpolateIntegers(a, b, 0.5))
      .toEqual({ type: 'integer', value: 2 });
    expect(accumulateIntegers(a, b))
      .toEqual({ type: 'integer', value: 3 });

    expect(serializeInteger(addIntegers(a, math))).toBe('calc(3)');
    const interpolated = interpolateIntegers(
      a,
      math,
      0.5,
    );

    expect(serializeInteger(
      resolveInteger(interpolated, ValueStage.Computed),
    )).toBe('2');
    expect(serializeInteger(accumulateIntegers(a, math))).toBe('calc(3)');
  });
});

describe('percentage values', () => {
  it('parses and serializes percentage literals and math functions', () => {
    expect(parsePercentage('25%')).toEqual({
      type: 'percentage',
      value: 25,
    });

    const value = parsePercentage('calc(10% + 20%)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'percentage',
        value: 30,
      },
    });
    expect(serializePercentage(value!)).toBe('calc(30%)');
    expect(serializePercentage(
      resolvePercentage(value!, ValueStage.Computed),
    )).toBe('30%');
  });

  it('resolves math values as percentages at the computed-value stage', () => {
    const value = parsePercentage('calc(10% + 20%)')!;

    expect(resolvePercentage(value, ValueStage.Declared)).toEqual(value);
    expect(resolvePercentage(value, ValueStage.Computed, {
      percentHint: 'length',
    })).toEqual({
      type: 'percentage',
      value: 30,
    });
  });

  it('rejects non-percentage math results', () => {
    for (const input of ['calc(1)', 'calc(1px)']) {
      const c = new TokenCursor(parseListOfComponentValues(input));

      expect(consumePercentage(c)).toBeNull();
      expect(c.pos()).toBe(0);
    }
  });

  it('keeps its percentage type in another percentage context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(25%)'),
      { context },
    );

    expect(consumePercentage(c)).toMatchObject({
      calculation: {
        type: 'percentage',
        value: 25,
      },
    });
    expect(c.context).toBe(context);
  });

  it('applies ranges to literals and math functions at their stages', () => {
    const consume = createPercentageConsumer({ min: 0, max: 100 });
    const literal = new TokenCursor(parseListOfComponentValues('125%'));
    const specifiedMath = new TokenCursor(
      parseListOfComponentValues('calc(125%)'),
    );
    const math = parsePercentage('calc(125%)')!;

    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).not.toBeNull();
    expect(resolvePercentage(math, ValueStage.Computed, {
      range: [0, 100],
    })).toEqual({
      type: 'percentage',
      value: 100,
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = parsePercentage('10%')!;
    const b = parsePercentage('20%')!;
    const math = parsePercentage('calc(20%)')!;

    expect(addPercentages(a, b))
      .toEqual({ type: 'percentage', value: 30 });
    expect(interpolatePercentages(a, b, 0.5))
      .toEqual({ type: 'percentage', value: 15 });
    expect(accumulatePercentages(a, b))
      .toEqual({ type: 'percentage', value: 30 });

    expect(serializePercentage(addPercentages(a, math))).toBe('calc(30%)');
    expect(serializePercentage(interpolatePercentages(a, math, 0.5)))
      .toBe('calc(15%)');
    expect(serializePercentage(accumulatePercentages(a, math)))
      .toBe('calc(30%)');
  });
});

describe('angle-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(parseAnglePercentage('10deg')).toEqual({
      type: 'angle',
      value: 10,
      unit: 'deg',
    });
    expect(parseAnglePercentage('25%')).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = parseAnglePercentage('calc(10deg + 25%)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'sum',
      },
    });
    expect(serializeAnglePercentage(value!)).toBe('calc(25% + 10deg)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = parseAnglePercentage('calc(10deg + 25%)')!;
    const percentage = parseAnglePercentage('calc(25%)')!;

    expect(resolveAnglePercentage(mixed, ValueStage.Computed)).toEqual(mixed);
    expect(resolveAnglePercentage(mixed, ValueStage.Computed, {
      percentageReferenceValue: { type: 'angle', value: 200, unit: 'deg' },
    })).toEqual({ type: 'angle', value: 60, unit: 'deg' });
    expect(resolveAnglePercentage(percentage, ValueStage.Computed))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('canonicalizes literal angles at the computed-value stage', () => {
    const angle = parseAnglePercentage('0.5turn')!;

    expect(resolveAnglePercentage(angle, ValueStage.Specified)).toBe(angle);
    expect(resolveAnglePercentage(angle, ValueStage.Computed))
      .toEqual({ type: 'angle', value: 180, unit: 'deg' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = parseAnglePercentage('25%')!;
    const context = {
      percentageReferenceValue: { type: 'angle', value: 200, unit: 'deg' },
    } as const;

    expect(resolveAnglePercentage(percentage, ValueStage.Specified, context))
      .toBe(percentage);
    expect(resolveAnglePercentage(percentage, ValueStage.Computed))
      .toBe(percentage);
    expect(resolveAnglePercentage(percentage, ValueStage.Computed, context))
      .toEqual({ type: 'angle', value: 50, unit: 'deg' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10px + 25%)'),
    );

    expect(consumeAnglePercentage(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the angle percentage type and restores outer context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10deg + 25%)'),
      { context },
    );

    expect(consumeAnglePercentage(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const angleA = parseAnglePercentage('10deg')!;
    const angleB = parseAnglePercentage('20deg')!;
    const percentageA = parseAnglePercentage('10%')!;
    const percentageB = parseAnglePercentage('20%')!;

    expect(addAnglePercentages(angleA, angleB))
      .toEqual({ type: 'angle', value: 30, unit: 'deg' });
    expect(interpolateAnglePercentages(
      percentageA,
      percentageB,
      0.5,
    )).toEqual({ type: 'percentage', value: 15 });
    expect(accumulateAnglePercentages(percentageA, percentageB))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const angle = parseAnglePercentage('10deg')!;
    const percentage = parseAnglePercentage('20%')!;

    expect(serializeAnglePercentage(addAnglePercentages(angle, percentage)))
      .toBe('calc(20% + 10deg)');
    expect(serializeAnglePercentage(interpolateAnglePercentages(
      angle,
      percentage,
      0.5,
    ))).toBe('calc(10% + 5deg)');
    expect(serializeAnglePercentage(accumulateAnglePercentages(
      angle,
      percentage,
    ))).toBe('calc(20% + 10deg)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = createAnglePercentageConsumer({ min: 0 });
    const specified = new TokenCursor(
      parseListOfComponentValues('calc(-10deg)'),
    );
    const math = parseAnglePercentage('calc(-10deg)')!;

    expect(consume(specified)).not.toBeNull();
    expect(resolveAnglePercentage(math, ValueStage.Computed, {
      range: [0, Infinity],
    })).toEqual({
      type: 'angle',
      value: 0,
      unit: 'deg',
    });
  });
});

describe('length-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(parseLengthPercentage('10px')).toEqual({
      type: 'length',
      value: 10,
      unit: 'px',
    });
    expect(parseLengthPercentage('25%')).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = parseLengthPercentage('calc(10px + 25%)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'sum',
      },
    });
    expect(serializeLengthPercentage(value!)).toBe('calc(25% + 10px)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = parseLengthPercentage('calc(10px + 25%)')!;
    const percentage = parseLengthPercentage('calc(25%)')!;

    expect(resolveLengthPercentage(mixed, ValueStage.Computed)).toEqual(mixed);
    expect(resolveLengthPercentage(mixed, ValueStage.Computed, {
      percentageReferenceValue: { type: 'length', value: 200, unit: 'px' },
    })).toEqual({ type: 'length', value: 60, unit: 'px' });
    expect(resolveLengthPercentage(percentage, ValueStage.Computed))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('resolves literal lengths to computed absolute lengths', () => {
    const absolute = parseLengthPercentage('1in')!;
    const relative = parseLengthPercentage('2em')!;

    expect(resolveLengthPercentage(absolute, ValueStage.Specified))
      .toEqual(absolute);
    expect(resolveLengthPercentage(absolute, ValueStage.Computed))
      .toEqual({ type: 'length', value: 96, unit: 'px' });
    expect(resolveLengthPercentage(relative, ValueStage.Computed))
      .toEqual(relative);
    expect(resolveLengthPercentage(relative, ValueStage.Computed, {
      length: { em: 16 },
    })).toEqual({ type: 'length', value: 32, unit: 'px' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = parseLengthPercentage('25%')!;

    expect(resolveLengthPercentage(percentage, ValueStage.Computed))
      .toEqual(percentage);
    expect(resolveLengthPercentage(percentage, ValueStage.Computed, {
      percentageReferenceValue: { type: 'length', value: 200, unit: 'px' },
    })).toEqual({ type: 'length', value: 50, unit: 'px' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10deg + 25%)'),
    );

    expect(consumeLengthPercentage(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the length percentage type and restores outer context', () => {
    const context = {
      percentHint: 'angle',
    } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10px + 25%)'),
      { context },
    );

    expect(consumeLengthPercentage(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const lengthA = parseLengthPercentage('10px')!;
    const lengthB = parseLengthPercentage('20px')!;
    const percentageA = parseLengthPercentage('10%')!;
    const percentageB = parseLengthPercentage('20%')!;

    expect(addLengthPercentages(lengthA, lengthB))
      .toEqual({ type: 'length', value: 30, unit: 'px' });
    expect(interpolateLengthPercentages(
      percentageA,
      percentageB,
      0.5,
    )).toEqual({ type: 'percentage', value: 15 });
    expect(accumulateLengthPercentages(percentageA, percentageB))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const length = parseLengthPercentage('10px')!;
    const percentage = parseLengthPercentage('20%')!;

    expect(serializeLengthPercentage(addLengthPercentages(
      length,
      percentage,
    ))).toBe('calc(20% + 10px)');
    expect(serializeLengthPercentage(interpolateLengthPercentages(
      length,
      percentage,
      0.5,
    ))).toBe('calc(10% + 5px)');
    expect(serializeLengthPercentage(accumulateLengthPercentages(
      length,
      percentage,
    ))).toBe('calc(20% + 10px)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = createLengthPercentageConsumer({ min: 0 });
    const specified = new TokenCursor(
      parseListOfComponentValues('calc(-10px)'),
    );
    const math = parseLengthPercentage('calc(-10px)')!;

    expect(consume(specified)).not.toBeNull();
    expect(resolveLengthPercentage(math, ValueStage.Computed, {
      range: [0, Infinity],
    })).toEqual({
      type: 'length',
      value: 0,
      unit: 'px',
    });
  });
});

describe('frequency-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(parseFrequencyPercentage('10hz')).toEqual({
      type: 'frequency',
      value: 10,
      unit: 'hz',
    });
    expect(parseFrequencyPercentage('25%')).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = parseFrequencyPercentage('calc(10hz + 25%)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'sum',
      },
    });
    expect(serializeFrequencyPercentage(value!)).toBe('calc(25% + 10hz)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = parseFrequencyPercentage('calc(10hz + 25%)')!;
    const percentage = parseFrequencyPercentage('calc(25%)')!;

    expect(resolveFrequencyPercentage(mixed, ValueStage.Computed))
      .toEqual(mixed);
    expect(resolveFrequencyPercentage(mixed, ValueStage.Computed, {
      percentageReferenceValue: { type: 'frequency', value: 200, unit: 'hz' },
    })).toEqual({ type: 'frequency', value: 60, unit: 'hz' });
    expect(resolveFrequencyPercentage(percentage, ValueStage.Computed))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('canonicalizes literal frequencies at the computed-value stage', () => {
    const frequency = parseFrequencyPercentage('1khz')!;

    expect(resolveFrequencyPercentage(frequency, ValueStage.Specified))
      .toBe(frequency);
    expect(resolveFrequencyPercentage(frequency, ValueStage.Computed))
      .toEqual({ type: 'frequency', value: 1_000, unit: 'hz' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = parseFrequencyPercentage('25%')!;
    const context = {
      percentageReferenceValue: { type: 'frequency', value: 200, unit: 'hz' },
    } as const;

    expect(resolveFrequencyPercentage(percentage, ValueStage.Specified, context))
      .toBe(percentage);
    expect(resolveFrequencyPercentage(percentage, ValueStage.Computed))
      .toBe(percentage);
    expect(resolveFrequencyPercentage(percentage, ValueStage.Computed, context))
      .toEqual({ type: 'frequency', value: 50, unit: 'hz' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10s + 25%)'),
    );

    expect(consumeFrequencyPercentage(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the frequency percentage type and restores outer context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10hz + 25%)'),
      { context },
    );

    expect(consumeFrequencyPercentage(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const frequencyA = parseFrequencyPercentage('10hz')!;
    const frequencyB = parseFrequencyPercentage('20hz')!;
    const percentageA = parseFrequencyPercentage('10%')!;
    const percentageB = parseFrequencyPercentage('20%')!;

    expect(addFrequencyPercentages(frequencyA, frequencyB))
      .toEqual({ type: 'frequency', value: 30, unit: 'hz' });
    expect(interpolateFrequencyPercentages(
      percentageA,
      percentageB,
      0.5,
    )).toEqual({ type: 'percentage', value: 15 });
    expect(accumulateFrequencyPercentages(percentageA, percentageB))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const frequency = parseFrequencyPercentage('10hz')!;
    const percentage = parseFrequencyPercentage('20%')!;

    expect(serializeFrequencyPercentage(addFrequencyPercentages(
      frequency,
      percentage,
    ))).toBe('calc(20% + 10hz)');
    expect(serializeFrequencyPercentage(interpolateFrequencyPercentages(
      frequency,
      percentage,
      0.5,
    ))).toBe('calc(10% + 5hz)');
    expect(serializeFrequencyPercentage(accumulateFrequencyPercentages(
      frequency,
      percentage,
    ))).toBe('calc(20% + 10hz)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = createFrequencyPercentageConsumer({ min: 0 });
    const specified = new TokenCursor(
      parseListOfComponentValues('calc(-10hz)'),
    );
    const math = parseFrequencyPercentage('calc(-10hz)')!;

    expect(consume(specified)).not.toBeNull();
    expect(resolveFrequencyPercentage(math, ValueStage.Computed, {
      range: [0, Infinity],
    })).toEqual({
      type: 'frequency',
      value: 0,
      unit: 'hz',
    });
  });
});

describe('time-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(parseTimePercentage('10s')).toEqual({
      type: 'time',
      value: 10,
      unit: 's',
    });
    expect(parseTimePercentage('25%')).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = parseTimePercentage('calc(10s + 25%)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'sum',
      },
    });
    expect(serializeTimePercentage(value!)).toBe('calc(25% + 10s)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = parseTimePercentage('calc(10s + 25%)')!;
    const percentage = parseTimePercentage('calc(25%)')!;

    expect(resolveTimePercentage(mixed, ValueStage.Computed)).toEqual(mixed);
    expect(resolveTimePercentage(mixed, ValueStage.Computed, {
      percentageReferenceValue: { type: 'time', value: 200, unit: 's' },
    })).toEqual({ type: 'time', value: 60, unit: 's' });
    expect(resolveTimePercentage(percentage, ValueStage.Computed))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('canonicalizes literal times at the computed-value stage', () => {
    const time = parseTimePercentage('250ms')!;

    expect(resolveTimePercentage(time, ValueStage.Specified)).toBe(time);
    expect(resolveTimePercentage(time, ValueStage.Computed))
      .toEqual({ type: 'time', value: 0.25, unit: 's' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = parseTimePercentage('25%')!;
    const context = {
      percentageReferenceValue: { type: 'time', value: 200, unit: 's' },
    } as const;

    expect(resolveTimePercentage(percentage, ValueStage.Specified, context))
      .toBe(percentage);
    expect(resolveTimePercentage(percentage, ValueStage.Computed))
      .toBe(percentage);
    expect(resolveTimePercentage(percentage, ValueStage.Computed, context))
      .toEqual({ type: 'time', value: 50, unit: 's' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10hz + 25%)'),
    );

    expect(consumeTimePercentage(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the time percentage type and restores outer context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10s + 25%)'),
      { context },
    );

    expect(consumeTimePercentage(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const timeA = parseTimePercentage('10s')!;
    const timeB = parseTimePercentage('20s')!;
    const percentageA = parseTimePercentage('10%')!;
    const percentageB = parseTimePercentage('20%')!;

    expect(addTimePercentages(timeA, timeB))
      .toEqual({ type: 'time', value: 30, unit: 's' });
    expect(interpolateTimePercentages(
      percentageA,
      percentageB,
      0.5,
    )).toEqual({ type: 'percentage', value: 15 });
    expect(accumulateTimePercentages(percentageA, percentageB))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const time = parseTimePercentage('10s')!;
    const percentage = parseTimePercentage('20%')!;

    expect(serializeTimePercentage(addTimePercentages(
      time,
      percentage,
    ))).toBe('calc(20% + 10s)');
    expect(serializeTimePercentage(interpolateTimePercentages(
      time,
      percentage,
      0.5,
    ))).toBe('calc(10% + 5s)');
    expect(serializeTimePercentage(accumulateTimePercentages(
      time,
      percentage,
    ))).toBe('calc(20% + 10s)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = createTimePercentageConsumer({ min: 0 });
    const specified = new TokenCursor(
      parseListOfComponentValues('calc(-10s)'),
    );
    const math = parseTimePercentage('calc(-10s)')!;

    expect(consume(specified)).not.toBeNull();
    expect(resolveTimePercentage(math, ValueStage.Computed, {
      range: [0, Infinity],
    })).toEqual({
      type: 'time',
      value: 0,
      unit: 's',
    });
  });
});
