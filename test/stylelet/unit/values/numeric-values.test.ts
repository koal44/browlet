import { describe, expect, it } from 'vitest';
import { LengthLiteral, DimensionLiteral, FrequencyLiteral, TimeLiteral } from '../../../../src/stylelet/values/numeric-literal/index';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { MathValue, type MathContext } from '../../../../src/stylelet/values/math-value';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { AngleValue } from '../../../../src/stylelet/values/angle';
import { FrequencyValue } from '../../../../src/stylelet/values/frequency';
import { LengthValue } from '../../../../src/stylelet/values/length';
import { ResolutionValue } from '../../../../src/stylelet/values/resolution';
import { TimeValue } from '../../../../src/stylelet/values/time';
import { IntegerValue } from '../../../../src/stylelet/values/integer';
import { PercentageValue } from '../../../../src/stylelet/values/percentage';
import { LengthPercentageValue } from '../../../../src/stylelet/values/length-percentage';
import { FrequencyPercentageValue } from '../../../../src/stylelet/values/frequency-percentage';
import { TimePercentageValue } from '../../../../src/stylelet/values/time-percentage';
import { parseDimension } from '../../../../src/stylelet/values/dimension';

type NumericValue = NumberValue | AngleValue | FrequencyValue | LengthValue | ResolutionValue | TimeValue
  | IntegerValue | PercentageValue | LengthPercentageValue | FrequencyPercentageValue | TimePercentageValue;

function representation(numeric: NumericValue | null) {
  if (numeric === null) return null;
  const payload = numeric.repr;
  return payload instanceof MathValue ? payload.repr : payload;
}

function expectLiteralResolution(
  factory: { parse(input: string, context: MathContext): NumericValue | null; },
  input: string,
  computed: unknown,
  context: MathContext = {},
): void {
  const parsed = factory.parse(input, context);
  expect(parsed).not.toBeNull();
  expect(parsed!.resolve(ValueStage.Specified, context)).toBe(parsed);
  expect(representation(parsed!.resolve(ValueStage.Computed, context))).toEqual(computed);
}

describe('dimensional value literals', () => {
  it.each([
    ['angle', () => expectLiteralResolution(AngleValue, '0.5turn', { type: 'angle', value: 180, unit: 'deg' })],
    ['frequency', () => expectLiteralResolution(FrequencyValue, '1khz', { type: 'frequency', value: 1000, unit: 'hz' })],
    ['length', () => expectLiteralResolution(LengthValue, '1in', { type: 'length', value: 96, unit: 'px' })],
    ['resolution', () => expectLiteralResolution(ResolutionValue, '96dpi', { type: 'resolution', value: 1, unit: 'dppx' })],
    ['time', () => expectLiteralResolution(TimeValue, '250ms', { type: 'time', value: 0.25, unit: 's' })],
  ])('canonicalizes a literal %s at computed-value time', (_name, test) => {
    test();
  });

  it('preserves a relative length until its context is available', () => {
    const value = LengthValue.parse('2em', {})!;
    expect(value.resolve(ValueStage.Specified, {
      length: { em: 16 },
    })).toBe(value);
    expect(value.resolve(ValueStage.Computed, {})).toBe(value);
    expect(representation(value.resolve(ValueStage.Computed, {
      length: { em: 16 },
    }))).toEqual({ type: 'length', value: 32, unit: 'px' });
  });
});

describe('dimension values', () => {
  it('delegates recognized dimension categories to their value modules', () => {
    const length = parseDimension('1in', {})!;
    const resolution = parseDimension('96dpi', {})!;
    const math = parseDimension('calc(1in + 96px)', {})!;
    expect(length.serialize()).toBe('1in');
    expect(length.resolve(ValueStage.Computed, {}).serialize())
      .toBe('96px');
    expect(resolution.resolve(ValueStage.Computed, {}).serialize())
      .toBe('1dppx');
    expect(math.serialize()).toBe('calc(192px)');
    expect(math.resolve(ValueStage.Computed, {}).serialize())
      .toBe('192px');
  });

  it('preserves an unrecognized dimension as the generic fallback', () => {
    const value = parseDimension('1unknown', {})!;
    expect(value).toBeInstanceOf(DimensionLiteral);
    expect(value).toMatchObject({ type: 'dimension', value: 1, unit: 'unknown' });
    expect(value.resolve(ValueStage.Computed, {})).toBe(value);
    expect(value.serialize()).toBe('1unknown');
  });
});

