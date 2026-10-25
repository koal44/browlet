import { styleletEnv } from '../../environment-fixture';
import { describe, expect, it } from 'vitest';
import { TokenCursor, parseListOfComponentValues, parseAsComponentGrammar, withTrivia } from '../../../../src/stylelet/syntax/index';
import { ValueStage } from '../../../../src/stylelet/value-processing/index';
import {
  NumberLiteral, IntegerLiteral, PercentageLiteral, ZeroLiteral, DimensionLiteral,
  AngleLiteral, LengthLiteral, FrequencyLiteral, TimeLiteral, ResolutionLiteral,
  ANGLE_UNITS, LENGTH_UNITS, FREQUENCY_UNITS, TIME_UNITS, RESOLUTION_UNITS,
  createAnglePercentageConsumer, createLengthPercentageConsumer, createFrequencyPercentageConsumer, createTimePercentageConsumer,
  type LengthResolutionContext,
} from '../../../../src/stylelet/values/numeric-literal/index';
import { AnglePercentageValue } from '../../../../src/stylelet/values/angle-percentage';
import { LengthPercentageValue } from '../../../../src/stylelet/values/length-percentage';
import { FrequencyPercentageValue } from '../../../../src/stylelet/values/frequency-percentage';
import { TimePercentageValue } from '../../../../src/stylelet/values/time-percentage';
import { MathValue } from '../../../../src/stylelet/values/math-value';

describe('literal instances', () => {
  it.each([
    [NumberLiteral, '1.5'],
    [IntegerLiteral, '2'],
    [PercentageLiteral, '25%'],
    [ZeroLiteral, '0'],
    [DimensionLiteral, '3unknown'],
    [AngleLiteral, '1turn'],
    [LengthLiteral, '2em'],
    [FrequencyLiteral, '3khz'],
    [TimeLiteral, '4ms'],
    [ResolutionLiteral, '96dpi'],
  ] as const)('%s parses an instance with reusable operations', (literal, input) => {
    const parsed = literal.parse(input, {})!;

    expect(parsed).toBeInstanceOf(literal);
    expect(parsed.serialize()).toBe(input);
    expect(parsed.resolve(ValueStage.Specified, {})).toBe(parsed);
  });

  it.each([
    new AngleLiteral(1, 'turn'),
    new LengthLiteral(1, 'em'),
    new FrequencyLiteral(1, 'khz'),
    new TimeLiteral(1, 'ms'),
    new ResolutionLiteral(1, 'dpi'),
    new DimensionLiteral(1, 'unknown'),
  ])('preserves the concrete %s through arithmetic', (literal: DimensionLiteral) => {
    expect(literal).toBeInstanceOf(DimensionLiteral);
    const results = [
      literal.add(literal),
      literal.interpolate(literal, 0.5),
      literal.accumulate(literal),
    ];

    for (const result of results) {
      expect(result).toBeInstanceOf(literal.constructor);
      expect(result.serialize()).toBe(`${result.value}${literal.unit}`);
      expect(result.resolve(ValueStage.Specified, {})).toBe(result);
    }
  });

  it('reuses canonical literals and leaves specified literals unchanged', () => {
    const angle = new AngleLiteral(0.5, 'turn');
    const canonical = angle.canonicalize();

    expect(canonical).toBeInstanceOf(AngleLiteral);
    expect(canonical.serialize()).toBe('180deg');
    expect(canonical.canonicalize()).toBe(canonical);
    expect(angle.serialize()).toBe('0.5turn');
  });

  it('retains a length until its reference is supplied, then returns a usable literal', () => {
    const length = new LengthLiteral(2, 'em');

    expect(length.tryResolve()).toBeNull();
    expect(length.resolve(ValueStage.Computed, {})).toBe(length);
    const resolved = length.resolve(ValueStage.Computed, { em: 16 });
    expect(resolved).toBeInstanceOf(LengthLiteral);
    expect(resolved.serialize()).toBe('32px');
    expect(resolved.tryResolve()).toBe(resolved);
    expect(length.serialize()).toBe('2em');
  });

  it('allows zero arithmetic to produce an ordinary number', () => {
    const result = new ZeroLiteral().add(new NumberLiteral(2));

    expect(result).toBeInstanceOf(NumberLiteral);
    expect(result).not.toBeInstanceOf(ZeroLiteral);
    expect(result.serialize()).toBe('2');
  });
});

