import { asciiLower } from '../../shared/css';
import type { ComponentCursor } from '../parser/component-cursor';
import {
  createDelimConsumer, createFunctionalNotationConsumer,
  tryConsumeIdentToken,
} from '../parser/component-consumers';
import { one, oneOf, repeat, sequenceOf, withComponentTrivia } from '../parser/component-grammar';
import {
  bad, ComponentConsumerBadReason, isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import {
  consumeComponentTrivia, isDelimToken, isParensBlock, parseAsComponentGrammar,
  type ParserInput,
} from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import { ANGLE_UNITS } from './angle';
import { tryConsumeDimension, type DimensionValue } from './dimension';
import { FREQUENCY_UNITS } from './frequency';
import { LENGTH_UNITS } from './length';
import { tryConsumeNumber, type NumberValue } from './number';
import { tryConsumePercentage, type PercentageValue } from './percentage';
import { RESOLUTION_UNITS } from './resolution';
import { TIME_UNITS } from './time';

const CALC_TERM_LIMIT = 32;

export type CalculationContext = {
  /** Whether the current grammar is nested inside another calculation. */
  insideCalculation?: boolean;

  /** Number of calculation terms consumed by the current calculation. */
  termCount?: number;

  /** Reserved for context-dependent percentage typing and resolution. */
  percentage?: never;

  /**
   * ASCII-lowercase numeric variable names and their values and types.
   * A null value represents a variable that has not resolved yet.
   */
  numericVariables?: ReadonlyMap<string, NumericVariable>;
};

export type NumericVariable = {
  value: NumberValue | DimensionValue | PercentageValue | null;
  dimensionalType: DimensionalType;
};

/*
 * <calc()> = calc( <calc-sum> )
 */

export type CalcValue = {
  type: 'calc';
  calculation: CalculationTree;
  dimensionalType: DimensionalType;
};

export type CalculationTree =
  | NumberValue
  | DimensionValue
  | PercentageValue
  | CalcVariableNode
  | CalcSumNode
  | CalcProductNode
  | CalcNegateNode
  | CalcInvertNode;

export function parseCalc(
  input: ParserInput,
  context: CalculationContext = {},
): CalcValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeCalc),
      context,
    ),
    'calc',
  );
}

export function tryConsumeCalc(
  c: ComponentCursor,
): TryComponentConsumerResult<CalcValue> {
  const result = consumeCalcCalculation(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const context = calculationContextFor(c.context);
  const dimensionalType = dimensionalTypeOf(result.value, context);

  if (
    dimensionalType === null ||
    (
      !context.insideCalculation &&
      resolvedDimensionalCategory(dimensionalType) === null
    )
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      'Invalid calculation type',
    );
  }

  return ok({
    type: 'calc',
    calculation: result.value,
    dimensionalType,
  });
}

const consumeCalcCalculation = createFunctionalNotationConsumer(
  'calc',
  tryConsumeCalcSum,
  (calculation) => calculation,
  {
    contextForArguments: enterCalculationContext,
  },
);

/*
 * <calc-sum> = <calc-product> [ [ '+' | '-' ] <calc-product> ]*
 */

export type CalcSumNode = {
  type: 'sum';
  children: [CalculationTree, CalculationTree, ...CalculationTree[]];
  dimensionalType: DimensionalType;
};

type CalcSumTail = {
  operator: '+' | '-';
  value: CalculationTree;
};

export function tryConsumeCalcSum(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return consumeCalcSum(c);
}

const consumeCalcSumTail: TryComponentConsumer<CalcSumTail> = sequenceOf(
  [
    one(tryConsumeCalcSumOperator),
    one(tryConsumeCalcProduct),
  ],
  ([[operator], [value]]) => ok({ operator, value }),
);

