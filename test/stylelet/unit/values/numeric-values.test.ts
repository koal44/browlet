import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/parser/syntax';
import {
  accumulateNumbers, addNumbers, createNumberConsumer, interpolateNumbers,
  parseNumber, serializeNumber, tryConsumeNumber,
} from '../../../../src/stylelet/values/number';
import {
  accumulateDimensions, addDimensions, interpolateDimensions,
  parseDimension, serializeDimension, tryConsumeDimension,
} from '../../../../src/stylelet/values/dimension';
import {
  accumulateAngles, addAngles, interpolateAngles,
  parseAngle, serializeAngle, tryConsumeAngle,
} from '../../../../src/stylelet/values/angle';
import {
  accumulateFrequencies, addFrequencies, interpolateFrequencies,
  parseFrequency, serializeFrequency, tryConsumeFrequency,
} from '../../../../src/stylelet/values/frequency';
import {
  accumulateLengths, addLengths, createLengthConsumer, interpolateLengths,
  parseLength, serializeLength, tryConsumeLength,
} from '../../../../src/stylelet/values/length';
import {
  accumulateResolutions, addResolutions, interpolateResolutions,
  parseResolution, serializeResolution, tryConsumeResolution,
} from '../../../../src/stylelet/values/resolution';
import {
  accumulateTimes, addTimes, interpolateTimes,
  parseTime, serializeTime, tryConsumeTime,
} from '../../../../src/stylelet/values/time';
import {
  accumulateIntegers, addIntegers, createIntegerConsumer, interpolateIntegers,
  parseInteger, serializeInteger, tryConsumeInteger,
} from '../../../../src/stylelet/values/integer';
import {
  accumulatePercentages, addPercentages, createPercentageConsumer,
  interpolatePercentages, parsePercentage, serializePercentage,
  tryConsumePercentage,
} from '../../../../src/stylelet/values/percentage';
import {
  accumulateAnglePercentages, addAnglePercentages,
  createAnglePercentageConsumer, interpolateAnglePercentages,
  parseAnglePercentage, serializeAnglePercentage,
  tryConsumeAnglePercentage,
} from '../../../../src/stylelet/values/angle-percentage';
import {
  accumulateLengthPercentages, addLengthPercentages,
  createLengthPercentageConsumer, interpolateLengthPercentages,
  parseLengthPercentage, serializeLengthPercentage,
  tryConsumeLengthPercentage,
} from '../../../../src/stylelet/values/length-percentage';
import {
  accumulateFrequencyPercentages, addFrequencyPercentages,
  createFrequencyPercentageConsumer, interpolateFrequencyPercentages,
  parseFrequencyPercentage, serializeFrequencyPercentage,
  tryConsumeFrequencyPercentage,
} from '../../../../src/stylelet/values/frequency-percentage';
import {
  accumulateTimePercentages, addTimePercentages,
  createTimePercentageConsumer, interpolateTimePercentages,
  parseTimePercentage, serializeTimePercentage,
  tryConsumeTimePercentage,
} from '../../../../src/stylelet/values/time-percentage';

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

describe('dimension values', () => {
  it('parses a dimension literal', () => {
    expect(parseDimension('1.25px')).toEqual({
      type: 'dimension',
      value: 1.25,
      unit: 'px',
    });
  });

  it('parses and serializes a dimension-valued math function', () => {
    const value = parseDimension('calc(1px + 2px)');

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'dimension',
        value: 3,
        unit: 'px',
      },
    });
    expect(serializeDimension(value!)).toBe('calc(3px)');
    expect(serializeDimension(value!, { stage: 'computed' })).toBe('3px');
  });

  it('accepts any pure dimension category', () => {
    expect(parseDimension('min(1deg, 2deg)')).toMatchObject({
      type: 'math',
      calculation: {
        type: 'dimension',
        value: 1,
        unit: 'deg',
      },
    });
  });

  it('rejects number, percentage, and mixed dimension-percentage results', () => {
    for (const input of ['calc(1)', 'calc(1%)', 'calc(1px + 1%)']) {
      const c = new ComponentCursor(parseListOfComponentValues(input));

      expect(tryConsumeDimension(c)).toMatchObject({ kind: 'bad' });
    }
  });

  it('combines two literals without creating a math value', () => {
    const a = parseDimension('2px')!;
    const b = parseDimension('4px')!;

    expect(addDimensions(a, b))
      .toEqual({ type: 'dimension', value: 6, unit: 'px' });
    expect(interpolateDimensions(a, b, 0.25))
      .toEqual({ type: 'dimension', value: 2.5, unit: 'px' });
    expect(accumulateDimensions(a, b))
      .toEqual({ type: 'dimension', value: 6, unit: 'px' });
  });

  it('promotes literals when combining them with math values', () => {
    const literal = parseDimension('2px')!;
    const math = parseDimension('calc(4px)')!;
    const added = addDimensions(literal, math);
    const interpolated = interpolateDimensions(literal, math, 0.25);
    const accumulated = accumulateDimensions(literal, math);

    expect(added.type).toBe('math');
    expect(interpolated.type).toBe('math');
    expect(accumulated.type).toBe('math');
    expect(serializeDimension(added)).toBe('calc(6px)');
    expect(serializeDimension(interpolated)).toBe('calc(2.5px)');
    expect(serializeDimension(accumulated)).toBe('calc(6px)');
  });
});

