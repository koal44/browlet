import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import { isOk } from '../../../../src/stylelet/parser/component-try-consumer';
import { parseListOfComponentValues } from '../../../../src/stylelet/parser/syntax';
import {
  accumulateMathFunctions, addMathFunctions, interpolateMathFunctions,
  parseCalc as parseCalcWithContext,
  parseMathFunction as parseMathFunctionWithContext,
  parseMathValue as parseMathValueWithContext,
  resolveMathValue, simplifyCalculationTree,
  serializeCalcTree, serializeMathFunction, serializeMathValue,
  tryConsumeCalc, tryConsumeCalcSum, tryConsumeMathFunction,
  type CalculationContext, type CalculationTree, type CalcProductNode, type CalcSumNode,
  type ExpectedCalculationType, type MathValue,
  type NumericBaseType, type NumericExponent, type NumericType,
} from '../../../../src/stylelet/values/calc';

describe('calc', () => {
  it.each([
    ['calc(1)', { type: 'number', value: 1 }, numericType(), 'number'],
    [
      'calc(1px)',
      { type: 'dimension', value: 1, unit: 'px' },
      numericType([['length', 1]]),
      'length',
    ],
    [
      'calc(25%)',
      { type: 'percentage', value: 25 },
      numericType([['percent', 1]], 'percent'),
      'percentage',
    ],
  ] as const)(
    'parses the terminal calculation %j',
    (input, expected, type, expectedType) => {
      expect(parseCalc(input)).toEqual({
        type: 'math',
        calculation: numericLeaf(expected, type),
        restrictions: { expectedType },
      });
    },
  );

  it.each([
    ['calc(1 + 2)', { type: 'number', value: 3 }],
    ['calc(25%)', { type: 'percentage', value: 25 }],
    ['calc(1px)', { type: 'length', value: 1, unit: 'px' }],
  ] as const)('resolves and unwraps the math value %j', (input, expected) => {
    const value = parseCalc(input);

    expect(value).not.toBeNull();
    if (value === null) {
      throw new Error('Expected a math value');
    }

    expect(resolveMathValue(value)).toEqual(value);
    expect(resolveMathValue(value, { stage: 'computed' })).toEqual(expected);
    expect(resolveMathValue(value, { unwrapMathAt: 'declared' })).toEqual(expected);
  });

  it('rejects a resolved literal that violates its expected type', () => {
    const value: MathValue<'number'> = {
      type: 'math',
      calculation: numericLeaf(
        { type: 'percentage', value: 25 },
        numericType([['percent', 1]], 'percent'),
      ),
      restrictions: { expectedType: 'number' },
    };

    expect(() => resolveMathValue(value, { stage: 'computed' }))
      .toThrow('Resolved math value does not match its expected calculation type');
  });

  it('respects operator precedence while simplifying', () => {
    expect(parseCalc('calc(1px + 2 * 3px - 4px / 2)')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'dimension', value: 5, unit: 'px' },
        numericType([['length', 1]]),
      ),
      restrictions: { expectedType: 'length' },
    });
  });

  it('uses parenthesized calculations for grouping while simplifying', () => {
    expect(parseCalc('calc((1 + 2) * 3)')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'number', value: 9 },
        numericType(),
      ),
      restrictions: { expectedType: 'number' },
    });
  });

  it.each([
    ['min(1em, 2rem)', 'min', 2, numericType([['length', 1]])],
    ['max(1vw, 2vh)', 'max', 2, numericType([['length', 1]])],
    ['clamp(1em, 2rem, 3em)', 'clamp', 3, numericType([['length', 1]])],
  ] as const)(
    'parses the math function %s',
    (input, type, expectedArgumentCount, expectedType) => {
      const parsed = parseMathFunctionCalculation(input);

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
        parsed.numericType,
      ).toEqual(expectedType);
    },
  );

  it('wraps every math function in the same public value shape', () => {
    expect(parseMathFunction('calc(1 + 2)')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'number', value: 3 },
        numericType(),
      ),
      restrictions: { expectedType: 'number' },
    });
    expect(parseMathValue('min(1em, 2rem)')).toMatchObject({
      type: 'math',
      calculation: {
        type: 'min',
        arguments: [
          { type: 'dimension', value: 1, unit: 'em' },
          { type: 'dimension', value: 2, unit: 'rem' },
        ],
      },
      restrictions: { expectedType: 'length' },
    });
  });

  describe('math comparison functions', () => {
    it.each([
      ['min(3, 1, 2)', 1],
      ['max(3px, 1px, 2px)', 3],
      ['min(1in, 100px)', 96],
      ['clamp(0px, 20px, 10px)', 10],
      ['clamp(100px, 0px, 50px)', 100],
      ['clamp(none, 20px, 10px)', 10],
      ['clamp(10px, 5px, none)', 10],
      ['clamp(none, 5px, none)', 5],
    ] as const)('simplifies the comparison function %s', (input, expected) => {
      expect(parseMathFunctionCalculation(input)).toMatchObject({
        value: expected,
      });
    });

    it('partially simplifies comparable min() and max() arguments', () => {
      expect(parseMathFunctionCalculation('min(2em, 1em, 3rem)')).toMatchObject({
        type: 'min',
        arguments: [
          { type: 'dimension', value: 1, unit: 'em' },
          { type: 'dimension', value: 3, unit: 'rem' },
        ],
      });
      expect(parseMathFunctionCalculation('max(2vw, 1vh, 3vw)')).toMatchObject({
        type: 'max',
        arguments: [
          { type: 'dimension', value: 3, unit: 'vw' },
          { type: 'dimension', value: 1, unit: 'vh' },
        ],
      });
      expect(parseMathFunctionCalculation('min(4rem, 2px, 3rem, 1px)'))
        .toMatchObject({
          type: 'min',
          arguments: [
            { type: 'dimension', value: 3, unit: 'rem' },
            { type: 'dimension', value: 1, unit: 'px' },
          ],
        });
    });

    it('retains percentage comparisons without sufficient context', () => {
      expect(parseMathFunctionCalculation('min(10%, 20%)')).toMatchObject({
        type: 'min',
      });
      expect(parseMathFunctionCalculation('clamp(10%, 20%, 30%)')).toMatchObject({
        type: 'clamp',
      });
      expect(parseMathFunctionCalculation('min(10%, 20%)', {
        percentageType: 'length',
      })).toMatchObject({
        type: 'min',
        arguments: [
          { type: 'percentage', value: 10 },
          { type: 'percentage', value: 20 },
        ],
      });
      expect(parseMathFunctionCalculation('clamp(10%, 20%, 30%)', {
        percentageType: 'length',
      })).toMatchObject({ type: 'clamp' });
    });

    it('compares raw or resolved percentages', () => {
      expect(parseMathFunctionCalculation('min(10%, 20%)', {
        percentageType: 'percent',
      })).toEqual({
        type: 'percentage',
        value: 10,
        numericType: numericType([['percent', 1]], 'percent'),
      });
      expect(parseMathFunctionCalculation('max(10%, 20%)', {
        percentageType: 'length',
        percentageReferenceValue: {
          type: 'dimension',
          value: 200,
          unit: 'px',
        },
      })).toEqual({
        type: 'dimension',
        value: 40,
        unit: 'px',
        numericType: numericType([['length', 1]], 'length'),
      });
    });

    it('unwraps a boundless clamp without comparing its percentage', () => {
      expect(parseMathFunctionCalculation('clamp(none, 20%, none)')).toEqual({
        type: 'percentage',
        value: 20,
        numericType: numericType([['percent', 1]], 'percent'),
      });
    });

    it('orders negative zero below positive zero', () => {
      const minimum = parseMathFunctionCalculation('min(0, calc(-1 * 0))')!;
      const maximum = parseMathFunctionCalculation('max(0, calc(-1 * 0))')!;
      const clamped = parseMathFunctionCalculation('clamp(0, calc(-1 * 0), 1)')!;

      expect('value' in minimum && Object.is(minimum.value, -0)).toBe(true);
      expect('value' in maximum && Object.is(maximum.value, 0)).toBe(true);
      expect('value' in clamped && Object.is(clamped.value, 0)).toBe(true);
    });

    it('retains clamp() when unresolved units cannot be compared', () => {
      expect(parseMathFunctionCalculation('clamp(1em, 2rem, 3em)')).toMatchObject({
        type: 'clamp',
        minimum: { type: 'dimension', value: 1, unit: 'em' },
        value: { type: 'dimension', value: 2, unit: 'rem' },
        maximum: { type: 'dimension', value: 3, unit: 'em' },
      });
      expect(parseMathFunctionCalculation('clamp(none, 2rem, 3em)'))
        .toMatchObject({
          type: 'clamp',
          minimum: undefined,
          value: { type: 'dimension', value: 2, unit: 'rem' },
          maximum: { type: 'dimension', value: 3, unit: 'em' },
        });
      expect(parseMathFunctionCalculation('clamp(1em, 2rem, none)'))
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
      expect(parseMathFunctionCalculation('round(1)')).toEqual({
        type: 'number',
        value: 1,
        numericType: numericType(),
      });
    });

    it.each([
      ['round(5, 2)', 6],
      ['round(-5, 2)', -4],
      ['round(up, 5, 2)', 6],
      ['round(down, 5, 2)', 4],
      ['round(to-zero, -5, 2)', -4],
    ] as const)('simplifies the stepped function %s', (input, expected) => {
      expect(parseMathFunctionCalculation(input)).toEqual({
        type: 'number',
        value: expected,
        numericType: numericType(),
      });
    });

    it.each([
      ['mod(-5, 3)', 1],
      ['mod(5, -3)', -1],
      ['rem(-5, 3)', -2],
      ['rem(5, -3)', 2],
    ] as const)('simplifies the modulus function %s', (input, expected) => {
      expect(parseMathFunctionCalculation(input)).toEqual({
        type: 'number',
        value: expected,
        numericType: numericType(),
      });
    });

    it('simplifies stepped dimensions with canonical or identical units', () => {
      expect(parseMathFunctionCalculation('round(down, 1.3in, 10px)')).toEqual({
        type: 'dimension',
        value: 120,
        unit: 'px',
        numericType: numericType([['length', 1]]),
      });
      expect(parseMathFunctionCalculation('mod(25rem, 10rem)')).toEqual({
        type: 'dimension',
        value: 5,
        unit: 'rem',
        numericType: numericType([['length', 1]]),
      });
    });

    it('retains stepped functions whose unresolved units differ', () => {
      expect(parseMathFunctionCalculation('round(10rem, 1em)')).toMatchObject({
        type: 'round',
        strategy: 'nearest',
        value: { type: 'dimension', value: 10, unit: 'rem' },
        step: { type: 'dimension', value: 1, unit: 'em' },
      });
    });

    it('snaps the line-width rounding strategy with device context', () => {
      expect(parseMathFunctionCalculation('round(line-width, .25px)', {
        devicePixelRatio: 2,
      })).toEqual({
        type: 'dimension',
        value: 0.5,
        unit: 'px',
        numericType: numericType([['length', 1]]),
      });
    });

    it('chooses the nonzero multiple for line-width rounding', () => {
      expect(parseMathFunctionCalculation(
        'round(line-width, 1px, calc(infinity * 1px))',
        { devicePixelRatio: 2 },
      )).toEqual({
        type: 'dimension',
        value: Infinity,
        unit: 'px',
        numericType: numericType([['length', 1]]),
      });
    });

    it.each([
      'round(1, 0)',
      'round(infinity, infinity)',
      'mod(infinity, 1)',
      'rem(1, 0)',
      'mod(-1, infinity)',
    ])('produces NaN for the out-of-range function %s', (input) => {
      const value = parseMathFunctionCalculation(input)!;

      expect(value.type).toBe('number');

      if (value.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(Number.isNaN(calculationValue(value))).toBe(true);
    });

    it('preserves the required signed zeros in stepped functions', () => {
      const rounded = parseMathFunctionCalculation(
        'round(to-zero, -1, 2)',
      )!;
      const infiniteStep = parseMathFunctionCalculation('round(-1, infinity)')!;
      const modulo = parseMathFunctionCalculation('mod(-6, 3)')!;
      const remainder = parseMathFunctionCalculation('rem(-6, 3)')!;

      expect(Object.is(calculationValue(rounded), -0)).toBe(true);
      expect(Object.is(calculationValue(infiniteStep), -0)).toBe(true);
      expect(Object.is(calculationValue(modulo), 0)).toBe(true);
      expect(Object.is(calculationValue(remainder), -0)).toBe(true);
    });
  });

  describe('math trigonometric functions', () => {
    it.each([
      ['sin(30deg)', 0.5],
      ['sin(.5)', Math.sin(0.5)],
      ['cos(.25turn)', 0],
      ['tan(50grad)', 1],
    ] as const)('simplifies the trigonometric function %s', (input, expected) => {
      const result = parseMathFunctionCalculation(input);

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
      const result = parseMathFunctionCalculation(input);

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
      const result = parseMathFunctionCalculation(input);

      if (result?.type !== 'dimension') {
        throw new Error('Expected an angle');
      }

      expect(result.unit).toBe('deg');
      expect(result.value).toBeCloseTo(expected, 8);
    });

    it('retains atan2() until its operands can be compared', () => {
      expect(parseMathFunctionCalculation('atan2(1em, 1rem)')).toMatchObject({
        type: 'atan2',
      });
      expect(parseRawCalculation('atan2(10%, 20%)')).toMatchObject({
        type: 'atan2',
      });
      expect(parseMathFunctionCalculation('atan2(10%, 20%)', {
        percentageType: 'length',
      })).toMatchObject({ type: 'atan2' });
    });

    it('simplifies raw or resolved percentage coordinates', () => {
      const raw = parseMathFunctionCalculation('atan2(10%, 20%)', {
        percentageType: 'percent',
      });
      const resolved = parseMathFunctionCalculation('atan2(10%, 20%)', {
        percentageType: 'length',
        percentageReferenceValue: {
          type: 'dimension',
          value: -100,
          unit: 'px',
        },
      });

      if (raw?.type !== 'dimension' || resolved?.type !== 'dimension') {
        throw new Error('Expected angles');
      }

      expect(raw.value).toBeCloseTo(26.565051177, 8);
      expect(resolved.value).toBeCloseTo(-153.434948823, 8);
    });

    it('uses JavaScript infinity, NaN, and signed-zero behavior', () => {
      const sine = parseMathFunctionCalculation('sin(calc(-1 * 0))');
      const tangent = parseMathFunctionCalculation('tan(calc(-1 * 0))');
      const invalidSine = parseMathFunctionCalculation('sin(infinity)');
      const invalidAsin = parseMathFunctionCalculation('asin(2)');
      const negativePi = parseMathFunctionCalculation('atan2(calc(-1 * 0), -1)');
      const positivePi = parseMathFunctionCalculation('atan2(0, -1)');

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
      const result = parseMathFunctionCalculation(input);

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
      expect(parseMathFunctionCalculation(input)).toEqual({
        type: 'dimension',
        value: expected,
        unit,
        numericType: numericType([['length', 1]]),
      });
    });

    it('retains hypot() until its operands can be compared', () => {
      expect(parseMathFunctionCalculation('hypot(3em, 4rem)')).toMatchObject({
        type: 'hypot',
      });
      expect(parseMathFunctionCalculation('hypot(3%, 4%)')).toMatchObject({
        type: 'hypot',
      });
      expect(parseMathFunctionCalculation('hypot(3%, 4%)', {
        percentageType: 'length',
      })).toMatchObject({ type: 'hypot' });
    });

    it('simplifies raw or resolved percentage components', () => {
      expect(parseMathFunctionCalculation('hypot(3%, 4%)', {
        percentageType: 'percent',
      })).toEqual({
        type: 'percentage',
        value: 5,
        numericType: numericType([['percent', 1]], 'percent'),
      });
      expect(parseMathFunctionCalculation('hypot(3%, 4%)', {
        percentageType: 'length',
        percentageReferenceValue: {
          type: 'dimension',
          value: -100,
          unit: 'px',
        },
      })).toEqual({
        type: 'dimension',
        value: 5,
        unit: 'px',
        numericType: numericType([['length', 1]], 'length'),
      });
    });

    it('makes NaN infectious in every exponential function', () => {
      const power = parseMathFunctionCalculation('pow(NaN, 0)');
      const hypotenuse = parseMathFunctionCalculation('hypot(infinity, NaN)');

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
      const result = parseMathFunctionCalculation(input);

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
      const result = parseMathFunctionCalculation(input);

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
      expect(parseMathFunctionCalculation(input)).toEqual({
        type,
        value,
        ...(unit === undefined ? {} : { unit }),
        numericType: type === 'number'
          ? numericType()
          : numericType([['length', 1]]),
      });
    });

    it('retains percentages whose numeric sign is unresolved', () => {
      expect(parseMathFunctionCalculation('abs(-10%)')).toMatchObject({ type: 'abs' });
      expect(parseRawCalculation('sign(10%)')).toMatchObject({ type: 'sign' });
      expect(parseMathFunctionCalculation('sign(10%)', {
        percentageType: 'length',
      })).toMatchObject({ type: 'sign' });
    });

    it('simplifies raw or resolved percentages', () => {
      expect(parseMathFunctionCalculation('abs(-10%)', {
        percentageType: 'percent',
      })).toEqual({
        type: 'percentage',
        value: 10,
        numericType: numericType([['percent', 1]], 'percent'),
      });
      expect(parseMathFunctionCalculation('sign(-10%)', {
        percentageType: 'percent',
      })).toEqual({
        type: 'number',
        value: -1,
        numericType: numericType([], 'percent'),
      });
      expect(parseMathFunctionCalculation('abs(10%)', {
        percentageType: 'length',
        percentageReferenceValue: {
          type: 'dimension',
          value: -200,
          unit: 'px',
        },
      })).toEqual({
        type: 'dimension',
        value: 20,
        unit: 'px',
        numericType: numericType([['length', 1]], 'length'),
      });
      expect(parseMathFunctionCalculation('sign(10%)', {
        percentageType: 'length',
        percentageReferenceValue: {
          type: 'dimension',
          value: -200,
          unit: 'px',
        },
      })).toEqual({
        type: 'number',
        value: -1,
        numericType: numericType([], 'length'),
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
      const result = parseMathFunctionCalculation(input);

      if (result?.type !== 'number') {
        throw new Error('Expected a number');
      }

      expect(Object.is(result.value, expected)).toBe(true);
    });

    it('makes NaN infectious', () => {
      const absolute = parseMathFunctionCalculation('abs(NaN)');
      const sign = parseMathFunctionCalculation('sign(NaN)');

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
      const result = simplifyInternalCalculation(input);

      expect(result.type).toBe('number');
      expect(Object.is(calculationValue(result), expected)).toBe(true);
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
      const result = simplifyInternalCalculation(input);

      expect(result.type).toBe('number');
      expect(Number.isNaN(calculationValue(result))).toBe(true);
    });
  });

  describe('top-level calculation IEEE-754 censoring', () => {
    it('preserves special values at specified-value time', () => {
      const negativeZero = parseCalc('calc(-5 * 0)')!.calculation;
      const notANumber = parseCalc('calc(NaN)')!.calculation;
      const infinity = parseCalc('calc(infinity)')!.calculation;

      expect(Object.is(calculationValue(negativeZero), -0)).toBe(true);
      expect(Number.isNaN(calculationValue(notANumber))).toBe(true);
      expect(calculationValue(infinity)).toBe(Infinity);
    });

    it('censors a negative zero into an unsigned zero', () => {
      const result = parseCalc('calc(-5 * 0)', {
        stage: 'computed',
      })!.calculation;

      expect(result.type).toBe('number');
      expect(Object.is(calculationValue(result), 0)).toBe(true);
    });

    it.each([
      ['calc(NaN)', 'number'],
      ['calc(NaN * 1px)', 'dimension'],
      ['sqrt(-1)', 'number'],
    ] as const)(
      'censors a top-level NaN into a zero value in %s',
      (input, type) => {
        const result = input.startsWith('calc(')
          ? parseCalc(input, { stage: 'computed' })!.calculation
          : parseMathFunctionCalculation(input, { stage: 'computed' })!;
        const value = 'value' in result
          ? result.value
          : undefined;

        expect(result.type).toBe(type);
        expect(value).toBe(0);
      },
    );

    it('retains signed zero inside a nested math function', () => {
      expect(parseMathFunctionCalculation('atan2(0, calc(-5 * 0))')).toMatchObject({
        type: 'dimension',
        value: 180,
        unit: 'deg',
      });
    });

    it('retains an inner signed zero until the outer calculation uses it', () => {
      const specified = parseCalc(
        'calc(1 / calc(-5 * 0))',
      )!.calculation;
      const computed = parseCalc(
        'calc(1 / calc(-5 * 0))',
        {
          stage: 'computed',
          range: [-100, 100],
        },
      )!.calculation;

      expect(calculationValue(specified)).toBe(-Infinity);
      expect(calculationValue(computed)).toBe(-100);
    });

    it.each([
      ['calc(-infinity)', 0],
      ['calc(infinity)', 100],
      ['calc(-5)', 0],
      ['calc(105)', 100],
    ] as const)('clamps %s to the target-context range', (input, expected) => {
      const result = parseCalc(input, {
        stage: 'computed',
        range: [0, 100],
      })!.calculation;

      expect(calculationValue(result)).toBe(expected);
    });

    it('clamps conceptual infinities to the finite host range', () => {
      const result = parseCalc('calc(infinity)', {
        stage: 'used',
      })!.calculation;

      expect(calculationValue(result)).toBe(Number.MAX_VALUE);
    });

    it.each([
      ['calc(1.5)', 2],
      ['calc(-1.5)', -1],
    ] as const)('rounds %s when an integer result is required', (
      input,
      expected,
    ) => {
      const result = parseCalc(input, {
        stage: 'computed',
      }, 'integer')!.calculation;

      expect(calculationValue(result)).toBe(expected);
    });

    it('does not clamp or round specified values', () => {
      const result = parseCalc('calc(105.5)', {
        range: [0, 100],
      }, 'integer')!.calculation;

      expect(calculationValue(result)).toBe(105.5);
    });
  });

  it('retains math functions as calculation-tree operator nodes', () => {
    const calculation = parseCalc(
      'calc(min(1em, 2rem) + max(3vw, 4vh))',
    )
      ?.calculation as CalcSumNode;

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
      ? { percentageType: 'length' } as const
      : {};

    const expectedType = hasPercentage ? 'length-percentage' : undefined;

    expect(serializeMathFunction(parseCalc(input, context, expectedType)!))
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
      const value = parseMathFunction(input, {
        percentageType: 'length',
      }, 'length-percentage')!;

      expect(serializeMathFunction(value)).toBe(expected);
    },
  );

  it.each([
    ['min(3, 1, 2)', 'calc(1)'],
    ['sqrt(-1)', 'calc(NaN)'],
  ] as const)(
    'wraps the simplified specified math function %s in calc()',
    (input, expected) => {
      expect(serializeMathFunction(parseMathFunction(input)!))
        .toBe(expected);
    },
  );

  it.each([
    ['calc(20px + 30px)', '50px'],
    ['min(3, 1, 2)', '1'],
    ['sqrt(-1)', '0'],
  ] as const)(
    'serializes the computed math function %s without calc()',
    (input, expected) => {
      const context = { stage: 'computed' } as const;
      const value = input.startsWith('calc(')
        ? parseCalc(input, context)!
        : parseMathFunction(input, context)!;

      expect(serializeMathFunction(value, context)).toBe(expected);
    },
  );

  it.each([
    ['calc(infinity)', 'calc(infinity)'],
    ['calc(-infinity * 1em)', 'calc(-infinity * 1px)'],
    ['calc(NaN * 1s)', 'calc(NaN * 1s)'],
  ] as const)(
    'serializes the special numeric calculation %s',
    (input, expected) => {
      expect(serializeMathFunction(parseCalc(input)!)).toBe(expected);
    },
  );

  it('serializes a calculation tree with its grouping parentheses', () => {
    const calculation = parseCalc('calc(1px - min(2px, 3%))', {
      percentageType: 'length',
    }, 'length-percentage')!.calculation;

    expect(serializeCalcTree(calculation))
      .toBe('(1px - min(2px, 3%))');
  });

  it('adds math functions into a simplified calc function', () => {
    const result = addMathFunctions(
      parseMathValue('calc(10px)')!,
      parseMathValue('min(20px, 30px)')!,
    );

    expect(serializeMathValue(result)).toBe('calc(30px)');
  });

  it('accumulates math functions using addition', () => {
    const result = accumulateMathFunctions(
      parseMathValue('calc(10px)')!,
      parseMathValue('min(20px, 30px)')!,
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
        percentageType: 'length',
      } as const satisfies CalculationContext;
      const result = interpolateMathFunctions(
        parseMathValue('calc(10px)', context, 'length-percentage')!,
        parseMathValue('calc(20%)', context, 'length-percentage')!,
        p,
        context,
      );

      expect(serializeMathValue(result)).toBe(expected);
    },
  );

  it('rejects combination of inconsistent math functions', () => {
    const length = parseMathValue('calc(1px)')!;
    const time = parseMathValue('calc(1s)')!;

    expect(() => addMathFunctions(length, time))
      .toThrow('Math value restrictions must be consistent');
    expect(() => interpolateMathFunctions(length, time, 0.5))
      .toThrow('Math value restrictions must be consistent');
    expect(() => accumulateMathFunctions(length, time))
      .toThrow('Math value restrictions must be consistent');
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
    expectBadMathFunction(input);
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
      expect(parseCalc(input)?.calculation).toEqual({
        type: 'dimension',
        value,
        unit,
        numericType: numericType([[category, 1]]),
      });
    },
  );

  it('simplifies again when later length context becomes available', () => {
    const parsed = parseCalc('calc(1em + 2px)')!;

    expect(parsed.calculation.type).toBe('sum');
    expect(simplifyCalculationTree(parsed.calculation, {
      length: { em: 16 },
    })).toEqual({
      type: 'dimension',
      value: 18,
      unit: 'px',
      numericType: numericType([['length', 1]]),
    });
  });

  it('types percentages in their supplied calculation context', () => {
    expectBadCalc('calc(10px + 25%)');

    const context = {
      percentageType: 'length',
    } as const satisfies CalculationContext;
    const parsed = parseCalc('calc(10px + 25%)', context, 'length-percentage');

    expect(parsed).toEqual({
      type: 'math',
      calculation: {
        type: 'sum',
        numericType: numericType([['length', 1]], 'length'),
        children: [
          numericLeaf(
            { type: 'percentage', value: 25 },
            numericType([['length', 1]], 'length'),
          ),
          numericLeaf(
            { type: 'dimension', value: 10, unit: 'px' },
            numericType([['length', 1]]),
          ),
        ],
      },
      restrictions: { expectedType: 'length-percentage' },
    });

    expect(parseCalc('calc(25%)', context, 'length-percentage')?.calculation)
      .toEqual({
        type: 'percentage',
        value: 25,
        numericType: numericType([['length', 1]], 'length'),
      });
    expect(parseCalc('calc(10px)', context, 'length-percentage')?.calculation)
      .toEqual({
        type: 'dimension',
        value: 10,
        unit: 'px',
        numericType: numericType([['length', 1]]),
      });
    expect(parseCalc(
      'calc(calc(10px + 25%))',
      context,
      'length-percentage',
    )).toEqual(parsed);
  });

  it('inherits percentage typing through nested math functions', () => {
    const context = {
      percentageType: 'length',
    } as const satisfies CalculationContext;

    expect(parseCalc('calc(min(25%, 50px))', context, 'length-percentage')
      ?.calculation.numericType)
      .toEqual(numericType([['length', 1]], 'length'));
  });

  it.each([
    ['calc(0px + 20%)', 20, 0, 'px'],
    ['calc(10px + 0%)', 0, 10, 'px'],
  ] as const)(
    'retains distinct zero terms in the mixed calculation %s',
    (input, percentage, dimension, unit) => {
      expect(parseCalc(input, {
        percentageType: 'length',
      }, 'length-percentage')?.calculation).toEqual({
        type: 'sum',
        numericType: numericType([['length', 1]], 'length'),
        children: [
          numericLeaf(
            { type: 'percentage', value: percentage },
            numericType([['length', 1]], 'length'),
          ),
          numericLeaf(
            { type: 'dimension', value: dimension, unit },
            numericType([['length', 1]]),
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
    expect(parseCalc(input, {}, expectedType)).not.toBeNull();
  });

  it('requires an expected type for a public math value', () => {
    const c = new ComponentCursor(parseListOfComponentValues('calc(1)'));

    expect(() => tryConsumeCalc(c))
      .toThrow('Math value expected type is required');
  });

  it.each([
    ['calc(1s)', 'length'],
    ['calc(1px)', 'time'],
    ['calc(1)', 'percentage'],
    ['calc(25%)', 'number'],
  ] as const)(
    'rejects %s against the expected %s type',
    (input, expectedType) => {
      expectNoCalc(input, expectedType);
    },
  );

  it('matches the expected type of another outer math function', () => {
    expect(parseMathFunctionCalculation(
      'min(1px, 2px)',
      {},
      'length',
    )).not.toBeNull();
    expectNoMathFunction('min(1px, 2px)', 'time');
  });

  it.each([
    ['length-percentage', 'length', 'calc(10px + 25%)'],
    ['angle-percentage', 'angle', 'calc(10deg + 25%)'],
    ['time-percentage', 'time', 'calc(10s + 25%)'],
    ['frequency-percentage', 'frequency', 'calc(10hz + 25%)'],
  ] as const)(
    'matches the mixed %s production',
    (expectedType, percentageType, input) => {
      expect(parseCalc(input, {
        percentageType,
      }, expectedType)).not.toBeNull();
    },
  );

  it('preserves a percent hint after percentage dimensions cancel', () => {
    const quotient = parseRawCalculation('1% / 1%') as CalcProductNode;

    expect(quotient).toEqual({
      type: 'product',
      children: [
        numericLeaf(
          { type: 'percentage', value: 1 },
          numericType([['percent', 1]], 'percent'),
        ),
        {
          type: 'invert',
          child: numericLeaf(
            { type: 'percentage', value: 1 },
            numericType([['percent', 1]], 'percent'),
          ),
          numericType: numericType(
            [['percent', -1]],
            'percent',
          ),
        },
      ],
      numericType: numericType([], 'percent'),
    });
    expect(parseCalc('calc(1% / 1%)', {
      percentageType: 'percent',
    }, 'number')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'number', value: 1 },
        numericType([], 'percent'),
      ),
      restrictions: { expectedType: 'number' },
    });

    const input = 'calc(1% / 1% * 10px)';
    const calculation = parseRawCalculation(
      '1% / 1% * 10px',
    ) as CalcProductNode;

    expect(calculation.numericType).toEqual(
      numericType([['length', 1]], 'percent'),
    );
    expectNoCalc(input, 'length');
    expect(parseCalc(input, {
      percentageType: 'length',
    }, 'length-percentage')).not.toBeNull();
  });

  it('preserves a percent hint through a nested calc function', () => {
    expectNoCalc('calc(calc(1% / 1%) * 10px)', 'length');
  });

  it('preserves a percent hint through deeply nested calculations', () => {
    expectNoCalc('calc(calc(calc(calc(1% / 1%))) * 10px)', 'length');
  });

  it.each([
    ['contained-type', 'calc(abs(1% / 1%) * 10px)'],
    ['consistent-type', 'calc(min(1% / 1%, 2% / 2%) * 10px)'],
    ['fixed-result', 'calc(sign(1% / 1%) * 10px)'],
  ] as const)(
    'preserves a percent hint through a nested %s math function',
    (_type, input) => {
      expectNoCalc(input, 'length');
      expect(parseCalc(input, {
        percentageType: 'length',
      }, 'length-percentage')).not.toBeNull();
    },
  );

  it('makes a fixed angle result consistent with its percentage inputs', () => {
    expect(parseCalc('calc(atan2(1%, 2%))', {
      percentageType: 'percent',
    })?.calculation.numericType).toEqual(
      numericType([['angle', 1]], 'percent'),
    );
  });

  it('resolves percentages against an available reference value', () => {
    expect(parseCalc('calc(10px + 25%)', {
      percentageType: 'length',
      percentageReferenceValue: {
        type: 'dimension',
        value: 200,
        unit: 'px',
      },
    }, 'length-percentage')).toEqual({
      type: 'math',
      calculation: numericLeaf(
        { type: 'dimension', value: 60, unit: 'px' },
        numericType([['length', 1]], 'length'),
      ),
      restrictions: { expectedType: 'length-percentage' },
    });

    expect(simplifyCalculationTree(
      {
        type: 'percentage',
        value: 25,
        numericType: numericType([['percent', 1]], 'percent'),
      },
      {
        percentageReferenceValue: { type: 'number', value: 200 },
      },
    )).toEqual(numericLeaf(
      { type: 'number', value: 50 },
      numericType([['percent', 1]], 'percent'),
    ));
  });

  it('combines unresolved dimensions using ASCII-insensitive units', () => {
    expect(parseCalc('calc(1EM + 2em)')?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'em',
      numericType: numericType([['length', 1]]),
    });
  });

  it('stores sum and product children in calculation serialization order', () => {
    expect(parseCalc('calc(1vh + 2em + 3% + 4px)', {
      percentageType: 'length',
    })?.calculation).toEqual({
      type: 'sum',
      numericType: numericType([['length', 1]], 'length'),
      children: [
        numericLeaf(
          { type: 'percentage', value: 3 },
          numericType([['length', 1]], 'length'),
        ),
        numericLeaf(
          { type: 'dimension', value: 2, unit: 'em' },
          numericType([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 4, unit: 'px' },
          numericType([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 1, unit: 'vh' },
          numericType([['length', 1]]),
        ),
      ],
    });

    expect(parseCalc('calc(min(1em, 2rem) * 2)')?.calculation)
      .toMatchObject({
        type: 'product',
        children: [
          { type: 'number', value: 2 },
          { type: 'min' },
        ],
      });
  });

  it('distributes a number over a sum of numeric values', () => {
    expect(parseCalc('calc(2 * (1px + 2em))')?.calculation).toEqual({
      type: 'sum',
      numericType: numericType([['length', 1]]),
      children: [
        numericLeaf(
          { type: 'dimension', value: 4, unit: 'em' },
          numericType([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 2, unit: 'px' },
          numericType([['length', 1]]),
        ),
      ],
    });
  });

  it('retains zero-valued terms with a distinct unit', () => {
    expect(parseCalc('calc(0px + 1em)')?.calculation).toEqual({
      type: 'sum',
      numericType: numericType([['length', 1]]),
      children: [
        numericLeaf(
          { type: 'dimension', value: 1, unit: 'em' },
          numericType([['length', 1]]),
        ),
        numericLeaf(
          { type: 'dimension', value: 0, unit: 'px' },
          numericType([['length', 1]]),
        ),
      ],
    });
  });

  it('negates positive zero using CSS addition semantics', () => {
    const simplified = simplifyCalculationTree({
      type: 'negate',
      child: {
        type: 'number',
        value: 0,
        numericType: numericType(),
      },
      numericType: numericType(),
    });

    expect(simplified.type).toBe('number');
    expect(Object.is(calculationValue(simplified), 0)).toBe(true);
  });

  it('cancels canonical units in a numeric product', () => {
    expect(parseCalc('calc(1in / 96px)')?.calculation).toEqual({
      type: 'number',
      value: 1,
      numericType: numericType(),
    });
  });

  it('unwraps nested calc functions as equivalent grouping', () => {
    expect(parseCalc('calc(calc(1 + 2))')).toEqual(
      parseCalc('calc((1 + 2))'),
    );
  });

  it('defers final type validation for nested calc functions', () => {
    expect(parseCalc('calc(calc(1px / 1s) * 1s)')).toEqual(
      parseCalc('calc((1px / 1s) * 1s)'),
    );
  });

  it.each([
    ['e', Math.E],
    ['PI', Math.PI],
    ['InFiNiTy', Infinity],
    ['-INFINITY', -Infinity],
    ['NaN', NaN],
  ] as const)('resolves the calc keyword %j at parse time', (keyword, value) => {
    const parsed = parseCalc(`calc(${keyword})`);

    expect(parsed?.calculation.type).toBe('number');
    expect(Object.is(calculationValue(parsed!.calculation), value)).toBe(true);
  });

  it.each([
    ['1px', numericType([['length', 1]])],
    ['1deg', numericType([['angle', 1]])],
    ['1s', numericType([['time', 1]])],
    ['1Hz', numericType([['frequency', 1]])],
    ['1dppx', numericType([['resolution', 1]])],
    ['1fr', numericType([['flex', 1]])],
  ] as const)('classifies the dimensional terminal %s', (input, expected) => {
    expect(parseCalc(`calc(${input})`)?.calculation.numericType)
      .toEqual(expected);
  });

  it('records compound numeric types on nested subexpressions', () => {
    const outer = parseRawCalculation('(1px / 1s) * 1s') as CalcProductNode;
    const inner = outer.children[0] as CalcProductNode;

    expect(inner.numericType).toEqual(numericType([
      ['length', 1],
      ['time', -1],
    ]));
    expect(outer.numericType).toEqual(
      numericType([['length', 1]]),
    );
  });

  it('records squared dimensions before a later inverse cancels them', () => {
    const outer = parseRawCalculation('(1px * 1em) / 1px') as CalcProductNode;
    const inner = outer.children[0] as CalcProductNode;

    expect(inner.numericType).toEqual(
      numericType([['length', 2]]),
    );
    expect(outer.numericType).toEqual(
      numericType([['length', 1]]),
    );
  });

  it('represents a dimensionless quotient with an empty exponent map', () => {
    const parsed = parseCalc('calc(1px / 1px)');

    expect(parsed?.calculation.numericType).toEqual(numericType());
  });

  describe('calculation type-checking examples', () => {
    it.each([
      ['calc(5px + 1em)', {}, undefined],
      [
        'calc(100% / 3)',
        { percentageType: 'percent' },
        'percentage',
      ],
      ['calc(1.5)', {}, 'integer'],
    ] as const)(
      'accepts the valid calculation %j',
      (input, context, expectedType) => {
        expect(parseCalc(input, context, expectedType)).not.toBeNull();
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
      expectBadCalc(input);
    });
  });

  it('passes unresolved numeric variables through nested calculations', () => {
    const context: CalculationContext = {
      numericVariables: new Map([['h', {
        value: null,
        numericType: numericType(),
      }]]),
    };
    const parsed = parseCalc('calc(calc(h + 180))', context);
    const sum = parsed?.calculation as CalcSumNode;

    expect(sum.children).toEqual([
      numericLeaf(
        { type: 'number', value: 180 },
        numericType(),
      ),
      {
        type: 'variable',
        name: 'h',
        numericType: numericType(),
      },
    ]);
    expect(sum.numericType).toEqual(numericType());
  });

  it('simplifies an available numeric variable', () => {
    const context: CalculationContext = {
      numericVariables: new Map([['h', {
        value: { type: 'number', value: 177 },
        numericType: numericType(),
      }]]),
    };
    expect(parseCalc('calc(h + 180)', context)?.calculation).toEqual({
      type: 'number',
      value: 357,
      numericType: numericType(),
    });
  });

  it('types an unresolved dimensional numeric variable', () => {
    const lengthType = numericType([['length', 1]]);
    const context: CalculationContext = {
      numericVariables: new Map([['x', {
        value: null,
        numericType: lengthType,
      }]]),
    };
    const sum = parseCalc('calc(x + 1px)', context)
      ?.calculation as CalcSumNode;

    expect(sum.children).toEqual([
      numericLeaf(
        { type: 'dimension', value: 1, unit: 'px' },
        lengthType,
      ),
      {
        type: 'variable',
        name: 'x',
        numericType: lengthType,
      },
    ]);
    expect(sum.numericType).toEqual(lengthType);
  });

  it('simplifies an available dimensional variable', () => {
    const lengthType = numericType([['length', 1]]);
    const context: CalculationContext = {
      numericVariables: new Map([['x', {
        value: { type: 'dimension', value: 2, unit: 'px' },
        numericType: lengthType,
      }]]),
    };
    expect(parseCalc('calc(x + 1px)', context)?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'px',
      numericType: lengthType,
    });
  });

  it('rejects a numeric variable outside its defining context', () => {
    expectBadCalc('calc(h + 180)');
  });

  it.each([
    'calc(1 + 2)',
    'calc(1\n+\t2)',
    'calc(1 /* before */ + /* after */ 2)',
  ])('accepts required whitespace around an additive operator in %j', (input) => {
    expect(parseCalc(input)).not.toBeNull();
  });

  it.each([
    'calc(1+2)',
    'calc(1 +2)',
    'calc(1+ 2)',
    'calc(1/**/+ 2)',
    'calc(1 +/**/2)',
  ])('rejects an additive operator without required whitespace in %j', (input) => {
    expectBadCalc(input);
  });

  it.each([
    'calc(2*3)',
    'calc(2 *3)',
    'calc(2* 3)',
    'calc(2 * 3)',
  ])('allows optional whitespace around a multiplicative operator in %j', (input) => {
    expect(parseCalc(input)).not.toBeNull();
  });

  it.each([
    'calc()',
    'calc(1 +)',
    'calc(* 1)',
    'calc(1 2)',
    'calc(())',
  ])('commits after recognizing the malformed calculation %j', (input) => {
    expectBadCalc(input);
  });

  it('supports at least 32 calculation terms', () => {
    const input = Array.from({ length: 32 }, (_, index) => index + 1).join(' + ');

    expect(parseCalc(`calc(${input})`)?.calculation).toEqual({
      type: 'number',
      value: 528,
      numericType: numericType(),
    });
  });

  it('supports at least 32 nested calculation levels', () => {
    const input = `${'('.repeat(32)}1${')'.repeat(32)}`;

    expect(parseCalc(`calc(${input})`)?.calculation).toEqual({
      type: 'number',
      value: 1,
      numericType: numericType(),
    });
  });

  it('bounds aggregate calculation complexity', () => {
    const input = `${'('.repeat(64)}1${')'.repeat(64)}`;

    expectBadCalc(`calc(${input})`);
  });

  it('keeps parser bookkeeping out of the supplied context', () => {
    const context = { insideCalculation: true } as const;

    expect(parseCalc('calc(1)', context)).not.toBeNull();
    expect(context).toEqual({ insideCalculation: true });
  });

  it('returns null without advancing for another functional notation', () => {
    const c = new ComponentCursor(parseListOfComponentValues('min(1) calc(2)'));

    expect(tryConsumeCalc(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

function parseCalc(
  input: string,
  context: CalculationContext = {},
  expectedType?: ExpectedCalculationType,
): MathValue | null {
  return parseWithExpectedType(parseCalcWithContext, input, context, expectedType);
}

function parseMathFunction(
  input: string,
  context: CalculationContext = {},
  expectedType?: ExpectedCalculationType,
): MathValue | null {
  return parseWithExpectedType(
    parseMathFunctionWithContext, input, context, expectedType,
  );
}

function parseMathValue(
  input: string,
  context: CalculationContext = {},
  expectedType?: ExpectedCalculationType,
): MathValue | null {
  return parseWithExpectedType(parseMathValueWithContext, input, context, expectedType);
}

function parseWithExpectedType(
  parse: (
    input: string,
    expectedType: ExpectedCalculationType,
    context?: CalculationContext,
  ) => MathValue | null,
  input: string,
  context: CalculationContext,
  expectedType?: ExpectedCalculationType,
): MathValue | null {
  const expectedTypes = expectedType === undefined
    ? inferredExpectedTypes(context)
    : [expectedType];

  for (const candidate of expectedTypes) {
    const result = parse(input, candidate, context);

    if (result !== null) {
      return result;
    }
  }

  return null;
}

function inferredExpectedTypes(
  context: CalculationContext,
): readonly ExpectedCalculationType[] {
  switch (context.percentageType) {
    case 'length':
      return ['length-percentage', ...EXPECTED_CALCULATION_TYPES];
    case 'angle':
      return ['angle-percentage', ...EXPECTED_CALCULATION_TYPES];
    case 'time':
      return ['time-percentage', ...EXPECTED_CALCULATION_TYPES];
    case 'frequency':
      return ['frequency-percentage', ...EXPECTED_CALCULATION_TYPES];
    case 'percent':
      return ['percentage', ...EXPECTED_CALCULATION_TYPES];
    case 'resolution':
    case 'flex':
    case undefined:
      return EXPECTED_CALCULATION_TYPES;
  }
}

const EXPECTED_CALCULATION_TYPES = [
  'number',
  'percentage',
  'length',
  'angle',
  'time',
  'frequency',
  'resolution',
  'flex',
  'dimension',
] as const satisfies readonly ExpectedCalculationType[];

function numericType(
  exponents: readonly NumericExponent[] = [],
  percentHint: NumericBaseType | null = null,
): NumericType {
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
  type: NumericType,
): Value & { numericType: NumericType; } {
  return { ...value, numericType: type };
}

function parseMathFunctionCalculation(
  input: string,
  context: CalculationContext = {},
  expectedType?: ExpectedCalculationType,
): CalculationTree | null {
  return parseMathFunction(input, context, expectedType)?.calculation ?? null;
}

function expectBadCalc(
  input: string,
  context: CalculationContext = {},
): void {
  const c = new ComponentCursor(parseListOfComponentValues(input), {
    context,
  });
  const result = tryConsumeCalc(c);

  expect(result).toMatchObject({ kind: 'bad' });
  expect(c.pos()).toBe(1);
}

function expectNoCalc(
  input: string,
  expectedType: ExpectedCalculationType,
  context: CalculationContext = {},
): void {
  const parserContext = { ...context, expectedType };
  const c = new ComponentCursor(parseListOfComponentValues(input), {
    context: parserContext,
  });

  expect(tryConsumeCalc(c)).toBeNull();
  expect(c.pos()).toBe(0);
  expect(c.context).toBe(parserContext);
}

function expectBadMathFunction(
  input: string,
  context: CalculationContext = {},
): void {
  const c = new ComponentCursor(parseListOfComponentValues(input), {
    context,
  });
  const result = tryConsumeMathFunction(c);

  expect(result).toMatchObject({ kind: 'bad' });
  expect(c.pos()).toBe(1);
}

function expectNoMathFunction(
  input: string,
  expectedType: ExpectedCalculationType,
  context: CalculationContext = {},
): void {
  const parserContext = { ...context, expectedType };
  const c = new ComponentCursor(parseListOfComponentValues(input), {
    context: parserContext,
  });

  expect(tryConsumeMathFunction(c)).toBeNull();
  expect(c.pos()).toBe(0);
  expect(c.context).toBe(parserContext);
}

function parseRawCalculation(
  input: string,
  context: CalculationContext = {},
): CalculationTree {
  const values = parseListOfComponentValues(input);
  const c = new ComponentCursor(values, {
    context: {
      ...context,
      insideCalculation: true,
    } satisfies CalculationContext,
  });
  const result = tryConsumeCalcSum(c);

  expect(isOk(result)).toBe(true);
  expect(c.pos()).toBe(values.length);

  if (!isOk(result)) {
    throw new Error('Expected a valid raw calculation');
  }

  return result.value;
}

function simplifyInternalCalculation(input: string): CalculationTree {
  const context: CalculationContext = { insideCalculation: true };
  return simplifyCalculationTree(parseRawCalculation(input, context), context);
}

function calculationValue(calculation: CalculationTree): number | undefined {
  return 'value' in calculation && typeof calculation.value === 'number'
    ? calculation.value
    : undefined;
}