const consumeCalcSum: TryComponentConsumer<CalculationTree> = sequenceOf(
  [
    one(tryConsumeCalcProduct),
    repeat(consumeCalcSumTail, 0, CALC_TERM_LIMIT - 1),
  ],
  ([[first], tail], context) => {
    if (tail.length === 0) {
      return ok(first);
    }

    const calculationContext = calculationContextFor(context);
    const children: CalculationTree[] = [first];
    let dimensionalType = dimensionalTypeOf(
      first,
      calculationContext,
    );

    if (dimensionalType === null) {
      return bad(
        ComponentConsumerBadReason.Invalid,
        'Invalid calculation sum type',
      );
    }

    for (const { operator, value } of tail) {
      const valueType = dimensionalTypeOf(
        value,
        calculationContext,
      );

      if (valueType === null) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Invalid calculation sum type',
        );
      }

      if (operator === '+') {
        children.push(value);
      } else {
        children.push({
          type: 'negate',
          child: value,
          dimensionalType: valueType,
        });
      }

      const sumType = addDimensionalTypes(
        [dimensionalType, valueType],
      );

      if (sumType === null) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Inconsistent calculation sum types',
        );
      }

      dimensionalType = sumType;
    }

    return ok({
      type: 'sum',
      children: children as CalcSumNode['children'],
      dimensionalType,
    });
  },
);

function tryConsumeCalcSumOperator(
  c: ComponentCursor,
): TryComponentConsumerResult<'+' | '-'> {
  const start = c.pos();

  if (!c.match(TokenKind.Whitespace)) {
    return null;
  }

  consumeComponentTrivia(c);
  const component = c.next();

  if (!isDelimToken(component, '+') && !isDelimToken(component, '-')) {
    c.restore(start);
    return null;
  }

  if (!c.match(TokenKind.Whitespace)) {
    c.restore(start);
    return null;
  }

  consumeComponentTrivia(c);
  return ok(component.value as '+' | '-');
}

/*
 * <calc-product> = <calc-value> [ [ '*' | '/' ] <calc-value> ]*
 */

export type CalcProductNode = {
  type: 'product';
  children: [CalculationTree, CalculationTree, ...CalculationTree[]];
  dimensionalType: DimensionalType;
};

export type CalcNegateNode = {
  type: 'negate';
  child: CalculationTree;
  dimensionalType: DimensionalType;
};

export type CalcInvertNode = {
  type: 'invert';
  child: CalculationTree;
  dimensionalType: DimensionalType;
};

type CalcProductTail = {
  operator: '*' | '/';
  value: CalculationTree;
};

export function tryConsumeCalcProduct(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return consumeCalcProduct(c);
}

const tryConsumeAsterisk = createDelimConsumer('*');
const tryConsumeSlash = createDelimConsumer('/');

const tryConsumeCalcProductOperator: TryComponentConsumer<'*' | '/'> = oneOf(
  [
    one(tryConsumeAsterisk),
    one(tryConsumeSlash),
  ],
  ([operator]) => ok(operator),
);

const consumeCalcProductTail: TryComponentConsumer<CalcProductTail> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeCalcProductOperator)),
    one(withComponentTrivia(tryConsumeCalcValue)),
  ],
  ([[operator], [value]]) => ok({ operator, value }),
);

const consumeCalcProduct: TryComponentConsumer<CalculationTree> = sequenceOf(
  [
    one(tryConsumeCalcValue),
    repeat(consumeCalcProductTail, 0, CALC_TERM_LIMIT - 1),
  ],
  ([[first], tail], context) => {
    if (tail.length === 0) {
      return ok(first);
    }

    const calculationContext = calculationContextFor(context);
    const children: CalculationTree[] = [first];
    let dimensionalType = dimensionalTypeOf(
      first,
      calculationContext,
    );

    if (dimensionalType === null) {
      return bad(
        ComponentConsumerBadReason.Invalid,
        'Invalid calculation product type',
      );
    }

    for (const { operator, value } of tail) {
      const valueType = dimensionalTypeOf(
        value,
        calculationContext,
      );

      if (valueType === null) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Invalid calculation product type',
        );
      }

      const childType = operator === '*'
        ? valueType
        : invertDimensionalType(valueType);

      children.push(operator === '*'
        ? value
        : {
          type: 'invert',
          child: value,
          dimensionalType: childType,
        });
      const productType = multiplyDimensionalTypes(
        [dimensionalType, childType],
      );

      if (productType === null) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Inconsistent calculation product types',
        );
      }

      dimensionalType = productType;
    }

    return ok({
      type: 'product',
      children: children as CalcProductNode['children'],
      dimensionalType,
    });
  },
);

