import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/syntax/component-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  accumulateMathValues, addMathValues, coercePercentageMathToNumber,
  createMathValueConsumer, interpolateMathValues, parseMathValue, promoteNumericVariable,
  resolveMathValue, serializeMathValue,
  type MathContext, type MathValueType, type MathValue, type MathBase,
} from '../../../../src/stylelet/values/math-value';

describe('calc', () => {
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
      expect(parseMathValue(input, expectedType)).toEqual({
        type: 'math',
        calculation: numericLeaf(expected, type),
        valueType: expectedType,
        promoted: false,
      });
    },
  );

  it.each([
    ['calc(1 + 2)', 'number', { type: 'number', value: 3 }],
    ['calc(25%)', 'percentage', { type: 'percentage', value: 25 }],
    ['calc(1px)', 'length', { type: 'length', value: 1, unit: 'px' }],
  ] as const)('resolves and unwraps the math value %j', (input, valueType, expected) => {
    const value = parseMathValue(input, valueType);

    expect(value).not.toBeNull();
    if (value === null) {
      throw new Error('Expected a math value');
    }

    expect(resolveMathValue(value, ValueStage.Declared)).toEqual(value);
    expect(resolveMathValue(value, ValueStage.Computed)).toEqual(expected);
    expect(resolveMathValue(value, ValueStage.Declared, { unwrapMathAt: ValueStage.Declared })).toEqual(expected);
  });

  it('coerces percentage math into number math', () => {
    const context = { percentHint: 'percent' } as const;
    const percentage = parseMathValue('calc(2 * 60%)', 'percentage', context)!;
    const number = coercePercentageMathToNumber(
      percentage,
      1 / 100,
      1,
    );

    expect(serializeMathValue(number)).toBe('calc(1.2)');
    expect(resolveMathValue(number, ValueStage.Computed)).toEqual({
      type: 'number',
      value: 1.2,
    });
  });

  it('preserves unresolved math while dividing its percentage dimension', () => {
    const context: MathContext = {
      percentHint: 'percent',
      numericVariables: new Map([['p', {
        value: undefined,
        valueType: 'percentage',
      }]]),
    };
    const percentage = parseMathValue('calc(p)', 'percentage', context)!;
    const number = coercePercentageMathToNumber(
      percentage,
      1 / 100,
      1,
    );

    expect(serializeMathValue(number)).toBe('calc(p / 100%)');
    expect(number.valueType).toBe('number');
  });

  it('promotes a numeric variable into a bare math value', () => {
    const value = promoteNumericVariable('X', 'number', {
      numericVariables: new Map([['x', {
        value: undefined,
        valueType: 'number',
      }]]),
    });

    expect(value).toMatchObject({
      type: 'math',
      calculation: {
        type: 'variable',
        name: 'x',
      },
      valueType: 'number',
      promoted: true,
    });
    expect(serializeMathValue(value)).toBe('x');
  });

  it('preserves promotion while resolving the same math value', () => {
    const value = {
      ...parseMathValue('calc(1em + 2px)', 'length')!,
      promoted: true,
    };

    const resolved = resolveMathValue(value, ValueStage.Declared, {
      length: { em: 16 },
    });

    expect(resolved).toMatchObject({
      type: 'math',
      promoted: true,
    });
    if (resolved.type !== 'math') {
      throw new Error('Expected a math value');
    }
    expect(serializeMathValue(resolved)).toBe('calc(18px)');
  });

  it('does not promote a newly combined math value', () => {
    const value = {
      ...parseMathValue('calc(10px)', 'length')!,
      promoted: true,
    };

    expect(addMathValues(
      value,
      parseMathValue('calc(20px)', 'length')!,
    )).toMatchObject({
      type: 'math',
      promoted: false,
    });
  });

  it('rejects a resolved literal that violates its value type', () => {
    const value: MathValue<'number'> = {
      type: 'math',
      calculation: numericLeaf(
        { type: 'percentage', value: 25 },
        mathHints([['percent', 1]], 'percent'),
      ),
      valueType: 'number',
      promoted: false,
    };

    expect(() => resolveMathValue(value, ValueStage.Computed))
      .toThrow('Resolved math value does not match its value type');
  });

  it('respects operator precedence while simplifying', () => {
    expect(parseMathValue(
      'calc(1px + 2 * 3px - 4px / 2)',
      'length',
    )).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'dimension', value: 5, unit: 'px' },
        mathHints([['length', 1]]),
      ),
      valueType: 'length',
      promoted: false,
    });
  });

  it('uses parenthesized calculations for grouping while simplifying', () => {
    expect(parseMathValue('calc((1 + 2) * 3)', 'number')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'number', value: 9 },
        mathHints(),
      ),
      valueType: 'number',
      promoted: false,
    });
  });

  it.each([
    ['min(1em, 2rem)', 'min', 2, mathHints([['length', 1]])],
    ['max(1vw, 2vh)', 'max', 2, mathHints([['length', 1]])],
    ['clamp(1em, 2rem, 3em)', 'clamp', 3, mathHints([['length', 1]])],
  ] as const)(
    'parses the math function %s',
    (input, type, expectedArgumentCount, expectedType) => {
      const parsed = parseMathValue(input, 'length')?.calculation ?? null;

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
    expect(parseMathValue('calc(1 + 2)', 'number')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'number', value: 3 },
        mathHints(),
      ),
      valueType: 'number',
      promoted: false,
    });
    expect(parseMathValue('min(1em, 2rem)', 'length')).toMatchObject({
      type: 'math',
      calculation: {
        type: 'min',
        arguments: [
          { type: 'dimension', value: 1, unit: 'em' },
          { type: 'dimension', value: 2, unit: 'rem' },
        ],
      },
      valueType: 'length',
      promoted: false,
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
      expect(parseMathValue(input, valueType)?.calculation).toMatchObject({
        value: expected,
      });
    });

    it('partially simplifies comparable min() and max() arguments', () => {
      expect(parseMathValue(
        'min(2em, 1em, 3rem)',
        'length',
      )?.calculation).toMatchObject({
        type: 'min',
        arguments: [
          { type: 'dimension', value: 1, unit: 'em' },
          { type: 'dimension', value: 3, unit: 'rem' },
        ],
      });
      expect(parseMathValue(
        'max(2vw, 1vh, 3vw)',
        'length',
      )?.calculation).toMatchObject({
        type: 'max',
        arguments: [
          { type: 'dimension', value: 3, unit: 'vw' },
          { type: 'dimension', value: 1, unit: 'vh' },
        ],
      });
      expect(parseMathValue(
        'min(4rem, 2px, 3rem, 1px)',
        'length',
      )?.calculation)
        .toMatchObject({
          type: 'min',
          arguments: [
            { type: 'dimension', value: 3, unit: 'rem' },
            { type: 'dimension', value: 1, unit: 'px' },
          ],
        });
    });

    it('retains percentage comparisons without sufficient context', () => {
      expect(parseMathValue(
        'min(10%, 20%)',
        'percentage',
      )?.calculation).toMatchObject({
        type: 'min',
      });
      expect(parseMathValue(
        'clamp(10%, 20%, 30%)',
        'percentage',
      )?.calculation).toMatchObject({
        type: 'clamp',
      });
      expect(parseMathValue('min(10%, 20%)', 'length-percentage', {
        percentHint: 'length',
      })?.calculation).toMatchObject({
        type: 'min',
        arguments: [
          { type: 'percentage', value: 10 },
          { type: 'percentage', value: 20 },
        ],
      });
      expect(parseMathValue('clamp(10%, 20%, 30%)', 'length-percentage', {
        percentHint: 'length',
      })?.calculation).toMatchObject({ type: 'clamp' });
    });

    it('compares raw or resolved percentages', () => {
      expect(parseMathValue('min(10%, 20%)', 'percentage', {
        percentHint: 'percent',
      })?.calculation).toEqual({
        type: 'percentage',
        value: 10,
        hints: mathHints([['percent', 1]], 'percent'),
      });
      expect(parseMathValue('max(10%, 20%)', 'length-percentage', {
        percentHint: 'length',
        percentageReferenceValue: {
          type: 'length',
          value: 200,
          unit: 'px',
        },
      })?.calculation).toEqual({
        type: 'dimension',
        value: 40,
        unit: 'px',
        hints: mathHints([['length', 1]], 'length'),
      });
    });

    it('unwraps a boundless clamp without comparing its percentage', () => {
      expect(parseMathValue(
        'clamp(none, 20%, none)',
        'percentage',
      )?.calculation).toEqual({
        type: 'percentage',
        value: 20,
        hints: mathHints([['percent', 1]], 'percent'),
      });
    });

    it('orders negative zero below positive zero', () => {
      const minimum = parseMathValue(
        'min(0, calc(-1 * 0))',
        'number',
      )!.calculation;
      const maximum = parseMathValue(
        'max(0, calc(-1 * 0))',
        'number',
      )!.calculation;
      const clamped = parseMathValue(
        'clamp(0, calc(-1 * 0), 1)',
        'number',
      )!.calculation;

      expect('value' in minimum && Object.is(minimum.value, -0)).toBe(true);
      expect('value' in maximum && Object.is(maximum.value, 0)).toBe(true);
      expect('value' in clamped && Object.is(clamped.value, 0)).toBe(true);
    });

    it('retains clamp() when unresolved units cannot be compared', () => {
      expect(parseMathValue(
        'clamp(1em, 2rem, 3em)',
        'length',
      )?.calculation).toMatchObject({
        type: 'clamp',
        minimum: { type: 'dimension', value: 1, unit: 'em' },
        value: { type: 'dimension', value: 2, unit: 'rem' },
        maximum: { type: 'dimension', value: 3, unit: 'em' },
      });
      expect(parseMathValue(
        'clamp(none, 2rem, 3em)',
        'length',
      )?.calculation)
        .toMatchObject({
          type: 'clamp',
          minimum: undefined,
          value: { type: 'dimension', value: 2, unit: 'rem' },
          maximum: { type: 'dimension', value: 3, unit: 'em' },
        });
      expect(parseMathValue(
        'clamp(1em, 2rem, none)',
        'length',
      )?.calculation)
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
      expect(parseMathValue('round(1)', 'number')?.calculation).toEqual({
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
      expect(parseMathValue(input, 'number')?.calculation).toEqual({
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
      expect(parseMathValue(input, 'number')?.calculation).toEqual({
        type: 'number',
        value: expected,
        hints: mathHints(),
      });
    });

    it('simplifies stepped dimensions with canonical or identical units', () => {
      expect(parseMathValue(
        'round(down, 1.3in, 10px)',
        'length',
      )?.calculation).toEqual({
        type: 'dimension',
        value: 120,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
      expect(parseMathValue(
        'mod(25rem, 10rem)',
        'length',
      )?.calculation).toEqual({
        type: 'dimension',
        value: 5,
        unit: 'rem',
        hints: mathHints([['length', 1]]),
      });
    });

    it('retains stepped functions whose unresolved units differ', () => {
      expect(parseMathValue(
        'round(10rem, 1em)',
        'length',
      )?.calculation).toMatchObject({
        type: 'round',
        strategy: 'nearest',
        value: { type: 'dimension', value: 10, unit: 'rem' },
        step: { type: 'dimension', value: 1, unit: 'em' },
      });
    });

    it('snaps the line-width rounding strategy with device context', () => {
      expect(parseMathValue('round(line-width, .25px)', 'length', {
        devicePixelRatio: 2,
      })?.calculation).toEqual({
        type: 'dimension',
        value: 0.5,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
    });

    it('chooses the nonzero multiple for line-width rounding', () => {
      expect(parseMathValue(
        'round(line-width, 1px, calc(infinity * 1px))',
        'length',
        { devicePixelRatio: 2 },
      )?.calculation).toEqual({
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
      const value = parseMathValue(input, 'number')!;

      expect(value.calculation.type).toBe('number');
      expect(Number.isNaN(mathValueNumber(value))).toBe(true);
    });

    it('preserves the required signed zeros in stepped functions', () => {
      const rounded = parseMathValue(
        'round(to-zero, -1, 2)',
        'number',
      )!;
      const infiniteStep = parseMathValue(
        'round(-1, infinity)',
        'number',
      )!;
      const modulo = parseMathValue('mod(-6, 3)', 'number')!;
      const remainder = parseMathValue('rem(-6, 3)', 'number')!;

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
      const result = parseMathValue(input, 'number')?.calculation;

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
      const result = parseMathValue(input, 'angle')?.calculation;

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
      const result = parseMathValue(input, 'angle')?.calculation;

      if (result?.type !== 'dimension') {
        throw new Error('Expected an angle');
      }

      expect(result.unit).toBe('deg');
      expect(result.value).toBeCloseTo(expected, 8);
    });

    it('retains atan2() until its operands can be compared', () => {
      expect(parseMathValue(
        'atan2(1em, 1rem)',
        'angle',
      )?.calculation).toMatchObject({
        type: 'atan2',
      });
      expect(parseMathValue('atan2(10%, 20%)', 'angle', {
        percentHint: 'length',
      })?.calculation).toMatchObject({ type: 'atan2' });
    });

    it('simplifies raw or resolved percentage coordinates', () => {
      const raw = parseMathValue('atan2(10%, 20%)', 'angle', {
        percentHint: 'percent',
      })?.calculation;
      const resolved = parseMathValue('atan2(10%, 20%)', 'angle', {
        percentHint: 'length',
        percentageReferenceValue: {
          type: 'length',
          value: -100,
          unit: 'px',
        },
      })?.calculation;

      if (raw?.type !== 'dimension' || resolved?.type !== 'dimension') {
        throw new Error('Expected angles');
      }

      expect(raw.value).toBeCloseTo(26.565051177, 8);
      expect(resolved.value).toBeCloseTo(-153.434948823, 8);
    });

    it('uses JavaScript infinity, NaN, and signed-zero behavior', () => {
      const sine = parseMathValue(
        'sin(calc(-1 * 0))',
        'number',
      )?.calculation;
      const tangent = parseMathValue(
        'tan(calc(-1 * 0))',
        'number',
      )?.calculation;
      const invalidSine = parseMathValue(
        'sin(infinity)',
        'number',
      )?.calculation;
      const invalidAsin = parseMathValue('asin(2)', 'angle')?.calculation;
      const negativePi = parseMathValue(
        'atan2(calc(-1 * 0), -1)',
        'angle',
      )?.calculation;
      const positivePi = parseMathValue(
        'atan2(0, -1)',
        'angle',
      )?.calculation;

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
      const result = parseMathValue(input, 'number')?.calculation;

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
      expect(parseMathValue(input, 'length')?.calculation).toEqual({
        type: 'dimension',
        value: expected,
        unit,
        hints: mathHints([['length', 1]]),
      });
    });

    it('retains hypot() until its operands can be compared', () => {
      expect(parseMathValue(
        'hypot(3em, 4rem)',
        'length',
      )?.calculation).toMatchObject({
        type: 'hypot',
      });
      expect(parseMathValue(
        'hypot(3%, 4%)',
        'percentage',
      )?.calculation).toMatchObject({
        type: 'hypot',
      });
      expect(parseMathValue('hypot(3%, 4%)', 'length-percentage', {
        percentHint: 'length',
      })?.calculation).toMatchObject({ type: 'hypot' });
    });

    it('simplifies raw or resolved percentage components', () => {
      expect(parseMathValue('hypot(3%, 4%)', 'percentage', {
        percentHint: 'percent',
      })?.calculation).toEqual({
        type: 'percentage',
        value: 5,
        hints: mathHints([['percent', 1]], 'percent'),
      });
      expect(parseMathValue('hypot(3%, 4%)', 'length-percentage', {
        percentHint: 'length',
        percentageReferenceValue: {
          type: 'length',
          value: -100,
          unit: 'px',
        },
      })?.calculation).toEqual({
        type: 'dimension',
        value: 5,
        unit: 'px',
        hints: mathHints([['length', 1]], 'length'),
      });
    });

    it('makes NaN infectious in every exponential function', () => {
      const power = parseMathValue('pow(NaN, 0)', 'number')?.calculation;
      const hypotenuse = parseMathValue(
        'hypot(infinity, NaN)',
        'number',
      )?.calculation;

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
      const result = parseMathValue(input, 'number')?.calculation;

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
      const result = parseMathValue(input, 'number')?.calculation;

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

      expect(parseMathValue(input, valueType)?.calculation).toEqual({
        type,
        value,
        ...(unit === undefined ? {} : { unit }),
        hints: type === 'number'
          ? mathHints()
          : mathHints([['length', 1]]),
      });
    });

    it('retains percentages whose numeric sign is unresolved', () => {
      expect(parseMathValue(
        'abs(-10%)',
        'percentage',
      )?.calculation).toMatchObject({ type: 'abs' });
      expect(parseMathValue('sign(10%)', 'number', {
        percentHint: 'length',
      })?.calculation).toMatchObject({ type: 'sign' });
    });

    it('simplifies raw or resolved percentages', () => {
      expect(parseMathValue('abs(-10%)', 'percentage', {
        percentHint: 'percent',
      })?.calculation).toEqual({
        type: 'percentage',
        value: 10,
        hints: mathHints([['percent', 1]], 'percent'),
      });
      expect(parseMathValue('sign(-10%)', 'number', {
        percentHint: 'percent',
      })?.calculation).toEqual({
        type: 'number',
        value: -1,
        hints: mathHints([], 'percent'),
      });
      expect(parseMathValue('abs(10%)', 'length-percentage', {
        percentHint: 'length',
        percentageReferenceValue: {
          type: 'length',
          value: -200,
          unit: 'px',
        },
      })?.calculation).toEqual({
        type: 'dimension',
        value: 20,
        unit: 'px',
        hints: mathHints([['length', 1]], 'length'),
      });
      expect(parseMathValue('sign(10%)', 'number', {
        percentHint: 'length',
        percentageReferenceValue: {
          type: 'length',
          value: -200,
          unit: 'px',
        },
      })?.calculation).toEqual({
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
      const result = parseMathValue(input, 'number')?.calculation;

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(Object.is(result.value, expected)).toBe(true);
    });

    it('makes NaN infectious', () => {
      const absolute = parseMathValue('abs(NaN)', 'number')?.calculation;
      const sign = parseMathValue('sign(NaN)', 'number')?.calculation;

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
      const result = parseMathValue(
        `calc(${input})`,
        'number',
      )!;

      expect(result.calculation.type).toBe('number');
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
      const result = parseMathValue(
        `calc(${input})`,
        'number',
      )!;

      expect(result.calculation.type).toBe('number');
      expect(Number.isNaN(mathValueNumber(result))).toBe(true);
    });
  });

  describe('top-level calculation IEEE-754 censoring', () => {
    it('preserves special values at specified-value time', () => {
      const negativeZero = parseMathValue(
        'calc(-5 * 0)',
        'number',
      )!;
      const notANumber = parseMathValue('calc(NaN)', 'number')!;
      const infinity = parseMathValue('calc(infinity)', 'number')!;

      expect(Object.is(mathValueNumber(negativeZero), -0)).toBe(true);
      expect(Number.isNaN(mathValueNumber(notANumber))).toBe(true);
      expect(mathValueNumber(infinity)).toBe(Infinity);
    });

    it('censors a negative zero into an unsigned zero', () => {
      const result = resolveMathValue(
        parseMathValue('calc(-5 * 0)', 'number')!,
        ValueStage.Computed,
        { unwrapMathAt: ValueStage.Actual },
      ) as MathValue;

      expect(result.calculation.type).toBe('number');
      expect(Object.is(mathValueNumber(result), 0)).toBe(true);
    });

    it.each([
      ['calc(NaN)', 'number', 'number'],
      ['calc(NaN * 1px)', 'length', 'dimension'],
      ['sqrt(-1)', 'number', 'number'],
    ] as const)(
      'censors a top-level NaN into a zero value in %s',
      (input, valueType, type) => {
        const result = (resolveMathValue(
          parseMathValue(input, valueType)!,
          ValueStage.Computed,
          { unwrapMathAt: ValueStage.Actual },
        ) as MathValue).calculation;
        const value = 'value' in result
          ? result.value
          : undefined;

        expect(result.type).toBe(type);
        expect(value).toBe(0);
      },
    );

    it('retains signed zero inside a nested math function', () => {
      expect(parseMathValue(
        'atan2(0, calc(-5 * 0))',
        'angle',
      )?.calculation).toMatchObject({
        type: 'dimension',
        value: 180,
        unit: 'deg',
      });
    });

    it('retains an inner signed zero until the outer calculation uses it', () => {
      const specified = parseMathValue(
        'calc(1 / calc(-5 * 0))',
        'number',
      )!;
      const computed = resolveMathValue(
        parseMathValue(
          'calc(1 / calc(-5 * 0))',
          'number',
        )!,
        ValueStage.Computed,
        {
          range: [-100, 100],
          unwrapMathAt: ValueStage.Actual,
        },
      );

      expect(mathValueNumber(specified)).toBe(-Infinity);
      expect(mathValueNumber(computed as MathValue)).toBe(-100);
    });

    it.each([
      ['calc(-infinity)', 0],
      ['calc(infinity)', 100],
      ['calc(-5)', 0],
      ['calc(105)', 100],
    ] as const)('clamps %s to the target-context range', (input, expected) => {
      const result = resolveMathValue(
        parseMathValue(input, 'number')!,
        ValueStage.Computed,
        {
          range: [0, 100],
          unwrapMathAt: ValueStage.Actual,
        },
      ) as MathValue;

      expect(mathValueNumber(result)).toBe(expected);
    });

    it('clamps conceptual infinities to the finite host range', () => {
      const result = resolveMathValue(
        parseMathValue('calc(infinity)', 'number')!,
        ValueStage.Used,
        { unwrapMathAt: ValueStage.Actual },
      ) as MathValue;

      expect(mathValueNumber(result)).toBe(Number.MAX_VALUE);
    });

    it.each([
      ['calc(1.5)', 2],
      ['calc(-1.5)', -1],
    ] as const)('rounds %s when an integer result is required', (
      input,
      expected,
    ) => {
      const result = resolveMathValue(
        parseMathValue(input, 'integer')!,
        ValueStage.Computed,
        { unwrapMathAt: ValueStage.Actual },
      ) as MathValue;

      expect(mathValueNumber(result)).toBe(expected);
    });

    it('does not clamp or round specified values', () => {
      const result = parseMathValue('calc(105.5)', 'integer', {
        range: [0, 100],
      })!;

      expect(mathValueNumber(result)).toBe(105.5);
    });
  });

  it('retains math functions as calculation-tree operator nodes', () => {
    const calculation = parseMathValue(
      'calc(min(1em, 2rem) + max(3vw, 4vh))',
      'length',
    )?.calculation;

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

    expect(serializeMathValue(parseMathValue(input, valueType, context)!))
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
      const value = parseMathValue(input, 'length-percentage', {
        percentHint: 'length',
      })!;

      expect(serializeMathValue(value)).toBe(expected);
    },
  );

  it.each([
    ['min(3, 1, 2)', 'calc(1)'],
    ['sqrt(-1)', 'calc(NaN)'],
  ] as const)(
    'wraps the simplified specified math function %s in calc()',
    (input, expected) => {
      expect(serializeMathValue(parseMathValue(input, 'number')!))
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
      const value = parseMathValue(input, valueType)!;

      expect(resolveMathValue(value, ValueStage.Computed)).toEqual(expected);
    },
  );

  it.each([
    ['calc(infinity)', 'number', 'calc(infinity)'],
    ['calc(-infinity * 1em)', 'length', 'calc(-infinity * 1px)'],
    ['calc(NaN * 1s)', 'time', 'calc(NaN * 1s)'],
  ] as const)(
    'serializes the special numeric calculation %s',
    (input, valueType, expected) => {
      expect(serializeMathValue(parseMathValue(input, valueType)!))
        .toBe(expected);
    },
  );

  it('canonicalizes a special numeric dimension while simplifying', () => {
    expect(parseMathValue(
      'calc(-infinity * 1em)',
      'length',
    )?.calculation).toEqual(numericLeaf(
      {
        type: 'dimension',
        value: -Infinity,
        unit: 'px',
      },
      mathHints([['length', 1]]),
    ));
  });

  it('adds math functions into a simplified calc function', () => {
    const result = addMathValues(
      parseMathValue('calc(10px)', 'length')!,
      parseMathValue('min(20px, 30px)', 'length')!,
    );

    expect(serializeMathValue(result)).toBe('calc(30px)');
  });

  it('accumulates math functions using addition', () => {
    const result = accumulateMathValues(
      parseMathValue('calc(10px)', 'length')!,
      parseMathValue('min(20px, 30px)', 'length')!,
    );

    expect(serializeMathValue(result)).toBe('calc(30px)');
  });

  it.each([
    [0, 'calc(0% + 10px)'],
    [0.25, 'calc(5% + 7.5px)'],
    [1, 'calc(20% + 0px)'],
  ] as const)(
    'interpolates math functions at p = %s',
    (p, expected) => {
      const context = {
        percentHint: 'length',
      } as const satisfies MathContext;
      const result = interpolateMathValues(
        parseMathValue('calc(10px)', 'length-percentage', context)!,
        parseMathValue('calc(20%)', 'length-percentage', context)!,
        p,
        context,
      );

      expect(serializeMathValue(result)).toBe(expected);
    },
  );

  it('rejects combination of inconsistent math functions', () => {
    const length = parseMathValue('calc(1px)', 'length')!;
    const time = parseMathValue('calc(1s)', 'time')!;

    expect(() => addMathValues(length, time))
      .toThrow('Math value types must be consistent');
    expect(() => interpolateMathValues(length, time, 0.5))
      .toThrow('Math value types must be consistent');
    expect(() => accumulateMathValues(length, time))
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
    expectInvalidMath(input);
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
      expect(parseMathValue(input, category)?.calculation).toEqual({
        type: 'dimension',
        value,
        unit,
        hints: mathHints([[category, 1]]),
      });
    },
  );

  it('simplifies again when later length context becomes available', () => {
    const parsed = parseMathValue('calc(1em + 2px)', 'length')!;

    expect(parsed.calculation.type).toBe('sum');
    expect(resolveMathValue(parsed, ValueStage.Declared, {
      length: { em: 16 },
    })).toEqual({
      type: 'math',
      calculation: {
        type: 'dimension',
        value: 18,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      },
      valueType: 'length',
      promoted: false,
    });
  });

  it('types percentages in their supplied calculation context', () => {
    expectInvalidMath('calc(10px + 25%)');

    const context = {
      percentHint: 'length',
    } as const satisfies MathContext;
    const parsed = parseMathValue(
      'calc(10px + 25%)',
      'length-percentage',
      context,
    );

    expect(parsed).toEqual({
      type: 'math',
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
      },
      valueType: 'length-percentage',
      promoted: false,
    });

    expect(parseMathValue(
      'calc(25%)',
      'length-percentage',
      context,
    )?.calculation)
      .toEqual({
        type: 'percentage',
        value: 25,
        hints: mathHints([['length', 1]], 'length'),
      });
    expect(parseMathValue(
      'calc(10px)',
      'length-percentage',
      context,
    )?.calculation)
      .toEqual({
        type: 'dimension',
        value: 10,
        unit: 'px',
        hints: mathHints([['length', 1]]),
      });
    expect(parseMathValue(
      'calc(calc(10px + 25%))',
      'length-percentage',
      context,
    )).toEqual(parsed);
  });

  it('inherits percentage typing through nested math functions', () => {
    const context = {
      percentHint: 'length',
    } as const satisfies MathContext;

    expect(parseMathValue(
      'calc(min(25%, 50px))',
      'length-percentage',
      context,
    )
      ?.calculation.hints)
      .toEqual(mathHints([['length', 1]], 'length'));
  });

  it.each([
    ['calc(0px + 20%)', 20, 0, 'px'],
    ['calc(10px + 0%)', 0, 10, 'px'],
  ] as const)(
    'retains distinct zero terms in the mixed calculation %s',
    (input, percentage, dimension, unit) => {
      expect(parseMathValue(input, 'length-percentage', {
        percentHint: 'length',
      })?.calculation).toEqual({
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
    expect(parseMathValue(input, expectedType)).not.toBeNull();
  });

  it.each([
    ['calc(1s)', 'length'],
    ['calc(1px)', 'time'],
    ['calc(1)', 'percentage'],
    ['calc(25%)', 'number'],
  ] as const)(
    'rejects %s against the expected %s type',
    (input, expectedType) => {
      expectNoMath(input, expectedType);
    },
  );

  it('matches the expected type of another outer math function', () => {
    expect(parseMathValue(
      'min(1px, 2px)',
      'length',
    )?.calculation).not.toBeNull();
    expectNoMath('min(1px, 2px)', 'time');
  });

  it.each([
    ['length-percentage', 'length', 'calc(10px + 25%)'],
    ['angle-percentage', 'angle', 'calc(10deg + 25%)'],
    ['time-percentage', 'time', 'calc(10s + 25%)'],
    ['frequency-percentage', 'frequency', 'calc(10hz + 25%)'],
  ] as const)(
    'matches the mixed %s production',
    (expectedType, percentHint, input) => {
      expect(parseMathValue(input, expectedType, {
        percentHint,
      })).not.toBeNull();
    },
  );

  it('preserves a percent hint after percentage dimensions cancel', () => {
    expect(parseMathValue('calc(1% / 1%)', 'number', {
      percentHint: 'percent',
    })).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'number', value: 1 },
        mathHints([], 'percent'),
      ),
      valueType: 'number',
      promoted: false,
    });

    const input = 'calc(1% / 1% * 10px)';
    expectNoMath(input, 'length');
    expect(parseMathValue(input, 'length-percentage', {
      percentHint: 'length',
    })).not.toBeNull();
  });

  it('preserves a percent hint through a nested calc function', () => {
    expectNoMath('calc(calc(1% / 1%) * 10px)', 'length');
  });

  it('preserves a percent hint through deeply nested calculations', () => {
    expectNoMath('calc(calc(calc(calc(1% / 1%))) * 10px)', 'length');
  });

  it.each([
    ['contained-type', 'calc(abs(1% / 1%) * 10px)'],
    ['consistent-type', 'calc(min(1% / 1%, 2% / 2%) * 10px)'],
    ['fixed-result', 'calc(sign(1% / 1%) * 10px)'],
  ] as const)(
    'preserves a percent hint through a nested %s math function',
    (_type, input) => {
      expectNoMath(input, 'length');
      expect(parseMathValue(input, 'length-percentage', {
        percentHint: 'length',
      })).not.toBeNull();
    },
  );

  it('makes a fixed angle result consistent with its percentage inputs', () => {
    expect(parseMathValue('calc(atan2(1%, 2%))', 'angle', {
      percentHint: 'percent',
    })?.calculation.hints).toEqual(
      mathHints([['angle', 1]], 'percent'),
    );
  });

  it('resolves percentages against an available dimension reference', () => {
    expect(parseMathValue('calc(10px + 25%)', 'length-percentage', {
      percentHint: 'length',
      percentageReferenceValue: {
        type: 'length',
        value: 200,
        unit: 'px',
      },
    })).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'dimension', value: 60, unit: 'px' },
        mathHints([['length', 1]], 'length'),
      ),
      valueType: 'length-percentage',
      promoted: false,
    });
  });

  it('combines unresolved dimensions using ASCII-insensitive units', () => {
    expect(parseMathValue('calc(1EM + 2em)', 'length')?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'em',
      hints: mathHints([['length', 1]]),
    });
  });

  it('stores sum and product children in calculation serialization order', () => {
    expect(parseMathValue('calc(1vh + 2em + 3% + 4px)', 'length-percentage', {
      percentHint: 'length',
    })?.calculation).toEqual({
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

    expect(parseMathValue(
      'calc(min(1em, 2rem) * 2)',
      'length',
    )?.calculation)
      .toMatchObject({
        type: 'product',
        children: [
          { type: 'number', value: 2 },
          { type: 'min' },
        ],
      });
  });

  it('distributes a number over a sum of numeric values', () => {
    expect(parseMathValue(
      'calc(2 * (1px + 2em))',
      'length',
    )?.calculation).toEqual({
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
    expect(parseMathValue(
      'calc(0px + 1em)',
      'length',
    )?.calculation).toEqual({
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
    const resolved = resolveMathValue(
      parseMathValue('calc(0 - 0)', 'number')!,
      ValueStage.Computed,
    );

    if (resolved.type !== 'number') {
      throw new Error('Expected a number');
    }

    expect(Object.is(resolved.value, 0)).toBe(true);
  });

  it('cancels canonical units in a numeric product', () => {
    expect(parseMathValue(
      'calc(1in / 96px)',
      'number',
    )?.calculation).toEqual({
      type: 'number',
      value: 1,
      hints: mathHints(),
    });
  });

  it('unwraps nested calc functions as equivalent grouping', () => {
    expect(parseMathValue('calc(calc(1 + 2))', 'number')).toEqual(
      parseMathValue('calc((1 + 2))', 'number'),
    );
  });

  it('defers final type validation for nested calc functions', () => {
    expect(parseMathValue(
      'calc(calc(1px / 1s) * 1s)',
      'length',
    )).toEqual(
      parseMathValue('calc((1px / 1s) * 1s)', 'length'),
    );
  });

  it.each([
    ['e', Math.E],
    ['PI', Math.PI],
    ['InFiNiTy', Infinity],
    ['-INFINITY', -Infinity],
    ['NaN', NaN],
  ] as const)('resolves the calc keyword %j at parse time', (keyword, value) => {
    const parsed = parseMathValue(`calc(${keyword})`, 'number');

    expect(parsed?.calculation.type).toBe('number');
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
    expect(parseMathValue(`calc(${input})`, valueType)?.calculation.hints)
      .toEqual(expected);
  });

  it('reduces a compound intermediate type to its final length', () => {
    expect(parseMathValue(
      'calc((1px / 1s) * 1s)',
      'length',
    )?.calculation).toEqual({
      type: 'dimension',
      value: 1,
      unit: 'px',
      hints: mathHints([['length', 1]]),
    });
  });

  it('reduces a squared intermediate type to its final length', () => {
    expect(parseMathValue(
      'calc((1px * 1em) / 1px)',
      'length',
    )?.calculation).toEqual({
      type: 'dimension',
      value: 1,
      unit: 'em',
      hints: mathHints([['length', 1]]),
    });
  });

  it('represents a dimensionless quotient with an empty exponent map', () => {
    const parsed = parseMathValue('calc(1px / 1px)', 'number');

    expect(parsed?.calculation.hints).toEqual(mathHints());
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
        expect(parseMathValue(input, valueType, context)).not.toBeNull();
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
      expectInvalidMath(input);
    });
  });

  it('passes unresolved numeric variables through nested calculations', () => {
    const context: MathContext = {
      numericVariables: new Map([['h', {
        value: undefined,
        valueType: 'number',
      }]]),
    };
    const parsed = parseMathValue('calc(calc(h + 180))', 'number', context);
    const sum = parsed?.calculation;

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
    const value = parseMathValue('calc(c * 0.9)', 'number', {
      numericVariables: new Map([['c', {
        value: undefined,
        valueType: 'number',
      }]]),
    });

    expect(value).toEqual({
      type: 'math',
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
      },
      valueType: 'number',
      promoted: false,
    });
    expect(serializeMathValue(value!)).toBe('calc(0.9 * c)');
  });

  it('simplifies an available numeric variable', () => {
    const context: MathContext = {
      numericVariables: new Map([['h', {
        value: { type: 'number', value: 177 },
        valueType: 'number',
      }]]),
    };
    expect(parseMathValue(
      'calc(h + 180)',
      'number',
      context,
    )?.calculation).toEqual({
      type: 'number',
      value: 357,
      hints: mathHints(),
    });
  });

  it('calculates with a missing numeric variable as zero', () => {
    const context: MathContext = {
      numericVariables: new Map([['x', {
        value: 'none',
        valueType: 'number',
      }]]),
    };
    const value = parseMathValue('calc(x + 1)', 'number', context)!;

    expect(resolveMathValue(value, ValueStage.Computed, {
      ...context,
    })).toEqual({
      type: 'number',
      value: 1,
    });
  });

  it('types an unresolved dimensional numeric variable', () => {
    const lengthHints = mathHints([['length', 1]]);
    const context: MathContext = {
      numericVariables: new Map([['x', {
        value: undefined,
        valueType: 'length',
      }]]),
    };
    const sum = parseMathValue('calc(x + 1px)', 'length', context)?.calculation;

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
      numericVariables: new Map([['x', {
        value: { type: 'dimension', value: 2, unit: 'px' },
        valueType: 'length',
      }]]),
    };
    expect(parseMathValue(
      'calc(x + 1px)',
      'length',
      context,
    )?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'px',
      hints: lengthHints,
    });
  });

  it('rejects a numeric variable value that does not match its type', () => {
    expect(() => parseMathValue('calc(x)', 'length', {
      numericVariables: new Map([['x', {
        value: { type: 'number', value: 2 },
        valueType: 'length',
      }]]),
    })).toThrow('Numeric variable value does not match its value type');
  });

  it('rejects a numeric variable outside its defining context', () => {
    expectInvalidMath('calc(h + 180)');
  });

  it.each([
    'calc(1 + 2)',
    'calc(1\n+\t2)',
    'calc(1 /* before */ + /* after */ 2)',
  ])('accepts required whitespace around an additive operator in %j', (input) => {
    expect(parseMathValue(input, 'number')).not.toBeNull();
  });

  it.each([
    'calc(1+2)',
    'calc(1 +2)',
    'calc(1+ 2)',
    'calc(1/**/+ 2)',
    'calc(1 +/**/2)',
  ])('rejects an additive operator without required whitespace in %j', (input) => {
    expectInvalidMath(input);
  });

  it.each([
    'calc(2*3)',
    'calc(2 *3)',
    'calc(2* 3)',
    'calc(2 * 3)',
  ])('allows optional whitespace around a multiplicative operator in %j', (input) => {
    expect(parseMathValue(input, 'number')).not.toBeNull();
  });

  it.each([
    'calc()',
    'calc(1 +)',
    'calc(* 1)',
    'calc(1 2)',
    'calc(())',
  ])('commits after recognizing the malformed calculation %j', (input) => {
    expectInvalidMath(input);
  });

  it('supports at least 32 calculation terms', () => {
    const input = Array.from({ length: 32 }, (_, index) => index + 1).join(' + ');

    expect(parseMathValue(`calc(${input})`, 'number')?.calculation).toEqual({
      type: 'number',
      value: 528,
      hints: mathHints(),
    });
  });

  it('supports at least 32 nested calculation levels', () => {
    const input = `${'('.repeat(32)}1${')'.repeat(32)}`;

    expect(parseMathValue(`calc(${input})`, 'number')?.calculation).toEqual({
      type: 'number',
      value: 1,
      hints: mathHints(),
    });
  });

  it('bounds aggregate calculation complexity', () => {
    const input = `${'('.repeat(64)}1${')'.repeat(64)}`;

    expectInvalidMath(`calc(${input})`);
  });

  it('does not advance after rejecting aggregate calculation complexity', () => {
    const input = `${'('.repeat(64)}1${')'.repeat(64)}`;
    const cursor = new ComponentCursor(
      parseListOfComponentValues(`calc(${input}) trailing`),
    );
    const consume = createMathValueConsumer({ expectedType: 'number' });

    expect(consume(cursor)).toBeNull();
    expect(cursor.pos()).toBe(0);
  });

  it('keeps parser bookkeeping out of the supplied context', () => {
    const context = {};

    expect(parseMathValue('calc(1)', 'number', context)).not.toBeNull();
    expect(context).toEqual({});
  });
});

type ExpectedMathHints = {
  exponents: readonly (readonly [base: MathBase, power: number])[];
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
  context: MathContext = {},
): void {
  expect(parseMathValue(input, expectedType, context)).toBeNull();
}

function expectNoMath(
  input: string,
  expectedType: MathValueType,
  context: MathContext = {},
): void {
  expect(parseMathValue(input, expectedType, context)).toBeNull();
}

function mathValueNumber(value: MathValue | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const { calculation } = value;

  return 'value' in calculation && typeof calculation.value === 'number'
    ? calculation.value
    : undefined;
}