describe('number values', () => {
  it('retains finite values from long CSS number tokens', () => {
    expect(representation(NumberValue.parse(`0.${'1'.repeat(400)}`, {}))).toEqual({
      type: 'number',
      value: 0.1111111111111111,
    });
  });

  it('parses a number literal', () => {
    expect(representation(NumberValue.parse('1.25', {}))).toEqual({
      type: 'number',
      value: 1.25,
    });
  });

  it('parses and serializes a number-valued math function', () => {
    const value = NumberValue.parse('calc(1 + 2)', {});
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'number',
        value: 3,
      },
    });
    expect(value!.serialize()).toBe('calc(3)');
    expect(value!.resolve(ValueStage.Computed, {}).serialize()).toBe('3');
  });

  it('resolves a math value to a number at computed-value time', () => {
    const value = NumberValue.parse('calc(1 + 2)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Declared, { unwrapMathAt: ValueStage.Declared }))).toEqual({
      type: 'number',
      value: 3,
    });
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'number',
      value: 3,
    });
  });

  it('accepts math functions other than calc()', () => {
    expect(representation(NumberValue.parse('min(1, 2)', {}))).toMatchObject({
      calculation: {
        type: 'number',
        value: 1,
      },
    });
  });

  it('rejects a math function with a non-number result', () => {
    const c = new TokenCursor(parseListOfComponentValues('calc(1px)', {}), {});
    expect(NumberValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('applies consumer ranges to literals and math functions at their stages', () => {
    const consume = NumberValue.createConsumer({ min: 0, max: 1 });
    const literal = new TokenCursor(parseListOfComponentValues('2', {}), {});
    const specifiedMath = new TokenCursor(parseListOfComponentValues('calc(2)', {}), {});
    const math = NumberValue.parse('calc(2)', {})!;
    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).not.toBeNull();
    expect(math.resolve(ValueStage.Specified, {
      range: [0, 1],
    })).toBe(math);
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, 1],
    }))).toEqual({
      type: 'number',
      value: 1,
    });
  });

  it('does not mutate the surrounding calculation context', () => {
    const context = {
      range: [0, 5] as [
        number,
        number
      ], marker: true,
    };
    const c = new TokenCursor(parseListOfComponentValues('calc(1 + 2)', {}), context);
    expect(NumberValue.consume(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('combines two literals without creating a math value', () => {
    const a = NumberValue.parse('2', {})!;
    const b = NumberValue.parse('4', {})!;
    expect(representation(a.add(b))).toEqual({ type: 'number', value: 6 });
    expect(representation(a.interpolate(b, 0.25)))
      .toEqual({ type: 'number', value: 2.5 });
    expect(representation(a.accumulate(b)))
      .toEqual({ type: 'number', value: 6 });
  });

  it('promotes a literal when adding it to a math value', () => {
    const literal = NumberValue.parse('2', {})!;
    const math = NumberValue.parse('calc(4)', {})!;
    const forward = literal.add(math);
    const reverse = math.add(literal);
    expect(forward.repr).toBeInstanceOf(MathValue);
    expect(reverse.repr).toBeInstanceOf(MathValue);
    expect(forward.serialize()).toBe('calc(6)');
    expect(reverse.serialize()).toBe('calc(6)');
  });

  it('promotes literals for interpolation and accumulation with math values', () => {
    const literal = NumberValue.parse('2', {})!;
    const math = NumberValue.parse('calc(4)', {})!;
    const interpolated = literal.interpolate(math, 0.25);
    const accumulated = literal.accumulate(math);
    expect(interpolated.repr).toBeInstanceOf(MathValue);
    expect(accumulated.repr).toBeInstanceOf(MathValue);
    expect(interpolated.serialize()).toBe('calc(2.5)');
    expect(accumulated.serialize()).toBe('calc(6)');
  });
});

describe('angle values', () => {
  it('accepts angle-valued math and rejects other categories', () => {
    const value = AngleValue.parse('min(1deg, 2deg)', {});
    const other = new TokenCursor(parseListOfComponentValues('calc(1s)', {}), {});
    expect(value!.serialize()).toBe('calc(1deg)');
    expect(AngleValue.consume(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical angles at the computed-value stage', () => {
    const value = AngleValue.parse('calc(.5turn + 180deg)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'angle',
      value: 360,
      unit: 'deg',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = AngleValue.parse('1deg', {})!;
    const b = AngleValue.parse('2deg', {})!;
    const math = AngleValue.parse('calc(2deg)', {})!;
    expect(representation(a.add(b)))
      .toEqual({ type: 'angle', value: 3, unit: 'deg' });
    expect(a.add(math).serialize()).toBe('calc(3deg)');
    expect(a.interpolate(math, 0.5).serialize())
      .toBe('calc(1.5deg)');
    expect(a.accumulate(math).serialize()).toBe('calc(3deg)');
  });

  it.each([
    ['add', '270deg'],
    ['interpolate', '135deg'],
    ['accumulate', '270deg'],
  ] as const)('%s combines angles in different units', (operation, expected) => {
    const a = AngleValue.parse('0.25turn', {})!;
    const b = AngleValue.parse('180deg', {})!;
    const combined = operation === 'interpolate'
      ? a.interpolate(b, 0.5)
      : a[operation](b);

    expect(combined.resolve(ValueStage.Computed).serialize()).toBe(expected);
    expect(a.serialize()).toBe('0.25turn');
    expect(b.serialize()).toBe('180deg');
  });
});

describe('frequency values', () => {
  it('accepts frequency-valued math and rejects other categories', () => {
    const value = FrequencyValue.parse('min(1hz, 2hz)', {});
    const other = new TokenCursor(parseListOfComponentValues('calc(1s)', {}), {});
    expect(value!.serialize()).toBe('calc(1hz)');
    expect(FrequencyValue.consume(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical frequencies at the computed-value stage', () => {
    const value = FrequencyValue.parse('calc(1khz + 500hz)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'frequency',
      value: 1500,
      unit: 'hz',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = FrequencyValue.parse('1hz', {})!;
    const b = FrequencyValue.parse('2hz', {})!;
    const math = FrequencyValue.parse('calc(2hz)', {})!;
    expect(representation(a.add(b)))
      .toEqual({ type: 'frequency', value: 3, unit: 'hz' });
    expect(a.add(math).serialize()).toBe('calc(3hz)');
    expect(a.interpolate(math, 0.5).serialize())
      .toBe('calc(1.5hz)');
    expect(a.accumulate(math).serialize())
      .toBe('calc(3hz)');
  });

  it.each([
    ['add', '1500hz'],
    ['interpolate', '750hz'],
    ['accumulate', '1500hz'],
  ] as const)('%s combines frequencies in different units', (operation, expected) => {
    const a = FrequencyValue.parse('1khz', {})!;
    const b = FrequencyValue.parse('500hz', {})!;
    const combined = operation === 'interpolate'
      ? a.interpolate(b, 0.5)
      : a[operation](b);

    expect(combined.resolve(ValueStage.Computed).serialize()).toBe(expected);
    expect(a.serialize()).toBe('1khz');
    expect(b.serialize()).toBe('500hz');
  });
});

describe('length values', () => {
  it('promotes unitless zero as a length when combining with other units or math', () => {
    const zero = LengthValue.parse('0', {})!;
    const pixels = LengthValue.parse('2px', {})!;
    const math = LengthValue.parse('calc(2px)', {})!;

    expect(zero.add(pixels).resolve(ValueStage.Computed, {}).serialize()).toBe('2px');
    expect(zero.interpolate(pixels, 0.5).resolve(ValueStage.Computed, {}).serialize()).toBe('1px');
    expect(zero.accumulate(math).resolve(ValueStage.Computed, {}).serialize()).toBe('2px');
    expect(zero.serialize()).toBe('0');
  });

  it.each([
    ['add', 192],
    ['interpolate', 96],
    ['accumulate', 192],
  ] as const)('combines different length units with %s', (operation, expected) => {
    const a = LengthValue.parse('1in', {})!;
    const b = LengthValue.parse('96px', {})!;
    const combined = operation === 'interpolate' ? a.interpolate(b, 0.5) : a[operation](b);

    expect(combined.resolve(ValueStage.Computed, {}).serialize()).toBe(`${expected}px`);
    expect(a.serialize()).toBe('1in');
    expect(b.serialize()).toBe('96px');
  });

  it('accepts length-valued math and rejects other categories', () => {
    const value = LengthValue.parse('min(1px, 2px)', {});
    const other = new TokenCursor(parseListOfComponentValues('calc(1deg)', {}), {});
    expect(value!.serialize()).toBe('calc(1px)');
    expect(LengthValue.consume(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical lengths at the computed-value stage', () => {
    const value = LengthValue.parse('calc(1in + 96px)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'length',
      value: 192,
      unit: 'px',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = LengthValue.parse('1px', {})!;
    const b = LengthValue.parse('2px', {})!;
    const math = LengthValue.parse('calc(2px)', {})!;
    expect(representation(a.add(b)))
      .toEqual({ type: 'length', value: 3, unit: 'px' });
    expect(a.add(math).serialize()).toBe('calc(3px)');
    expect(a.interpolate(math, 0.5).serialize())
      .toBe('calc(1.5px)');
    expect(a.accumulate(math).serialize()).toBe('calc(3px)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = LengthValue.createConsumer({ min: 0 });
    const specified = new TokenCursor(parseListOfComponentValues('calc(-1px)', {}), {});
    const math = LengthValue.parse('calc(-1px)', {})!;
    expect(consume(specified)).not.toBeNull();
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, Infinity],
    }))).toEqual({
      type: 'length',
      value: 0,
      unit: 'px',
    });
  });
});

describe('resolution values', () => {
  it.each([
    ['add', '3dppx'],
    ['interpolate', '1.5dppx'],
    ['accumulate', '3dppx'],
  ] as const)('%s combines resolutions in different units', (operation, expected) => {
    const a = ResolutionValue.parse('96dpi', {})!;
    const b = ResolutionValue.parse('2dppx', {})!;
    const combined = operation === 'interpolate' ? a.interpolate(b, 0.5) : a[operation](b);

    expect(combined.resolve(ValueStage.Computed).serialize()).toBe(expected);
    expect(a.serialize()).toBe('96dpi');
    expect(b.serialize()).toBe('2dppx');
  });

  it('accepts resolution-valued math and rejects other categories', () => {
    const value = ResolutionValue.parse('min(1dppx, 2dppx)', {});
    const other = new TokenCursor(parseListOfComponentValues('calc(1hz)', {}), {});
    expect(value!.serialize()).toBe('calc(1dppx)');
    expect(ResolutionValue.consume(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical resolutions at the computed-value stage', () => {
    const value = ResolutionValue.parse('calc(96dpi + 1dppx)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'resolution',
      value: 2,
      unit: 'dppx',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = ResolutionValue.parse('1dppx', {})!;
    const b = ResolutionValue.parse('2dppx', {})!;
    const math = ResolutionValue.parse('calc(2dppx)', {})!;
    expect(representation(a.add(b)))
      .toEqual({ type: 'resolution', value: 3, unit: 'dppx' });
    expect(a.add(math).serialize())
      .toBe('calc(3dppx)');
    expect(a.interpolate(math, 0.5).serialize())
      .toBe('calc(1.5dppx)');
    expect(a.accumulate(math).serialize())
      .toBe('calc(3dppx)');
  });

  it('clamps math results to the nonnegative resolution range', () => {
    const value = ResolutionValue.parse('calc(-1dppx)', {})!.resolve(ValueStage.Computed, {
      range: [0, Infinity],
      unwrapMathAt: ValueStage.Actual,
    });
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'dimension',
        value: 0,
        unit: 'dppx',
      },
    });
  });
});

describe('time values', () => {
  it.each([
    ['add', '1.5s'],
    ['interpolate', '0.75s'],
    ['accumulate', '1.5s'],
  ] as const)('%s combines times in different units', (operation, expected) => {
    const a = TimeValue.parse('500ms', {})!;
    const b = TimeValue.parse('1s', {})!;
    const combined = operation === 'interpolate' ? a.interpolate(b, 0.5) : a[operation](b);

    expect(combined.resolve(ValueStage.Computed).serialize()).toBe(expected);
    expect(a.serialize()).toBe('500ms');
    expect(b.serialize()).toBe('1s');
  });

  it('accepts time-valued math and rejects other categories', () => {
    const value = TimeValue.parse('min(1s, 2s)', {});
    const other = new TokenCursor(parseListOfComponentValues('calc(1hz)', {}), {});
    expect(value!.serialize()).toBe('calc(1s)');
    expect(TimeValue.consume(other)).toBeNull();
    expect(other.pos()).toBe(0);
  });

  it('resolves math values as canonical times at the computed-value stage', () => {
    const value = TimeValue.parse('calc(1000ms + 1s)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'time',
      value: 2,
      unit: 's',
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = TimeValue.parse('1s', {})!;
    const b = TimeValue.parse('2s', {})!;
    const math = TimeValue.parse('calc(2s)', {})!;
    expect(representation(a.add(b)))
      .toEqual({ type: 'time', value: 3, unit: 's' });
    expect(a.add(math).serialize()).toBe('calc(3s)');
    expect(a.interpolate(math, 0.5).serialize())
      .toBe('calc(1.5s)');
    expect(a.accumulate(math).serialize()).toBe('calc(3s)');
  });
});

describe('integer values', () => {
  it('parses integer literals and number-valued math functions', () => {
    expect(representation(IntegerValue.parse('2', {}))).toEqual({
      type: 'integer',
      value: 2,
    });
    const value = IntegerValue.parse('calc(1.5)', {});
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'number',
        value: 1.5,
      },
    });
    expect(value!.serialize()).toBe('calc(1.5)');
  });

  it('rounds math results at the computed-value stage', () => {
    const value = IntegerValue.parse('calc(1.5)', {})!.resolve(ValueStage.Computed, { unwrapMathAt: ValueStage.Actual });
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'number',
        value: 2,
      },
    });
    expect(value.resolve(ValueStage.Computed, {}).serialize()).toBe('2');
  });

  it('resolves math values as integers at the computed-value stage', () => {
    const value = IntegerValue.parse('calc(1.5)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {}))).toEqual({
      type: 'integer',
      value: 2,
    });
  });

  it('rejects non-number math results', () => {
    for (const input of ['calc(1px)', 'calc(1%)']) {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      expect(IntegerValue.consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    }
  });

  it('applies ranges to literals and math functions at their stages', () => {
    const consume = IntegerValue.createConsumer({ min: 0, max: 2 });
    const literal = new TokenCursor(parseListOfComponentValues('3', {}), {});
    const specifiedMath = new TokenCursor(parseListOfComponentValues('calc(3)', {}), {});
    const math = IntegerValue.parse('calc(3)', {})!;
    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).not.toBeNull();
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, 2],
    }))).toEqual({
      type: 'integer',
      value: 2,
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = IntegerValue.parse('1', {})!;
    const b = IntegerValue.parse('2', {})!;
    const math = IntegerValue.parse('calc(2)', {})!;
    expect(representation(a.add(b))).toEqual({ type: 'integer', value: 3 });
    expect(representation(a.interpolate(b, 0.5)))
      .toEqual({ type: 'integer', value: 2 });
    expect(representation(a.accumulate(b)))
      .toEqual({ type: 'integer', value: 3 });
    expect(a.add(math).serialize()).toBe('calc(3)');
    const interpolated = a.interpolate(math, 0.5);
    expect(interpolated.resolve(ValueStage.Computed, {}).serialize()).toBe('2');
    expect(a.accumulate(math).serialize()).toBe('calc(3)');
  });
});