describe('angle values', () => {
  it('accepts angle-valued math and rejects other categories', () => {
    const value = parseAngle('min(1deg, 2deg)');
    const other = new ComponentCursor(
      parseListOfComponentValues('calc(1s)'),
    );

    expect(serializeAngle(value!)).toBe('calc(1deg)');
    expect(tryConsumeAngle(other)).toMatchObject({ kind: 'bad' });
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
    const other = new ComponentCursor(
      parseListOfComponentValues('calc(1s)'),
    );

    expect(serializeFrequency(value!)).toBe('calc(1hz)');
    expect(tryConsumeFrequency(other)).toMatchObject({ kind: 'bad' });
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
    const other = new ComponentCursor(
      parseListOfComponentValues('calc(1deg)'),
    );

    expect(serializeLength(value!)).toBe('calc(1px)');
    expect(tryConsumeLength(other)).toMatchObject({ kind: 'bad' });
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
    const specified = new ComponentCursor(
      parseListOfComponentValues('calc(-1px)'),
    );
    const computed = new ComponentCursor(
      parseListOfComponentValues('calc(-1px)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(specified)).toMatchObject({ kind: 'ok' });
    expect(consume(computed)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'dimension',
          value: 0,
          unit: 'px',
        },
      },
    });
  });
});