describe('integer', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['+12', 12],
    ['-12', -12],
    ['0012', 12],
  ] as const)('parses %j as the integer %d', (input, expected) => {
    expect(IntegerLiteral.parse(input, {})).toEqual(new IntegerLiteral(expected));
  });

  it('accepts surrounding trivia', () => {
    expect(IntegerLiteral.parse(' /* before */ -12 /* after */ ', {})).toEqual(new IntegerLiteral(-12));
  });

  it.each([
    '',
    '1.0',
    '1e0',
    '.0',
    '1%',
    '1px',
    '1 2',
    'integer',
  ])('rejects %j as an integer production', (input) => {
    expect(IntegerLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one integer from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('12 13', {}), {});

    expect(IntegerLiteral.consume(c)).toEqual(new IntegerLiteral(12));
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-integer number token', () => {
    const c = new TokenCursor(parseListOfComponentValues('1.0', {}), {});

    expect(IntegerLiteral.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([-2, 0, 3])('includes the range boundary %d', (value) => {
    const c = new TokenCursor(parseListOfComponentValues(String(value), {}), {});
    const consume = IntegerLiteral.createConsumer({ min: -2, max: 3 });

    expect(consume(c)).toEqual(new IntegerLiteral(value));
  });

  it.each([-3, 4])('returns null without advancing for out-of-range integer %d', (value) => {
    const c = new TokenCursor(parseListOfComponentValues(String(value), {}), {});
    const consume = IntegerLiteral.createConsumer({ min: -2, max: 3 });

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('adds integers', () => {
    expect(new IntegerLiteral(-2).add(new IntegerLiteral(5))).toEqual(new IntegerLiteral(3));
  });

  it.each([
    [-1, 2, 0, -1],
    [-1, 2, 0.5, 1],
    [-2, -1, 0.5, -1],
    [10, 20, 2, 30],
  ])(
    'interpolates %d and %d at p = %d to %d',
    (a, b, p, expected) => {
      expect(new IntegerLiteral(a).interpolate(new IntegerLiteral(b), p)).toEqual(new IntegerLiteral(expected));
    },
  );

  it('accumulates integers using addition', () => {
    expect(new IntegerLiteral(-2).accumulate(new IntegerLiteral(5))).toEqual(new IntegerLiteral(3));
  });

  it('normalizes negative zero after interpolation', () => {
    const result = new IntegerLiteral(-1).interpolate(new IntegerLiteral(0), 0.5);

    expect(result.value).toBe(0);
    expect(Object.is(result.value, -0)).toBe(false);
  });

  it.each([
    [new IntegerLiteral(0), '0'],
    [new IntegerLiteral(-0), '0'],
    [new IntegerLiteral(12), '12'],
    [new IntegerLiteral(-12), '-12'],
    [new IntegerLiteral(1000000000000000128), '1000000000000000128'],
    [new IntegerLiteral(1e21), '1000000000000000000000'],
    [new IntegerLiteral(-1e21), '-1000000000000000000000'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it.each([0, 12, -12, 1_000_000])('round-trips the semantic integer %d', (value) => {
    expect(IntegerLiteral.parse(new IntegerLiteral(value).serialize(), {})).toEqual(new IntegerLiteral(value));
  });
});

describe('number', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['+12', 12],
    ['-12', -12],
    ['1.0', 1],
    ['.5', 0.5],
    ['-.5', -0.5],
    ['1e0', 1],
    ['1.5e2', 150],
  ] as const)('parses %j as the number %d', (input, expected) => {
    expect(NumberLiteral.parse(input, {})).toEqual(new NumberLiteral(expected));
  });

  it('accepts surrounding trivia', () => {
    expect(NumberLiteral.parse(' /* before */ -1.25 /* after */ ', {})).toEqual(new NumberLiteral(-1.25));
  });

  it.each([
    '',
    '1%',
    '1px',
    '1 2',
    'number',
  ])('rejects %j as a number production', (input) => {
    expect(NumberLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one number from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('1.25 2', {}), {});

    expect(NumberLiteral.consume(c)).toEqual(new NumberLiteral(1.25));
    expect(c.pos()).toBe(1);
  });

  it.each([-1.5, 0, 2.5])('includes the range boundary %d', (value) => {
    const c = new TokenCursor(parseListOfComponentValues(String(value), {}), {});
    const consume = NumberLiteral.createConsumer({ min: -1.5, max: 2.5 });

    expect(consume(c)).toEqual(new NumberLiteral(value));
  });

  it.each([-1.6, 2.6])('returns null without advancing for out-of-range number %d', (value) => {
    const c = new TokenCursor(parseListOfComponentValues(String(value), {}), {});
    const consume = NumberLiteral.createConsumer({ min: -1.5, max: 2.5 });

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('adds numbers', () => {
    expect(new NumberLiteral(-1.5).add(new NumberLiteral(2.25))).toEqual(new NumberLiteral(0.75));
  });

  it.each([
    [0, 10],
    [0.25, 15],
    [1, 30],
    [2, 50],
  ])('interpolates numbers at p = %d', (p, expected) => {
    expect(new NumberLiteral(10).interpolate(new NumberLiteral(30), p)).toEqual(new NumberLiteral(expected));
  });

  it('accumulates numbers using addition', () => {
    expect(new NumberLiteral(-1.5).accumulate(new NumberLiteral(2.25))).toEqual(new NumberLiteral(0.75));
  });

  it.each([
    [0, '0'],
    [-0, '0'],
    [12, '12'],
    [1.25, '1.25'],
    [0.1234564, '0.123456'],
    [0.1234565, '0.123457'],
    [-0.1234565, '-0.123456'],
    [-0.1234566, '-0.123457'],
    [0.0000004, '0'],
    [0.0000005, '0.000001'],
    [0.0000006, '0.000001'],
    [123456789.1234567, '123456789.123457'],
    [1e21, '1000000000000000000000'],
  ] as const)('serializes %d as %j', (value, expected) => {
    expect(new NumberLiteral(value).serialize()).toBe(expected);
  });

  it.each([0, 1.25, -1.25, 0.000001])('round-trips the semantic number %d', (value) => {
    expect(NumberLiteral.parse(new NumberLiteral(value).serialize(), {})).toEqual(new NumberLiteral(value));
  });
});

describe('zero', () => {
  it.each([
    '0',
    '+0',
    '-0',
    '0.0',
    '.0',
    '0e0',
  ])('parses the literal zero %j', (input) => {
    expect(ZeroLiteral.parse(input, {})).toEqual(new NumberLiteral(0));
  });

  it.each([
    '',
    '1',
    '0%',
    '0px',
    '0 0',
  ])('rejects %j as a zero production', (input) => {
    expect(ZeroLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one literal zero from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('0.0 1', {}), {});

    expect(ZeroLiteral.consume(c)).toEqual(new NumberLiteral(0));
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a nonzero number', () => {
    const c = new TokenCursor(parseListOfComponentValues('1', {}), {});

    expect(ZeroLiteral.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('participates in number operations without a zero-specific operation', () => {
    const zero = ZeroLiteral.parse('0', {});

    expect(zero).not.toBeNull();
    expect((zero!).add(new NumberLiteral(2.5))).toEqual(new NumberLiteral(2.5));
  });
});

describe('dimension', () => {
  it.each([
    ['0px', 0, 'px'],
    ['+12em', 12, 'em'],
    ['-1.5s', -1.5, 's'],
    ['1e2Hz', 100, 'Hz'],
    ['2furlong', 2, 'furlong'],
    ['1\\70 x', 1, 'px'],
    ['1\\65 2', 1, 'e2'],
    ['1.2--fem', 1.2, '--fem'],
  ] as const)('parses %j as the dimension %d%s', (input, value, unit) => {
    expect(DimensionLiteral.parse(input, {})).toEqual(new DimensionLiteral(value, unit));
  });

  it('accepts surrounding trivia', () => {
    expect(DimensionLiteral.parse(' /* before */ -1.25rem /* after */ ', {})).toEqual(new DimensionLiteral(-1.25, 'rem'));
  });

  it.each([
    '',
    '1',
    '1%',
    'px',
    '1 px',
    '1px 2px',
  ])('rejects %j as a dimension production', (input) => {
    expect(DimensionLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one dimension from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('1.25em 2s', {}), {});

    expect(DimensionLiteral.consume(c)).toEqual(new DimensionLiteral(1.25, 'em'));
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-dimension component', () => {
    const c = new TokenCursor(parseListOfComponentValues('1%', {}), {});

    expect(DimensionLiteral.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('adds dimensions with exactly the same unit', () => {
    expect(new AngleLiteral(90, 'deg').add(new AngleLiteral(45, 'deg'))).toEqual(new AngleLiteral(135, 'deg'));
  });

  it.each([
    [0, 10],
    [0.25, 15],
    [1, 30],
    [2, 50],
  ])('interpolates dimensions at p = %d', (p, expected) => {
    expect(new AngleLiteral(10, 'deg').interpolate(new AngleLiteral(30, 'deg'), p)).toEqual(new AngleLiteral(expected, 'deg'));
  });

  it('accumulates dimensions using addition', () => {
    expect(new AngleLiteral(90, 'deg').accumulate(new AngleLiteral(45, 'deg'))).toEqual(new AngleLiteral(135, 'deg'));
  });

  it('rejects addition when units differ by case', () => {
    expect(() => new DimensionLiteral(1, 'px').add(new DimensionLiteral(2, 'PX'))).toThrow('Dimension units must match: px and PX');
  });

  it('rejects interpolation when units differ', () => {
    expect(() => new DimensionLiteral(1, 'px').interpolate(new DimensionLiteral(2, 'em'), 0.5)).toThrow('Dimension units must match: px and em');
  });

  it.each([
    [new DimensionLiteral(0, 'px'), '0px'],
    [new DimensionLiteral(-0, 'px'), '0px'],
    [new DimensionLiteral(1.25, 'em'), '1.25em'],
    [new DimensionLiteral(100, 'Hz'), '100Hz'],
    [new DimensionLiteral(1, '123'), '1\\31 23'],
    [new DimensionLiteral(1, 'e2'), '1\\65 2'],
    [new DimensionLiteral(1, 'E-2'), '1\\45 -2'],
    [new DimensionLiteral(1.2, '--fem'), '1.2--fem'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it.each([
    new DimensionLiteral(0, 'px'),
    new DimensionLiteral(1.25, 'em'),
    new DimensionLiteral(-2.5, 's'),
    new DimensionLiteral(1, 'e2'),
    new DimensionLiteral(1.2, '--fem'),
  ] as const)('round-trips the semantic dimension %j', (value) => {
    expect(DimensionLiteral.parse(value.serialize(), {})).toEqual(value);
  });
});

describe('percentage', () => {
  it.each([
    ['0%', 0],
    ['+12%', 12],
    ['-12%', -12],
    ['1.5%', 1.5],
    ['.5%', 0.5],
    ['1e2%', 100],
  ] as const)('parses %j as the percentage %d', (input, expected) => {
    expect(PercentageLiteral.parse(input, {})).toEqual(new PercentageLiteral(expected));
  });

  it('accepts surrounding trivia', () => {
    expect(PercentageLiteral.parse(' /* before */ -12.5% /* after */ ', {})).toEqual(new PercentageLiteral(-12.5));
  });

  it.each([
    '',
    '1',
    '%',
    '1px',
    '1 %',
    '1% 2%',
  ])('rejects %j as a percentage production', (input) => {
    expect(PercentageLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one percentage from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('12.5% 25%', {}), {});

    expect(PercentageLiteral.consume(c)).toEqual(new PercentageLiteral(12.5));
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-percentage component', () => {
    const c = new TokenCursor(parseListOfComponentValues('12.5', {}), {});

    expect(PercentageLiteral.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([-10, 0, 125])('includes the numeric range boundary %d', (value) => {
    const c = new TokenCursor(parseListOfComponentValues(`${value}%`, {}), {});
    const consume = PercentageLiteral.createConsumer({ min: -10, max: 125 });

    expect(consume(c)).toEqual(new PercentageLiteral(value));
  });

  it.each([-10.1, 125.1])(
    'returns null without advancing for out-of-range value %d',
    (value) => {
      const c = new TokenCursor(parseListOfComponentValues(`${value}%`, {}), {});
      const consume = PercentageLiteral.createConsumer({ min: -10, max: 125 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('adds percentages', () => {
    expect(new PercentageLiteral(25).add(new PercentageLiteral(-10))).toEqual(new PercentageLiteral(15));
  });

  it.each([
    [0, 10],
    [0.25, 15],
    [1, 30],
    [2, 50],
  ])('interpolates percentages at p = %d', (p, expected) => {
    expect(new PercentageLiteral(10).interpolate(new PercentageLiteral(30), p)).toEqual(new PercentageLiteral(expected));
  });

  it('accumulates percentages using addition', () => {
    expect(new PercentageLiteral(25).accumulate(new PercentageLiteral(-10))).toEqual(new PercentageLiteral(15));
  });

  it.each([
    [0, '0%'],
    [-0, '0%'],
    [12, '12%'],
    [-12.5, '-12.5%'],
    [0.1234565, '0.123457%'],
  ] as const)('serializes %d as %j', (value, expected) => {
    expect(new PercentageLiteral(value).serialize()).toBe(expected);
  });

  it.each([0, 12.5, -12.5, 0.000001])(
    'round-trips the semantic percentage %d',
    (value) => {
      expect(PercentageLiteral.parse(new PercentageLiteral(value).serialize(), {})).toEqual(new PercentageLiteral(value));
    },
  );
});

describe('length-percentage', () => {
  it.each([
    ['1px', new LengthLiteral(1, 'px')],
    ['25%', new PercentageLiteral(25)],
    ['0', new LengthLiteral(0, '')],
  ] as const)('parses %j', (input, expected) => {
    expect(parseAsComponentGrammar(input, withTrivia(createLengthPercentageConsumer()), {})).toEqual(expected);
  });

  it.each(['', 'auto', '1', '1s', '1px 2px'])(
    'rejects %j as a length-percentage production',
    (input) => {
      expect(parseAsComponentGrammar(input, withTrivia(createLengthPercentageConsumer()), {})).toBeNull();
    },
  );

  it('consumes one length-percentage from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('25% 1px', {}), {});

    expect(createLengthPercentageConsumer()(c)).toEqual(new PercentageLiteral(25));
    expect(c.pos()).toBe(1);
  });

  it.each(['0', '1em', '150%'])(
    'applies a nonnegative range to either alternative for %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createLengthPercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1em', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createLengthPercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createLengthPercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Length-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it('resolves a percentage using its canonical length basis', () => {
    const value = new LengthPercentageValue(new PercentageLiteral(25));
    const context = { env: styleletEnv, percentageReferenceValue: new LengthLiteral(200, 'px') };

    expect(value.resolve(ValueStage.Computed, context).repr).toEqual(new LengthLiteral(50, 'px'));
  });

  it('resolves a length using the length resolution context', () => {
    const value = new LengthPercentageValue(new LengthLiteral(2, 'em'));

    expect(value.resolve(ValueStage.Computed, { env: styleletEnv, length: { em: 16 } }).repr).toEqual(new LengthLiteral(32, 'px'));
  });

  it('retains the literal when the required resolution input is missing', () => {
    expect(new LengthPercentageValue(new PercentageLiteral(25)).resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(25));
    expect(new LengthPercentageValue(new LengthLiteral(2, 'em')).resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(new LengthLiteral(2, 'em'));
  });

  it.each([
    [new LengthLiteral(1.5, 'rem'), '1.5rem'],
    [new PercentageLiteral(-10), '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('combines values from matching alternatives', () => {
    const tenPixels = new LengthPercentageValue(new LengthLiteral(10, 'px'));
    const fivePixels = new LengthPercentageValue(new LengthLiteral(5, 'px'));
    const tenPercent = new LengthPercentageValue(new PercentageLiteral(10));
    const thirtyPercent = new LengthPercentageValue(new PercentageLiteral(30));

    expect(tenPixels.add(fivePixels, { env: styleletEnv }).repr).toEqual(new LengthLiteral(15, 'px'));
    expect(tenPercent.interpolate(thirtyPercent, 0.25, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(15));
    expect(tenPixels.accumulate(fivePixels, { env: styleletEnv }).repr).toEqual(new LengthLiteral(15, 'px'));
  });

  it('retains mixed alternatives and different units as math', () => {
    const tenPixels = new LengthPercentageValue(new LengthLiteral(10, 'px'));
    const zeroPercent = new LengthPercentageValue(new PercentageLiteral(0));
    const zeroPixels = new LengthPercentageValue(new LengthLiteral(0, 'px'));
    const twentyPercent = new LengthPercentageValue(new PercentageLiteral(20));
    const em = new LengthPercentageValue(new LengthLiteral(1, 'em'));
    const sixteenPixels = new LengthPercentageValue(new LengthLiteral(16, 'px'));

    expect(tenPixels.add(zeroPercent, { env: styleletEnv }).repr).toBeInstanceOf(MathValue);
    expect(zeroPixels.add(twentyPercent, { env: styleletEnv }).repr).toBeInstanceOf(MathValue);
    expect(em.interpolate(sixteenPixels, 0.5, { env: styleletEnv }).repr).toBeInstanceOf(MathValue);
  });
});

describe('angle-percentage', () => {
  it.each([
    ['90deg', new AngleLiteral(90, 'deg')],
    ['25%', new PercentageLiteral(25)],
  ] as const)('parses %j', (input, expected) => {
    expect(parseAsComponentGrammar(input, withTrivia(createAnglePercentageConsumer()), {})).toEqual(expected);
  });

  it.each(['', '0', '1', 'auto', '1px', '1deg 25%'])(
    'rejects %j as an angle-percentage production',
    (input) => {
      expect(parseAsComponentGrammar(input, withTrivia(createAnglePercentageConsumer()), {})).toBeNull();
    },
  );

  it('consumes one angle-percentage from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('25% 90deg', {}), {});

    expect(createAnglePercentageConsumer()(c)).toEqual(new PercentageLiteral(25));
    expect(c.pos()).toBe(1);
  });

  it.each(['1deg', '150%'])(
    'accepts the nonnegative angle-percentage %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createAnglePercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1deg', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createAnglePercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createAnglePercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Angle-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [new AngleLiteral(0.25, 'turn'), {}, 90],
    [
      new PercentageLiteral(25),
      { percentageReferenceValue: new AngleLiteral(360, 'deg') },
      90,
    ],
  ] as const)('resolves %j to %ddeg', (value, context, expected) => {
    expect(new AnglePercentageValue(value).resolve(ValueStage.Computed, { env: styleletEnv, ...context }).repr).toEqual(new AngleLiteral(expected, 'deg'));
  });

  it('retains the percentage when its basis is missing', () => {
    expect(new AnglePercentageValue(new PercentageLiteral(25)).resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(25));
  });

  it.each([
    [new AngleLiteral(0.5, 'turn'), '0.5turn'],
    [new PercentageLiteral(-10), '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('combines matching alternatives and promotes other combinations to math', () => {
    const tenDegrees = new AnglePercentageValue(new AngleLiteral(10, 'deg'));
    const twentyDegrees = new AnglePercentageValue(new AngleLiteral(20, 'deg'));
    const twentyPercent = new AnglePercentageValue(new PercentageLiteral(20));
    const sixtyPercent = new AnglePercentageValue(new PercentageLiteral(60));

    expect(tenDegrees.add(twentyDegrees, { env: styleletEnv }).repr).toEqual(new AngleLiteral(30, 'deg'));
    expect(twentyPercent.interpolate(sixtyPercent, 0.5, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(40));
    expect(tenDegrees.accumulate(twentyDegrees, { env: styleletEnv }).repr).toEqual(new AngleLiteral(30, 'deg'));
    expect(tenDegrees.add(twentyPercent, { env: styleletEnv }).repr).toBeInstanceOf(MathValue);
  });
});

describe('frequency-percentage', () => {
  it.each([
    ['1khz', new FrequencyLiteral(1, 'khz')],
    ['25%', new PercentageLiteral(25)],
  ] as const)('parses %j', (input, expected) => {
    expect(parseAsComponentGrammar(input, withTrivia(createFrequencyPercentageConsumer()), {})).toEqual(expected);
  });

  it.each(['', '0', '1', 'auto', '1s', '1khz 25%'])(
    'rejects %j as a frequency-percentage production',
    (input) => {
      expect(parseAsComponentGrammar(input, withTrivia(createFrequencyPercentageConsumer()), {})).toBeNull();
    },
  );

  it('consumes one frequency-percentage from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('25% 1khz', {}), {});

    expect(createFrequencyPercentageConsumer()(c)).toEqual(new PercentageLiteral(25));
    expect(c.pos()).toBe(1);
  });

  it.each(['1hz', '150%'])(
    'accepts the nonnegative frequency-percentage %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createFrequencyPercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1hz', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createFrequencyPercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createFrequencyPercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Frequency-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [new FrequencyLiteral(1.5, 'khz'), {}, 1500],
    [
      new PercentageLiteral(25),
      { percentageReferenceValue: new FrequencyLiteral(2000, 'hz') },
      500,
    ],
  ] as const)('resolves %j to %dhz', (value, context, expected) => {
    expect(new FrequencyPercentageValue(value).resolve(ValueStage.Computed, { env: styleletEnv, ...context }).repr).toEqual(new FrequencyLiteral(expected, 'hz'));
  });

  it('retains the percentage when its basis is missing', () => {
    expect(new FrequencyPercentageValue(new PercentageLiteral(25)).resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(25));
  });

  it.each([
    [new FrequencyLiteral(1.5, 'khz'), '1.5khz'],
    [new PercentageLiteral(-10), '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('combines matching alternatives and promotes other combinations to math', () => {
    const tenPercent = new FrequencyPercentageValue(new PercentageLiteral(10));
    const fifteenPercent = new FrequencyPercentageValue(new PercentageLiteral(15));
    const hundredHz = new FrequencyPercentageValue(new FrequencyLiteral(100, 'hz'));
    const threeHundredHz = new FrequencyPercentageValue(new FrequencyLiteral(300, 'hz'));
    const kilohertz = new FrequencyPercentageValue(new FrequencyLiteral(1, 'khz'));

    expect(tenPercent.add(fifteenPercent, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(25));
    expect(hundredHz.interpolate(threeHundredHz, 0.5, { env: styleletEnv }).repr).toEqual(new FrequencyLiteral(200, 'hz'));
    expect(tenPercent.accumulate(fifteenPercent, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(25));
    expect(kilohertz.add(hundredHz, { env: styleletEnv }).repr).toBeInstanceOf(MathValue);
  });
});

describe('time-percentage', () => {
  it.each([
    ['250ms', new TimeLiteral(250, 'ms')],
    ['25%', new PercentageLiteral(25)],
  ] as const)('parses %j', (input, expected) => {
    expect(parseAsComponentGrammar(input, withTrivia(createTimePercentageConsumer()), {})).toEqual(expected);
  });

  it.each(['', '0', '1', 'auto', '1deg', '1s 25%'])(
    'rejects %j as a time-percentage production',
    (input) => {
      expect(parseAsComponentGrammar(input, withTrivia(createTimePercentageConsumer()), {})).toBeNull();
    },
  );

  it('consumes one time-percentage from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('25% 1s', {}), {});

    expect(createTimePercentageConsumer()(c)).toEqual(new PercentageLiteral(25));
    expect(c.pos()).toBe(1);
  });

  it.each(['1s', '150%'])(
    'accepts the nonnegative time-percentage %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createTimePercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1s', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = createTimePercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createTimePercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Time-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [new TimeLiteral(250, 'ms'), {}, 0.25],
    [
      new PercentageLiteral(25),
      { percentageReferenceValue: new TimeLiteral(2, 's') },
      0.5,
    ],
  ] as const)('resolves %j to %ds', (value, context, expected) => {
    expect(new TimePercentageValue(value).resolve(ValueStage.Computed, { env: styleletEnv, ...context }).repr).toEqual(new TimeLiteral(expected, 's'));
  });

  it('retains the percentage when its basis is missing', () => {
    expect(new TimePercentageValue(new PercentageLiteral(25)).resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(25));
  });

  it.each([
    [new TimeLiteral(250, 'ms'), '250ms'],
    [new PercentageLiteral(-10), '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('combines matching alternatives and promotes other combinations to math', () => {
    const second = new TimePercentageValue(new TimeLiteral(1, 's'));
    const twoSeconds = new TimePercentageValue(new TimeLiteral(2, 's'));
    const quarter = new TimePercentageValue(new PercentageLiteral(25));
    const threeQuarters = new TimePercentageValue(new PercentageLiteral(75));
    const full = new TimePercentageValue(new PercentageLiteral(100));

    expect(second.add(twoSeconds, { env: styleletEnv }).repr).toEqual(new TimeLiteral(3, 's'));
    expect(quarter.interpolate(threeQuarters, 0.5, { env: styleletEnv }).repr).toEqual(new PercentageLiteral(50));
    expect(second.accumulate(twoSeconds, { env: styleletEnv }).repr).toEqual(new TimeLiteral(3, 's'));
    expect(second.interpolate(full, 0.5, { env: styleletEnv }).repr).toBeInstanceOf(MathValue);
  });
});

describe('length', () => {
  const resolve = (
    input: string,
    context: LengthResolutionContext = {},
  ) => {
    const value = LengthLiteral.parse(input, context);

    if (value === null) {
      throw new Error(`Invalid length test input: ${input}`);
    }

    return value.tryResolve(context);
  };

  it.each(LENGTH_UNITS)('parses the %s length unit', (unit) => {
    expect(LengthLiteral.parse(`1${unit}`, {})).toEqual(new LengthLiteral(1, unit));
  });

  it.each([
    ['+1.25PX', 1.25, 'px'],
    ['-2Q', -2, 'q'],
    ['1\\72 cap', 1, 'rcap'],
    ['1CQMAX', 1, 'cqmax'],
  ] as const)('normalizes the unit in %j to %j', (input, value, unit) => {
    expect(LengthLiteral.parse(input, {})).toEqual(new LengthLiteral(value, unit));
  });

  it.each([
    '0',
    '+0',
    '-0',
    '0.0',
    '.0',
    '0e0',
  ])('parses unitless zero %j as a length', (input) => {
    expect(LengthLiteral.parse(input, {})).toEqual(new LengthLiteral(0, ''));
  });

  it('accepts surrounding trivia', () => {
    expect(LengthLiteral.parse(' /* before */ -1.25rem /* after */ ', {})).toEqual(new LengthLiteral(-1.25, 'rem'));
  });

  it.each([
    '',
    '1',
    '1%',
    '1s',
    '1fr',
    '1furlong',
    '1 px',
    '1px 2px',
  ])('rejects %j as a length production', (input) => {
    expect(LengthLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one length from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('1.25em 2px', {}), {});

    expect(LengthLiteral.consume(c)).toEqual(new LengthLiteral(1.25, 'em'));
    expect(c.pos()).toBe(1);
  });

  it.each(['1s', '1', '1%'])(
    'returns null without advancing for %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});

      expect(LengthLiteral.consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    ['0', 0, ''],
    ['1em', 1, 'em'],
    ['1vw', 1, 'vw'],
  ] as const)(
    'accepts the nonnegative length %j without resolving it',
    (input, value, unit) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = LengthLiteral.createConsumer({ min: 0 });

      expect(consume(c)).toEqual({ type: 'length', value, unit });
    },
  );

  it.each(['-1px', '-1em', '-1vw'])(
    'returns null without advancing for the negative length %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = LengthLiteral.createConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => LengthLiteral.createConsumer({ min: 96, max: 192 })).toThrow(
      'Length ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [new LengthLiteral(0, ''), '0'],
    [new LengthLiteral(0, 'px'), '0px'],
    [new LengthLiteral(-0, 'em'), '0em'],
    [new LengthLiteral(1.25, 'rem'), '1.25rem'],
    [new LengthLiteral(-2, 'q'), '-2q'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it.each([
    [new LengthLiteral(0, ''), 0],
    [new LengthLiteral(1, 'px'), 1],
    [new LengthLiteral(1, 'in'), 96],
    [new LengthLiteral(2.54, 'cm'), 96],
    [new LengthLiteral(25.4, 'mm'), 96],
    [new LengthLiteral(101.6, 'q'), 96],
    [new LengthLiteral(72, 'pt'), 96],
    [new LengthLiteral(6, 'pc'), 96],
  ] as const)('resolves the absolute length %j to %dpx', (value, expected) => {
    expect(value.tryResolve()).toEqual(new LengthLiteral(expected, 'px'));
  });

  it('resolves font-relative lengths from their effective reference lengths', () => {
    const context = {
      em: 10,
      rem: 11,
      ex: 12,
      rex: 13,
      cap: 14,
      rcap: 15,
      ch: 16,
      rch: 17,
      ic: 18,
      ric: 19,
      lh: 20,
      rlh: 21,
    } satisfies LengthResolutionContext;

    for (const [unit, pixelsPerUnit] of Object.entries(context)) {
      expect(resolve(`2${unit}`, context)).toEqual(new LengthLiteral(2 * pixelsPerUnit, 'px'));
    }
  });

  it('resolves physical and logical viewport-relative lengths', () => {
    const context = {
      smallViewportWidth: 300,
      smallViewportHeight: 600,
      largeViewportWidth: 400,
      largeViewportHeight: 800,
      dynamicViewportWidth: 350,
      dynamicViewportHeight: 700,
      viewportInlineAxis: 'vertical',
    } satisfies LengthResolutionContext;
    const expected = {
      '2vw': 8,
      '2lvh': 16,
      '2svmin': 6,
      '2svmax': 12,
      '2dvi': 14,
      '2dvb': 7,
    };

    for (const [input, value] of Object.entries(expected)) {
      expect(resolve(input, context)).toEqual(new LengthLiteral(value, 'px'));
    }
  });

  it('resolves physical and logical container-relative lengths', () => {
    const context = {
      containerWidth: 500,
      containerHeight: 200,
      containerInlineSize: 300,
      containerBlockSize: 700,
    } satisfies LengthResolutionContext;
    const expected = {
      '2cqw': 10,
      '2cqh': 4,
      '2cqi': 6,
      '2cqb': 14,
      '2cqmin': 6,
      '2cqmax': 14,
    };

    for (const [input, value] of Object.entries(expected)) {
      expect(resolve(input, context)).toEqual(new LengthLiteral(value, 'px'));
    }
  });

  it('returns null when contextual resolution data is missing', () => {
    expect(resolve('1em')).toBeNull();
    expect(resolve('1vi', {
      largeViewportWidth: 400,
      largeViewportHeight: 800,
    })).toBeNull();
    expect(resolve('1cqw')).toBeNull();
  });

  it('serializes a canonical length in pixels', () => {
    expect(new LengthLiteral(12.5, 'px').serialize()).toBe('12.5px');
  });

  it.each([
    [0, 0],
    [0.5, 0.5],
    [0.25, 0.5],
    [-0.25, -0.5],
    [0.75, 0.5],
    [-0.75, -0.5],
    [1.25, 1],
  ])('snaps %dpx as a line width to %dpx', (input, expected) => {
    expect(new LengthLiteral(input, 'px').snapAsLineWidth(2)).toEqual(new LengthLiteral(expected, 'px'));
  });

  it.each([
    new LengthLiteral(0, ''),
    new LengthLiteral(0, 'px'),
    new LengthLiteral(1.25, 'em'),
    new LengthLiteral(-2.5, 'cqmax'),
  ] as const)('round-trips the semantic length %j', (value) => {
    expect(LengthLiteral.parse(value.serialize(), {})).toEqual(value);
  });
});

describe('angle', () => {
  it.each(ANGLE_UNITS)('parses the %s angle unit', (unit) => {
    expect(AngleLiteral.parse(`1${unit}`, {})).toEqual(new AngleLiteral(1, unit));
  });

  it('normalizes angle units to ASCII lowercase', () => {
    expect(AngleLiteral.parse('-1.25TuRn', {})).toEqual(new AngleLiteral(-1.25, 'turn'));
  });

  it('accepts surrounding trivia', () => {
    expect(AngleLiteral.parse(' /* before */ 100grad /* after */ ', {})).toEqual(new AngleLiteral(100, 'grad'));
  });

  it.each([
    '',
    '0',
    '1',
    '1%',
    '1px',
    '1deg 2deg',
  ])('rejects %j as an angle production', (input) => {
    expect(AngleLiteral.parse(input, {})).toBeNull();
  });

  it('consumes one angle from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('0.25turn 90deg', {}), {});

    expect(AngleLiteral.consume(c)).toEqual(new AngleLiteral(0.25, 'turn'));
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-angle dimension', () => {
    const c = new TokenCursor(parseListOfComponentValues('1px', {}), {});

    expect(AngleLiteral.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([
    '100grad',
    `${Math.PI}rad`,
    '0.5turn',
  ])('accepts the angle %j within a canonical range', (input) => {
    const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
    const consume = AngleLiteral.createConsumer({ min: 90, max: 180 });

    expect(consume(c)).not.toBeNull();
    expect(c.pos()).toBe(1);
  });

  it.each(['0.2turn', '4rad'])(
    'returns null without advancing for the out-of-range angle %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = AngleLiteral.createConsumer({ min: 90, max: 180 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    [new AngleLiteral(90, 'deg'), 90],
    [new AngleLiteral(100, 'grad'), 90],
    [new AngleLiteral(Math.PI, 'rad'), 180],
    [new AngleLiteral(0.5, 'turn'), 180],
  ] as const)('canonicalizes %j as %ddeg', (value, expected) => {
    expect(value.canonicalize()).toEqual(new AngleLiteral(expected, 'deg'));
  });

  it.each([
    [new AngleLiteral(0, 'deg'), '0deg'],
    [new AngleLiteral(-1.25, 'rad'), '-1.25rad'],
    [new AngleLiteral(0.5, 'turn'), '0.5turn'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('serializes a canonical angle in degrees', () => {
    expect(new AngleLiteral(90, 'deg').serialize()).toBe('90deg');
  });

  it.each([
    new AngleLiteral(90, 'deg'),
    new AngleLiteral(-100, 'grad'),
    new AngleLiteral(0.5, 'turn'),
  ] as const)('round-trips the semantic angle %j', (value) => {
    expect(AngleLiteral.parse(value.serialize(), {})).toEqual(value);
  });
});

describe('time', () => {
  it.each(TIME_UNITS)('parses the %s time unit', (unit) => {
    expect(TimeLiteral.parse(`1${unit}`, {})).toEqual(new TimeLiteral(1, unit));
  });

  it('normalizes time units to ASCII lowercase', () => {
    expect(TimeLiteral.parse('-250MS', {})).toEqual(new TimeLiteral(-250, 'ms'));
  });

  it('accepts surrounding trivia', () => {
    expect(TimeLiteral.parse(' /* before */ 1.5s /* after */ ', {})).toEqual(new TimeLiteral(1.5, 's'));
  });

  it.each(['', '0', '1', '1%', '1deg', '1s 2s'])(
    'rejects %j as a time production',
    (input) => {
      expect(TimeLiteral.parse(input, {})).toBeNull();
    },
  );

  it('consumes one time from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('250ms 1s', {}), {});

    expect(TimeLiteral.consume(c)).toEqual(new TimeLiteral(250, 'ms'));
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-time dimension', () => {
    const c = new TokenCursor(parseListOfComponentValues('1deg', {}), {});

    expect(TimeLiteral.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each(['500ms', '2s'])(
    'accepts the time %j within a canonical range',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = TimeLiteral.createConsumer({ min: 0.5, max: 2 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['499ms', '2.001s'])(
    'returns null without advancing for the out-of-range time %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = TimeLiteral.createConsumer({ min: 0.5, max: 2 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    [new TimeLiteral(2, 's'), 2],
    [new TimeLiteral(250, 'ms'), 0.25],
  ] as const)('canonicalizes %j as %ds', (value, expected) => {
    expect(value.canonicalize()).toEqual(new TimeLiteral(expected, 's'));
  });

  it.each([
    [new TimeLiteral(0, 's'), '0s'],
    [new TimeLiteral(-250, 'ms'), '-250ms'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('serializes a canonical time in seconds', () => {
    expect(new TimeLiteral(1.5, 's').serialize()).toBe('1.5s');
  });

  it.each([
    new TimeLiteral(1.5, 's'),
    new TimeLiteral(-250, 'ms'),
  ] as const)('round-trips the semantic time %j', (value) => {
    expect(TimeLiteral.parse(value.serialize(), {})).toEqual(value);
  });
});

describe('frequency', () => {
  it.each(FREQUENCY_UNITS)('parses the %s frequency unit', (unit) => {
    expect(FrequencyLiteral.parse(`1${unit}`, {})).toEqual(new FrequencyLiteral(1, unit));
  });

  it('normalizes frequency units to ASCII lowercase', () => {
    expect(FrequencyLiteral.parse('6kHz', {})).toEqual(new FrequencyLiteral(6, 'khz'));
  });

  it.each(['', '0', '1', '1%', '1s', '1hz 2hz'])(
    'rejects %j as a frequency production',
    (input) => {
      expect(FrequencyLiteral.parse(input, {})).toBeNull();
    },
  );

  it('consumes one frequency from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('1khz 500hz', {}), {});

    expect(FrequencyLiteral.consume(c)).toEqual(new FrequencyLiteral(1, 'khz'));
    expect(c.pos()).toBe(1);
  });

  it.each(['1000hz', '2khz'])(
    'accepts the frequency %j within a canonical range',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = FrequencyLiteral.createConsumer({ min: 1000, max: 2000 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it('returns null without advancing for an out-of-range frequency', () => {
    const c = new TokenCursor(parseListOfComponentValues('0.5khz', {}), {});
    const consume = FrequencyLiteral.createConsumer({ min: 1000 });

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([
    [new FrequencyLiteral(500, 'hz'), 500],
    [new FrequencyLiteral(1.5, 'khz'), 1500],
  ] as const)('canonicalizes %j as %dhz', (value, expected) => {
    expect(value.canonicalize()).toEqual(new FrequencyLiteral(expected, 'hz'));
  });

  it.each([
    [new FrequencyLiteral(200, 'hz'), '200hz'],
    [new FrequencyLiteral(6, 'khz'), '6khz'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('serializes a canonical frequency in hertz', () => {
    expect(new FrequencyLiteral(500, 'hz').serialize()).toBe('500hz');
  });

  it.each([
    new FrequencyLiteral(200, 'hz'),
    new FrequencyLiteral(6, 'khz'),
  ] as const)('round-trips the semantic frequency %j', (value) => {
    expect(FrequencyLiteral.parse(value.serialize(), {})).toEqual(value);
  });
});

describe('resolution', () => {
  it.each(RESOLUTION_UNITS)('parses the %s resolution unit', (unit) => {
    expect(ResolutionLiteral.parse(`1${unit}`, {})).toEqual(new ResolutionLiteral(1, unit));
  });

  it('normalizes resolution units to ASCII lowercase', () => {
    expect(ResolutionLiteral.parse('96DPI', {})).toEqual(new ResolutionLiteral(96, 'dpi'));
  });

  it('accepts zero resolution with a unit', () => {
    expect(ResolutionLiteral.parse('0x', {})).toEqual(new ResolutionLiteral(0, 'x'));
  });

  it.each(['', '0', '1', '1%', '1hz', '1dpi 2dpi'])(
    'rejects %j as a resolution production',
    (input) => {
      expect(ResolutionLiteral.parse(input, {})).toBeNull();
    },
  );

  it.each(['-1dpi', '-1dpcm', '-1dppx', '-1x'])(
    'rejects the negative resolution %j',
    (input) => {
      expect(ResolutionLiteral.parse(input, {})).toBeNull();
    },
  );

  it('consumes one resolution from the current cursor position', () => {
    const c = new TokenCursor(parseListOfComponentValues('2dppx 96dpi', {}), {});

    expect(ResolutionLiteral.consume(c)).toEqual(new ResolutionLiteral(2, 'dppx'));
    expect(c.pos()).toBe(1);
  });

  it.each(['96dpi', '1dppx', '2x'])(
    'accepts the resolution %j within a canonical range',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = ResolutionLiteral.createConsumer({ min: 1, max: 2 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['95dpi', '2.1x'])(
    'returns null without advancing for the out-of-range resolution %j',
    (input) => {
      const c = new TokenCursor(parseListOfComponentValues(input, {}), {});
      const consume = ResolutionLiteral.createConsumer({ min: 1, max: 2 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    [new ResolutionLiteral(96, 'dpi'), 1],
    [new ResolutionLiteral(96 / 2.54, 'dpcm'), 1],
    [new ResolutionLiteral(2, 'dppx'), 2],
    [new ResolutionLiteral(2, 'x'), 2],
  ] as const)('canonicalizes %j as %ddppx', (value, expected) => {
    expect(value.canonicalize()).toEqual(new ResolutionLiteral(expected, 'dppx'));
  });

  it.each([
    [new ResolutionLiteral(96, 'dpi'), '96dpi'],
    [new ResolutionLiteral(2, 'x'), '2x'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(value.serialize()).toBe(expected);
  });

  it('serializes a canonical resolution in dots per CSS pixel', () => {
    expect(new ResolutionLiteral(2, 'dppx').serialize()).toBe('2dppx');
  });

  it.each([
    new ResolutionLiteral(96, 'dpi'),
    new ResolutionLiteral(37.5, 'dpcm'),
    new ResolutionLiteral(2, 'dppx'),
    new ResolutionLiteral(2, 'x'),
  ] as const)('round-trips the semantic resolution %j', (value) => {
    expect(ResolutionLiteral.parse(value.serialize(), {})).toEqual(value);
  });
});
