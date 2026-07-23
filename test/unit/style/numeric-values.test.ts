import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import {
  accumulateNumbers, addNumbers, createNumberConsumer, interpolateNumbers,
  parseNumber, serializeNumber, tryConsumeNumber,
} from '../../../src/stylelet/values/number';
import {
  accumulateDimensions, addDimensions, interpolateDimensions,
  parseDimension, serializeDimension, tryConsumeDimension,
} from '../../../src/stylelet/values/dimension';
import {
  accumulateAngles, addAngles, interpolateAngles,
  parseAngle, serializeAngle, tryConsumeAngle,
} from '../../../src/stylelet/values/angle';
import {
  accumulateFrequencies, addFrequencies, interpolateFrequencies,
  parseFrequency, serializeFrequency, tryConsumeFrequency,
} from '../../../src/stylelet/values/frequency';
import {
  accumulateLengths, addLengths, createLengthConsumer, interpolateLengths,
  parseLength, serializeLength, tryConsumeLength,
} from '../../../src/stylelet/values/length';
import {
  accumulateResolutions, addResolutions, interpolateResolutions,
  parseResolution, serializeResolution, tryConsumeResolution,
} from '../../../src/stylelet/values/resolution';
import {
  accumulateTimes, addTimes, interpolateTimes,
  parseTime, serializeTime, tryConsumeTime,
} from '../../../src/stylelet/values/time';

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