/*
 * <calc-value> = <number> | <dimension> | <percentage> |
 *                <calc-keyword> | ( <calc-sum> )
 *
 * Math functions are also calculation components. Nested calc() functions
 * are unwrapped because their parentheses provide equivalent grouping.
 */

export function tryConsumeCalcValue(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  const result = consumeCalcValue(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const context = calculationContextFor(c.context);

  if (
    context.termCount !== undefined
    && ++context.termCount > CALC_TERM_LIMIT
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Calculation exceeds ${CALC_TERM_LIMIT} terms`,
    );
  }

  return result;
}

const consumeCalcValue: TryComponentConsumer<CalculationTree> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumeDimension),
    one(tryConsumePercentage),
    one(tryConsumeCalcKeyword),
    one(tryConsumeParenthesizedCalcSum),
    one(tryConsumeNestedCalc),
  ],
  ([value]) => ok(value),
);

function tryConsumeParenthesizedCalcSum(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  const start = c.pos();
  const component = c.next();

  if (!isParensBlock(component)) {
    c.restore(start);
    return null;
  }

  const result = parseAsComponentGrammar(
    component.value,
    withComponentTrivia(tryConsumeCalcSum),
    c.context,
  );

  if (result === null) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      'Invalid parenthesized calculation',
    );
  }

  return result;
}

function tryConsumeNestedCalc(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  const result = tryConsumeCalc(c);

  if (result === null || isBad(result)) {
    return result;
  }

  return ok(result.value.calculation);
}

/*
 * <calc-keyword> = e | pi | infinity | -infinity | NaN
 *
 * A calculation context can define additional numeric variables.
 */

export type CalcVariableNode = {
  type: 'variable';
  name: string;
  dimensionalType: DimensionalType;
};

export function tryConsumeCalcKeyword(
  c: ComponentCursor,
): TryComponentConsumerResult<NumberValue | CalcVariableNode> {
  const start = c.pos();
  const token = tryConsumeIdentToken(c);

  if (token === null || isBad(token)) {
    return token;
  }

  const name = asciiLower(token.value.value);
  let value: number | undefined;

  switch (name) {
    case 'e': value = Math.E; break;
    case 'pi': value = Math.PI; break;
    case 'infinity': value = Infinity; break;
    case '-infinity': value = -Infinity; break;
    case 'nan': value = NaN; break;
    default:
      break;
  }

  if (value !== undefined) {
    return ok({ type: 'number', value });
  }

  const variable = calculationContextFor(c.context)
    .numericVariables?.get(name);

  if (variable === undefined) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'variable',
    name,
    dimensionalType: cloneDimensionalType(variable.dimensionalType),
  });
}

/*
 * Dimensional analysis
 */

export const DIMENSIONAL_BASE_TYPES = [
  'length',
  'angle',
  'time',
  'frequency',
  'resolution',
  'flex',
  'percent',
] as const;

export type DimensionalBaseType =
  (typeof DIMENSIONAL_BASE_TYPES)[number];

export type DimensionalExponent =
  readonly [base: DimensionalBaseType, power: number];

export type DimensionalType = {
  exponents: readonly DimensionalExponent[];
  percentHint: DimensionalBaseType | null;
};

export type ResolvedDimensionalCategory =
  | 'number'
  | DimensionalBaseType;

function dimensionalTypeOf(
  calculation: CalculationTree,
  context: CalculationContext,
): DimensionalType | null {
  return 'dimensionalType' in calculation
    ? cloneDimensionalType(calculation.dimensionalType)
    : determineDimensionalType(calculation, context);
}

export function determineDimensionalType(
  calculation: CalculationTree,
  context: CalculationContext = {},
): DimensionalType | null {
  switch (calculation.type) {
    case 'number':
      return numberDimensionalType();

    case 'percentage':
      return percentageDimensionalType(context);

    case 'dimension':
      return dimensionalTypeForUnit(calculation.unit);

    case 'variable':
      return cloneDimensionalType(calculation.dimensionalType);

    case 'sum':
      return addDimensionalTypes(
        calculation.children.map((child) => (
          determineDimensionalType(child, context)
        )),
      );

    case 'product':
      return multiplyDimensionalTypes(
        calculation.children.map((child) => (
          determineDimensionalType(child, context)
        )),
      );

    case 'negate':
      return determineDimensionalType(calculation.child, context);

    case 'invert': {
      const childType = determineDimensionalType(
        calculation.child,
        context,
      );

      return childType === null
        ? null
        : invertDimensionalType(childType);
    }
  }
}

export function addDimensionalTypes(
  types: readonly (DimensionalType | null)[],
): DimensionalType | null {
  const [first, ...rest] = types;

  if (first === null) {
    return null;
  }

  let result = first === undefined
    ? numberDimensionalType()
    : cloneDimensionalType(first);

  for (const type of rest) {
    if (type === null) {
      return null;
    }

    const sum = addTwoDimensionalTypes(result, type);

    if (sum === null) {
      return null;
    }

    result = sum;
  }

  return result;
}

export function multiplyDimensionalTypes(
  types: readonly (DimensionalType | null)[],
): DimensionalType | null {
  let result = numberDimensionalType();

  for (const type of types) {
    if (type === null) {
      return null;
    }

    const product = multiplyTwoDimensionalTypes(result, type);

    if (product === null) {
      return null;
    }

    result = product;
  }

  return result;
}

export function invertDimensionalType(
  type: DimensionalType,
): DimensionalType {
  return createDimensionalType(
    type.exponents.map(([base, power]) => [base, -power]),
    type.percentHint,
  );
}

export function resolvedDimensionalCategory(
  type: DimensionalType,
): ResolvedDimensionalCategory | null {
  if (type.exponents.length === 0) {
    return 'number';
  }

  if (type.exponents.length !== 1) {
    return null;
  }

  const [base, power] = type.exponents[0]!;
  return power === 1
    ? base
    : null;
}

function addTwoDimensionalTypes(
  a: DimensionalType,
  b: DimensionalType,
): DimensionalType | null {
  let left = cloneDimensionalType(a);
  let right = cloneDimensionalType(b);

  if (
    left.percentHint !== null &&
    right.percentHint !== null &&
    left.percentHint !== right.percentHint
  ) {
    return null;
  }

  if (left.percentHint !== null && right.percentHint === null) {
    right = applyPercentHint(right, left.percentHint);
  } else if (right.percentHint !== null && left.percentHint === null) {
    left = applyPercentHint(left, right.percentHint);
  }

  if (haveEqualExponents(left, right)) {
    return createDimensionalType(
      left.exponents,
      left.percentHint,
    );
  }

  if (!containMixedPercentAndDimension(left, right)) {
    return null;
  }

  const unhintedLeft = cloneDimensionalType(left);
  const unhintedRight = cloneDimensionalType(right);

  if (
    unhintedLeft.percentHint !== null ||
    unhintedRight.percentHint !== null
  ) {
    return null;
  }

  for (const hint of DIMENSIONAL_BASE_TYPES) {
    if (hint === 'percent') {
      continue;
    }

    const hintedLeft = applyPercentHint(unhintedLeft, hint);
    const hintedRight = applyPercentHint(unhintedRight, hint);

    if (haveEqualExponents(hintedLeft, hintedRight)) {
      return createDimensionalType(
        hintedLeft.exponents,
        hint,
      );
    }
  }

  return null;
}

function multiplyTwoDimensionalTypes(
  a: DimensionalType,
  b: DimensionalType,
): DimensionalType | null {
  let left = cloneDimensionalType(a);
  let right = cloneDimensionalType(b);

  if (
    left.percentHint !== null &&
    right.percentHint !== null &&
    left.percentHint !== right.percentHint
  ) {
    return null;
  }

  if (left.percentHint !== null && right.percentHint === null) {
    right = applyPercentHint(right, left.percentHint);
  } else if (right.percentHint !== null && left.percentHint === null) {
    left = applyPercentHint(left, right.percentHint);
  }

  const exponents = exponentMap(left);

  for (const [base, power] of right.exponents) {
    exponents.set(base, (exponents.get(base) ?? 0) + power);
  }

  return dimensionalTypeFromMap(exponents, left.percentHint);
}

function applyPercentHint(
  type: DimensionalType,
  hint: DimensionalBaseType,
): DimensionalType {
  const exponents = exponentMap(type);

  if (!exponents.has(hint)) {
    exponents.set(hint, 0);
  }

  if (hint !== 'percent' && exponents.has('percent')) {
    exponents.set(
      hint,
      (exponents.get(hint) ?? 0) + (exponents.get('percent') ?? 0),
    );
    exponents.set('percent', 0);
  }

  return dimensionalTypeFromMap(exponents, hint);
}

function dimensionalTypeForUnit(unit: string): DimensionalType | null {
  const normalized = asciiLower(unit);
  let base: DimensionalBaseType;

  if (LENGTH_UNITS.some((candidate) => candidate === normalized)) {
    base = 'length';
  } else if (ANGLE_UNITS.some((candidate) => candidate === normalized)) {
    base = 'angle';
  } else if (TIME_UNITS.some((candidate) => candidate === normalized)) {
    base = 'time';
  } else if (FREQUENCY_UNITS.some((candidate) => candidate === normalized)) {
    base = 'frequency';
  } else if (RESOLUTION_UNITS.some((candidate) => candidate === normalized)) {
    base = 'resolution';
  } else if (normalized === 'fr') {
    base = 'flex';
  } else {
    return null;
  }

  return createDimensionalType([[base, 1]], null);
}

function percentageDimensionalType(
  _context: CalculationContext,
): DimensionalType {
  return createDimensionalType([['percent', 1]], 'percent');
}

function numberDimensionalType(): DimensionalType {
  return createDimensionalType([], null);
}

function createDimensionalType(
  exponents: readonly DimensionalExponent[],
  percentHint: DimensionalBaseType | null,
): DimensionalType {
  const powers = new Map<DimensionalBaseType, number>(exponents);
  return dimensionalTypeFromMap(powers, percentHint);
}

function dimensionalTypeFromMap(
  powers: ReadonlyMap<DimensionalBaseType, number>,
  percentHint: DimensionalBaseType | null,
): DimensionalType {
  const exponents: DimensionalExponent[] = [];

  for (const base of DIMENSIONAL_BASE_TYPES) {
    const power = powers.get(base) ?? 0;

    if (power !== 0) {
      exponents.push([base, power]);
    }
  }

  return { exponents, percentHint };
}

function cloneDimensionalType(type: DimensionalType): DimensionalType {
  return createDimensionalType(type.exponents, type.percentHint);
}

function exponentMap(
  type: DimensionalType,
): Map<DimensionalBaseType, number> {
  return new Map(type.exponents);
}

function haveEqualExponents(
  a: DimensionalType,
  b: DimensionalType,
): boolean {
  if (a.exponents.length !== b.exponents.length) {
    return false;
  }

  return a.exponents.every(([base, power], index) => {
    const other = b.exponents[index];
    return other?.[0] === base && other[1] === power;
  });
}

function containMixedPercentAndDimension(
  a: DimensionalType,
  b: DimensionalType,
): boolean {
  const combined = [...a.exponents, ...b.exponents];
  return combined.some(([base, power]) => (
    base === 'percent' && power !== 0
  )) && combined.some(([base, power]) => (
    base !== 'percent' && power !== 0
  ));
}

function calculationContextFor(
  context: unknown,
): CalculationContext {
  return context === null || context === undefined
    ? {}
    : context;
}

function enterCalculationContext(
  context: unknown,
): CalculationContext {
  const calculationContext = calculationContextFor(context);

  if (calculationContext.insideCalculation) {
    calculationContext.termCount ??= 0;
    return calculationContext;
  }

  return { ...calculationContext, insideCalculation: true, termCount: 0 };
}
