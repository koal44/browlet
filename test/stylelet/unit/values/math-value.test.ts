import { styleletEnv } from '../../environment-fixture';
import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import {
  AngleLiteral, DimensionLiteral, FrequencyLiteral, IntegerLiteral, LengthLiteral,
  NumberLiteral, PercentageLiteral, ResolutionLiteral, TimeLiteral,
} from '../../../../src/stylelet/values/numeric-literal/index';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  MathValue, MathExpression, type MathContext, type MathValueType, type MathBase,
} from '../../../../src/stylelet/values/math-value';

describe('calc', () => {
  it.each([
    ['calc(1 + 2)', 'number', NumberLiteral, '3'],
    ['calc(1.5)', 'integer', IntegerLiteral, '2'],
    ['calc(25%)', 'percentage', PercentageLiteral, '25%'],
    ['calc(0.5turn)', 'angle', AngleLiteral, '180deg'],
    ['calc(1in)', 'length', LengthLiteral, '96px'],
    ['calc(1khz)', 'frequency', FrequencyLiteral, '1000hz'],
    ['calc(250ms)', 'time', TimeLiteral, '0.25s'],
    ['calc(96dpi)', 'resolution', ResolutionLiteral, '1dppx'],
    ['calc(2fr)', 'flex', DimensionLiteral, '2fr'],
  ] as const)('resolves %j to a literal with its operations intact', (input, valueType, literal, expected) => {
    const result = MathValue.parse(input, valueType, { env: styleletEnv })!.resolve(ValueStage.Computed, { env: styleletEnv }).repr;

    expect(result).toBeInstanceOf(literal);
    if (result instanceof MathExpression) throw new Error('Expected a resolved literal');
    expect(result.serialize()).toBe(expected);
    expect(result.resolve(ValueStage.Computed, {})).toBe(result);
  });

  it.each([
    ['calc(1)', { type: 'number', value: 1 }, mathHints(), 'number'],
    [
      'calc(1px)',
      { type: 'dimension', value: 1, unit: 'px' },
      mathHints([['length', 1]]),
      'length',
    ],
    [
      'calc(25%)',
      { type: 'percentage', value: 25 },
      mathHints([['percent', 1]], 'percent'),
      'percentage',
    ],
  ] as const)(
    'parses the terminal calculation %j',
    (input, expected, type, expectedType) => {
      const value = MathValue.parse(input, expectedType, { env: styleletEnv });
      expect(value?.repr).toBeInstanceOf(MathExpression);
      expect(value).toEqual({ repr: { calculation: numericLeaf(expected, type), promoted: false }, valueType: expectedType });
    },
  );

  it('retains an expression tree and serializes it without simplifying', () => {
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([
        ['a', { valueType: 'number', value: undefined }],
        ['b', { valueType: 'number', value: undefined }],
      ]),
    };
    const calculation = expression(MathValue.parse('calc(a + b)', 'number', context))!.calculation;
    if (calculation.type !== 'sum') throw new Error('Expected a sum');
    // Supply unsimplified children to a real node; serialization must leave them alone.
    calculation.children = [
      numericLeaf({ type: 'number', value: 1 }, mathHints()),
      numericLeaf({ type: 'number', value: 2 }, mathHints()),
    ];
    const mathExpression = new MathExpression(calculation);
    const value = new MathValue(mathExpression, 'number');

    expect(value.serialize()).toBe('calc(1 + 2)');
    expect(mathExpression.serialize()).toBe('calc(1 + 2)');
    expect(mathExpression.calculation).toBe(calculation);
    expect(value.resolve(ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('3');
    expect(mathExpression.serialize()).toBe('calc(1 + 2)');
  });

  it.each([
    ['calc(x + y)', 6, 10],
    ['calc(x * y)', 8, 16],
    ['calc(1 - x)', -3, -7],
    ['calc(1 / x)', 0.25, 0.125],
    ['min(x)', 4, 8],
    ['max(x, y)', 4, 8],
    ['clamp(y, x, 10)', 4, 8],
    ['round(up, x, y)', 4, 8],
    ['pow(x, y)', 16, 64],
    ['abs(calc(0 - x))', 4, 8],
    ['log(x, y)', 2, 3],
  ] as const)('keeps deferred nodes usable with later contexts: %s', (input, first, second) => {
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([
        ['x', { valueType: 'number', value: undefined }],
        ['y', { valueType: 'number', value: undefined }],
      ]),
    };
    const declared = MathValue.parse(input, 'number', context)!;
    const serialized = declared.serialize();
    const deferred = declared.resolve(ValueStage.Computed, context);

    for (const [x, expected] of [[4, first], [8, second]] as const) {
      const result = deferred.resolve(ValueStage.Computed, {
        env: styleletEnv,
        numericVariables: new Map([
          ['x', { valueType: 'number', value: new NumberLiteral(x) }],
          ['y', { valueType: 'number', value: new NumberLiteral(2) }],
        ]),
      });
      expect(result.repr).toEqual(new NumberLiteral(expected));
    }
    expect(deferred.serialize()).toBe(serialized);
    expect(declared.serialize()).toBe(serialized);
  });

  it.each([
    ['calc(1 + 2)', 'number', { type: 'number', value: 3 }],
    ['calc(25%)', 'percentage', { type: 'percentage', value: 25 }],
    ['calc(1px)', 'length', { type: 'length', value: 1, unit: 'px' }],
  ] as const)('resolves and unwraps the math value %j', (input, valueType, expected) => {
    const value = MathValue.parse(input, valueType, { env: styleletEnv });

    expect(value).not.toBeNull();
    if (value === null) {
      throw new Error('Expected a math value');
    }

    expect(value.resolve(ValueStage.Declared, { env: styleletEnv })).toEqual(value);
    expect(value.resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(expected);
    expect(value.resolve(ValueStage.Declared, { env: styleletEnv, unwrapMathAt: ValueStage.Declared }).repr).toEqual(expected);
  });

  it('coerces percentage math into number math', () => {
    const context = { env: styleletEnv, percentHint: 'percent' } as const;
    const percentage = MathValue.parse('calc(2 * 60%)', 'percentage', context)!;
    const number = percentage.toNumber(1 / 100, 1, { env: styleletEnv });

    expect(number.serialize()).toBe('calc(1.2)');
    expect(number.resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual({
      type: 'number',
      value: 1.2,
    });
  });

  it('preserves unresolved math while dividing its percentage dimension', () => {
    const context: MathContext = {
      env: styleletEnv,
      percentHint: 'percent',
      numericVariables: new Map([['p', {
        value: undefined,
        valueType: 'percentage',
      }]]),
    };
    const percentage = MathValue.parse('calc(p)', 'percentage', context)!;
    const number = percentage.toNumber(1 / 100, 1, { env: styleletEnv });

    expect(number.serialize()).toBe('calc(p / 100%)');
    expect(number.valueType).toBe('number');
  });

  it('promotes a numeric variable into a bare math value', () => {
    const value = MathValue.fromVariable('X', 'number', {
      env: styleletEnv,
      numericVariables: new Map([['x', {
        value: undefined,
        valueType: 'number',
      }]]),
    });

    expect(value).toMatchObject({
      repr: {
        calculation: {
          type: 'variable',
          name: 'x',
        }, promoted: true,
      }, valueType: 'number',
    });
    expect(value.serialize()).toBe('x');

    const promoted = expression(value)!;
    expect(promoted.variableName()).toBe('x');
    expect(promoted.serialize()).toBe('x');
    const ordinary = new MathExpression(promoted.calculation);
    expect(ordinary.variableName()).toBeNull();
    expect(ordinary.serialize()).toBe('calc(x)');
  });

  it('preserves promotion while resolving the same math value', () => {
    const calculation = expression(MathValue.parse('calc(1em + 2px)', 'length', { env: styleletEnv }))!.calculation;
    const value = new MathValue(new MathExpression(calculation, true), 'length');

    const resolved = value.resolve(ValueStage.Declared, {
      env: styleletEnv,
      length: { em: 16 },
    });

    expect(resolved).toMatchObject({ repr: { promoted: true } });
    if (!(resolved.repr instanceof MathExpression)) {
      throw new Error('Expected a math value');
    }
    expect(resolved.serialize()).toBe('calc(18px)');
  });

  it('does not promote a newly combined math value', () => {
    const calculation = expression(MathValue.parse('calc(10px)', 'length', { env: styleletEnv }))!.calculation;
    const value = new MathValue(new MathExpression(calculation, true), 'length');

    expect(value.add(MathValue.parse('calc(20px)', 'length', { env: styleletEnv })!, { env: styleletEnv })).toMatchObject({ repr: { promoted: false } });
  });

  it('rejects a resolved literal that violates its value type', () => {
    const value = new MathValue(new MathExpression(numericLeaf(
      { type: 'percentage', value: 25 },
      mathHints([['percent', 1]], 'percent'),
    )), 'number');

    expect(() => value.resolve(ValueStage.Computed, { env: styleletEnv }))
      .toThrow('Resolved math value does not match its value type');
  });

  it('respects operator precedence while simplifying', () => {
    expect(MathValue.parse('calc(1px + 2 * 3px - 4px / 2)', 'length', { env: styleletEnv })).toEqual({
      repr: {
        calculation: numericLeaf(
          { type: 'dimension', value: 5, unit: 'px' },
          mathHints([['length', 1]]),
        ), promoted: false,
      }, valueType: 'length',
    });
  });

  it('uses parenthesized calculations for grouping while simplifying', () => {
    expect(MathValue.parse('calc((1 + 2) * 3)', 'number', { env: styleletEnv })).toEqual({
      repr: {
        calculation: numericLeaf(
          { type: 'number', value: 9 },
          mathHints(),
        ), promoted: false,
      }, valueType: 'number',
    });
  });

  it.each([
    ['min(1em, 2rem)', 'min', 2, mathHints([['length', 1]])],
    ['max(1vw, 2vh)', 'max', 2, mathHints([['length', 1]])],
    ['clamp(1em, 2rem, 3em)', 'clamp', 3, mathHints([['length', 1]])],
  ] as const)(
    'parses the math function %s',
    (input, type, expectedArgumentCount, expectedType) => {
      const parsed = expression(MathValue.parse(input, 'length', { env: styleletEnv }))?.calculation ?? null;

      expect(parsed?.type).toBe(type);
      if (parsed === null) {
        throw new Error('Expected a math function calculation');
      }

      const argumentCount = parsed.type === 'clamp'
        ? 3
        : 'arguments' in parsed
          ? parsed.arguments.length
          : 0;

      expect(argumentCount).toBe(expectedArgumentCount);
      expect(
        parsed.hints,
      ).toEqual(expectedType);
    },
  );

  it('wraps every math function in the same public value shape', () => {
    expect(MathValue.parse('calc(1 + 2)', 'number', { env: styleletEnv })).toEqual({
      repr: {
        calculation: numericLeaf(
          { type: 'number', value: 3 },
          mathHints(),
        ), promoted: false,
      }, valueType: 'number',
    });
    expect(MathValue.parse('min(1em, 2rem)', 'length', { env: styleletEnv })).toMatchObject({
      repr: {
        calculation: {
          type: 'min',
          arguments: [
            { type: 'dimension', value: 1, unit: 'em' },
            { type: 'dimension', value: 2, unit: 'rem' },
          ],
        }, promoted: false,
      }, valueType: 'length',
    });
  });

  describe('math comparison functions', () => {
    it.each([
      ['min(3, 1, 2)', 'number', 1],
      ['max(3px, 1px, 2px)', 'length', 3],
      ['min(1in, 100px)', 'length', 96],
      ['clamp(0px, 20px, 10px)', 'length', 10],
      ['clamp(100px, 0px, 50px)', 'length', 100],
      ['clamp(none, 20px, 10px)', 'length', 10],
      ['clamp(10px, 5px, none)', 'length', 10],
      ['clamp(none, 5px, none)', 'length', 5],
    ] as const)('simplifies the comparison function %s', (input, valueType, expected) => {
      expect(expression(MathValue.parse(input, valueType, { env: styleletEnv }))?.calculation).toMatchObject({
        value: expected,
      });
    });

    it('partially simplifies comparable min() and max() arguments', () => {
      expect(expression(MathValue.parse('min(2em, 1em, 3rem)', 'length', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'min',
        arguments: [
          { type: 'dimension', value: 1, unit: 'em' },
          { type: 'dimension', value: 3, unit: 'rem' },
        ],
      });
      expect(expression(MathValue.parse('max(2vw, 1vh, 3vw)', 'length', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'max',
        arguments: [
          { type: 'dimension', value: 3, unit: 'vw' },
          { type: 'dimension', value: 1, unit: 'vh' },
        ],
      });
      expect(expression(MathValue.parse('min(4rem, 2px, 3rem, 1px)', 'length', { env: styleletEnv }))?.calculation)
        .toMatchObject({
          type: 'min',
          arguments: [
            { type: 'dimension', value: 3, unit: 'rem' },
            { type: 'dimension', value: 1, unit: 'px' },
          ],
        });
    });

    it('retains percentage comparisons without sufficient context', () => {
      expect(expression(MathValue.parse('min(10%, 20%)', 'percentage', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'min',
      });
      expect(expression(MathValue.parse('clamp(10%, 20%, 30%)', 'percentage', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'clamp',
      });
      expect(expression(MathValue.parse('min(10%, 20%)', 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
      }))?.calculation).toMatchObject({
        type: 'min',
        arguments: [
          { type: 'percentage', value: 10 },
          { type: 'percentage', value: 20 },
        ],
      });
      expect(expression(MathValue.parse('clamp(10%, 20%, 30%)', 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
      }))?.calculation).toMatchObject({ type: 'clamp' });
    });

    it('compares raw or resolved percentages', () => {
      expect(expression(MathValue.parse('min(10%, 20%)', 'percentage', {
        env: styleletEnv,
        percentHint: 'percent',
      }))?.calculation).toEqual({
        type: 'percentage',
        value: 10,
        hints: mathHints([['percent', 1]], 'percent'),
      });
      expect(expression(MathValue.parse('max(10%, 20%)', 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
        percentageReferenceValue: new LengthLiteral(200, 'px'),
      }))?.calculation).toEqual({
        type: 'dimension',
        value: 40,
        unit: 'px',
        hints: mathHints([['length', 1]], 'length'),
      });
    });

    it('unwraps a boundless clamp without comparing its percentage', () => {
      expect(expression(MathValue.parse('clamp(none, 20%, none)', 'percentage', { env: styleletEnv }))?.calculation).toEqual({
        type: 'percentage',
        value: 20,
        hints: mathHints([['percent', 1]], 'percent'),
      });
    });

    it('orders negative zero below positive zero', () => {
      const minimum = expression(MathValue.parse('min(0, calc(-1 * 0))', 'number', { env: styleletEnv }))!.calculation;
      const maximum = expression(MathValue.parse('max(0, calc(-1 * 0))', 'number', { env: styleletEnv }))!.calculation;
      const clamped = expression(MathValue.parse('clamp(0, calc(-1 * 0), 1)', 'number', { env: styleletEnv }))!.calculation;

      expect('value' in minimum && Object.is(minimum.value, -0)).toBe(true);
      expect('value' in maximum && Object.is(maximum.value, 0)).toBe(true);
      expect('value' in clamped && Object.is(clamped.value, 0)).toBe(true);
    });

    it('retains clamp() when unresolved units cannot be compared', () => {
      expect(expression(MathValue.parse('clamp(1em, 2rem, 3em)', 'length', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'clamp',
        minimum: { type: 'dimension', value: 1, unit: 'em' },
        value: { type: 'dimension', value: 2, unit: 'rem' },
        maximum: { type: 'dimension', value: 3, unit: 'em' },
      });
      expect(expression(MathValue.parse('clamp(none, 2rem, 3em)', 'length', { env: styleletEnv }))?.calculation)
        .toMatchObject({
          type: 'clamp',
          minimum: undefined,
          value: { type: 'dimension', value: 2, unit: 'rem' },
          maximum: { type: 'dimension', value: 3, unit: 'em' },
        });
      expect(expression(MathValue.parse('clamp(1em, 2rem, none)', 'length', { env: styleletEnv }))?.calculation)
        .toMatchObject({
          type: 'clamp',
          minimum: { type: 'dimension', value: 1, unit: 'em' },
          value: { type: 'dimension', value: 2, unit: 'rem' },
          maximum: undefined,
        });
    });
  });

  describe('math stepped-value functions', () => {
    it('uses the default round() strategy and optional numeric step', () => {
      expect(expression(MathValue.parse('round(1)', 'number', { env: styleletEnv }))?.calculation).toEqual({
        type: 'number',
        value: 1,
        hints: mathHints(),
      });
    });

    it.each([
      ['round(5, 2)', 6],
      ['round(-5, 2)', -4],
      ['round(up, 5, 2)', 6],
      ['round(down, 5, 2)', 4],
      ['round(to-zero, -5, 2)', -4],
    ] as const)('simplifies the stepped function %s', (input, expected) => {
      expect(expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation).toEqual({
        type: 'number',
        value: expected,
        hints: mathHints(),
      });
    });

    it.each([
      ['mod(-5, 3)', 1],
      ['mod(5, -3)', -1],
      ['rem(-5, 3)', -2],
      ['rem(5, -3)', 2],
    ] as const)('simplifies the modulus function %s', (input, expected) => {
      expect(expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation).toEqual({
        type: 'number',
        value: expected,
        hints: mathHints(),
      });
    });

    it('simplifies stepped dimensions with canonical or identical units', () => {
      expect(expression(MathValue.parse('round(down, 1.3in, 10px)', 'length', { env: styleletEnv }))?.calculation).toEqual({
        type: 'dimension',
        value: 120,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
      expect(expression(MathValue.parse('mod(25rem, 10rem)', 'length', { env: styleletEnv }))?.calculation).toEqual({
        type: 'dimension',
        value: 5,
        unit: 'rem',
        hints: mathHints([['length', 1]]),
      });
    });

    it('retains stepped functions whose unresolved units differ', () => {
      expect(expression(MathValue.parse('round(10rem, 1em)', 'length', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'round',
        strategy: 'nearest',
        value: { type: 'dimension', value: 10, unit: 'rem' },
        step: { type: 'dimension', value: 1, unit: 'em' },
      });
    });

    it('snaps the line-width rounding strategy with device context', () => {
      expect(expression(MathValue.parse('round(line-width, .25px)', 'length', {
        env: styleletEnv,
        devicePixelRatio: 2,
      }))?.calculation).toEqual({
        type: 'dimension',
        value: 0.5,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
    });

    it('chooses the nonzero multiple for line-width rounding', () => {
      expect(expression(MathValue.parse('round(line-width, 1px, calc(infinity * 1px))', 'length', { env: styleletEnv, devicePixelRatio: 2 }))?.calculation).toEqual({
        type: 'dimension',
        value: Infinity,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
    });

    it.each([
      'round(1, 0)',
      'round(infinity, infinity)',
      'mod(infinity, 1)',
      'rem(1, 0)',
      'mod(-1, infinity)',
    ])('produces NaN for the out-of-range function %s', (input) => {
      const value = MathValue.parse(input, 'number', { env: styleletEnv })!;

      expect(expression(value)!.calculation.type).toBe('number');
      expect(Number.isNaN(mathValueNumber(value))).toBe(true);
    });

    it('preserves the required signed zeros in stepped functions', () => {
      const rounded = MathValue.parse('round(to-zero, -1, 2)', 'number', { env: styleletEnv })!;
      const infiniteStep = MathValue.parse('round(-1, infinity)', 'number', { env: styleletEnv })!;
      const modulo = MathValue.parse('mod(-6, 3)', 'number', { env: styleletEnv })!;
      const remainder = MathValue.parse('rem(-6, 3)', 'number', { env: styleletEnv })!;

      expect(Object.is(mathValueNumber(rounded), -0)).toBe(true);
      expect(Object.is(mathValueNumber(infiniteStep), -0)).toBe(true);
      expect(Object.is(mathValueNumber(modulo), 0)).toBe(true);
      expect(Object.is(mathValueNumber(remainder), -0)).toBe(true);
    });
  });

  describe('math trigonometric functions', () => {
    it.each([
      ['sin(30deg)', 0.5],
      ['sin(.5)', Math.sin(0.5)],
      ['cos(.25turn)', 0],
      ['tan(50grad)', 1],
    ] as const)('simplifies the trigonometric function %s', (input, expected) => {
      const result = expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(result.value).toBeCloseTo(expected, 10);
    });

    it.each([
      ['asin(.5)', 30],
      ['acos(-1)', 180],
      ['atan(1)', 45],
      ['atan(infinity)', 90],
    ] as const)('simplifies the inverse function %s', (input, expected) => {
      const result = expression(MathValue.parse(input, 'angle', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'dimension') {
        throw new Error('Expected an angle');
      }

      expect(result.unit).toBe('deg');
      expect(result.value).toBeCloseTo(expected, 10);
    });

    it.each([
      ['atan2(1, -1)', 135],
      ['atan2(-1, 1)', -45],
      ['atan2(1in, 96px)', 45],
      ['atan2(1rem, 2rem)', 26.565051177],
    ] as const)('simplifies the two-argument function %s', (input, expected) => {
      const result = expression(MathValue.parse(input, 'angle', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'dimension') {
        throw new Error('Expected an angle');
      }

      expect(result.unit).toBe('deg');
      expect(result.value).toBeCloseTo(expected, 8);
    });

    it('retains atan2() until its operands can be compared', () => {
      expect(expression(MathValue.parse('atan2(1em, 1rem)', 'angle', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'atan2',
      });
      expect(expression(MathValue.parse('atan2(10%, 20%)', 'angle', {
        env: styleletEnv,
        percentHint: 'length',
      }))?.calculation).toMatchObject({ type: 'atan2' });
    });

    it('simplifies raw or resolved percentage coordinates', () => {
      const raw = expression(MathValue.parse('atan2(10%, 20%)', 'angle', {
        env: styleletEnv,
        percentHint: 'percent',
      }))?.calculation;
      const resolved = expression(MathValue.parse('atan2(10%, 20%)', 'angle', {
        env: styleletEnv,
        percentHint: 'length',
        percentageReferenceValue: new LengthLiteral(-100, 'px'),
      }))?.calculation;

      if (raw?.type !== 'dimension' || resolved?.type !== 'dimension') {
        throw new Error('Expected angles');
      }

      expect(raw.value).toBeCloseTo(26.565051177, 8);
      expect(resolved.value).toBeCloseTo(-153.434948823, 8);
    });

    it('uses JavaScript infinity, NaN, and signed-zero behavior', () => {
      const sine = expression(MathValue.parse('sin(calc(-1 * 0))', 'number', { env: styleletEnv }))?.calculation;
      const tangent = expression(MathValue.parse('tan(calc(-1 * 0))', 'number', { env: styleletEnv }))?.calculation;
      const invalidSine = expression(MathValue.parse('sin(infinity)', 'number', { env: styleletEnv }))?.calculation;
      const invalidAsin = expression(MathValue.parse('asin(2)', 'angle', { env: styleletEnv }))?.calculation;
      const negativePi = expression(MathValue.parse('atan2(calc(-1 * 0), -1)', 'angle', { env: styleletEnv }))?.calculation;
      const positivePi = expression(MathValue.parse('atan2(0, -1)', 'angle', { env: styleletEnv }))?.calculation;

      if (
        sine?.type !== 'number' ||
        tangent?.type !== 'number' ||
        invalidSine?.type !== 'number' ||
        invalidAsin?.type !== 'dimension' ||
        negativePi?.type !== 'dimension' ||
        positivePi?.type !== 'dimension'
      ) {
        throw new Error('Expected simplified trigonometric values');
      }

      expect(Object.is(sine.value, -0)).toBe(true);
      expect(Object.is(tangent.value, -0)).toBe(true);
      expect(Number.isNaN(invalidSine.value)).toBe(true);
      expect(Number.isNaN(invalidAsin.value)).toBe(true);
      expect(negativePi.value).toBe(-180);
      expect(positivePi.value).toBe(180);
    });
  });

  describe('math exponential functions', () => {
    it.each([
      ['pow(2, 3)', 8],
      ['pow(2, -3)', 0.125],
      ['sqrt(9)', 3],
      ['log(e)', 1],
      ['log(8, 2)', 3],
      ['exp(1)', Math.E],
    ] as const)('simplifies the exponential function %s', (input, expected) => {
      const result = expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(result.value).toBeCloseTo(expected, 10);
    });

    it.each([
      ['hypot(3px, 4px)', 5, 'px'],
      ['hypot(-2rem)', 2, 'rem'],
      ['hypot(3in, 384px)', 480, 'px'],
    ] as const)('simplifies the dimensional function %s', (
      input,
      expected,
      unit,
    ) => {
      expect(expression(MathValue.parse(input, 'length', { env: styleletEnv }))?.calculation).toEqual({
        type: 'dimension',
        value: expected,
        unit,
        hints: mathHints([['length', 1]]),
      });
    });

    it('retains hypot() until its operands can be compared', () => {
      expect(expression(MathValue.parse('hypot(3em, 4rem)', 'length', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'hypot',
      });
      expect(expression(MathValue.parse('hypot(3%, 4%)', 'percentage', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'hypot',
      });
      expect(expression(MathValue.parse('hypot(3%, 4%)', 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
      }))?.calculation).toMatchObject({ type: 'hypot' });
    });

    it('simplifies raw or resolved percentage components', () => {
      expect(expression(MathValue.parse('hypot(3%, 4%)', 'percentage', {
        env: styleletEnv,
        percentHint: 'percent',
      }))?.calculation).toEqual({
        type: 'percentage',
        value: 5,
        hints: mathHints([['percent', 1]], 'percent'),
      });
      expect(expression(MathValue.parse('hypot(3%, 4%)', 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
        percentageReferenceValue: new LengthLiteral(-100, 'px'),
      }))?.calculation).toEqual({
        type: 'dimension',
        value: 5,
        unit: 'px',
        hints: mathHints([['length', 1]], 'length'),
      });
    });

    it('makes NaN infectious in every exponential function', () => {
      const power = expression(MathValue.parse('pow(NaN, 0)', 'number', { env: styleletEnv }))?.calculation;
      const hypotenuse = expression(MathValue.parse('hypot(infinity, NaN)', 'number', { env: styleletEnv }))?.calculation;

      if (power?.type !== 'number' || hypotenuse?.type !== 'number') {
        throw new Error('Expected numbers');
      }

      expect(Number.isNaN(power.value)).toBe(true);
      expect(Number.isNaN(hypotenuse.value)).toBe(true);
    });

    it.each([
      'pow(-2, .5)',
      'sqrt(-1)',
      'log(-1)',
      'log(10, 0)',
      'log(10, -2)',
      'log(10, 1)',
    ])('produces NaN for the out-of-range function %s', (input) => {
      const result = expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(Number.isNaN(result.value)).toBe(true);
    });

    it.each([
      ['sqrt(calc(-1 * 0))', -0],
      ['pow(calc(-1 * 0), -3)', -Infinity],
      ['pow(0, -1)', Infinity],
      ['pow(-infinity, -3)', -0],
      ['log(0, .5)', -Infinity],
      ['log(1, .5)', 0],
      ['log(infinity, .5)', Infinity],
      ['exp(-infinity)', 0],
    ] as const)('handles the boundary function %s', (input, expected) => {
      const result = expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(Object.is(result.value, expected)).toBe(true);
    });
  });

  describe('math sign-related functions', () => {
    it.each([
      ['abs(-10px)', 'dimension', 10, 'px'],
      ['abs(5rem)', 'dimension', 5, 'rem'],
      ['sign(-10px)', 'number', -1, undefined],
      ['sign(10px)', 'number', 1, undefined],
    ] as const)('simplifies the sign-related function %s', (
      input,
      type,
      value,
      unit,
    ) => {
      const valueType = type === 'number' ? 'number' : 'length';

      expect(expression(MathValue.parse(input, valueType, { env: styleletEnv }))?.calculation).toEqual({
        type,
        value,
        ...(unit === undefined ? {} : { unit }),
        hints: type === 'number'
          ? mathHints()
          : mathHints([['length', 1]]),
      });
    });

    it('retains percentages whose numeric sign is unresolved', () => {
      expect(expression(MathValue.parse('abs(-10%)', 'percentage', { env: styleletEnv }))?.calculation).toMatchObject({ type: 'abs' });
      expect(expression(MathValue.parse('sign(10%)', 'number', {
        env: styleletEnv,
        percentHint: 'length',
      }))?.calculation).toMatchObject({ type: 'sign' });
    });

    it('simplifies raw or resolved percentages', () => {
      expect(expression(MathValue.parse('abs(-10%)', 'percentage', {
        env: styleletEnv,
        percentHint: 'percent',
      }))?.calculation).toEqual({
        type: 'percentage',
        value: 10,
        hints: mathHints([['percent', 1]], 'percent'),
      });
      expect(expression(MathValue.parse('sign(-10%)', 'number', {
        env: styleletEnv,
        percentHint: 'percent',
      }))?.calculation).toEqual({
        type: 'number',
        value: -1,
        hints: mathHints([], 'percent'),
      });
      expect(expression(MathValue.parse('abs(10%)', 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
        percentageReferenceValue: new LengthLiteral(-200, 'px'),
      }))?.calculation).toEqual({
        type: 'dimension',
        value: 20,
        unit: 'px',
        hints: mathHints([['length', 1]], 'length'),
      });
      expect(expression(MathValue.parse('sign(10%)', 'number', {
        env: styleletEnv,
        percentHint: 'length',
        percentageReferenceValue: new LengthLiteral(-200, 'px'),
      }))?.calculation).toEqual({
        type: 'number',
        value: -1,
        hints: mathHints([], 'length'),
      });
    });

    it.each([
      ['abs(calc(-1 * 0))', 0],
      ['sign(calc(-1 * 0))', -0],
      ['sign(0)', 0],
      ['abs(-infinity)', Infinity],
      ['sign(infinity)', 1],
      ['sign(-infinity)', -1],
    ] as const)('handles the boundary function %s', (input, expected) => {
      const result = expression(MathValue.parse(input, 'number', { env: styleletEnv }))?.calculation;

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(Object.is(result.value, expected)).toBe(true);
    });

    it('makes NaN infectious', () => {
      const absolute = expression(MathValue.parse('abs(NaN)', 'number', { env: styleletEnv }))?.calculation;
      const sign = expression(MathValue.parse('sign(NaN)', 'number', { env: styleletEnv }))?.calculation;

      if (absolute?.type !== 'number' || sign?.type !== 'number') {
        throw new Error('Expected numbers');
      }

      expect(Number.isNaN(absolute.value)).toBe(true);
      expect(Number.isNaN(sign.value)).toBe(true);
    });
  });

  describe('internal calculation IEEE-754 semantics', () => {
    it.each([
      ['0', 0],
      ['+0', 0],
      ['-0', 0],
      ['-5 * 0', -0],
      ['1 / -infinity', -0],
      ['(-5 * 0) + (-5 * 0)', -0],
      ['(-5 * 0) - 0', -0],
      ['0 + 0', 0],
      ['0 + (-5 * 0)', 0],
      ['(-5 * 0) + 0', 0],
      ['0 - 0', 0],
      ['0 - (-5 * 0)', 0],
      ['(-5 * 0) - (-5 * 0)', 0],
      ['(-5 * 0) * 0', -0],
      ['(-5 * 0) * 2', -0],
      ['(-5 * 0) * -2', 0],
      ['(-5 * 0) / 2', -0],
      ['(-5 * 0) / -2', 0],
      ['1 / 0', Infinity],
      ['-1 / 0', -Infinity],
      ['1 / (-5 * 0)', -Infinity],
      ['1 / infinity', 0],
      ['-1 / infinity', -0],
      ['-1 / -infinity', 0],
      ['infinity + 1', Infinity],
      ['1 + -infinity', -Infinity],
      ['1 - infinity', -Infinity],
      ['1 - -infinity', Infinity],
      ['-infinity - 1', -Infinity],
      ['1 * -infinity', -Infinity],
      ['-1 * infinity', -Infinity],
      ['-1 * -infinity', Infinity],
    ] as const)('evaluates %s as %s', (input, expected) => {
      const result = MathValue.parse(`calc(${input})`, 'number', { env: styleletEnv })!;

      expect(expression(result)!.calculation.type).toBe('number');
      expect(Object.is(mathValueNumber(result), expected)).toBe(true);
    });

    it.each([
      '0 / 0',
      '(-5 * 0) / 0',
      'infinity / infinity',
      '0 * infinity',
      'infinity + -infinity',
      'infinity - infinity',
      'NaN + 1',
      'NaN - 1',
      'NaN * 1',
      'NaN / 1',
    ])('evaluates %s as NaN', (input) => {
      const result = MathValue.parse(`calc(${input})`, 'number', { env: styleletEnv })!;

      expect(expression(result)!.calculation.type).toBe('number');
      expect(Number.isNaN(mathValueNumber(result))).toBe(true);
    });
  });

  describe('top-level calculation IEEE-754 censoring', () => {
    it('preserves special values at specified-value time', () => {
      const negativeZero = MathValue.parse('calc(-5 * 0)', 'number', { env: styleletEnv })!;
      const notANumber = MathValue.parse('calc(NaN)', 'number', { env: styleletEnv })!;
      const infinity = MathValue.parse('calc(infinity)', 'number', { env: styleletEnv })!;

      expect(Object.is(mathValueNumber(negativeZero), -0)).toBe(true);
      expect(Number.isNaN(mathValueNumber(notANumber))).toBe(true);
      expect(mathValueNumber(infinity)).toBe(Infinity);
    });

    it('censors a negative zero into an unsigned zero', () => {
      const result = (MathValue.parse('calc(-5 * 0)', 'number', { env: styleletEnv })!).resolve(ValueStage.Computed, { env: styleletEnv, unwrapMathAt: ValueStage.Actual }) as MathValue;

      expect(expression(result)!.calculation.type).toBe('number');
      expect(Object.is(mathValueNumber(result), 0)).toBe(true);
    });

    it.each([
      ['calc(NaN)', 'number', 'number'],
      ['calc(NaN * 1px)', 'length', 'dimension'],
      ['sqrt(-1)', 'number', 'number'],
    ] as const)(
      'censors a top-level NaN into a zero value in %s',
      (input, valueType, type) => {
        const result = expression((MathValue.parse(input, valueType, { env: styleletEnv })!).resolve(ValueStage.Computed, { env: styleletEnv, unwrapMathAt: ValueStage.Actual }))!.calculation;
        const value = 'value' in result
          ? result.value
          : undefined;

        expect(result.type).toBe(type);
        expect(value).toBe(0);
      },
    );

    it('retains signed zero inside a nested math function', () => {
      expect(expression(MathValue.parse('atan2(0, calc(-5 * 0))', 'angle', { env: styleletEnv }))?.calculation).toMatchObject({
        type: 'dimension',
        value: 180,
        unit: 'deg',
      });
    });

    it('retains an inner signed zero until the outer calculation uses it', () => {
      const specified = MathValue.parse('calc(1 / calc(-5 * 0))', 'number', { env: styleletEnv })!;
      const computed = (MathValue.parse('calc(1 / calc(-5 * 0))', 'number', { env: styleletEnv })!).resolve(ValueStage.Computed, {
        env: styleletEnv,
        range: [-100, 100],
        unwrapMathAt: ValueStage.Actual,
      });

      expect(mathValueNumber(specified)).toBe(-Infinity);
      expect(mathValueNumber(computed as MathValue)).toBe(-100);
    });

    it.each([
      ['calc(-infinity)', 0],
      ['calc(infinity)', 100],
      ['calc(-5)', 0],
      ['calc(105)', 100],
    ] as const)('clamps %s to the target-context range', (input, expected) => {
      const result = (MathValue.parse(input, 'number', { env: styleletEnv })!).resolve(ValueStage.Computed, {
        env: styleletEnv,
        range: [0, 100],
        unwrapMathAt: ValueStage.Actual,
      }) as MathValue;

      expect(mathValueNumber(result)).toBe(expected);
    });

    it('clamps conceptual infinities to the finite host range', () => {
      const result = (MathValue.parse('calc(infinity)', 'number', { env: styleletEnv })!).resolve(ValueStage.Used, { env: styleletEnv, unwrapMathAt: ValueStage.Actual }) as MathValue;

      expect(mathValueNumber(result)).toBe(Number.MAX_VALUE);
    });

    it.each([
      ['calc(1.5)', 2],
      ['calc(-1.5)', -1],
    ] as const)('rounds %s when an integer result is required', (
      input,
      expected,
    ) => {
      const result = (MathValue.parse(input, 'integer', { env: styleletEnv })!).resolve(ValueStage.Computed, { env: styleletEnv, unwrapMathAt: ValueStage.Actual }) as MathValue;

      expect(mathValueNumber(result)).toBe(expected);
    });

    it('does not clamp or round specified values', () => {
      const result = MathValue.parse('calc(105.5)', 'integer', {
        env: styleletEnv,
        range: [0, 100],
      })!;

      expect(mathValueNumber(result)).toBe(105.5);
    });
  });

  it('retains math functions as calculation-tree operator nodes', () => {
    const calculation = expression(MathValue.parse('calc(min(1em, 2rem) + max(3vw, 4vh))', 'length', { env: styleletEnv }))?.calculation;

    if (calculation?.type !== 'sum') {
      throw new Error('Expected a sum node');
    }

    expect(calculation.children.map((child) => child.type)).toEqual([
      'min',
      'max',
    ]);
  });

  it.each([
    [
      'calc(1vh + 2em + 3% + 4px)',
      'calc(3% + 2em + 4px + 1vh)',
    ],
    ['calc(1vh - 7px)', 'calc(-7px + 1vh)'],
    ['calc(min(1px, 2%))', 'min(1px, 2%)'],
    ['calc(1px - min(2px, 3%))', 'calc(1px - min(2px, 3%))'],
    ['calc(1px / min(2, 3))', 'calc(0.5px)'],
  ] as const)('serializes the specified calculation %s', (input, expected) => {
    const hasPercentage = input.includes('%');
    const context = hasPercentage
      ? { percentHint: 'length' } as const
      : {};

    const valueType = hasPercentage ? 'length-percentage' : 'length';

    expect((MathValue.parse(input, valueType, { env: styleletEnv, ...context })!).serialize())
      .toBe(expected);
  });

  it.each([
    [
      'round(up, calc(5px + 1%), 2px)',
      'round(up, 1% + 5px, 2px)',
    ],
    [
      'round(calc(5px + 1%), 2px)',
      'round(1% + 5px, 2px)',
    ],
    [
      'clamp(none, calc(1px + 1%), 20%)',
      'clamp(none, 1% + 1px, 20%)',
    ],
  ] as const)(
    'serializes the specified math function %s',
    (input, expected) => {
      const value = MathValue.parse(input, 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
      })!;

      expect(value.serialize()).toBe(expected);
    },
  );

  it.each([
    ['min(3, 1, 2)', 'calc(1)'],
    ['sqrt(-1)', 'calc(NaN)'],
  ] as const)(
    'wraps the simplified specified math function %s in calc()',
    (input, expected) => {
      expect((MathValue.parse(input, 'number', { env: styleletEnv })!).serialize())
        .toBe(expected);
    },
  );

  it.each([
    ['calc(20px + 30px)', 'length', { type: 'length', value: 50, unit: 'px' }],
    ['min(3, 1, 2)', 'number', { type: 'number', value: 1 }],
    ['sqrt(-1)', 'number', { type: 'number', value: 0 }],
  ] as const)(
    'resolves the computed math function %s to a literal',
    (input, valueType, expected) => {
      const value = MathValue.parse(input, valueType, { env: styleletEnv })!;

      expect(value.resolve(ValueStage.Computed, { env: styleletEnv }).repr).toEqual(expected);
    },
  );

  it.each([
    ['calc(infinity)', 'number', 'calc(infinity)'],
    ['calc(-infinity * 1em)', 'length', 'calc(-infinity * 1px)'],
    ['calc(NaN * 1s)', 'time', 'calc(NaN * 1s)'],
  ] as const)(
    'serializes the special numeric calculation %s',
    (input, valueType, expected) => {
      expect((MathValue.parse(input, valueType, { env: styleletEnv })!).serialize())
        .toBe(expected);
    },
  );

  it('canonicalizes a special numeric dimension while simplifying', () => {
    expect(expression(MathValue.parse('calc(-infinity * 1em)', 'length', { env: styleletEnv }))?.calculation).toEqual(numericLeaf(
      {
        type: 'dimension',
        value: -Infinity,
        unit: 'px',
      },
      mathHints([['length', 1]]),
    ));
  });

  it('adds math functions into a simplified calc function', () => {
    const result = (MathValue.parse('calc(10px)', 'length', { env: styleletEnv })!).add(MathValue.parse('min(20px, 30px)', 'length', { env: styleletEnv })!, { env: styleletEnv });

    expect(result.serialize()).toBe('calc(30px)');
  });

  it('accumulates math functions using addition', () => {
    const result = (MathValue.parse('calc(10px)', 'length', { env: styleletEnv })!).accumulate(MathValue.parse('min(20px, 30px)', 'length', { env: styleletEnv })!, { env: styleletEnv });

    expect(result.serialize()).toBe('calc(30px)');
  });

  it.each([
    [0, 'calc(0% + 10px)'],
    [0.25, 'calc(5% + 7.5px)'],
    [1, 'calc(20% + 0px)'],
  ] as const)(
    'interpolates math functions at p = %s',
    (p, expected) => {
      const context = {
        env: styleletEnv,
        percentHint: 'length',
      } as const satisfies MathContext;
      const result = (MathValue.parse('calc(10px)', 'length-percentage', context)!).interpolate(MathValue.parse('calc(20%)', 'length-percentage', context)!, p, context);

      expect(result.serialize()).toBe(expected);
    },
  );

  it('rejects combination of inconsistent math functions', () => {
    const length: MathValue = MathValue.parse('calc(1px)', 'length', { env: styleletEnv })!;
    const time = MathValue.parse('calc(1s)', 'time', { env: styleletEnv })!;

    expect(() => length.add(time, { env: styleletEnv }))
      .toThrow('Math value types must be consistent');
    expect(() => length.interpolate(time, 0.5, { env: styleletEnv }))
      .toThrow('Math value types must be consistent');
    expect(() => length.accumulate(time, { env: styleletEnv }))
      .toThrow('Math value types must be consistent');
  });

  it.each([
    'min()',
    'min(1px, 1s)',
    'clamp(1px, none, 2px)',
    'clamp(1px, 2px, 3s)',
    'round(1px)',
    'mod(1px, 1s)',
    'sin(1px)',
    'pow(1px, 2)',
    'log(1, 2, 3)',
    'abs(1, 2)',
  ])('rejects invalid math-function arguments in %s', (input) => {
    expectInvalidMath(input, undefined, { env: styleletEnv });
  });

  it.each([
    ['calc(1in + 96px)', 192, 'px', 'length'],
    ['calc(1turn + 180deg)', 540, 'deg', 'angle'],
    ['calc(1000ms + 1s)', 2, 's', 'time'],
    ['calc(1khz + 500hz)', 1500, 'hz', 'frequency'],
    ['calc(96dpi + 1dppx)', 2, 'dppx', 'resolution'],
  ] as const)(
    'combines compatible dimensions in their canonical unit for %s',
    (input, value, unit, category) => {
      expect(expression(MathValue.parse(input, category, { env: styleletEnv }))?.calculation).toEqual({
        type: 'dimension',
        value,
        unit,
        hints: mathHints([[category, 1]]),
      });
    },
  );

  it('simplifies again when later length context becomes available', () => {
    const parsed = MathValue.parse('calc(1em + 2px)', 'length', { env: styleletEnv })!;

    expect(expression(parsed)!.calculation.type).toBe('sum');
    expect(parsed.resolve(ValueStage.Declared, {
      env: styleletEnv,
      length: { em: 16 },
    })).toEqual({
      repr: {
        calculation: {
          type: 'dimension',
          value: 18,
          unit: 'px',
          hints: mathHints([['length', 1]]),
        }, promoted: false,
      }, valueType: 'length',
    });
  });

  it('types percentages in their supplied calculation context', () => {
    expectInvalidMath('calc(10px + 25%)', undefined, { env: styleletEnv });

    const context = {
      env: styleletEnv,
      percentHint: 'length',
    } as const satisfies MathContext;
    const parsed = MathValue.parse('calc(10px + 25%)', 'length-percentage', context);

    expect(parsed).toEqual({
      repr: {
        calculation: {
          type: 'sum',
          hints: mathHints([['length', 1]], 'length'),
          children: [
            numericLeaf(
              { type: 'percentage', value: 25 },
              mathHints([['length', 1]], 'length'),
            ),
            numericLeaf(
              { type: 'dimension', value: 10, unit: 'px' },
              mathHints([['length', 1]]),
            ),
          ],
        }, promoted: false,
      }, valueType: 'length-percentage',
    });

    expect(expression(MathValue.parse('calc(25%)', 'length-percentage', context))?.calculation)
      .toEqual({
        type: 'percentage',
        value: 25,
        hints: mathHints([['length', 1]], 'length'),
      });
    expect(expression(MathValue.parse('calc(10px)', 'length-percentage', context))?.calculation)
      .toEqual({
        type: 'dimension',
        value: 10,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
    expect(MathValue.parse('calc(calc(10px + 25%))', 'length-percentage', context)).toEqual(parsed);
  });

  it('inherits percentage typing through nested math functions', () => {
    const context = {
      env: styleletEnv,
      percentHint: 'length',
    } as const satisfies MathContext;

    expect(expression(MathValue.parse('calc(min(25%, 50px))', 'length-percentage', context))?.calculation.hints)
      .toEqual(mathHints([['length', 1]], 'length'));
  });

  it.each([
    ['calc(0px + 20%)', 20, 0, 'px'],
    ['calc(10px + 0%)', 0, 10, 'px'],
  ] as const)(
    'retains distinct zero terms in the mixed calculation %s',
    (input, percentage, dimension, unit) => {
      expect(expression(MathValue.parse(input, 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
      }))?.calculation).toEqual({
        type: 'sum',
        hints: mathHints([['length', 1]], 'length'),
        children: [
          numericLeaf(
            { type: 'percentage', value: percentage },
            mathHints([['length', 1]], 'length'),
          ),
          numericLeaf(
            { type: 'dimension', value: dimension, unit },
            mathHints([['length', 1]]),
          ),
        ],
      });
    },
  );

  it.each([
    ['calc(1)', 'number'],
    ['calc(1)', 'integer'],
    ['calc(25%)', 'percentage'],
    ['calc(1px)', 'length'],
    ['calc(1deg)', 'angle'],
    ['calc(1s)', 'time'],
    ['calc(1hz)', 'frequency'],
    ['calc(1dppx)', 'resolution'],
    ['calc(1fr)', 'flex'],
  ] as const)('matches %s against the expected %s type', (input, expectedType) => {
    expect(MathValue.parse(input, expectedType, { env: styleletEnv })).not.toBeNull();
  });

  it.each([
    ['calc(1s)', 'length'],
    ['calc(1px)', 'time'],
    ['calc(1)', 'percentage'],
    ['calc(25%)', 'number'],
  ] as const)(
    'rejects %s against the expected %s type',
    (input, expectedType) => {
      expectNoMath(input, expectedType, { env: styleletEnv });
    },
  );

  it('matches the expected type of another outer math function', () => {
    expect(expression(MathValue.parse('min(1px, 2px)', 'length', { env: styleletEnv }))?.calculation).not.toBeNull();
    expectNoMath('min(1px, 2px)', 'time', { env: styleletEnv });
  });

  it.each([
    ['length-percentage', 'length', 'calc(10px + 25%)'],
    ['angle-percentage', 'angle', 'calc(10deg + 25%)'],
    ['time-percentage', 'time', 'calc(10s + 25%)'],
    ['frequency-percentage', 'frequency', 'calc(10hz + 25%)'],
  ] as const)(
    'matches the mixed %s production',
    (expectedType, percentHint, input) => {
      expect(MathValue.parse(input, expectedType, {
        env: styleletEnv,
        percentHint,
      })).not.toBeNull();
    },
  );

  it('preserves a percent hint after percentage dimensions cancel', () => {
    expect(MathValue.parse('calc(1% / 1%)', 'number', {
      env: styleletEnv,
      percentHint: 'percent',
    })).toEqual({
      repr: {
        calculation: numericLeaf(
          { type: 'number', value: 1 },
          mathHints([], 'percent'),
        ), promoted: false,
      }, valueType: 'number',
    });

    const input = 'calc(1% / 1% * 10px)';
    expectNoMath(input, 'length', { env: styleletEnv });
    expect(MathValue.parse(input, 'length-percentage', {
      env: styleletEnv,
      percentHint: 'length',
    })).not.toBeNull();
  });

  it('preserves a percent hint through a nested calc function', () => {
    expectNoMath('calc(calc(1% / 1%) * 10px)', 'length', { env: styleletEnv });
  });

  it('preserves a percent hint through deeply nested calculations', () => {
    expectNoMath('calc(calc(calc(calc(1% / 1%))) * 10px)', 'length', { env: styleletEnv });
  });

  it.each([
    ['contained-type', 'calc(abs(1% / 1%) * 10px)'],
    ['consistent-type', 'calc(min(1% / 1%, 2% / 2%) * 10px)'],
    ['fixed-result', 'calc(sign(1% / 1%) * 10px)'],
  ] as const)(
    'preserves a percent hint through a nested %s math function',
    (_type, input) => {
      expectNoMath(input, 'length', { env: styleletEnv });
      expect(MathValue.parse(input, 'length-percentage', {
        env: styleletEnv,
        percentHint: 'length',
      })).not.toBeNull();
    },
  );

  it('makes a fixed angle result consistent with its percentage inputs', () => {
    expect(expression(MathValue.parse('calc(atan2(1%, 2%))', 'angle', {
      env: styleletEnv,
      percentHint: 'percent',
    }))?.calculation.hints).toEqual(
      mathHints([['angle', 1]], 'percent'),
    );
  });

  it('resolves percentages against an available dimension reference', () => {
    expect(MathValue.parse('calc(10px + 25%)', 'length-percentage', {
      env: styleletEnv,
      percentHint: 'length',
      percentageReferenceValue: new LengthLiteral(200, 'px'),
    })).toEqual({
      repr: {
        calculation: numericLeaf(
          { type: 'dimension', value: 60, unit: 'px' },
          mathHints([['length', 1]], 'length'),
        ), promoted: false,
      }, valueType: 'length-percentage',
    });
  });

  it('combines unresolved dimensions using ASCII-insensitive units', () => {
    expect(expression(MathValue.parse('calc(1EM + 2em)', 'length', { env: styleletEnv }))?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'em',
      hints: mathHints([['length', 1]]),
    });
  });

  it('stores sum and product children in calculation serialization order', () => {
    expect(expression(MathValue.parse('calc(1vh + 2em + 3% + 4px)', 'length-percentage', {
      env: styleletEnv,
      percentHint: 'length',
    }))?.calculation).toEqual({
      type: 'sum',
      hints: mathHints([['length', 1]], 'length'),
      children: [
        numericLeaf(
          { type: 'percentage', value: 3 },
          mathHints([['length', 1]], 'length'),
        ),
        numericLeaf(
          { type: 'dimension', value: 2, unit: 'em' },
          mathHints([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 4, unit: 'px' },
          mathHints([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 1, unit: 'vh' },
          mathHints([['length', 1]]),
        ),
      ],
    });

    expect(expression(MathValue.parse('calc(min(1em, 2rem) * 2)', 'length', { env: styleletEnv }))?.calculation)
      .toMatchObject({
        type: 'product',
        children: [
          { type: 'number', value: 2 },
          { type: 'min' },
        ],
      });
  });

  it('distributes a number over a sum of numeric values', () => {
    expect(expression(MathValue.parse('calc(2 * (1px + 2em))', 'length', { env: styleletEnv }))?.calculation).toEqual({
      type: 'sum',
      hints: mathHints([['length', 1]]),
      children: [
        numericLeaf(
          { type: 'dimension', value: 4, unit: 'em' },
          mathHints([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 2, unit: 'px' },
          mathHints([['length', 1]]),
        ),
      ],
    });
  });

  it('retains zero-valued terms with a distinct unit', () => {
    expect(expression(MathValue.parse('calc(0px + 1em)', 'length', { env: styleletEnv }))?.calculation).toEqual({
      type: 'sum',
      hints: mathHints([['length', 1]]),
      children: [
        numericLeaf(
          { type: 'dimension', value: 1, unit: 'em' },
          mathHints([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 0, unit: 'px' },
          mathHints([['length', 1]]),
        ),
      ],
    });
  });

  it('negates positive zero using CSS addition semantics', () => {
    const resolved = (MathValue.parse('calc(0 - 0)', 'number', { env: styleletEnv })!).resolve(ValueStage.Computed, { env: styleletEnv });

    if (!(resolved.repr instanceof NumberLiteral)) {
      throw new Error('Expected a number');
    }

    expect(Object.is(resolved.repr.value, 0)).toBe(true);
  });

  it('cancels canonical units in a numeric product', () => {
    expect(expression(MathValue.parse('calc(1in / 96px)', 'number', { env: styleletEnv }))?.calculation).toEqual({
      type: 'number',
      value: 1,
      hints: mathHints(),
    });
  });

  it('unwraps nested calc functions as equivalent grouping', () => {
    expect(MathValue.parse('calc(calc(1 + 2))', 'number', { env: styleletEnv })).toEqual(
      MathValue.parse('calc((1 + 2))', 'number', { env: styleletEnv }),
    );
  });

  it('defers final type validation for nested calc functions', () => {
    expect(MathValue.parse('calc(calc(1px / 1s) * 1s)', 'length', { env: styleletEnv })).toEqual(
      MathValue.parse('calc((1px / 1s) * 1s)', 'length', { env: styleletEnv }),
    );
  });

  it.each([
    ['e', Math.E],
    ['PI', Math.PI],
    ['InFiNiTy', Infinity],
    ['-INFINITY', -Infinity],
    ['NaN', NaN],
  ] as const)('resolves the calc keyword %j at parse time', (keyword, value) => {
    const parsed = MathValue.parse(`calc(${keyword})`, 'number', { env: styleletEnv });

    expect(expression(parsed)?.calculation.type).toBe('number');
    expect(Object.is(mathValueNumber(parsed!), value)).toBe(true);
  });

  it.each([
    ['1px', 'length', mathHints([['length', 1]])],
    ['1deg', 'angle', mathHints([['angle', 1]])],
    ['1s', 'time', mathHints([['time', 1]])],
    ['1Hz', 'frequency', mathHints([['frequency', 1]])],
    ['1dppx', 'resolution', mathHints([['resolution', 1]])],
    ['1fr', 'flex', mathHints([['flex', 1]])],
  ] as const)('classifies the dimensional terminal %s', (
    input,
    valueType,
    expected,
  ) => {
    expect(expression(MathValue.parse(`calc(${input})`, valueType, { env: styleletEnv }))?.calculation.hints)
      .toEqual(expected);
  });

  it('reduces a compound intermediate type to its final length', () => {
    expect(expression(MathValue.parse('calc((1px / 1s) * 1s)', 'length', { env: styleletEnv }))?.calculation).toEqual({
      type: 'dimension',
      value: 1,
      unit: 'px',
      hints: mathHints([['length', 1]]),
    });
  });

  it('reduces a squared intermediate type to its final length', () => {
    expect(expression(MathValue.parse('calc((1px * 1em) / 1px)', 'length', { env: styleletEnv }))?.calculation).toEqual({
      type: 'dimension',
      value: 1,
      unit: 'em',
      hints: mathHints([['length', 1]]),
    });
  });

  it('represents a dimensionless quotient with an empty exponent map', () => {
    const parsed = MathValue.parse('calc(1px / 1px)', 'number', { env: styleletEnv });

    expect(expression(parsed)?.calculation.hints).toEqual(mathHints());
  });

  describe('calculation type-checking examples', () => {
    it.each([
      ['calc(5px + 1em)', 'length', {}],
      [
        'calc(100% / 3)',
        'percentage',
        { percentHint: 'percent' },
      ],
      ['calc(1.5)', 'integer', {}],
    ] as const)(
      'accepts the valid calculation %j',
      (input, valueType, context) => {
        expect(MathValue.parse(input, valueType, { env: styleletEnv, ...context })).not.toBeNull();
      },
    );

    it.each([
      'calc(.25 + 25%)',
      'calc(0 + 5px)',
      'calc(1 + 5px)',
      'calc(1px + 1s)',
      'calc(5px - 5px + 10s)',
      'calc(0 * 5px + 10s)',
      'calc(1px / 1s)',
      'calc(1px * 1em)',
      'calc(1unknown)',
    ])('rejects the invalid calculation %j', (input) => {
      expectInvalidMath(input, undefined, { env: styleletEnv });
    });
  });

  it('passes unresolved numeric variables through nested calculations', () => {
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([['h', {
        value: undefined,
        valueType: 'number',
      }]]),
    };
    const parsed = MathValue.parse('calc(calc(h + 180))', 'number', context);
    const sum = expression(parsed)?.calculation;

    if (sum?.type !== 'sum') {
      throw new Error('Expected a sum node');
    }

    expect(sum.children).toEqual([
      numericLeaf(
        { type: 'number', value: 180 },
        mathHints(),
      ),
      {
        type: 'variable',
        name: 'h',
        hints: mathHints(),
      },
    ]);
    expect(sum.hints).toEqual(mathHints());
  });

  it('retains an unresolved numeric variable in a product', () => {
    const value = MathValue.parse('calc(c * 0.9)', 'number', {
      env: styleletEnv,
      numericVariables: new Map([['c', {
        value: undefined,
        valueType: 'number',
      }]]),
    });

    expect(value).toEqual({
      repr: {
        calculation: {
          type: 'product',
          children: [
            numericLeaf(
              { type: 'number', value: 0.9 },
              mathHints(),
            ),
            {
              type: 'variable',
              name: 'c',
              hints: mathHints(),
            },
          ],
          hints: mathHints(),
        }, promoted: false,
      }, valueType: 'number',
    });
    expect((value!).serialize()).toBe('calc(0.9 * c)');
  });

  it('simplifies an available numeric variable', () => {
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([['h', {
        value: new NumberLiteral(177),
        valueType: 'number',
      }]]),
    };
    expect(expression(MathValue.parse('calc(h + 180)', 'number', context))?.calculation).toEqual({
      type: 'number',
      value: 357,
      hints: mathHints(),
    });
  });

  it('calculates with a missing numeric variable as zero', () => {
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([['x', {
        value: 'none',
        valueType: 'number',
      }]]),
    };
    const value = MathValue.parse('calc(x + 1)', 'number', context)!;

    expect(value.resolve(ValueStage.Computed, {
      ...context,
    }).repr).toEqual({
      type: 'number',
      value: 1,
    });
  });

  it('types an unresolved dimensional numeric variable', () => {
    const lengthHints = mathHints([['length', 1]]);
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([['x', {
        value: undefined,
        valueType: 'length',
      }]]),
    };
    const sum = expression(MathValue.parse('calc(x + 1px)', 'length', context))?.calculation;

    if (sum?.type !== 'sum') {
      throw new Error('Expected a sum node');
    }

    expect(sum.children).toEqual([
      numericLeaf(
        { type: 'dimension', value: 1, unit: 'px' },
        lengthHints,
      ),
      {
        type: 'variable',
        name: 'x',
        hints: lengthHints,
      },
    ]);
    expect(sum.hints).toEqual(lengthHints);
  });

  it('simplifies an available dimensional variable', () => {
    const lengthHints = mathHints([['length', 1]]);
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([['x', {
        value: new DimensionLiteral(2, 'px'),
        valueType: 'length',
      }]]),
    };
    expect(expression(MathValue.parse('calc(x + 1px)', 'length', context))?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'px',
      hints: lengthHints,
    });
  });

  it('resolves a dimensional variable supplied after parsing', () => {
    const context: MathContext = {
      env: styleletEnv,
      numericVariables: new Map([['distance', { value: undefined, valueType: 'length' }]]),
    };
    const value = MathValue.parse('calc(distance + 1px)', 'length', context)!;
    context.numericVariables = new Map([['distance', { value: new LengthLiteral(2, 'em'), valueType: 'length' }]]);
    context.length = { em: 16 };

    const result = value.resolve(ValueStage.Computed, context).repr;
    expect(result).toBeInstanceOf(LengthLiteral);
    if (result instanceof MathExpression) throw new Error('Expected a resolved literal');
    expect(result.serialize()).toBe('33px');
  });

  it('rejects a numeric variable value that does not match its type', () => {
    expect(() => MathValue.parse('calc(x)', 'length', {
      env: styleletEnv,
      numericVariables: new Map([['x', {
        value: new NumberLiteral(2),
        valueType: 'length',
      }]]),
    })).toThrow('Numeric variable value does not match its value type');
  });

  it('rejects a numeric variable outside its defining context', () => {
    expectInvalidMath('calc(h + 180)', undefined, { env: styleletEnv });
  });

  it.each([
    'calc(1 + 2)',
    'calc(1\n+\t2)',
    'calc(1 /* before */ + /* after */ 2)',
  ])('accepts required whitespace around an additive operator in %j', (input) => {
    expect(MathValue.parse(input, 'number', { env: styleletEnv })).not.toBeNull();
  });

  it.each([
    'calc(1+2)',
    'calc(1 +2)',
    'calc(1+ 2)',
    'calc(1/**/+ 2)',
    'calc(1 +/**/2)',
  ])('rejects an additive operator without required whitespace in %j', (input) => {
    expectInvalidMath(input, undefined, { env: styleletEnv });
  });

  it.each([
    'calc(2*3)',
    'calc(2 *3)',
    'calc(2* 3)',
    'calc(2 * 3)',
  ])('allows optional whitespace around a multiplicative operator in %j', (input) => {
    expect(MathValue.parse(input, 'number', { env: styleletEnv })).not.toBeNull();
  });

  it.each([
    'calc()',
    'calc(1 +)',
    'calc(* 1)',
    'calc(1 2)',
    'calc(())',
  ])('commits after recognizing the malformed calculation %j', (input) => {
    expectInvalidMath(input, undefined, { env: styleletEnv });
  });

  it('supports at least 32 calculation terms', () => {
    const input = Array.from({ length: 32 }, (_, index) => index + 1).join(' + ');

    expect(expression(MathValue.parse(`calc(${input})`, 'number', { env: styleletEnv }))?.calculation).toEqual({
      type: 'number',
      value: 528,
      hints: mathHints(),
    });
  });

  it('supports at least 32 nested calculation levels', () => {
    const input = `${'('.repeat(32)}1${')'.repeat(32)}`;

    expect(expression(MathValue.parse(`calc(${input})`, 'number', { env: styleletEnv }))?.calculation).toEqual({
      type: 'number',
      value: 1,
      hints: mathHints(),
    });
  });

  it('bounds aggregate calculation complexity', () => {
    const input = `${'('.repeat(64)}1${')'.repeat(64)}`;

    expectInvalidMath(`calc(${input})`, undefined, { env: styleletEnv });
  });

  it('does not advance after rejecting aggregate calculation complexity', () => {
    const input = `${'('.repeat(64)}1${')'.repeat(64)}`;
    const cursor = new TokenCursor(
      parseListOfComponentValues(`calc(${input}) trailing`, {}), { env: styleletEnv },
    );
    const consume = MathValue.createConsumer({ expectedType: 'number' });

    expect(consume(cursor)).toBeNull();
    expect(cursor.pos()).toBe(0);
  });

  it('keeps parser bookkeeping out of the supplied context', () => {
    const context = { env: styleletEnv };

    expect(MathValue.parse('calc(1)', 'number', context)).not.toBeNull();
    expect(context).toEqual({ env: styleletEnv });
  });
});

type ExpectedMathHints = {
  exponents: [base: MathBase, power: number][];
  percentHint: MathBase | null;
};

function mathHints(
  exponents: ExpectedMathHints['exponents'] = [],
  percentHint: MathBase | null = null,
): ExpectedMathHints {
  return {
    exponents,
    percentHint,
  };
}

function numericLeaf<
  Value extends {
    type: 'number' | 'dimension' | 'percentage';
    value: number;
  },
>(
  value: Value,
  hints: ExpectedMathHints,
): Value & { hints: ExpectedMathHints; } {
  return { ...value, hints: hints };
}

function expectInvalidMath(
  input: string,
  expectedType: MathValueType = 'number',
  context: MathContext = { env: styleletEnv },
): void {
  expect(MathValue.parse(input, expectedType, context)).toBeNull();
}

function expectNoMath(
  input: string,
  expectedType: MathValueType,
  context: MathContext = { env: styleletEnv },
): void {
  expect(MathValue.parse(input, expectedType, context)).toBeNull();
}

function mathValueNumber(value: MathValue | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const { calculation } = expression(value)!;

  return 'value' in calculation && typeof calculation.value === 'number'
    ? calculation.value
    : undefined;
}

function expression(value: MathValue | null | undefined): MathExpression | undefined {
  if (value === null || value === undefined) return undefined;
  if (!(value.repr instanceof MathExpression)) throw new Error('Expected an unresolved math expression');
  return value.repr;
}