describe('percentage values', () => {
  it('parses and serializes percentage literals and math functions', () => {
    expect(representation(PercentageValue.parse('25%', {}))).toEqual({
      type: 'percentage',
      value: 25,
    });
    const value = PercentageValue.parse('calc(10% + 20%)', {});
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'percentage',
        value: 30,
      },
    });
    expect(value!.serialize()).toBe('calc(30%)');
    expect(value!.resolve(ValueStage.Computed, {}).serialize()).toBe('30%');
  });

  it('resolves math values as percentages at the computed-value stage', () => {
    const value = PercentageValue.parse('calc(10% + 20%)', {})!;
    expect(value.resolve(ValueStage.Declared)).toEqual(value);
    expect(representation(value.resolve(ValueStage.Computed, {
      percentHint: 'length',
    }))).toEqual({
      type: 'percentage',
      value: 30,
    });
  });

  it('rejects non-percentage math results', () => {
    for (const input of ['calc(1)', 'calc(1px)']) {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      expect(PercentageValue.consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    }
  });

  it('keeps its percentage type in another percentage context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(parseListOfComponentValues('calc(25%)', {}), context);
    expect(representation(PercentageValue.consume(c))).toMatchObject({
      calculation: {
        type: 'percentage',
        value: 25,
      },
    });
    expect(c.context).toBe(context);
  });

  it('applies ranges to literals and math functions at their stages', () => {
    const consume = PercentageValue.createConsumer({ min: 0, max: 100 });
    const literal = new TokenCursor(parseListOfComponentValues('125%', {}), {});
    const specifiedMath = new TokenCursor(parseListOfComponentValues('calc(125%)', {}), {});
    const math = PercentageValue.parse('calc(125%)', {})!;
    expect(consume(literal)).toBeNull();
    expect(consume(specifiedMath)).not.toBeNull();
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, 100],
    }))).toEqual({
      type: 'percentage',
      value: 100,
    });
  });

  it('combines literals directly and promotes mixed representations', () => {
    const a = PercentageValue.parse('10%', {})!;
    const b = PercentageValue.parse('20%', {})!;
    const math = PercentageValue.parse('calc(20%)', {})!;
    expect(representation(a.add(b)))
      .toEqual({ type: 'percentage', value: 30 });
    expect(representation(a.interpolate(b, 0.5)))
      .toEqual({ type: 'percentage', value: 15 });
    expect(representation(a.accumulate(b)))
      .toEqual({ type: 'percentage', value: 30 });
    expect(a.add(math).serialize()).toBe('calc(30%)');
    expect(a.interpolate(math, 0.5).serialize())
      .toBe('calc(15%)');
    expect(a.accumulate(math).serialize())
      .toBe('calc(30%)');
  });
});

