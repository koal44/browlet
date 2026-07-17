import { asciiLower } from '../../shared/css';
import type { ComponentCursor } from '../parser/component-cursor';
import {
  createDelimConsumer, createFunctionalNotationConsumer, createIdentValueConsumer,
  tryConsumeIdentToken,
} from '../parser/component-consumers';
import {
  commaRepeat, one, oneOf, opt, repeat, sequenceOf, withComponentTrivia,
} from '../parser/component-grammar';
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
import {
  serializeDimension, tryConsumeDimension,
  type DimensionValue,
} from './dimension';
import { FREQUENCY_UNITS, resolveFrequency } from './frequency';
import { serializeIdentifier } from './ident';
import {
  LENGTH_UNITS, tryResolveLength,
  type LengthResolutionContext,
} from './length';
import {
  serializeNumber, tryConsumeNumber,
  type NumberValue,
} from './number';
import {
  serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';
import { RESOLUTION_UNITS, resolveResolution } from './resolution';
import { TIME_UNITS, resolveTime } from './time';

const CALC_TERM_LIMIT = 32;

export type ExpectedCalculationType =
  | 'number'
  | 'integer'
  | 'percentage'
  | 'length'
  | 'angle'
  | 'time'
  | 'frequency'
  | 'resolution'
  | 'flex'
  | 'length-percentage'
  | 'angle-percentage'
  | 'time-percentage'
  | 'frequency-percentage';

export type CalculationContext = CalculationSimplificationContext & {
  /** Whether the current grammar is nested inside another calculation. */
  insideCalculation?: boolean;

  /** Number of calculation terms consumed by the current calculation. */
  termCount?: number;

  /** Numeric production the outermost calculation must match. */
  expectedType?: ExpectedCalculationType;
};

export type CalculationSimplificationContext = {
  /** Context used to reduce lengths to the canonical px unit. */
  length?: LengthResolutionContext;

  /**
   * Dimensional type against which percentages resolve. Percentages retain
   * their percentage type when this is omitted.
   */
  percentageType?: DimensionalBaseType;

  /** Numeric value against which percentages can be resolved. */
  percentageReferenceValue?: NumberValue | DimensionValue;

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

export const ROUNDING_STRATEGIES = [
  'nearest',
  'up',
  'down',
  'to-zero',
  'line-width',
] as const;

export type RoundingStrategy =
  (typeof ROUNDING_STRATEGIES)[number];

type VariadicMathFunctionName = 'min' | 'max' | 'hypot';
type BinaryMathFunctionName = 'mod' | 'rem' | 'atan2' | 'pow';
type UnaryMathFunctionName =
  | 'sin'
  | 'cos'
  | 'tan'
  | 'asin'
  | 'acos'
  | 'atan'
  | 'sqrt'
  | 'exp'
  | 'abs'
  | 'sign';

export type CalcVariadicFunctionNode<
  Name extends VariadicMathFunctionName = VariadicMathFunctionName,
> = {
  type: Name;
  children: [CalculationTree, ...CalculationTree[]];
  dimensionalType: DimensionalType;
};

export type CalcClampNode = {
  type: 'clamp';
  children: [
    minimum: CalculationTree | null,
    value: CalculationTree,
    maximum: CalculationTree | null,
  ];
  dimensionalType: DimensionalType;
};

export type CalcRoundNode = {
  type: 'round';
  strategy: RoundingStrategy;
  children: [value: CalculationTree, step?: CalculationTree];
  dimensionalType: DimensionalType;
};

export type CalcBinaryFunctionNode<
  Name extends BinaryMathFunctionName = BinaryMathFunctionName,
> = {
  type: Name;
  children: [CalculationTree, CalculationTree];
  dimensionalType: DimensionalType;
};

export type CalcUnaryFunctionNode<
  Name extends UnaryMathFunctionName = UnaryMathFunctionName,
> = {
  type: Name;
  children: [CalculationTree];
  dimensionalType: DimensionalType;
};

export type CalcLogNode = {
  type: 'log';
  children: [value: CalculationTree, base?: CalculationTree];
  dimensionalType: DimensionalType;
};

export type MathFunctionNode =
  | CalcVariadicFunctionNode
  | CalcClampNode
  | CalcRoundNode
  | CalcBinaryFunctionNode
  | CalcUnaryFunctionNode
  | CalcLogNode;

export type MathFunctionValue = CalcValue | MathFunctionNode;

export type CalculationTree =
  | NumberValue
  | DimensionValue
  | PercentageValue
  | CalcVariableNode
  | CalcSumNode
  | CalcProductNode
  | CalcNegateNode
  | CalcInvertNode
  | MathFunctionNode;

export function parseMathFunction(
  input: ParserInput,
  context: CalculationContext = {},
): MathFunctionValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeMathFunction),
      context,
    ),
    'math function',
  );
}

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
      !matchesCalculationContext(dimensionalType, context)
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
 * <min()>   = min( <calc-sum># )
 * <max()>   = max( <calc-sum># )
 * <clamp()> = clamp( [ <calc-sum> | none ], <calc-sum>,
 *                    [ <calc-sum> | none ] )
 * <round()> = round( <rounding-strategy>?, <calc-sum>, <calc-sum>? )
 * <mod()>   = mod( <calc-sum>, <calc-sum> )
 * <rem()>   = rem( <calc-sum>, <calc-sum> )
 * <sin()>   = sin( <calc-sum> )
 * <cos()>   = cos( <calc-sum> )
 * <tan()>   = tan( <calc-sum> )
 * <asin()>  = asin( <calc-sum> )
 * <acos()>  = acos( <calc-sum> )
 * <atan()>  = atan( <calc-sum> )
 * <atan2()> = atan2( <calc-sum>, <calc-sum> )
 * <pow()>   = pow( <calc-sum>, <calc-sum> )
 * <sqrt()>  = sqrt( <calc-sum> )
 * <hypot()> = hypot( <calc-sum># )
 * <log()>   = log( <calc-sum>, <calc-sum>? )
 * <exp()>   = exp( <calc-sum> )
 * <abs()>   = abs( <calc-sum> )
 * <sign()>  = sign( <calc-sum> )
 */

export const tryConsumeMin = createVariadicMathFunctionConsumer('min');
export const tryConsumeMax = createVariadicMathFunctionConsumer('max');
export const tryConsumeClamp = createClampConsumer();
export const tryConsumeRound = createRoundConsumer();
export const tryConsumeMod = createBinaryMathFunctionConsumer(
  'mod',
  'consistent',
  undefined,
  true,
);
export const tryConsumeRem = createBinaryMathFunctionConsumer(
  'rem',
  'consistent',
  undefined,
  true,
);
export const tryConsumeSin = createUnaryMathFunctionConsumer(
  'sin',
  'number',
  ['number', 'angle'],
);
export const tryConsumeCos = createUnaryMathFunctionConsumer(
  'cos',
  'number',
  ['number', 'angle'],
);
export const tryConsumeTan = createUnaryMathFunctionConsumer(
  'tan',
  'number',
  ['number', 'angle'],
);
export const tryConsumeAsin = createUnaryMathFunctionConsumer(
  'asin',
  'angle',
  ['number'],
);
export const tryConsumeAcos = createUnaryMathFunctionConsumer(
  'acos',
  'angle',
  ['number'],
);
export const tryConsumeAtan = createUnaryMathFunctionConsumer(
  'atan',
  'angle',
  ['number'],
);
export const tryConsumeAtan2 = createBinaryMathFunctionConsumer(
  'atan2',
  'angle',
);
export const tryConsumePow = createBinaryMathFunctionConsumer(
  'pow',
  'number',
  ['number'],
);
export const tryConsumeSqrt = createUnaryMathFunctionConsumer(
  'sqrt',
  'number',
  ['number'],
);
export const tryConsumeHypot = createVariadicMathFunctionConsumer('hypot');
export const tryConsumeLog = createLogConsumer();
export const tryConsumeExp = createUnaryMathFunctionConsumer(
  'exp',
  'number',
  ['number'],
);
export const tryConsumeAbs = createUnaryMathFunctionConsumer(
  'abs',
  'consistent',
);
export const tryConsumeSign = createUnaryMathFunctionConsumer(
  'sign',
  'number',
);

const tryConsumeNonCalcMathFunction: TryComponentConsumer<MathFunctionNode> =
  oneOf(
    [
      one(tryConsumeMin), one(tryConsumeMax), one(tryConsumeClamp),
      one(tryConsumeRound), one(tryConsumeMod), one(tryConsumeRem),
      one(tryConsumeSin), one(tryConsumeCos), one(tryConsumeTan),
      one(tryConsumeAsin), one(tryConsumeAcos), one(tryConsumeAtan),
      one(tryConsumeAtan2), one(tryConsumePow), one(tryConsumeSqrt),
      one(tryConsumeHypot), one(tryConsumeLog), one(tryConsumeExp),
      one(tryConsumeAbs), one(tryConsumeSign),
    ],
    ([value]) => ok(value),
  );

export const tryConsumeMathFunction: TryComponentConsumer<MathFunctionValue> =
  oneOf(
    [
      one(tryConsumeCalc),
      one(tryConsumeNonCalcMathFunction),
    ],
    ([value]) => ok(value),
  );

type FunctionResultType = 'consistent' | 'number' | 'angle';

function createVariadicMathFunctionConsumer<
  Name extends VariadicMathFunctionName,
>(
  name: Name,
): TryComponentConsumer<CalcVariadicFunctionNode<Name>> {
  const consumeArguments = sequenceOf(
    [commaRepeat(tryConsumeCalcSum, 1, CALC_TERM_LIMIT)],
    ([children], context) => createMathFunctionNode<
      CalcVariadicFunctionNode<Name>
    >(
      name,
      children,
      'consistent',
      calculationContextFor(context),
    ),
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createBinaryMathFunctionConsumer<
  Name extends BinaryMathFunctionName,
>(
  name: Name,
  resultType: FunctionResultType,
  allowedCategories?: readonly ResolvedDimensionalCategory[],
  requireSameType = false,
): TryComponentConsumer<CalcBinaryFunctionNode<Name>> {
  const consumeArguments = sequenceOf(
    [commaRepeat(tryConsumeCalcSum, 2, 2)],
    ([children], context) => {
      const [first, second] = children;

      if (first === undefined || second === undefined) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          `Invalid ${name}() arguments`,
        );
      }

      return createMathFunctionNode<CalcBinaryFunctionNode<Name>>(
        name,
        [first, second],
        resultType,
        calculationContextFor(context),
        allowedCategories,
        requireSameType,
      );
    },
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createUnaryMathFunctionConsumer<
  Name extends UnaryMathFunctionName,
>(
  name: Name,
  resultType: FunctionResultType,
  allowedCategories?: readonly ResolvedDimensionalCategory[],
): TryComponentConsumer<CalcUnaryFunctionNode<Name>> {
  const consumeArguments = sequenceOf(
    [one(tryConsumeCalcSum)],
    ([[child]], context) => createMathFunctionNode<
      CalcUnaryFunctionNode<Name>
    >(
      name,
      [child],
      resultType,
      calculationContextFor(context),
      allowedCategories,
    ),
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createClampConsumer(): TryComponentConsumer<CalcClampNode> {
  const consumeArgument: TryComponentConsumer<CalculationTree | null> = oneOf(
    [
      one(tryConsumeCalcSum),
      one(createIdentValueConsumer('none')),
    ],
    ([value]) => ok(value === 'none' ? null : value),
  );
  const consumeArguments = sequenceOf(
    [commaRepeat(consumeArgument, 3, 3)],
    ([children], context) => {
      const [minimum, value, maximum] = children;

      if (
        minimum === undefined ||
        value === undefined ||
        value === null ||
        maximum === undefined
      ) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Invalid clamp() arguments',
        );
      }

      const result = createMathFunctionNode<CalcClampNode>(
        'clamp',
        [minimum, value, maximum],
        'consistent',
        calculationContextFor(context),
      );

      return result;
    },
  );

  return createMathFunctionConsumer('clamp', consumeArguments);
}

function createRoundConsumer(): TryComponentConsumer<CalcRoundNode> {
  const consumeArguments = sequenceOf(
    [
      opt(tryConsumeRoundingStrategyPrefix),
      commaRepeat(tryConsumeCalcSum, 1, 2),
    ],
    ([[explicitStrategy], children], context) => {
      const [value, step] = children;

      const strategy = explicitStrategy ?? 'nearest';
      const calculationContext = calculationContextFor(context);
      const valueType = dimensionalTypeOf(value, calculationContext);
      const valueCategory = valueType === null
        ? null
        : resolvedDimensionalCategory(valueType);

      if (
        valueCategory === null ||
        (strategy === 'line-width' && valueCategory !== 'length') ||
        (
          step === undefined &&
          valueCategory !== 'number' &&
          strategy !== 'line-width'
        )
      ) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Invalid round() argument type',
        );
      }

      return createMathFunctionNode<CalcRoundNode>(
        'round',
        step === undefined ? [value] : [value, step],
        'consistent',
        calculationContext,
        undefined,
        false,
        { strategy },
      );
    },
  );

  return createMathFunctionConsumer('round', consumeArguments);
}

function createLogConsumer(): TryComponentConsumer<CalcLogNode> {
  const consumeArguments = sequenceOf(
    [commaRepeat(tryConsumeCalcSum, 1, 2)],
    ([children], context) => {
      const [value, base] = children;

      return createMathFunctionNode<CalcLogNode>(
        'log',
        base === undefined ? [value] : [value, base],
        'number',
        calculationContextFor(context),
        ['number'],
      );
    },
  );

  return createMathFunctionConsumer('log', consumeArguments);
}

function createMathFunctionConsumer<Node extends MathFunctionNode>(
  name: string,
  consumeArguments: TryComponentConsumer<Node>,
): TryComponentConsumer<Node> {
  const consume = createFunctionalNotationConsumer(
    name,
    consumeArguments,
    (node) => node,
    {
      contextForArguments: enterCalculationContext,
    },
  );

  return (c) => {
    const result = consume(c);

    if (result === null || isBad(result)) {
      return result;
    }

    const context = calculationContextFor(c.context);

    if (
      !context.insideCalculation &&
      !matchesCalculationContext(result.value.dimensionalType, context)
    ) {
      return bad(
        ComponentConsumerBadReason.Invalid,
        'Invalid calculation type',
      );
    }

    return ok(simplifyCalculationTree(
      result.value,
      context,
    ) as Node);
  };
}

function createMathFunctionNode<
  Node extends MathFunctionNode,
>(
  type: Node['type'],
  children: Node['children'],
  resultType: FunctionResultType,
  context: CalculationContext,
  allowedCategories?: readonly ResolvedDimensionalCategory[],
  requireSameType = false,
  extra?: Omit<Node, 'type' | 'children' | 'dimensionalType'>,
): TryComponentConsumerResult<Node> {
  const calculations = children.filter(
    (child): child is CalculationTree => child !== null,
  );
  const argumentTypes = calculations.map((child) => (
    dimensionalTypeOf(child, context)
  ));

  if (argumentTypes.some((argumentType) => argumentType === null)) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Invalid ${type}() argument type`,
    );
  }

  const types = argumentTypes as DimensionalType[];
  const categories = types.map(resolvedDimensionalCategory);

  if (
    categories.some((category) => category === null) ||
    (
      allowedCategories !== undefined &&
      categories.some((category) => (
        !allowedCategories.includes(category!)
      ))
    ) ||
    (
      requireSameType &&
      !types.every((argumentType) => (
        haveSameDimensionalType(argumentType, types[0]!)
      ))
    )
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Invalid ${type}() argument type`,
    );
  }

  const consistentType = addDimensionalTypes(types);

  if (consistentType === null) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Inconsistent ${type}() argument types`,
    );
  }

  let dimensionalType: DimensionalType;

  switch (resultType) {
    case 'consistent':
      dimensionalType = consistentType;
      break;
    case 'number':
      dimensionalType = createDimensionalType(
        [],
        consistentType.percentHint,
      );
      break;
    case 'angle':
      dimensionalType = createDimensionalType(
        [['angle', 1]],
        consistentType.percentHint,
      );
      break;
  }

  if (resolvedDimensionalCategory(dimensionalType) === null) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Invalid ${type}() result type`,
    );
  }

  return ok({
    type,
    children,
    dimensionalType,
    ...extra,
  } as Node);
}

