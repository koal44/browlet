import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { isOk } from '../../../src/stylelet/parser/component-try-consumer';
import { parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import {
  parseCalc, parseMathFunction, simplifyCalculationTree,
  tryConsumeCalc, tryConsumeCalcSum, tryConsumeMathFunction,
  type CalculationContext, type CalculationTree, type CalcProductNode, type CalcSumNode,
  type DimensionalBaseType, type DimensionalExponent, type DimensionalType,
} from '../../../src/stylelet/values/calc';

describe('calc', () => {
  it.each([
    ['calc(1)', { type: 'number', value: 1 }, dimensionalType()],
    [
      'calc(1px)',
      { type: 'dimension', value: 1, unit: 'px' },
      dimensionalType(['length', 1]),
    ],
    [
      'calc(25%)',
      { type: 'percentage', value: 25 },
      dimensionalType(['percent', 1], 'percent'),
    ],
  ] as const)('parses the terminal calculation %j', (input, expected, type) => {
    expect(parseCalc(input)).toEqual({
      type: 'calc',
      calculation: expected,
      dimensionalType: type,
    });
  });

  it('respects operator precedence while simplifying', () => {
    expect(parseCalc('calc(1px + 2 * 3px - 4px / 2)')).toEqual({
      type: 'calc',
      dimensionalType: dimensionalType(['length', 1]),
      calculation: { type: 'dimension', value: 5, unit: 'px' },
    });
  });

  it('uses parenthesized calculations for grouping while simplifying', () => {
    expect(parseCalc('calc((1 + 2) * 3)')).toEqual({
      type: 'calc',
      dimensionalType: dimensionalType(),
      calculation: { type: 'number', value: 9 },
    });
  });

  it.each([
    ['min(1, 2)', 'min', 2, dimensionalType()],
    ['max(1px, 2px)', 'max', 2, dimensionalType(['length', 1])],
    ['clamp(none, 1px, 2px)', 'clamp', 3, dimensionalType(['length', 1])],
    ['round(up, 5px, 2px)', 'round', 2, dimensionalType(['length', 1])],
    ['mod(5px, 2px)', 'mod', 2, dimensionalType(['length', 1])],
    ['rem(5, 2)', 'rem', 2, dimensionalType()],
    ['sin(1rad)', 'sin', 1, dimensionalType()],
    ['cos(1)', 'cos', 1, dimensionalType()],
    ['tan(1deg)', 'tan', 1, dimensionalType()],
    ['asin(1)', 'asin', 1, dimensionalType(['angle', 1])],
    ['acos(1)', 'acos', 1, dimensionalType(['angle', 1])],
    ['atan(1)', 'atan', 1, dimensionalType(['angle', 1])],
    ['atan2(1px, 2px)', 'atan2', 2, dimensionalType(['angle', 1])],
    ['pow(2, 3)', 'pow', 2, dimensionalType()],
    ['sqrt(4)', 'sqrt', 1, dimensionalType()],
    ['hypot(3px, 4px)', 'hypot', 2, dimensionalType(['length', 1])],
    ['log(8, 2)', 'log', 2, dimensionalType()],
    ['exp(1)', 'exp', 1, dimensionalType()],
    ['abs(-1px)', 'abs', 1, dimensionalType(['length', 1])],
    ['sign(-1px)', 'sign', 1, dimensionalType()],
  ] as const)(
    'parses the math function %s',
    (input, type, childCount, expectedType) => {
      const parsed = parseMathFunction(input);

      expect(parsed?.type).toBe(type);
      expect('children' in parsed! && parsed.children).toHaveLength(childCount);
      expect(parsed?.dimensionalType).toEqual(expectedType);
    },
  );

  it('uses the default round() strategy and optional numeric step', () => {
    expect(parseMathFunction('round(1)')).toMatchObject({
      type: 'round',
      strategy: 'nearest',
      children: [{ type: 'number', value: 1 }],
    });
  });

  it('retains math functions as calculation-tree operator nodes', () => {
    const calculation = parseCalc('calc(min(1, 2) + max(3, 4))')
      ?.calculation as CalcSumNode;

    expect(calculation.children.map((child) => child.type)).toEqual([
      'min',
      'max',
    ]);
  });

  it.each([
    'min()',
    'clamp(1px, none, 2px)',
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
    ['calc(1in + 96px)', 192, 'px'],
    ['calc(1turn + 180deg)', 540, 'deg'],
    ['calc(1000ms + 1s)', 2, 's'],
    ['calc(1khz + 500hz)', 1500, 'hz'],
    ['calc(96dpi + 1dppx)', 2, 'dppx'],
  ] as const)(
    'combines compatible dimensions in their canonical unit for %s',
    (input, value, unit) => {
      expect(parseCalc(input)?.calculation).toEqual({
        type: 'dimension',
        value,
        unit,
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
    });
  });

  it('types percentages in their supplied calculation context', () => {
    expectBadCalc('calc(10px + 25%)');

    const context = {
      expectedType: 'length-percentage',
      percentageType: 'length',
    } as const satisfies CalculationContext;
    const parsed = parseCalc('calc(10px + 25%)', context);

    expect(parsed).toEqual({
      type: 'calc',
      dimensionalType: dimensionalType(['length', 1], 'length'),
      calculation: {
        type: 'sum',
        dimensionalType: dimensionalType(['length', 1], 'length'),
        children: [
          { type: 'percentage', value: 25 },
          { type: 'dimension', value: 10, unit: 'px' },
        ],
      },
    });

    expect(parseCalc('calc(25%)', context)?.calculation).toEqual({
      type: 'percentage',
      value: 25,
    });
    expect(parseCalc('calc(10px)', context)?.calculation).toEqual({
      type: 'dimension',
      value: 10,
      unit: 'px',
    });
    expect(parseCalc('calc(calc(10px + 25%))', context)).toEqual(parsed);
  });

  it.each([
    ['calc(0px + 20%)', 20, 0, 'px'],
    ['calc(10px + 0%)', 0, 10, 'px'],
  ] as const)(
    'retains distinct zero terms in the mixed calculation %s',
    (input, percentage, dimension, unit) => {
      expect(parseCalc(input, {
        expectedType: 'length-percentage',
        percentageType: 'length',
      })?.calculation).toEqual({
        type: 'sum',
        dimensionalType: dimensionalType(['length', 1], 'length'),
        children: [
          { type: 'percentage', value: percentage },
          { type: 'dimension', value: dimension, unit },
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
    expect(parseCalc(input, { expectedType })).not.toBeNull();
  });

  it.each([
    ['calc(1s)', 'length'],
    ['calc(1px)', 'time'],
    ['calc(1)', 'percentage'],
    ['calc(25%)', 'number'],
  ] as const)(
    'rejects %s against the expected %s type',
    (input, expectedType) => {
      expectBadCalc(input, { expectedType });
    },
  );

  it('matches the expected type of another outer math function', () => {
    expect(parseMathFunction('min(1px, 2px)', {
      expectedType: 'length',
    })).not.toBeNull();
    expectBadMathFunction('min(1px, 2px)', {
      expectedType: 'time',
    });
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
        expectedType,
        percentageType,
      })).not.toBeNull();
    },
  );

  it('preserves a percent hint after percentage dimensions cancel', () => {
    const quotient = parseRawCalculation('1% / 1%') as CalcProductNode;

    expect(quotient).toEqual({
      type: 'product',
      children: [
        { type: 'percentage', value: 1 },
        {
          type: 'invert',
          child: { type: 'percentage', value: 1 },
          dimensionalType: dimensionalType(
            ['percent', -1],
            'percent',
          ),
        },
      ],
      dimensionalType: dimensionalType('percent'),
    });
    expect(parseCalc('calc(1% / 1%)')).toEqual({
      type: 'calc',
      calculation: { type: 'number', value: 1 },
      dimensionalType: dimensionalType('percent'),
    });

    const input = 'calc(1% / 1% * 10px)';
    const calculation = parseRawCalculation(
      '1% / 1% * 10px',
    ) as CalcProductNode;

    expect(calculation.dimensionalType).toEqual(
      dimensionalType(['length', 1], 'percent'),
    );
    expectBadCalc(input, { expectedType: 'length' });
    expect(parseCalc(input)).not.toBeNull();
    expect(parseCalc(input, {
      expectedType: 'length-percentage',
      percentageType: 'length',
    })).not.toBeNull();
  });

  it('resolves percentages against an available reference value', () => {
    expect(parseCalc('calc(10px + 25%)', {
      expectedType: 'length-percentage',
      percentageType: 'length',
      percentageReferenceValue: {
        type: 'dimension',
        value: 200,
        unit: 'px',
      },
    })).toEqual({
      type: 'calc',
      dimensionalType: dimensionalType(['length', 1], 'length'),
      calculation: { type: 'dimension', value: 60, unit: 'px' },
    });

    expect(simplifyCalculationTree(
      { type: 'percentage', value: 25 },
      {
        percentageReferenceValue: { type: 'number', value: 200 },
      },
    )).toEqual({ type: 'number', value: 50 });
  });

  it('combines unresolved dimensions using ASCII-insensitive units', () => {
    expect(parseCalc('calc(1EM + 2em)')?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'em',
    });
  });

  it('stores sum and product children in calculation serialization order', () => {
    expect(parseCalc('calc(1vh + 2em + 3% + 4px)', {
      percentageType: 'length',
    })?.calculation).toEqual({
      type: 'sum',
      dimensionalType: dimensionalType(['length', 1], 'length'),
      children: [
        { type: 'percentage', value: 3 },
        { type: 'dimension', value: 2, unit: 'em' },
        { type: 'dimension', value: 4, unit: 'px' },
        { type: 'dimension', value: 1, unit: 'vh' },
      ],
    });

    expect(parseCalc('calc(min(1px, 2px) * 2)')?.calculation)
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
      dimensionalType: dimensionalType(['length', 1]),
      children: [
        { type: 'dimension', value: 4, unit: 'em' },
        { type: 'dimension', value: 2, unit: 'px' },
      ],
    });
  });

  it('retains zero-valued terms with a distinct unit', () => {
    expect(parseCalc('calc(0px + 1em)')?.calculation).toEqual({
      type: 'sum',
      dimensionalType: dimensionalType(['length', 1]),
      children: [
        { type: 'dimension', value: 1, unit: 'em' },
        { type: 'dimension', value: 0, unit: 'px' },
      ],
    });
  });

  it('negates positive zero using CSS addition semantics', () => {
    const simplified = simplifyCalculationTree({
      type: 'negate',
      child: { type: 'number', value: 0 },
      dimensionalType: dimensionalType(),
    });

    expect(simplified.type).toBe('number');
    expect(Object.is(calculationValue(simplified), 0)).toBe(true);
  });

  it('cancels canonical units in a numeric product', () => {
    expect(parseCalc('calc(1in / 96px)')?.calculation).toEqual({
      type: 'number',
      value: 1,
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
    ['1px', dimensionalType(['length', 1])],
    ['1deg', dimensionalType(['angle', 1])],
    ['1s', dimensionalType(['time', 1])],
    ['1Hz', dimensionalType(['frequency', 1])],
    ['1dppx', dimensionalType(['resolution', 1])],
    ['1fr', dimensionalType(['flex', 1])],
  ] as const)('classifies the dimensional terminal %s', (input, expected) => {
    expect(parseCalc(`calc(${input})`)?.dimensionalType).toEqual(expected);
  });

  it('records compound dimensional types on nested subexpressions', () => {
    const outer = parseRawCalculation('(1px / 1s) * 1s') as CalcProductNode;
    const inner = outer.children[0] as CalcProductNode;

    expect(inner.dimensionalType).toEqual(dimensionalType(
      ['length', 1],
      ['time', -1],
    ));
    expect(outer.dimensionalType).toEqual(
      dimensionalType(['length', 1]),
    );
  });

  it('records squared dimensions before a later inverse cancels them', () => {
    const outer = parseRawCalculation('(1px * 1em) / 1px') as CalcProductNode;
    const inner = outer.children[0] as CalcProductNode;

    expect(inner.dimensionalType).toEqual(
      dimensionalType(['length', 2]),
    );
    expect(outer.dimensionalType).toEqual(
      dimensionalType(['length', 1]),
    );
  });

  it('represents a dimensionless quotient with an empty exponent map', () => {
    const parsed = parseCalc('calc(1px / 1px)');

    expect(parsed?.dimensionalType).toEqual(dimensionalType());
  });

  it.each([
    'calc(1px + 1s)',
    'calc(5px - 5px + 10s)',
    'calc(0 * 5px + 10s)',
    'calc(1px / 1s)',
    'calc(1px * 1em)',
    'calc(1unknown)',
  ])('rejects the invalid dimensional analysis in %j', (input) => {
    expectBadCalc(input);
  });

  it('passes unresolved numeric variables through nested calculations', () => {
    const context: CalculationContext = {
      numericVariables: new Map([['h', {
        value: null,
        dimensionalType: dimensionalType(),
      }]]),
    };
    const parsed = parseCalc('calc(calc(h + 180))', context);
    const sum = parsed?.calculation as CalcSumNode;

    expect(sum.children).toEqual([
      { type: 'number', value: 180 },
      {
        type: 'variable',
        name: 'h',
        dimensionalType: dimensionalType(),
      },
    ]);
    expect(sum.dimensionalType).toEqual(dimensionalType());
  });

  it('simplifies an available numeric variable', () => {
    const context: CalculationContext = {
      numericVariables: new Map([['h', {
        value: { type: 'number', value: 177 },
        dimensionalType: dimensionalType(),
      }]]),
    };
    expect(parseCalc('calc(h + 180)', context)?.calculation).toEqual({
      type: 'number',
      value: 357,
    });
  });

  it('types an unresolved dimensional numeric variable', () => {
    const lengthType = dimensionalType(['length', 1]);
    const context: CalculationContext = {
      numericVariables: new Map([['x', {
        value: null,
        dimensionalType: lengthType,
      }]]),
    };
    const sum = parseCalc('calc(x + 1px)', context)
      ?.calculation as CalcSumNode;

    expect(sum.children).toEqual([
      { type: 'dimension', value: 1, unit: 'px' },
      {
        type: 'variable',
        name: 'x',
        dimensionalType: lengthType,
      },
    ]);
    expect(sum.dimensionalType).toEqual(lengthType);
  });

  it('simplifies an available dimensional variable', () => {
    const lengthType = dimensionalType(['length', 1]);
    const context: CalculationContext = {
      numericVariables: new Map([['x', {
        value: { type: 'dimension', value: 2, unit: 'px' },
        dimensionalType: lengthType,
      }]]),
    };
    expect(parseCalc('calc(x + 1px)', context)?.calculation).toEqual({
      type: 'dimension',
      value: 3,
      unit: 'px',
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
    });
  });

  it('limits calculation terms across nested groups', () => {
    const left = Array.from({ length: 16 }, () => 1).join(' + ');
    const right = Array.from({ length: 15 }, () => 1).join(' + ');

    expectBadCalc(`calc((${left}) + (${right}))`);
  });

  it('returns null without advancing for another functional notation', () => {
    const c = new ComponentCursor(parseListOfComponentValues('min(1) calc(2)'));

    expect(tryConsumeCalc(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

function dimensionalType(
  ...entries: (DimensionalExponent | DimensionalBaseType)[]
): DimensionalType {
  const last = entries.at(-1);
  const hasPercentHint = typeof last === 'string';
  const exponents = hasPercentHint
    ? entries.slice(0, -1)
    : entries;

  return {
    exponents: exponents as DimensionalType['exponents'],
    percentHint: hasPercentHint ? last : null,
  };
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

function parseRawCalculation(
  input: string,
  context: CalculationContext = {},
): CalculationTree {
  const values = parseListOfComponentValues(input);
  const c = new ComponentCursor(values, {
    context: {
      ...context,
      insideCalculation: true,
      termCount: 0,
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

function calculationValue(calculation: CalculationTree): number | undefined {
  return 'value' in calculation && typeof calculation.value === 'number'
    ? calculation.value
    : undefined;
}
