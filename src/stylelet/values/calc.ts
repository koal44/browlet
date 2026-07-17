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
import { ANGLE_UNITS, resolveAngle } from './angle';
import { tryConsumeDimension, type DimensionValue } from './dimension';
import { FREQUENCY_UNITS, resolveFrequency } from './frequency';
import {
  LENGTH_UNITS, tryResolveLength,
  type LengthResolutionContext,
} from './length';
import { tryConsumeNumber, type NumberValue } from './number';
import { tryConsumePercentage, type PercentageValue } from './percentage';
import { RESOLUTION_UNITS, resolveResolution } from './resolution';
import { TIME_UNITS, resolveTime } from './time';

const CALC_TERM_LIMIT = 32;

export type CalculationContext = CalculationSimplificationContext & {
  /** Whether the current grammar is nested inside another calculation. */
  insideCalculation?: boolean;

  /** Number of calculation terms consumed by the current calculation. */
  termCount?: number;
};

export type CalculationSimplificationContext = {
  /** Context used to reduce lengths to the canonical px unit. */
  length?: LengthResolutionContext;

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
    calculation: simplifyCalculationTree(result.value, context),
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

// █████▌ █   ▐▌ ████▌  █████▌  ███▌
//   █▌   ▐▌  █  █▌  █▌ █▌     █▌  █▌
//   █▌    █ ▐▌  █▌  █▌ █▌     █▌
//   █▌    ▐▌█   ████▌  ████    ███▌
//   █▌     █▌   █▌     █▌         █▌
//   █▌     █▌   █▌     █▌     █▌  █▌
//   █▌     █▌   █▌     █████▌  ███▌
//
// Dimensional Analysis

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

//  ███▌  ████ █     █ ████▌  █▌
// █▌  █▌  ▐▌  ██   ██ █▌  █▌ █▌
// █▌      ▐▌  █▌█ █▐█ █▌  █▌ █▌
//  ███▌   ▐▌  █▌ █ ▐█ ████▌  █▌
//     █▌  ▐▌  █▌   ▐█ █▌     █▌
// █▌  █▌  ▐▌  █▌   ▐█ █▌     █▌
//  ███▌  ████ █▌   ▐█ █▌     █████

export function simplifyCalculationTree(
  root: CalculationTree,
  context: CalculationSimplificationContext = {},
): CalculationTree {
  switch (root.type) {
    case 'number':
    case 'percentage':
      return root;

    case 'dimension':
      return canonicalizeDimension(root, context);

    case 'variable': {
      const value = context.numericVariables?.get(root.name)?.value;
      return value === null || value === undefined
        ? root
        : simplifyCalculationTree(value, context);
    }

    case 'negate':
      return simplifyNegate(root, context);

    case 'invert':
      return simplifyInvert(root, context);

    case 'sum':
      return simplifySum(root, context);

    case 'product':
      return simplifyProduct(root, context);
  }
}

function simplifyNegate(
  root: CalcNegateNode,
  context: CalculationSimplificationContext,
): CalculationTree {
  const child = simplifyCalculationTree(root.child, context);

  if (isCalculationNumericValue(child)) {
    return negateNumericValue(child);
  }

  if (child.type === 'negate') {
    return child.child;
  }

  if (child.type === 'sum') {
    return {
      type: 'sum',
      children: child.children.map((grandchild) => {
        if (isCalculationNumericValue(grandchild)) {
          return negateNumericValue(grandchild);
        }

        if (grandchild.type === 'negate') {
          return grandchild.child;
        }

        return createNegateNode(grandchild, context);
      }) as CalcSumNode['children'],
      dimensionalType: cloneDimensionalType(root.dimensionalType),
    };
  }

  return {
    ...root,
    child,
    dimensionalType: cloneDimensionalType(root.dimensionalType),
  };
}

function simplifyInvert(
  root: CalcInvertNode,
  context: CalculationSimplificationContext,
): CalculationTree {
  const child = simplifyCalculationTree(root.child, context);

  if (child.type === 'number') {
    return { type: 'number', value: 1 / child.value };
  }

  if (child.type === 'invert') {
    return child.child;
  }

  return {
    ...root,
    child,
    dimensionalType: cloneDimensionalType(root.dimensionalType),
  };
}

function simplifySum(
  root: CalcSumNode,
  context: CalculationSimplificationContext,
): CalculationTree {
  const simplified = root.children.map((child) => (
    simplifyCalculationTree(child, context)
  ));
  const flattened = simplified.flatMap((child) => (
    child.type === 'sum' ? child.children : [child]
  ));
  const children = combineLikeNumericValues(flattened);

  if (children.length === 1) {
    return children[0]!;
  }

  return {
    ...root,
    children: children as CalcSumNode['children'],
    dimensionalType: cloneDimensionalType(root.dimensionalType),
  };
}

function simplifyProduct(
  root: CalcProductNode,
  context: CalculationSimplificationContext,
): CalculationTree {
  const simplified = root.children.map((child) => (
    simplifyCalculationTree(child, context)
  ));
  const flattened = simplified.flatMap((child) => (
    child.type === 'product' ? child.children : [child]
  ));
  const children = combineProductNumbers(flattened);

  if (children.length === 2) {
    const number = children.find((child) => child.type === 'number');
    const sum = children.find((child) => child.type === 'sum');

    if (
      number?.type === 'number' &&
      sum?.type === 'sum' &&
      sum.children.every(isCalculationNumericValue)
    ) {
      return {
        type: 'sum',
        children: sum.children.map((child) => (
          multiplyNumericValue(
            child as CalculationNumericValue,
            number.value,
          )
        )) as CalcSumNode['children'],
        dimensionalType: cloneDimensionalType(root.dimensionalType),
      };
    }
  }

  const product = evaluateNumericProduct(
    children,
    root.dimensionalType,
  );

  if (product !== null) {
    return product;
  }

  return {
    ...root,
    children: children as CalcProductNode['children'],
    dimensionalType: cloneDimensionalType(root.dimensionalType),
  };
}

type CalculationNumericValue =
  | NumberValue
  | DimensionValue
  | PercentageValue;

function isCalculationNumericValue(
  value: CalculationTree,
): value is CalculationNumericValue {
  return (
    value.type === 'number' ||
    value.type === 'dimension' ||
    value.type === 'percentage'
  );
}

function multiplyNumericValue(
  value: CalculationNumericValue,
  multiplier: number,
): CalculationNumericValue {
  return { ...value, value: value.value * multiplier };
}

function negateNumericValue(
  value: CalculationNumericValue,
): CalculationNumericValue {
  return { ...value, value: 0 - value.value };
}

function createNegateNode(
  child: CalculationTree,
  context: CalculationSimplificationContext,
): CalcNegateNode {
  const dimensionalType = dimensionalTypeOf(child, context);

  if (dimensionalType === null) {
    throw new TypeError('Cannot negate an invalid calculation type');
  }

  return {
    type: 'negate',
    child,
    dimensionalType,
  };
}

function combineLikeNumericValues(
  children: readonly CalculationTree[],
): CalculationTree[] {
  const totals = new Map<string, number>();

  for (const child of children) {
    if (isCalculationNumericValue(child)) {
      const key = numericUnitKey(child);
      totals.set(
        key,
        totals.has(key) ? totals.get(key)! + child.value : child.value,
      );
    }
  }

  const emitted = new Set<string>();
  const combined: CalculationTree[] = [];

  for (const child of children) {
    if (!isCalculationNumericValue(child)) {
      combined.push(child);
      continue;
    }

    const key = numericUnitKey(child);

    if (!emitted.has(key)) {
      combined.push({
        ...child,
        value: totals.get(key)!,
      });
      emitted.add(key);
    }
  }

  return combined;
}

function numericUnitKey(value: CalculationNumericValue): string {
  switch (value.type) {
    case 'number':
      return 'number';
    case 'percentage':
      return 'percentage';
    case 'dimension':
      return `dimension:${value.unit}`;
  }
}

function combineProductNumbers(
  children: readonly CalculationTree[],
): CalculationTree[] {
  const numbers = children.filter((child) => child.type === 'number');

  if (numbers.length < 2) {
    return [...children];
  }

  const product = numbers.reduce(
    (value, number) => value * number.value,
    1,
  );
  const combined: CalculationTree[] = [];
  let emitted = false;

  for (const child of children) {
    if (child.type !== 'number') {
      combined.push(child);
      continue;
    }

    if (!emitted) {
      combined.push({ type: 'number', value: product });
      emitted = true;
    }
  }

  return combined;
}

function evaluateNumericProduct(
  children: readonly CalculationTree[],
  dimensionalType: DimensionalType,
): CalculationNumericValue | null {
  if (!children.every(isNumericProductFactor)) {
    return null;
  }

  const units = new Map<string, number>();
  let value = 1;

  for (const child of children) {
    const inverted = child.type === 'invert';
    const factor = inverted ? child.child : child;
    const exponent = inverted ? -1 : 1;
    value = inverted
      ? value / factor.value
      : value * factor.value;

    if (factor.type === 'percentage') {
      units.set('%', (units.get('%') ?? 0) + exponent);
    } else if (factor.type === 'dimension') {
      const unit = asciiLower(factor.unit);
      units.set(unit, (units.get(unit) ?? 0) + exponent);
    }
  }

  const remaining = [...units].filter(([, power]) => power !== 0);
  const category = resolvedDimensionalCategory(dimensionalType);

  if (remaining.length === 0) {
    return category === 'number'
      ? { type: 'number', value }
      : null;
  }

  if (remaining.length !== 1 || remaining[0]![1] !== 1) {
    return null;
  }

  const unit = remaining[0]![0];

  if (unit === '%') {
    return category === 'percent'
      ? { type: 'percentage', value }
      : null;
  }

  const unitType = dimensionalTypeForUnit(unit);

  if (
    unitType === null ||
    resolvedDimensionalCategory(unitType) !== category
  ) {
    return null;
  }

  return { type: 'dimension', value, unit };
}

function isNumericProductFactor(
  value: CalculationTree,
): value is CalculationNumericValue | (
  CalcInvertNode & { child: CalculationNumericValue; }
) {
  return (
    isCalculationNumericValue(value) ||
    (value.type === 'invert' && isCalculationNumericValue(value.child))
  );
}

function canonicalizeDimension(
  value: DimensionValue,
  context: CalculationSimplificationContext,
): DimensionValue {
  const unit = asciiLower(value.unit);
  let resolved: DimensionValue<string, string> | null;

  if (isUnit(LENGTH_UNITS, unit)) {
    resolved = tryResolveLength(
      {
        type: 'length',
        value: value.value,
        unit,
      },
      context.length,
    );
  } else if (isUnit(ANGLE_UNITS, unit)) {
    resolved = resolveAngle({
      type: 'angle',
      value: value.value,
      unit,
    });
  } else if (isUnit(TIME_UNITS, unit)) {
    resolved = resolveTime({
      type: 'time',
      value: value.value,
      unit,
    });
  } else if (isUnit(FREQUENCY_UNITS, unit)) {
    resolved = resolveFrequency({
      type: 'frequency',
      value: value.value,
      unit,
    });
  } else if (isUnit(RESOLUTION_UNITS, unit)) {
    resolved = resolveResolution({
      type: 'resolution',
      value: value.value,
      unit,
    });
  } else if (unit === 'fr') {
    resolved = { type: 'dimension', value: value.value, unit };
  } else {
    return value;
  }

  return resolved === null
    ? { ...value, unit }
    : {
      type: 'dimension',
      value: resolved.value,
      unit: resolved.unit,
    };
}

function isUnit<Unit extends string>(
  units: readonly Unit[],
  value: string,
): value is Unit {
  return units.some((unit) => unit === value);
}