export const tryConsumeRoundingStrategy: TryComponentConsumer<RoundingStrategy> =
  oneOf(
    [
      one(createIdentValueConsumer('nearest')),
      one(createIdentValueConsumer('up')),
      one(createIdentValueConsumer('down')),
      one(createIdentValueConsumer('to-zero')),
      one(createIdentValueConsumer('line-width')),
    ],
    ([strategy]) => ok(strategy),
  );

function tryConsumeRoundingStrategyPrefix(
  c: ComponentCursor,
): TryComponentConsumerResult<RoundingStrategy> {
  const start = c.pos();
  const strategy = tryConsumeRoundingStrategy(c);

  if (strategy === null || isBad(strategy)) {
    return strategy;
  }

  consumeComponentTrivia(c);

  if (!c.match(TokenKind.Comma)) {
    c.restore(start);
    return bad(
      ComponentConsumerBadReason.Invalid,
      'Expected a comma after the round() strategy',
    );
  }

  consumeComponentTrivia(c);
  return strategy;
}

function haveSameDimensionalType(
  a: DimensionalType,
  b: DimensionalType,
): boolean {
  return (
    a.percentHint === b.percentHint &&
    haveEqualExponents(a, b)
  );
}

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

const tryConsumeCalculationMathFunction: TryComponentConsumer<CalculationTree> =
  oneOf(
    [
      one(tryConsumeNestedCalc),
      one(tryConsumeNonCalcMathFunction),
    ],
    ([value]) => ok(value),
  );

