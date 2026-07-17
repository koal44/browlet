import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import {
  parseCalc, tryConsumeCalc,
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

  it('builds a calculation tree with operator precedence', () => {
    expect(parseCalc('calc(1px + 2 * 3px - 4px / 2)')).toEqual({
      type: 'calc',
      dimensionalType: dimensionalType(['length', 1]),
      calculation: {
        type: 'sum',
        dimensionalType: dimensionalType(['length', 1]),
        children: [
          { type: 'dimension', value: 1, unit: 'px' },
          {
            type: 'product',
            dimensionalType: dimensionalType(['length', 1]),
            children: [
              { type: 'number', value: 2 },
              { type: 'dimension', value: 3, unit: 'px' },
            ],
          },
          {
            type: 'negate',
            dimensionalType: dimensionalType(['length', 1]),
            child: {
              type: 'product',
              dimensionalType: dimensionalType(['length', 1]),
              children: [
                { type: 'dimension', value: 4, unit: 'px' },
                {
                  type: 'invert',
                  dimensionalType: dimensionalType(),
                  child: { type: 'number', value: 2 },
                },
              ],
            },
          },
        ],
      },
    });
  });

  it('uses parenthesized calculations for grouping', () => {
    expect(parseCalc('calc((1 + 2) * 3)')).toEqual({
      type: 'calc',
      dimensionalType: dimensionalType(),
      calculation: {
        type: 'product',
        dimensionalType: dimensionalType(),
        children: [
          {
            type: 'sum',
            dimensionalType: dimensionalType(),
            children: [
              { type: 'number', value: 1 },
              { type: 'number', value: 2 },
            ],
          },
          { type: 'number', value: 3 },
        ],
      },
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
    const parsed = parseCalc('calc((1px / 1s) * 1s)');
    const outer = parsed?.calculation as CalcProductNode;
    const inner = outer.children[0] as CalcProductNode;

    expect(inner.dimensionalType).toEqual(dimensionalType(
      ['length', 1],
      ['time', -1],
    ));
    expect(outer.dimensionalType).toEqual(
      dimensionalType(['length', 1]),
    );
    expect(parsed?.dimensionalType).toEqual(
      dimensionalType(['length', 1]),
    );
  });

  it('records squared dimensions before a later inverse cancels them', () => {
    const parsed = parseCalc('calc((1px * 1em) / 1px)');
    const outer = parsed?.calculation as CalcProductNode;
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

    expect(sum.children[0]).toEqual({
      type: 'variable',
      name: 'h',
      dimensionalType: dimensionalType(),
    });
    expect(sum.dimensionalType).toEqual(dimensionalType());
  });

  it('preserves an available numeric variable for simplification', () => {
    const context: CalculationContext = {
      numericVariables: new Map([['h', {
        value: { type: 'number', value: 177 },
        dimensionalType: dimensionalType(),
      }]]),
    };
    const sum = parseCalc('calc(h + 180)', context)
      ?.calculation as CalcSumNode;

    expect(sum.children[0]).toEqual({
      type: 'variable',
      name: 'h',
      dimensionalType: dimensionalType(),
    });
    expect(sum.dimensionalType).toEqual(dimensionalType());
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

    expect(sum.children[0]).toEqual({
      type: 'variable',
      name: 'x',
      dimensionalType: lengthType,
    });
    expect(sum.dimensionalType).toEqual(lengthType);
  });

  it('preserves an available dimensional variable for simplification', () => {
    const lengthType = dimensionalType(['length', 1]);
    const context: CalculationContext = {
      numericVariables: new Map([['x', {
        value: { type: 'dimension', value: 2, unit: 'px' },
        dimensionalType: lengthType,
      }]]),
    };
    const sum = parseCalc('calc(x + 1px)', context)
      ?.calculation as CalcSumNode;

    expect(sum.children[0]).toEqual({
      type: 'variable',
      name: 'x',
      dimensionalType: lengthType,
    });
    expect(sum.dimensionalType).toEqual(lengthType);
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
    const calculation = parseCalc(`calc(${input})`)?.calculation as
      | CalcSumNode
      | undefined;

    expect(calculation?.type).toBe('sum');
    expect(calculation?.children).toHaveLength(32);
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

function expectBadCalc(input: string): void {
  const c = new ComponentCursor(parseListOfComponentValues(input));
  const result = tryConsumeCalc(c);

  expect(result).toMatchObject({ kind: 'bad' });
  expect(c.pos()).toBe(1);
}

function calculationValue(calculation: CalculationTree): number | undefined {
  return 'value' in calculation && typeof calculation.value === 'number'
    ? calculation.value
    : undefined;
}