describe('resolution values', () => {
  it('accepts resolution-valued math and rejects other categories', () => {
    const value = parseResolution('min(1dppx, 2dppx)');
    const other = new ComponentCursor(
      parseListOfComponentValues('calc(1hz)'),
    );

    expect(serializeResolution(value!)).toBe('calc(1dppx)');
    expect(tryConsumeResolution(other)).toMatchObject({ kind: 'bad' });
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
    const value = parseResolution('calc(-1dppx)', { stage: 'computed' });

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
    const other = new ComponentCursor(
      parseListOfComponentValues('calc(1hz)'),
    );

    expect(serializeTime(value!)).toBe('calc(1s)');
    expect(tryConsumeTime(other)).toMatchObject({ kind: 'bad' });
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
    const value = parseInteger('calc(1.5)', { stage: 'computed' });

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'number',
        value: 2,
      },
    });
    expect(serializeInteger(value!, { stage: 'computed' })).toBe('2');
  });

  it('rejects non-number math results', () => {
    for (const input of ['calc(1px)', 'calc(1%)']) {
      const c = new ComponentCursor(parseListOfComponentValues(input));

      expect(tryConsumeInteger(c)).toMatchObject({ kind: 'bad' });
    }
  });

  it('applies ranges to literals and math functions at their stages', () => {
    const consume = createIntegerConsumer({ min: 0, max: 2 });
    const literal = new ComponentCursor(parseListOfComponentValues('3'));
    const specifiedMath = new ComponentCursor(
      parseListOfComponentValues('calc(3)'),
    );
    const computedMath = new ComponentCursor(
      parseListOfComponentValues('calc(3)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).toMatchObject({ kind: 'ok' });
    expect(consume(computedMath)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'number',
          value: 2,
        },
      },
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
    expect(serializeInteger(interpolateIntegers(
      a,
      math,
      0.5,
      { stage: 'computed' },
    ), { stage: 'computed' })).toBe('2');
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
    expect(serializePercentage(value!, { stage: 'computed' })).toBe('30%');
  });

  it('rejects non-percentage math results', () => {
    for (const input of ['calc(1)', 'calc(1px)']) {
      const c = new ComponentCursor(parseListOfComponentValues(input));

      expect(tryConsumePercentage(c)).toMatchObject({ kind: 'bad' });
    }
  });

  it('keeps its percentage type in another percentage context', () => {
    const context = {
      percentageType: 'length',
    } as const;
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(25%)'),
      { context },
    );

    expect(tryConsumePercentage(c)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'percentage',
          value: 25,
        },
      },
    });
    expect(c.context).toBe(context);
  });

  it('applies ranges to literals and math functions at their stages', () => {
    const consume = createPercentageConsumer({ min: 0, max: 100 });
    const literal = new ComponentCursor(parseListOfComponentValues('125%'));
    const specifiedMath = new ComponentCursor(
      parseListOfComponentValues('calc(125%)'),
    );
    const computedMath = new ComponentCursor(
      parseListOfComponentValues('calc(125%)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).toMatchObject({ kind: 'ok' });
    expect(consume(computedMath)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'percentage',
          value: 100,
        },
      },
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

  it('rejects calculations from another dimensional category', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10px + 25%)'),
    );

    expect(tryConsumeAnglePercentage(c)).toMatchObject({ kind: 'bad' });
  });

  it('uses the angle percentage type and restores outer context', () => {
    const context = {
      percentageType: 'length',
    } as const;
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10deg + 25%)'),
      { context },
    );

    expect(tryConsumeAnglePercentage(c)).toMatchObject({ kind: 'ok' });
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
    const specified = new ComponentCursor(
      parseListOfComponentValues('calc(-10deg)'),
    );
    const computed = new ComponentCursor(
      parseListOfComponentValues('calc(-10deg)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(specified)).toMatchObject({ kind: 'ok' });
    expect(consume(computed)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'dimension',
          value: 0,
          unit: 'deg',
        },
      },
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

  it('rejects calculations from another dimensional category', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10deg + 25%)'),
    );

    expect(tryConsumeLengthPercentage(c)).toMatchObject({ kind: 'bad' });
  });

  it('uses the length percentage type and restores outer context', () => {
    const context = {
      percentageType: 'angle',
    } as const;
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10px + 25%)'),
      { context },
    );

    expect(tryConsumeLengthPercentage(c)).toMatchObject({ kind: 'ok' });
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
    const specified = new ComponentCursor(
      parseListOfComponentValues('calc(-10px)'),
    );
    const computed = new ComponentCursor(
      parseListOfComponentValues('calc(-10px)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(specified)).toMatchObject({ kind: 'ok' });
    expect(consume(computed)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'dimension',
          value: 0,
          unit: 'px',
        },
      },
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

  it('rejects calculations from another dimensional category', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10s + 25%)'),
    );

    expect(tryConsumeFrequencyPercentage(c)).toMatchObject({ kind: 'bad' });
  });

  it('uses the frequency percentage type and restores outer context', () => {
    const context = {
      percentageType: 'length',
    } as const;
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10hz + 25%)'),
      { context },
    );

    expect(tryConsumeFrequencyPercentage(c)).toMatchObject({ kind: 'ok' });
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
    const specified = new ComponentCursor(
      parseListOfComponentValues('calc(-10hz)'),
    );
    const computed = new ComponentCursor(
      parseListOfComponentValues('calc(-10hz)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(specified)).toMatchObject({ kind: 'ok' });
    expect(consume(computed)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'dimension',
          value: 0,
          unit: 'hz',
        },
      },
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

  it('rejects calculations from another dimensional category', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10hz + 25%)'),
    );

    expect(tryConsumeTimePercentage(c)).toMatchObject({ kind: 'bad' });
  });

  it('uses the time percentage type and restores outer context', () => {
    const context = {
      percentageType: 'length',
    } as const;
    const c = new ComponentCursor(
      parseListOfComponentValues('calc(10s + 25%)'),
      { context },
    );

    expect(tryConsumeTimePercentage(c)).toMatchObject({ kind: 'ok' });
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
    const specified = new ComponentCursor(
      parseListOfComponentValues('calc(-10s)'),
    );
    const computed = new ComponentCursor(
      parseListOfComponentValues('calc(-10s)'),
      { context: { stage: 'computed' } },
    );

    expect(consume(specified)).toMatchObject({ kind: 'ok' });
    expect(consume(computed)).toMatchObject({
      kind: 'ok',
      value: {
        calculation: {
          type: 'dimension',
          value: 0,
          unit: 's',
        },
      },
    });
  });
});