const consumeCalcValue: TryComponentConsumer<CalculationTree> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumeDimension),
    one(tryConsumePercentage),
    one(tryConsumeCalcKeyword),
    one(tryConsumeParenthesizedCalcSum),
    one(tryConsumeCalculationMathFunction),
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

    case 'min': case 'max': case 'clamp':
    case 'round': case 'mod': case 'rem':
    case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'atan2':
    case 'pow': case 'sqrt': case 'hypot': case 'log': case 'exp':
    case 'abs': case 'sign': // Sign-related functions
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

function matchesCalculationContext(
  type: DimensionalType,
  context: CalculationContext,
): boolean {
  const expectedType = context.expectedType;

  if (expectedType === undefined) {
    return resolvedDimensionalCategory(type) !== null;
  }

  switch (expectedType) {
    case 'number':
    case 'integer':
      return matchesNumberType(type, context.percentageType);

    case 'percentage':
      return matchesPercentageType(type);

    case 'length':
    case 'angle':
    case 'time':
    case 'frequency':
    case 'resolution':
    case 'flex':
      return matchesDimensionType(
        type,
        expectedType,
        context.percentageType === expectedType
          ? expectedType
          : null,
      );

    case 'length-percentage':
      return matchesMixedType(type, 'length');

    case 'angle-percentage':
      return matchesMixedType(type, 'angle');

    case 'time-percentage':
      return matchesMixedType(type, 'time');

    case 'frequency-percentage':
      return matchesMixedType(type, 'frequency');
  }
}