describe('length-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(representation(LengthPercentageValue.parse('10px', {}))).toEqual({
      type: 'length',
      value: 10,
      unit: 'px',
    });
    expect(representation(LengthPercentageValue.parse('25%', {}))).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = LengthPercentageValue.parse('calc(10px + 25%)', {});
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'sum',
      },
    });
    expect(value!.serialize()).toBe('calc(25% + 10px)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = LengthPercentageValue.parse('calc(10px + 25%)', {})!;
    const percentage = LengthPercentageValue.parse('calc(25%)', {})!;
    expect(mixed.resolve(ValueStage.Computed, {})).toEqual(mixed);
    expect(representation(mixed.resolve(ValueStage.Computed, {
      percentageReferenceValue: new LengthLiteral(200, 'px'),
    }))).toEqual({ type: 'length', value: 60, unit: 'px' });
    expect(representation(percentage.resolve(ValueStage.Computed, {})))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('resolves literal lengths to computed absolute lengths', () => {
    const absolute = LengthPercentageValue.parse('1in', {})!;
    const relative = LengthPercentageValue.parse('2em', {})!;
    expect(absolute.resolve(ValueStage.Specified))
      .toEqual(absolute);
    expect(representation(absolute.resolve(ValueStage.Computed, {})))
      .toEqual({ type: 'length', value: 96, unit: 'px' });
    expect(relative.resolve(ValueStage.Computed, {}))
      .toEqual(relative);
    expect(representation(relative.resolve(ValueStage.Computed, {
      length: { em: 16 },
    }))).toEqual({ type: 'length', value: 32, unit: 'px' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = LengthPercentageValue.parse('25%', {})!;
    expect(percentage.resolve(ValueStage.Computed, {}))
      .toEqual(percentage);
    expect(representation(percentage.resolve(ValueStage.Computed, {
      percentageReferenceValue: new LengthLiteral(200, 'px'),
    }))).toEqual({ type: 'length', value: 50, unit: 'px' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(parseListOfComponentValues('calc(10deg + 25%)', {}), {});
    expect(LengthPercentageValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the length percentage type and restores outer context', () => {
    const context = {
      percentHint: 'angle',
    } as const;
    const c = new TokenCursor(parseListOfComponentValues('calc(10px + 25%)', {}), context);
    expect(LengthPercentageValue.consume(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const lengthA = LengthPercentageValue.parse('10px', {})!;
    const lengthB = LengthPercentageValue.parse('20px', {})!;
    const percentageA = LengthPercentageValue.parse('10%', {})!;
    const percentageB = LengthPercentageValue.parse('20%', {})!;
    expect(representation(lengthA.add(lengthB)))
      .toEqual({ type: 'length', value: 30, unit: 'px' });
    expect(representation(percentageA.interpolate(percentageB, 0.5))).toEqual({ type: 'percentage', value: 15 });
    expect(representation(percentageA.accumulate(percentageB)))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const length = LengthPercentageValue.parse('10px', {})!;
    const percentage = LengthPercentageValue.parse('20%', {})!;
    expect(length.add(percentage).serialize()).toBe('calc(20% + 10px)');
    expect(length.interpolate(percentage, 0.5).serialize()).toBe('calc(10% + 5px)');
    expect(length.accumulate(percentage).serialize()).toBe('calc(20% + 10px)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = LengthPercentageValue.createConsumer({ min: 0 });
    const specified = new TokenCursor(parseListOfComponentValues('calc(-10px)', {}), {});
    const math = LengthPercentageValue.parse('calc(-10px)', {})!;
    expect(consume(specified)).not.toBeNull();
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, Infinity],
    }))).toEqual({
      type: 'length',
      value: 0,
      unit: 'px',
    });
  });
});

describe('frequency-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(representation(FrequencyPercentageValue.parse('10hz', {}))).toEqual({
      type: 'frequency',
      value: 10,
      unit: 'hz',
    });
    expect(representation(FrequencyPercentageValue.parse('25%', {}))).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = FrequencyPercentageValue.parse('calc(10hz + 25%)', {});
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'sum',
      },
    });
    expect(value!.serialize()).toBe('calc(25% + 10hz)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = FrequencyPercentageValue.parse('calc(10hz + 25%)', {})!;
    const percentage = FrequencyPercentageValue.parse('calc(25%)', {})!;
    expect(mixed.resolve(ValueStage.Computed, {}))
      .toEqual(mixed);
    expect(representation(mixed.resolve(ValueStage.Computed, {
      percentageReferenceValue: new FrequencyLiteral(200, 'hz'),
    }))).toEqual({ type: 'frequency', value: 60, unit: 'hz' });
    expect(representation(percentage.resolve(ValueStage.Computed, {})))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('canonicalizes literal frequencies at the computed-value stage', () => {
    const frequency = FrequencyPercentageValue.parse('1khz', {})!;
    expect(frequency.resolve(ValueStage.Specified))
      .toBe(frequency);
    expect(representation(frequency.resolve(ValueStage.Computed, {})))
      .toEqual({ type: 'frequency', value: 1000, unit: 'hz' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = FrequencyPercentageValue.parse('25%', {})!;
    const context = {
      percentageReferenceValue: new FrequencyLiteral(200, 'hz'),
    } as const;
    expect(percentage.resolve(ValueStage.Specified, context))
      .toBe(percentage);
    expect(percentage.resolve(ValueStage.Computed, {}))
      .toBe(percentage);
    expect(representation(percentage.resolve(ValueStage.Computed, context)))
      .toEqual({ type: 'frequency', value: 50, unit: 'hz' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(parseListOfComponentValues('calc(10s + 25%)', {}), {});
    expect(FrequencyPercentageValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the frequency percentage type and restores outer context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(parseListOfComponentValues('calc(10hz + 25%)', {}), context);
    expect(FrequencyPercentageValue.consume(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const frequencyA = FrequencyPercentageValue.parse('10hz', {})!;
    const frequencyB = FrequencyPercentageValue.parse('20hz', {})!;
    const percentageA = FrequencyPercentageValue.parse('10%', {})!;
    const percentageB = FrequencyPercentageValue.parse('20%', {})!;
    expect(representation(frequencyA.add(frequencyB)))
      .toEqual({ type: 'frequency', value: 30, unit: 'hz' });
    expect(representation(percentageA.interpolate(percentageB, 0.5))).toEqual({ type: 'percentage', value: 15 });
    expect(representation(percentageA.accumulate(percentageB)))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const frequency = FrequencyPercentageValue.parse('10hz', {})!;
    const percentage = FrequencyPercentageValue.parse('20%', {})!;
    expect(frequency.add(percentage).serialize()).toBe('calc(20% + 10hz)');
    expect(frequency.interpolate(percentage, 0.5).serialize()).toBe('calc(10% + 5hz)');
    expect(frequency.accumulate(percentage).serialize()).toBe('calc(20% + 10hz)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = FrequencyPercentageValue.createConsumer({ min: 0 });
    const specified = new TokenCursor(parseListOfComponentValues('calc(-10hz)', {}), {});
    const math = FrequencyPercentageValue.parse('calc(-10hz)', {})!;
    expect(consume(specified)).not.toBeNull();
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, Infinity],
    }))).toEqual({
      type: 'frequency',
      value: 0,
      unit: 'hz',
    });
  });
});

describe('time-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(representation(TimePercentageValue.parse('10s', {}))).toEqual({
      type: 'time',
      value: 10,
      unit: 's',
    });
    expect(representation(TimePercentageValue.parse('25%', {}))).toEqual({
      type: 'percentage',
      value: 25,
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = TimePercentageValue.parse('calc(10s + 25%)', {});
    expect(representation(value)).toMatchObject({
      calculation: {
        type: 'sum',
      },
    });
    expect(value!.serialize()).toBe('calc(25% + 10s)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = TimePercentageValue.parse('calc(10s + 25%)', {})!;
    const percentage = TimePercentageValue.parse('calc(25%)', {})!;
    expect(mixed.resolve(ValueStage.Computed, {})).toEqual(mixed);
    expect(representation(mixed.resolve(ValueStage.Computed, {
      percentageReferenceValue: new TimeLiteral(200, 's'),
    }))).toEqual({ type: 'time', value: 60, unit: 's' });
    expect(representation(percentage.resolve(ValueStage.Computed, {})))
      .toEqual({ type: 'percentage', value: 25 });
  });

  it('canonicalizes literal times at the computed-value stage', () => {
    const time = TimePercentageValue.parse('250ms', {})!;
    expect(time.resolve(ValueStage.Specified)).toBe(time);
    expect(representation(time.resolve(ValueStage.Computed, {})))
      .toEqual({ type: 'time', value: 0.25, unit: 's' });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = TimePercentageValue.parse('25%', {})!;
    const context = {
      percentageReferenceValue: new TimeLiteral(200, 's'),
    } as const;
    expect(percentage.resolve(ValueStage.Specified, context))
      .toBe(percentage);
    expect(percentage.resolve(ValueStage.Computed, {}))
      .toBe(percentage);
    expect(representation(percentage.resolve(ValueStage.Computed, context)))
      .toEqual({ type: 'time', value: 50, unit: 's' });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(parseListOfComponentValues('calc(10hz + 25%)', {}), {});
    expect(TimePercentageValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the time percentage type and restores outer context', () => {
    const context = {
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(parseListOfComponentValues('calc(10s + 25%)', {}), context);
    expect(TimePercentageValue.consume(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const timeA = TimePercentageValue.parse('10s', {})!;
    const timeB = TimePercentageValue.parse('20s', {})!;
    const percentageA = TimePercentageValue.parse('10%', {})!;
    const percentageB = TimePercentageValue.parse('20%', {})!;
    expect(representation(timeA.add(timeB)))
      .toEqual({ type: 'time', value: 30, unit: 's' });
    expect(representation(percentageA.interpolate(percentageB, 0.5))).toEqual({ type: 'percentage', value: 15 });
    expect(representation(percentageA.accumulate(percentageB)))
      .toEqual({ type: 'percentage', value: 30 });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const time = TimePercentageValue.parse('10s', {})!;
    const percentage = TimePercentageValue.parse('20%', {})!;
    expect(time.add(percentage).serialize()).toBe('calc(20% + 10s)');
    expect(time.interpolate(percentage, 0.5).serialize()).toBe('calc(10% + 5s)');
    expect(time.accumulate(percentage).serialize()).toBe('calc(20% + 10s)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = TimePercentageValue.createConsumer({ min: 0 });
    const specified = new TokenCursor(parseListOfComponentValues('calc(-10s)', {}), {});
    const math = TimePercentageValue.parse('calc(-10s)', {})!;
    expect(consume(specified)).not.toBeNull();
    expect(representation(math.resolve(ValueStage.Computed, {
      range: [0, Infinity],
    }))).toEqual({
      type: 'time',
      value: 0,
      unit: 's',
    });
  });
});