function matchesNumberType(
  type: DimensionalType,
  percentageType: DimensionalBaseType | undefined,
): boolean {
  return (
    type.exponents.length === 0 &&
    (
      type.percentHint === null ||
      (
        percentageType !== undefined &&
        type.percentHint === percentageType
      )
    )
  );
}

function matchesPercentageType(type: DimensionalType): boolean {
  return (
    hasSingleExponent(type, 'percent') &&
    (
      type.percentHint === null ||
      type.percentHint === 'percent'
    )
  );
}

function matchesDimensionType(
  type: DimensionalType,
  base: Exclude<DimensionalBaseType, 'percent'>,
  percentageType: DimensionalBaseType | null,
): boolean {
  return (
    hasSingleExponent(type, base) &&
    (
      type.percentHint === null ||
      type.percentHint === percentageType
    )
  );
}

function matchesMixedType(
  type: DimensionalType,
  base: 'length' | 'angle' | 'time' | 'frequency',
): boolean {
  return (
    matchesDimensionType(type, base, base) ||
    matchesPercentageType(type)
  );
}

function hasSingleExponent(
  type: DimensionalType,
  base: DimensionalBaseType,
): boolean {
  return (
    type.exponents.length === 1 &&
    type.exponents[0]![0] === base &&
    type.exponents[0]![1] === 1
  );
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
  context: CalculationContext,
): DimensionalType {
  const hint = context.percentageType ?? 'percent';
  return createDimensionalType([[hint, 1]], hint);
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
      return root;

    case 'percentage':
      return resolvePercentage(root, context);

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

    case 'min': case 'max': case 'clamp':
    case 'round': case 'mod': case 'rem':
    case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'atan2':
    case 'pow': case 'sqrt': case 'hypot': case 'log': case 'exp':
    case 'abs': case 'sign':
      return simplifyMathFunctionNode(root, context);
  }
}

function simplifyMathFunctionNode<Node extends MathFunctionNode>(
  root: Node,
  context: CalculationSimplificationContext,
): Node {
  return {
    ...root,
    children: root.children.map((child) => (
      child === null || child === undefined
        ? child
        : simplifyCalculationTree(child, context)
    )),
    dimensionalType: cloneDimensionalType(root.dimensionalType),
  };
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
  const children = sortCalculationChildren(
    combineLikeNumericValues(flattened),
  );

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
  const children = sortCalculationChildren(
    combineProductNumbers(flattened),
  );

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

function sortCalculationChildren(
  children: readonly CalculationTree[],
): CalculationTree[] {
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const rank = calculationChildSortRank(a.child) -
        calculationChildSortRank(b.child);

      if (rank !== 0) {
        return rank;
      }

      if (a.child.type === 'dimension' && b.child.type === 'dimension') {
        const aUnit = asciiLower(a.child.unit);
        const bUnit = asciiLower(b.child.unit);

        if (aUnit < bUnit) {
          return -1;
        }

        if (aUnit > bUnit) {
          return 1;
        }
      }

      return a.index - b.index;
    })
    .map(({ child }) => child);
}

function calculationChildSortRank(value: CalculationTree): number {
  switch (value.type) {
    case 'number':
      return 0;
    case 'percentage':
      return 1;
    case 'dimension':
      return 2;
    default:
      return 3;
  }
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

function resolvePercentage(
  value: PercentageValue,
  context: CalculationSimplificationContext,
): NumberValue | DimensionValue | PercentageValue {
  const reference = context.percentageReferenceValue;

  if (reference === undefined) {
    return value;
  }

  const resolved = {
    ...reference,
    value: reference.value * value.value / 100,
  };

  return resolved.type === 'dimension'
    ? canonicalizeDimension(resolved, context)
    : resolved;
}

function isUnit<Unit extends string>(
  units: readonly Unit[],
  value: string,
): value is Unit {
  return units.some((unit) => unit === value);
}

//  ███▌  █████▌ ████▌  ████  ███▌  █▌
// █▌  █▌ █▌     █▌  █▌  ▐▌  ▐█ ▐█  █▌
// █▌     █▌     █▌  █▌  ▐▌  █▌  █▌ █▌
//  ███▌  ████   ████▌   ▐▌  █▌  █▌ █▌
//     █▌ █▌     █▌▐█    ▐▌  █████▌ █▌
// █▌  █▌ █▌     █▌ ▐█   ▐▌  █▌  █▌ █▌
//  ███▌  █████▌ █▌  █▌ ████ █▌  █▌ █████

export function serializeMathFunction(value: MathFunctionValue): string {
  if (value.type === 'calc') {
    if (isMathFunctionNode(value.calculation)) {
      return serializeMathFunction(value.calculation);
    }

    return `calc(${unwrapParens(
      serializeCalcTree(value.calculation),
    )})`;
  }

  const serializedChildren = value.children.flatMap((child) => {
    if (child === undefined) {
      return [];
    }

    return child === null
      ? ['none']
      : [unwrapParens(serializeCalcTree(child))];
  });

  if (value.type === 'round' && value.strategy !== 'nearest') {
    serializedChildren.unshift(value.strategy);
  }

  return `${value.type}(${serializedChildren.join(', ')})`;
}

function isMathFunctionNode(
  value: CalculationTree,
): value is MathFunctionNode {
  switch (value.type) {
    case 'min': case 'max': case 'clamp':
    case 'round': case 'mod': case 'rem':
    case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'atan2':
    case 'pow': case 'sqrt': case 'hypot': case 'log': case 'exp':
    case 'abs': case 'sign':
      return true;
    default:
      return false;
  }
}

export function serializeCalcTree(root: CalculationTree): string {
  switch (root.type) {
    case 'number':
    case 'percentage':
    case 'dimension':
      return serializeCalculationNumericValue(root);

    case 'variable':
      return serializeIdentifier(root.name);

    case 'negate':
      return `(-1 * ${serializeCalcTree(root.child)})`;

    case 'invert':
      return `(1 / ${serializeCalcTree(root.child)})`;

    case 'sum':
      return serializeCalcSum(root);

    case 'product':
      return serializeCalcProduct(root);

    case 'min': case 'max': case 'clamp':
    case 'round': case 'mod': case 'rem':
    case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'atan2':
    case 'pow': case 'sqrt': case 'hypot': case 'log': case 'exp':
    case 'abs': case 'sign':
      return serializeMathFunction(root);
  }
}

function serializeCalcSum(root: CalcSumNode): string {
  const [first, ...rest] = sortCalculationChildren(root.children);
  let serialized = `(${serializeCalcTree(first!)}`;

  for (const child of rest) {
    if (child.type === 'negate') {
      serialized += ` - ${serializeCalcTree(child.child)}`;
    } else if (isNegativeNumericValue(child)) {
      serialized += ` - ${serializeCalculationNumericValue(
        negateNumericValue(child),
      )}`;
    } else {
      serialized += ` + ${serializeCalcTree(child)}`;
    }
  }

  return `${serialized})`;
}

function serializeCalcProduct(root: CalcProductNode): string {
  const [first, ...rest] = sortCalculationChildren(root.children);
  let serialized = `(${serializeCalcTree(first!)}`;

  for (const child of rest) {
    if (child.type === 'invert') {
      serialized += ` / ${serializeCalcTree(child.child)}`;
    } else {
      serialized += ` * ${serializeCalcTree(child)}`;
    }
  }

  return `${serialized})`;
}

function unwrapParens(value: string): string {
  return value.startsWith('(') && value.endsWith(')')
    ? value.slice(1, -1)
    : value;
}


function isNegativeNumericValue(
  value: CalculationTree,
): value is CalculationNumericValue {
  return (
    isCalculationNumericValue(value) &&
    (value.value < 0 || Object.is(value.value, -0))
  );
}

function serializeCalculationNumericValue(
  value: CalculationNumericValue,
): string {
  if (Number.isFinite(value.value)) {
    switch (value.type) {
      case 'number':
        return serializeNumber(value);
      case 'percentage':
        return serializePercentage(value);
      case 'dimension':
        return serializeDimension(value);
    }
  }

  const keyword = Number.isNaN(value.value)
    ? 'NaN'
    : value.value < 0
      ? '-infinity'
      : 'infinity';

  switch (value.type) {
    case 'number':
      return keyword;
    case 'percentage':
      return `${keyword} * ${serializePercentage({
        type: 'percentage',
        value: 1,
      })}`;
    case 'dimension':
      return `${keyword} * ${serializeDimension({
        type: 'dimension',
        value: 1,
        unit: canonicalUnitForDimension(value.unit),
      })}`;
  }
}

function canonicalUnitForDimension(unit: string): string {
  const type = dimensionalTypeForUnit(unit);
  const category = type === null
    ? null
    : resolvedDimensionalCategory(type);

  switch (category) {
    case 'length':
      return 'px';
    case 'angle':
      return 'deg';
    case 'time':
      return 's';
    case 'frequency':
      return 'hz';
    case 'resolution':
      return 'dppx';
    case 'flex':
      return 'fr';
    case 'number':
    case 'percent':
    case null:
      throw new TypeError(`Cannot serialize unknown dimension unit: ${unit}`);
  }
}
