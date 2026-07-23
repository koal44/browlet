import { asciiLower } from '../../shared/css';
import { assertNever } from '../../shared/util';
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
import { ANGLE_UNITS, resolveAngle } from './numeric-literal/angle';
import {
  serializeDimension, tryConsumeDimension,
  type DimensionLiteral,
} from './numeric-literal/dimension';
import { FREQUENCY_UNITS, resolveFrequency } from './numeric-literal/frequency';
import { serializeIdentifier } from './ident';
import {
  LENGTH_UNITS, snapLengthAsLineWidth, tryResolveLength,
  type LengthResolutionContext,
} from './numeric-literal/length';
import {
  serializeNumber, tryConsumeNumber,
  type NumberLiteral,
} from './numeric-literal/number';
import {
  serializePercentage, tryConsumePercentage,
  type PercentageLiteral,
} from './numeric-literal/percentage';
import { RESOLUTION_UNITS, resolveResolution } from './numeric-literal/resolution';
import { TIME_UNITS, resolveTime } from './numeric-literal/time';

const CALC_TERM_LIMIT = 32;
const CALC_COMPLEXITY_LIMIT = 64;

export type ExpectedCalculationType =
  | 'number'
  | 'integer'
  | 'percentage'
  | 'dimension'
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

export type CalculationValueStage =
  | 'specified'
  | 'computed'
  | 'used';

export type CalculationRange = readonly [
  minimum: number,
  maximum: number,
];

export type CalculationSerializationContext = {
  /** Value-processing stage whose representation is being serialized. */
  stage?: CalculationValueStage;
};

export type CalculationContext = {
  /** Value-processing stage whose available information is being applied. */
  stage?: CalculationValueStage;

  /** Whether the current math function is nested inside another math function. */
  insideCalculation?: boolean;

  /** Numeric production the outermost calculation must match. */
  expectedType?: ExpectedCalculationType;

  /** Inclusive range allowed for the outermost calculation. */
  range?: CalculationRange;

  /** Context used to reduce lengths to the canonical px unit. */
  length?: LengthResolutionContext;

  /** Number of device pixels in one CSS pixel. */
  devicePixelRatio?: number;

  /**
   * Numeric base type against which percentages resolve. Percentages retain
   * their percentage type when this is omitted.
   */
  percentageType?: NumericBaseType;

  /** Numeric value against which percentages can be resolved. */
  percentageReferenceValue?: NumberLiteral | DimensionLiteral;

  /**
   * ASCII-lowercase numeric variable names and their values and types.
   * A null value represents a variable that has not resolved yet.
   */
  numericVariables?: ReadonlyMap<string, NumericVariable>;
};

type CalculationParserContext = CalculationContext & {
  /** Shared complexity consumed by the current calculation and its children. */
  termCount?: number;
};

export type NumericVariable = {
  value: NumericLiteral | null;
  numericType: NumericType;
};

export type MathValue = {
  type: 'math';
  calculation: CalculationTree;
};

export type CalculationTree =
  | CalculationLeaf
  | CalculationNode;

type CalculationLeaf =
  | NumericLeaf
  | VariableLeaf;

export type CalculationNode =
  | CalcSumNode
  | CalcProductNode
  | CalcNegateNode
  | CalcInvertNode
  | MathFunctionNode;

type NumericLiteral =
  | NumberLiteral
  | DimensionLiteral
  | PercentageLiteral;

type NumericLeaf = NumericLiteral & {
  numericType: NumericType;
};

type NumberLeaf = NumberLiteral & { numericType: NumericType; };
type DimensionLeaf = DimensionLiteral & { numericType: NumericType; };
type PercentageLeaf = PercentageLiteral & { numericType: NumericType; };

type VariableLeaf = {
  type: 'variable';
  name: string;
  numericType: NumericType;
};

// Interfaces are required to break the recursive CalculationTree alias.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface CalculationNodeWithChildren<
  Type extends string,
  Children extends readonly CalculationTree[],
> {
  type: Type;
  children: Children;
  numericType: NumericType;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface MathFunctionNodeWithArguments<
  Type extends string,
  Arguments extends readonly CalculationTree[],
> {
  type: Type;
  arguments: Arguments;
  numericType: NumericType;
}

export type MathFunctionNode =
  | MathVariadicFunctionNode
  | MathClampNode
  | MathRoundNode
  | MathBinaryFunctionNode
  | MathUnaryFunctionNode
  | MathLogNode;

export type MathVariadicFunctionNode<
  Name extends VariadicMathFunctionName = VariadicMathFunctionName,
> = MathFunctionNodeWithArguments<
  Name,
  [CalculationTree, ...CalculationTree[]]
>;

export type MathClampNode = {
  type: 'clamp';
  minimum?: CalculationTree;
  value: CalculationTree;
  maximum?: CalculationTree;
  numericType: NumericType;
};

export type MathRoundNode = {
  type: 'round';
  strategy: RoundingStrategy;
  value: CalculationTree;
  step?: CalculationTree;
  numericType: NumericType;
};

export type MathBinaryFunctionNode<
  Name extends BinaryMathFunctionName = BinaryMathFunctionName,
> = MathFunctionNodeWithArguments<
  Name,
  [CalculationTree, CalculationTree]
>;

export type MathUnaryFunctionNode<
  Name extends UnaryMathFunctionName = UnaryMathFunctionName,
> = MathFunctionNodeWithArguments<Name, [CalculationTree]>;

export type MathLogNode = MathFunctionNodeWithArguments<
  'log',
  [value: CalculationTree] | [value: CalculationTree, base: CalculationTree]
>;

export type RoundingStrategy =
  | 'nearest'
  | 'up'
  | 'down'
  | 'to-zero'
  | 'line-width';

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

export function parseMathFunction(
  input: ParserInput,
  context: CalculationContext = {},
): MathValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeMathFunction),
      context,
    ),
    'math function',
  );
}

export function parseMathValue(
  input: ParserInput,
  context: CalculationContext = {},
): MathValue | null {
  return parseMathFunction(input, context);
}

export function parseCalc(
  input: ParserInput,
  context: CalculationContext = {},
): MathValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeCalc),
      context,
    ),
    'calc',
  );
}

export function createMathValueFromLiteral(
  literal: NumberLiteral | DimensionLiteral | PercentageLiteral,
  context: CalculationContext = {},
): MathValue {
  const normalized = literal.value === 0
    ? { ...literal, value: 0 }
    : literal;
  const numericType = numericTypeFromValue(normalized, context);

  if (numericType === null) {
    throw new TypeError('Cannot create a math value from an unknown dimension');
  }

  return createMathValue(createNumericLeaf(normalized, numericType));
}

export type MathValueConsumerOptions = {
  expectedType: ExpectedCalculationType;
  range?: CalculationRange;
  percentageType?: NumericBaseType;
};

export function createMathValueConsumer(
  options: MathValueConsumerOptions,
): TryComponentConsumer<MathValue> {
  return (c) => {
    const outerContext = c.context;
    const calculationContext = outerContext === null || outerContext === undefined
      ? {}
      : outerContext as CalculationContext;

    try {
      c.context = {
        ...calculationContext,
        expectedType: options.expectedType,
        ...(options.range === undefined ? {} : { range: options.range }),
        ...(options.percentageType === undefined
          ? {}
          : { percentageType: options.percentageType }),
      };

      return tryConsumeMathValue(c);
    } finally {
      c.context = outerContext;
    }
  };
}

export function tryConsumeCalc(
  c: ComponentCursor,
): TryComponentConsumerResult<MathValue> {
  const result = consumeCalcCalculation(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const context = calculationContextFor(c.context);
  const numericType = numericTypeOf(result.value);

  if (
    !context.insideCalculation &&
    !matchesExpectedCalculationType(numericType, context)
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      'Invalid calculation type',
    );
  }

  return ok(createMathValue(
    simplifyCalculationTree(result.value, context),
  ));
}

/*
 * <calc()> = calc( <calc-sum> )
 */

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

const tryConsumeMin = createVariadicMathFunctionConsumer('min');
const tryConsumeMax = createVariadicMathFunctionConsumer('max');
const tryConsumeClamp = createClampConsumer();
const tryConsumeRound = createRoundConsumer();
const tryConsumeMod = createBinaryMathFunctionConsumer(
  'mod',
  'same',
);
const tryConsumeRem = createBinaryMathFunctionConsumer(
  'rem',
  'same',
);
const tryConsumeSin = createUnaryMathFunctionConsumer(
  'sin',
  'number',
  ['number', 'angle'],
);
const tryConsumeCos = createUnaryMathFunctionConsumer(
  'cos',
  'number',
  ['number', 'angle'],
);
const tryConsumeTan = createUnaryMathFunctionConsumer(
  'tan',
  'number',
  ['number', 'angle'],
);
const tryConsumeAsin = createUnaryMathFunctionConsumer(
  'asin',
  'angle',
  ['number'],
);
const tryConsumeAcos = createUnaryMathFunctionConsumer(
  'acos',
  'angle',
  ['number'],
);
const tryConsumeAtan = createUnaryMathFunctionConsumer(
  'atan',
  'angle',
  ['number'],
);
const tryConsumeAtan2 = createBinaryMathFunctionConsumer(
  'atan2',
  'angle',
);
const tryConsumePow = createBinaryMathFunctionConsumer(
  'pow',
  'number',
  ['number'],
);
const tryConsumeSqrt = createUnaryMathFunctionConsumer(
  'sqrt',
  'number',
  ['number'],
);
const tryConsumeHypot = createVariadicMathFunctionConsumer('hypot');
const tryConsumeLog = createLogConsumer();
const tryConsumeExp = createUnaryMathFunctionConsumer(
  'exp',
  'number',
  ['number'],
);
const tryConsumeAbs = createUnaryMathFunctionConsumer(
  'abs',
  'consistent',
);
const tryConsumeSign = createUnaryMathFunctionConsumer(
  'sign',
  'number',
);

const tryConsumeNonCalcMathFunction: TryComponentConsumer<
  MathFunctionNode | NumericLeaf
> =
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

export const tryConsumeMathFunction: TryComponentConsumer<MathValue> = (c) => {
  const result = tryConsumeMathFunctionCalculation(c);

  return result === null || isBad(result)
    ? result
    : ok(createMathValue(result.value));
};

export const tryConsumeMathValue = tryConsumeMathFunction;

function createMathValue(
  calculation: CalculationTree,
): MathValue {
  return {
    type: 'math',
    calculation,
  };
}

type FunctionResultType =
  | 'consistent'
  | 'same'
  | 'number'
  | 'angle';

function createVariadicMathFunctionConsumer<
  Name extends VariadicMathFunctionName,
>(
  name: Name,
): TryComponentConsumer<
  MathVariadicFunctionNode<Name> | NumericLeaf
> {
  const consumeArguments = sequenceOf(
    [commaRepeat(tryConsumeCalcSum, 1, CALC_TERM_LIMIT)],
    ([args]) => createMathFunctionNode<
      MathVariadicFunctionNode<Name>
    >(
      { type: name, arguments: args },
      args,
      'consistent',
    ),
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createBinaryMathFunctionConsumer<
  Name extends BinaryMathFunctionName,
>(
  name: Name,
  resultType: FunctionResultType,
  allowedCategories?: readonly ResolvedNumericCategory[],
): TryComponentConsumer<
  MathBinaryFunctionNode<Name> | NumericLeaf
> {
  const consumeArguments = sequenceOf(
    [commaRepeat(tryConsumeCalcSum, 2, 2)],
    ([args]) => {
      const [first, second] = args;

      if (first === undefined || second === undefined) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          `Invalid ${name}() arguments`,
        );
      }

      return createMathFunctionNode<MathBinaryFunctionNode<Name>>(
        { type: name, arguments: [first, second] },
        args,
        resultType,
        allowedCategories,
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
  allowedCategories?: readonly ResolvedNumericCategory[],
): TryComponentConsumer<
  MathUnaryFunctionNode<Name> | NumericLeaf
> {
  const consumeArguments = sequenceOf(
    [one(tryConsumeCalcSum)],
    ([[child]]) => createMathFunctionNode<
      MathUnaryFunctionNode<Name>
    >(
      { type: name, arguments: [child] },
      [child],
      resultType,
      allowedCategories,
    ),
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createClampConsumer(): TryComponentConsumer<
  MathClampNode | NumericLeaf
> {
  const consumeArgument: TryComponentConsumer<CalculationTree | 'none'> = oneOf(
    [
      one(tryConsumeCalcSum),
      one(createIdentValueConsumer('none')),
    ],
    ([value]) => ok(value),
  );
  const consumeArguments = sequenceOf(
    [commaRepeat(consumeArgument, 3, 3)],
    ([args]) => {
      const [minimumArgument, value, maximumArgument] = args;

      if (
        minimumArgument === undefined ||
        value === undefined ||
        value === 'none' ||
        maximumArgument === undefined
      ) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Invalid clamp() arguments',
        );
      }

      const minimum = minimumArgument === 'none'
        ? undefined
        : minimumArgument;
      const maximum = maximumArgument === 'none'
        ? undefined
        : maximumArgument;
      const calculations = [
        ...(minimum === undefined ? [] : [minimum]),
        value,
        ...(maximum === undefined ? [] : [maximum]),
      ];
      const result = createMathFunctionNode<MathClampNode>(
        { type: 'clamp', minimum, value, maximum },
        calculations,
        'consistent',
      );

      return result;
    },
  );

  return createMathFunctionConsumer('clamp', consumeArguments);
}

function createRoundConsumer(): TryComponentConsumer<
  MathRoundNode | NumericLeaf
> {
  const consumeArguments = sequenceOf(
    [
      opt(tryConsumeRoundingStrategyPrefix),
      commaRepeat(tryConsumeCalcSum, 1, 2),
    ],
    ([[explicitStrategy], children]) => {
      const [value, step] = children;

      const strategy = explicitStrategy ?? 'nearest';
      const valueType = numericTypeOf(value);
      const valueCategory = resolvedNumericCategory(valueType);

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

      return createMathFunctionNode<MathRoundNode>(
        { type: 'round', strategy, value, step },
        step === undefined ? [value] : [value, step],
        'consistent',
      );
    },
  );

  return createMathFunctionConsumer('round', consumeArguments);
}

function createLogConsumer(): TryComponentConsumer<
  MathLogNode | NumericLeaf
> {
  const consumeArguments = sequenceOf(
    [commaRepeat(tryConsumeCalcSum, 1, 2)],
    ([args]) => {
      const [value, base] = args;

      return createMathFunctionNode<MathLogNode>(
        {
          type: 'log',
          arguments: base === undefined ? [value] : [value, base],
        },
        args,
        'number',
        ['number'],
      );
    },
  );

  return createMathFunctionConsumer('log', consumeArguments);
}

function createMathFunctionConsumer<Node extends MathFunctionNode>(
  name: string,
  consumeArguments: TryComponentConsumer<Node>,
): TryComponentConsumer<Node | NumericLeaf> {
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
      !matchesExpectedCalculationType(result.value.numericType, context)
    ) {
      return bad(
        ComponentConsumerBadReason.Invalid,
        'Invalid calculation type',
      );
    }

    return ok(simplifyCalculationTree(
      result.value,
      context,
    ) as Node | NumericLeaf);
  };
}

function createMathFunctionNode<
  Node extends MathFunctionNode,
>(
  node: Omit<Node, 'numericType'>,
  calculations: readonly CalculationTree[],
  resultType: FunctionResultType,
  allowedCategories?: readonly ResolvedNumericCategory[],
): TryComponentConsumerResult<Node> {
  const types = calculations.map(numericTypeOf);
  const categories = types.map(resolvedNumericCategory);

  if (
    categories.some((category) => category === null) ||
    (
      allowedCategories !== undefined &&
      categories.some((category) => (
        !allowedCategories.includes(category!)
      ))
    ) ||
    (
      resultType === 'same' &&
      !types.every((argumentType) => (
        haveSameNumericType(argumentType, types[0]!)
      ))
    )
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Invalid ${node.type}() argument type`,
    );
  }

  const consistentType = addNumericTypes(types);

  if (consistentType === null) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Inconsistent ${node.type}() argument types`,
    );
  }

  let numericType: NumericType;

  switch (resultType) {
    case 'consistent':
    case 'same':
      numericType = consistentType;
      break;
    case 'number':
      numericType = createNumericType(
        [],
        consistentType.percentHint,
      );
      break;
    case 'angle':
      numericType = createNumericType(
        [['angle', 1]],
        consistentType.percentHint,
      );
      break;
  }

  if (resolvedNumericCategory(numericType) === null) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Invalid ${node.type}() result type`,
    );
  }

  return ok({
    ...node,
    numericType,
  } as Node);
}

const tryConsumeRoundingStrategy: TryComponentConsumer<RoundingStrategy> =
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

function haveSameNumericType(
  a: NumericType,
  b: NumericType,
): boolean {
  return (
    a.percentHint === b.percentHint &&
    haveEqualExponents(a, b)
  );
}

/*
 * <calc-sum> = <calc-product> [ [ '+' | '-' ] <calc-product> ]*
 */

export type CalcSumNode = CalculationNodeWithChildren<
  'sum',
  [CalculationTree, CalculationTree, ...CalculationTree[]]
>;

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
  ([[first], tail]) => {
    if (tail.length === 0) {
      return ok(first);
    }

    const children: CalculationTree[] = [first];
    let numericType = numericTypeOf(first);

    for (const { operator, value } of tail) {
      const valueType = numericTypeOf(value);

      if (operator === '+') {
        children.push(value);
      } else {
        children.push({
          type: 'negate',
          child: value,
          numericType: valueType,
        });
      }

      const sumType = addNumericTypes(
        [numericType, valueType],
      );

      if (sumType === null) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Inconsistent calculation sum types',
        );
      }

      numericType = sumType;
    }

    return ok({
      type: 'sum',
      children: children as CalcSumNode['children'],
      numericType,
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

export type CalcProductNode = CalculationNodeWithChildren<
  'product',
  [CalculationTree, CalculationTree, ...CalculationTree[]]
>;

export type CalcNegateNode = {
  type: 'negate';
  child: CalculationTree;
  numericType: NumericType;
};

export type CalcInvertNode = {
  type: 'invert';
  child: CalculationTree;
  numericType: NumericType;
};

type CalcProductTail = {
  operator: '*' | '/';
  value: CalculationTree;
};

function tryConsumeCalcProduct(
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
  ([[first], tail]) => {
    if (tail.length === 0) {
      return ok(first);
    }

    const children: CalculationTree[] = [first];
    let numericType = numericTypeOf(first);

    for (const { operator, value } of tail) {
      const valueType = numericTypeOf(value);

      const childType = operator === '*'
        ? valueType
        : invertNumericType(valueType);

      children.push(operator === '*'
        ? value
        : {
          type: 'invert',
          child: value,
          numericType: childType,
        });
      const productType = multiplyNumericTypes(
        [numericType, childType],
      );

      if (productType === null) {
        return bad(
          ComponentConsumerBadReason.Invalid,
          'Inconsistent calculation product types',
        );
      }

      numericType = productType;
    }

    return ok({
      type: 'product',
      children: children as CalcProductNode['children'],
      numericType,
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

function tryConsumeCalcValue(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  const result = consumeCalcValue(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const context = calculationContextFor(c.context);

  if (
    context.termCount !== undefined
    && ++context.termCount > CALC_COMPLEXITY_LIMIT
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Calculation exceeds the complexity limit of ${CALC_COMPLEXITY_LIMIT}`,
    );
  }

  return result;
}

const tryConsumeMathFunctionCalculation: TryComponentConsumer<CalculationTree> =
  oneOf(
    [
      one(tryConsumeCalcCalculation),
      one(tryConsumeNonCalcMathFunction),
    ],
    ([value]) => ok(value),
  );

const tryConsumeCalcNumericLeaf: TryComponentConsumer<NumericLeaf> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumeDimension),
    one(tryConsumePercentage),
  ],
  ([value], context) => {
    const normalized = value.value === 0
      ? { ...value, value: 0 }
      : value;
    const numericType = numericTypeFromValue(
      normalized,
      calculationContextFor(context),
    );

    return numericType === null
      ? bad(
        ComponentConsumerBadReason.Invalid,
        'Invalid calculation value type',
      )
      : ok(createNumericLeaf(normalized, numericType));
  },
);

const consumeCalcValue: TryComponentConsumer<CalculationTree> = oneOf(
  [
    one(tryConsumeCalcNumericLeaf),
    one(tryConsumeCalcKeyword),
    one(tryConsumeParenthesizedCalcSum),
    one(tryConsumeMathFunctionCalculation),
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

function tryConsumeCalcCalculation(
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

function tryConsumeCalcKeyword(
  c: ComponentCursor,
): TryComponentConsumerResult<NumericLeaf | VariableLeaf> {
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
    return ok(createNumericLeaf(
      { type: 'number', value },
      numberNumericType(),
    ));
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
    numericType: cloneNumericType(variable.numericType),
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
// Numeric Types

const NUMERIC_BASE_TYPES = [
  'length',
  'angle',
  'time',
  'frequency',
  'resolution',
  'flex',
  'percent',
] as const;

export type NumericBaseType =
  (typeof NUMERIC_BASE_TYPES)[number];

export type NumericExponent =
  readonly [base: NumericBaseType, power: number];

export type NumericType = {
  exponents: readonly NumericExponent[];
  percentHint: NumericBaseType | null;
};

type ResolvedNumericCategory =
  | 'number'
  | NumericBaseType;

function numericTypeOf(calculation: CalculationTree): NumericType {
  return cloneNumericType(calculation.numericType);
}

function numericTypeFromValue(
  value: NumericLiteral,
  context: CalculationContext,
): NumericType | null {
  switch (value.type) {
    case 'number':
      return numberNumericType();
    case 'percentage':
      return percentageNumericType(context);
    case 'dimension':
      return createNumericTypeFromUnit(value.unit);
  }
}

function createNumericLeaf<Value extends NumericLiteral>(
  value: Value,
  numericType: NumericType,
): Value & { numericType: NumericType; } {
  return {
    ...value,
    numericType: cloneNumericType(numericType),
  };
}

function withNumericType<Calculation extends CalculationTree>(
  calculation: Calculation,
  numericType: NumericType,
): Calculation {
  return {
    ...calculation,
    numericType: cloneNumericType(numericType),
  };
}

function addNumericTypes(
  types: readonly (NumericType | null)[],
): NumericType | null {
  const [first, ...rest] = types;

  if (first === undefined) {
    throw new RangeError('Numeric type addition requires an operand');
  }

  if (first === null) {
    return null;
  }

  let result = cloneNumericType(first);

  for (const type of rest) {
    if (type === null) {
      return null;
    }

    const sum = addTwoNumericTypes(result, type);

    if (sum === null) {
      return null;
    }

    result = sum;
  }

  return result;
}

function multiplyNumericTypes(
  types: readonly (NumericType | null)[],
): NumericType | null {
  let result = numberNumericType();

  for (const type of types) {
    if (type === null) {
      return null;
    }

    const product = multiplyTwoNumericTypes(result, type);

    if (product === null) {
      return null;
    }

    result = product;
  }

  return result;
}

function invertNumericType(
  type: NumericType,
): NumericType {
  return createNumericType(
    type.exponents.map(([base, power]) => [base, -power]),
    type.percentHint,
  );
}

function resolvedNumericCategory(
  type: NumericType,
): ResolvedNumericCategory | null {
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

function matchesExpectedCalculationType(
  type: NumericType,
  context: CalculationContext,
): boolean {
  const expectedType = context.expectedType;

  if (expectedType === undefined) {
    return resolvedNumericCategory(type) !== null;
  }

  switch (expectedType) {
    case 'number':
    case 'integer':
      return matchesNumberType(type, context.percentageType);

    case 'percentage':
      return matchesPercentageType(type);

    case 'dimension':
      return matchesDimensionCategory(type);

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

function matchesDimensionCategory(type: NumericType): boolean {
  if (type.percentHint !== null) {
    return false;
  }

  switch (resolvedNumericCategory(type)) {
    case 'length':
    case 'angle':
    case 'time':
    case 'frequency':
    case 'resolution':
    case 'flex':
      return true;

    case 'number':
    case 'percent':
    case null:
      return false;
  }
}

function matchesNumberType(
  type: NumericType,
  percentageType: NumericBaseType | undefined,
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

function matchesPercentageType(type: NumericType): boolean {
  return (
    hasSingleExponent(type, 'percent') &&
    (
      type.percentHint === null ||
      type.percentHint === 'percent'
    )
  );
}

function matchesDimensionType(
  type: NumericType,
  base: Exclude<NumericBaseType, 'percent'>,
  percentageType: NumericBaseType | null,
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
  type: NumericType,
  base: 'length' | 'angle' | 'time' | 'frequency',
): boolean {
  return (
    matchesDimensionType(type, base, base) ||
    matchesPercentageType(type)
  );
}

function hasSingleExponent(
  type: NumericType,
  base: NumericBaseType,
): boolean {
  return (
    type.exponents.length === 1 &&
    type.exponents[0]![0] === base &&
    type.exponents[0]![1] === 1
  );
}

function addTwoNumericTypes(
  a: NumericType,
  b: NumericType,
): NumericType | null {
  let left = cloneNumericType(a);
  let right = cloneNumericType(b);

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
    return createNumericType(
      left.exponents,
      left.percentHint,
    );
  }

  if (!containMixedPercentAndDimension(left, right)) {
    return null;
  }

  const unhintedLeft = cloneNumericType(left);
  const unhintedRight = cloneNumericType(right);

  if (
    unhintedLeft.percentHint !== null ||
    unhintedRight.percentHint !== null
  ) {
    return null;
  }

  for (const hint of NUMERIC_BASE_TYPES) {
    if (hint === 'percent') {
      continue;
    }

    const hintedLeft = applyPercentHint(unhintedLeft, hint);
    const hintedRight = applyPercentHint(unhintedRight, hint);

    if (haveEqualExponents(hintedLeft, hintedRight)) {
      return createNumericType(
        hintedLeft.exponents,
        hint,
      );
    }
  }

  return null;
}

function multiplyTwoNumericTypes(
  a: NumericType,
  b: NumericType,
): NumericType | null {
  let left = cloneNumericType(a);
  let right = cloneNumericType(b);

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

  return numericTypeFromMap(exponents, left.percentHint);
}

function applyPercentHint(
  type: NumericType,
  hint: NumericBaseType,
): NumericType {
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

  return numericTypeFromMap(exponents, hint);
}

function createNumericTypeFromUnit(unit: string): NumericType | null {
  const normalized = asciiLower(unit);
  let base: NumericBaseType;

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

  return createNumericType([[base, 1]], null);
}

function percentageNumericType(
  context: CalculationContext,
): NumericType {
  const hint = context.percentageType ?? 'percent';
  return createNumericType([[hint, 1]], hint);
}

function numberNumericType(): NumericType {
  return createNumericType([], null);
}

function createNumericType(
  exponents: readonly NumericExponent[],
  percentHint: NumericBaseType | null,
): NumericType {
  const powers = new Map<NumericBaseType, number>(exponents);
  return numericTypeFromMap(powers, percentHint);
}

function numericTypeFromMap(
  powers: ReadonlyMap<NumericBaseType, number>,
  percentHint: NumericBaseType | null,
): NumericType {
  const exponents: NumericExponent[] = [];

  for (const base of NUMERIC_BASE_TYPES) {
    const power = powers.get(base) ?? 0;

    if (power !== 0) {
      exponents.push([base, power]);
    }
  }

  return { exponents, percentHint };
}

function cloneNumericType(type: NumericType): NumericType {
  return createNumericType(type.exponents, type.percentHint);
}

function exponentMap(
  type: NumericType,
): Map<NumericBaseType, number> {
  return new Map(type.exponents);
}

function haveEqualExponents(
  a: NumericType,
  b: NumericType,
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
  a: NumericType,
  b: NumericType,
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
): CalculationParserContext {
  return context === null || context === undefined
    ? {}
    : context;
}

function enterCalculationContext(
  context: unknown,
): CalculationParserContext {
  const calculationContext = calculationContextFor(context);

  if (
    calculationContext.insideCalculation &&
    calculationContext.termCount !== undefined
  ) {
    return calculationContext;
  }

  return {
    ...calculationContext,
    insideCalculation: true,
    termCount: 0,
  };
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
  context: CalculationContext = {},
): CalculationTree {
  const simplified = simplifyCalculationNode(root, context);
  const stage = context.stage ?? 'specified';

  if (
    stage === 'specified' ||
    context.insideCalculation ||
    !isNumericLeaf(simplified)
  ) {
    return simplified;
  }

  return finalizeNumericLeaf(simplified, context);
}

function simplifyCalculationNode(
  root: CalculationTree,
  context: CalculationContext,
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
        : simplifyCalculationNode(
          createNumericLeaf(value, root.numericType),
          context,
        );
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

function finalizeNumericLeaf(
  root: NumericLeaf,
  context: CalculationContext,
): NumericLeaf {
  const [rangeMinimum, rangeMaximum] =
    context.range ?? [-Infinity, Infinity];
  const minimum = Math.max(rangeMinimum, -Number.MAX_VALUE);
  const maximum = Math.min(rangeMaximum, Number.MAX_VALUE);
  const censored = censorNumericLeaf(root, minimum, maximum);
  const clamped = Math.min(maximum, Math.max(minimum, censored.value));

  return {
    ...censored,
    value: context.expectedType === 'integer'
      ? Math.round(clamped)
      : clamped,
  };
}

function censorNumericLeaf(
  root: NumericLeaf,
  minimum: number,
  maximum: number,
): NumericLeaf {
  let value = root.value;

  if (Number.isNaN(value) || Object.is(value, -0)) {
    value = 0;
  } else if (value === -Infinity) {
    value = minimum;
  } else if (value === Infinity) {
    value = maximum;
  }

  return { ...root, value };
}

function simplifyMathFunctionNode(
  root: MathFunctionNode,
  context: CalculationContext,
): CalculationTree {
  const mathNode = simplifyMathFunctionArguments(root, context);

  switch (mathNode.type) {
    case 'min':
    case 'max': {
      const args = combineComparableNumericArguments(
        mathNode.arguments,
        mathNode.type,
        context,
      );

      if (args.length === 1) {
        return withNumericType(args[0]!, mathNode.numericType);
      }

      return {
        ...mathNode,
        arguments: args,
      } as MathVariadicFunctionNode;
    }

    case 'clamp': {
      const { minimum, value, maximum } = mathNode;

      if (
        !isNumericLeaf(value) ||
        (minimum !== undefined && !isNumericLeaf(minimum)) ||
        (maximum !== undefined && !isNumericLeaf(maximum))
      ) {
        return mathNode;
      }

      if (
        (
          minimum !== undefined &&
          !canCompareNumericLeaves(value, minimum, context)
        ) ||
        (
          maximum !== undefined &&
          !canCompareNumericLeaves(value, maximum, context)
        )
      ) {
        return mathNode;
      }

      let result = maximum === undefined
        ? value.value
        : Math.min(value.value, maximum.value);

      if (minimum !== undefined) {
        result = Math.max(minimum.value, result);
      }

      return createNumericLeaf(
        { ...value, value: result },
        mathNode.numericType,
      );
    }

    case 'round': {
      const {
        strategy,
        value: input,
        step: stepArg,
      } = mathNode;

      if (
        !isNumericLeaf(input) ||
        (stepArg !== undefined && !isNumericLeaf(stepArg))
      ) {
        return mathNode;
      }

      const step = stepArg ?? createNumericLeaf(
        { type: 'number', value: 1 },
        numberNumericType(),
      );

      switch (strategy) {
        case 'nearest': {
          if (!haveSameNumericTypeAndUnit(input, step)) {
            return mathNode;
          }

          const [lower, upper] = roundingBounds(input.value, step.value);
          const result = input.value - lower < upper - input.value
            ? lower
            : upper;

          return createNumericLeaf(
            { ...input, value: result },
            mathNode.numericType,
          );
        }

        case 'up': {
          if (!haveSameNumericTypeAndUnit(input, step)) {
            return mathNode;
          }

          const [, upper] = roundingBounds(input.value, step.value);
          return createNumericLeaf(
            { ...input, value: upper },
            mathNode.numericType,
          );
        }

        case 'down': {
          if (!haveSameNumericTypeAndUnit(input, step)) {
            return mathNode;
          }

          const [lower] = roundingBounds(input.value, step.value);
          return createNumericLeaf(
            { ...input, value: lower },
            mathNode.numericType,
          );
        }

        case 'to-zero': {
          if (!haveSameNumericTypeAndUnit(input, step)) {
            return mathNode;
          }

          const [lower, upper] = roundingBounds(input.value, step.value);
          const result = input.value < 0 || Object.is(input.value, -0)
            ? upper
            : lower;

          return createNumericLeaf(
            { ...input, value: result },
            mathNode.numericType,
          );
        }

        case 'line-width': {
          const devicePixelRatio = context.devicePixelRatio;

          if (!isPixelDimension(input) || devicePixelRatio === undefined) {
            return mathNode;
          }

          if (stepArg === undefined) {
            return snapPixelDimension(
              input.value,
              devicePixelRatio,
              mathNode.numericType,
            );
          }

          if (!haveSameNumericTypeAndUnit(input, step)) {
            return mathNode;
          }

          const [lower, upper] = roundingBounds(input.value, step.value);
          let result: number;

          if (lower === 0 && upper !== 0) {
            result = upper;
          } else if (upper === 0 && lower !== 0) {
            result = lower;
          } else {
            result = input.value - lower < upper - input.value
              ? lower
              : upper;
          }

          return snapPixelDimension(
            result,
            devicePixelRatio,
            mathNode.numericType,
          );
        }

        default:
          return assertNever(strategy);
      }
    }

    case 'mod':
    case 'rem': {
      const [value, step] = mathNode.arguments;

      if (!isNumericLeaf(value) || !isNumericLeaf(step)) {
        return mathNode;
      }

      if (!haveSameNumericTypeAndUnit(value, step)) {
        return mathNode;
      }

      const inputValue = value.value;
      const stepValue = step.value;
      const inputIsNegative = inputValue < 0 || Object.is(inputValue, -0);
      const stepIsNegative = stepValue < 0 || Object.is(stepValue, -0);
      let result: number;

      if (
        Number.isNaN(inputValue) ||
        Number.isNaN(stepValue) ||
        stepValue === 0 ||
        !Number.isFinite(inputValue)
      ) {
        result = NaN;
      } else if (!Number.isFinite(stepValue)) {
        result = mathNode.type === 'mod' && inputIsNegative !== stepIsNegative
          ? NaN
          : inputValue;
      } else if (mathNode.type === 'rem') {
        result = inputValue % stepValue;
      } else {
        result = inputValue % stepValue;

        if (result === 0) {
          result = stepIsNegative ? -0 : 0;
        } else if ((result < 0) !== stepIsNegative) {
          result += stepValue;
        }
      }

      return createNumericLeaf(
        { ...value, value: result },
        mathNode.numericType,
      );
    }

    case 'sin':
    case 'cos':
    case 'tan': {
      const [input] = mathNode.arguments;
      let radians: number;

      if (input.type === 'number') {
        radians = input.value;
      } else if (input.type === 'dimension' && input.unit === 'deg') {
        radians = input.value * Math.PI / 180;
      } else {
        return mathNode;
      }

      return createNumericLeaf(
        {
          type: 'number',
          value: Math[mathNode.type](radians),
        },
        mathNode.numericType,
      );
    }

    case 'asin':
    case 'acos':
    case 'atan': {
      const [input] = mathNode.arguments;

      if (input.type !== 'number') {
        return mathNode;
      }

      return createNumericLeaf(
        {
          type: 'dimension',
          value: Math[mathNode.type](input.value) * 180 / Math.PI,
          unit: 'deg',
        },
        mathNode.numericType,
      );
    }

    case 'atan2': {
      const [y, x] = mathNode.arguments;

      if (!isNumericLeaf(y) || !isNumericLeaf(x)) {
        return mathNode;
      }

      if (!canCompareNumericLeaves(y, x, context)) {
        return mathNode;
      }

      return createNumericLeaf(
        {
          type: 'dimension',
          value: Math.atan2(y.value, x.value) * 180 / Math.PI,
          unit: 'deg',
        },
        mathNode.numericType,
      );
    }

    case 'pow': {
      const [base, exponent] = mathNode.arguments;

      if (base.type !== 'number' || exponent.type !== 'number') {
        return mathNode;
      }

      const result = Number.isNaN(base.value) || Number.isNaN(exponent.value)
        ? NaN
        : Math.pow(base.value, exponent.value);

      return createNumericLeaf(
        { type: 'number', value: result },
        mathNode.numericType,
      );
    }

    case 'sqrt': {
      const [input] = mathNode.arguments;

      if (input.type !== 'number') {
        return mathNode;
      }

      return createNumericLeaf(
        { type: 'number', value: Math.sqrt(input.value) },
        mathNode.numericType,
      );
    }

    case 'hypot': {
      const args = mathNode.arguments;

      if (!areResolvedNumericArguments(args)) {
        return mathNode;
      }

      const first = args[0];

      if (
        !hasResolvedNumericMagnitude(first, context) ||
        !haveSameNumericTypeAndUnit(first, ...args.slice(1))
      ) {
        return mathNode;
      }

      const result = args.some((argument) => Number.isNaN(argument.value))
        ? NaN
        : Math.hypot(...args.map((argument) => argument.value));

      return createNumericLeaf(
        { ...first, value: result },
        mathNode.numericType,
      );
    }

    case 'log': {
      const [value, base] = mathNode.arguments;

      if (
        value.type !== 'number' ||
        (base !== undefined && base.type !== 'number')
      ) {
        return mathNode;
      }

      let result: number;

      if (
        Number.isNaN(value.value) ||
        (base !== undefined && (
          Number.isNaN(base.value) ||
          base.value <= 0 ||
          base.value === 1
        ))
      ) {
        result = NaN;
      } else if (value.value === 0) {
        result = -Infinity;
      } else if (value.value === 1) {
        result = 0;
      } else if (value.value === Infinity) {
        result = Infinity;
      } else if (base === undefined) {
        result = Math.log(value.value);
      } else {
        result = Math.log(value.value) / Math.log(base.value);
      }

      return createNumericLeaf(
        { type: 'number', value: result },
        mathNode.numericType,
      );
    }

    case 'exp': {
      const [input] = mathNode.arguments;

      if (input.type !== 'number') {
        return mathNode;
      }

      return createNumericLeaf(
        { type: 'number', value: Math.exp(input.value) },
        mathNode.numericType,
      );
    }

    case 'abs':
    case 'sign': {
      const [input] = mathNode.arguments;

      if (
        !isNumericLeaf(input) ||
        !hasResolvedNumericMagnitude(input, context)
      ) {
        return mathNode;
      }

      return mathNode.type === 'abs'
        ? createNumericLeaf(
          { ...input, value: Math.abs(input.value) },
          mathNode.numericType,
        )
        : createNumericLeaf(
          { type: 'number', value: Math.sign(input.value) },
          mathNode.numericType,
        );
    }

    default:
      return mathNode;
  }
}

function simplifyMathFunctionArguments(
  root: MathFunctionNode,
  context: CalculationContext,
): MathFunctionNode {
  const simplify = (calculation: CalculationTree): CalculationTree => (
    simplifyCalculationNode(calculation, context)
  );
  const numericType = cloneNumericType(root.numericType);

  switch (root.type) {
    case 'clamp':
      return {
        ...root,
        minimum: root.minimum === undefined
          ? undefined
          : simplify(root.minimum),
        value: simplify(root.value),
        maximum: root.maximum === undefined
          ? undefined
          : simplify(root.maximum),
        numericType,
      };

    case 'round':
      return {
        ...root,
        value: simplify(root.value),
        step: root.step === undefined
          ? undefined
          : simplify(root.step),
        numericType,
      };

    default:
      return {
        ...root,
        arguments: root.arguments.map(simplify),
        numericType,
      } as MathFunctionNode;
  }
}

function areResolvedNumericArguments(
  args: [CalculationTree, ...CalculationTree[]],
): args is [NumericLeaf, ...NumericLeaf[]] {
  return args.every(isNumericLeaf);
}

function combineComparableNumericArguments(
  args: readonly CalculationTree[],
  operation: 'min' | 'max',
  context: CalculationContext,
): CalculationTree[] {
  const compare = operation === 'min' ? Math.min : Math.max;
  const groups = new Map<string, { index: number; value: NumericLeaf; }>();
  const combinedArgs: CalculationTree[] = [];

  for (const argument of args) {
    if (
      !isNumericLeaf(argument) ||
      !hasResolvedNumericMagnitude(argument, context)
    ) {
      combinedArgs.push(argument);
      continue;
    }

    const key = numericUnitKey(argument);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, { index: combinedArgs.length, value: argument });
      combinedArgs.push(argument);
      continue;
    }

    group.value = {
      ...group.value,
      value: compare(group.value.value, argument.value),
    };
    combinedArgs[group.index] = group.value;
  }

  return combinedArgs;
}

function canCompareNumericLeaves(
  first: NumericLeaf,
  second: NumericLeaf,
  context: CalculationContext,
): boolean {
  return (
    haveSameNumericTypeAndUnit(first, second) &&
    hasResolvedNumericMagnitude(first, context)
  );
}

function hasResolvedNumericMagnitude(
  value: NumericLeaf,
  context: CalculationContext,
): boolean {
  return (
    value.type !== 'percentage' ||
    context.percentageType === 'percent'
  );
}

function snapPixelDimension(
  value: number,
  devicePixelRatio: number,
  numericType: NumericType,
): DimensionLiteral<'dimension', 'px'> & { numericType: NumericType; } {
  const snapped = snapLengthAsLineWidth(
    { type: 'length', value, unit: 'px' },
    devicePixelRatio,
  );

  return createNumericLeaf(
    { ...snapped, type: 'dimension' },
    numericType,
  );
}

function isPixelDimension(
  value: NumericLeaf,
): value is DimensionLeaf & { unit: 'px'; } {
  return value.type === 'dimension' && value.unit === 'px';
}

function haveSameNumericTypeAndUnit(
  first: NumericLeaf,
  ...rest: readonly NumericLeaf[]
): boolean {
  return rest.every((value) => (
    first.type === value.type &&
    (
      first.type !== 'dimension' ||
      (value.type === 'dimension' && first.unit === value.unit)
    )
  ));
}

function roundingBounds(
  input: number,
  step: number,
): readonly [lower: number, upper: number] {
  if (
    Number.isNaN(input) ||
    Number.isNaN(step) ||
    step === 0 ||
    (!Number.isFinite(input) && !Number.isFinite(step))
  ) {
    return [NaN, NaN];
  }

  if (!Number.isFinite(input)) {
    return [input, input];
  }

  if (!Number.isFinite(step)) {
    if (input === 0) {
      return [input, input];
    }

    return input < 0
      ? [-Infinity, -0]
      : [0, Infinity];
  }

  const magnitude = Math.abs(step);
  const quotient = input / magnitude;

  if (Number.isInteger(quotient)) {
    return [input, input];
  }

  const lower = Math.floor(quotient) * magnitude;
  const upper = Math.ceil(quotient) * magnitude;

  return [
    lower === 0 ? 0 : lower,
    upper === 0 ? -0 : upper,
  ];
}

function simplifyNegate(
  root: CalcNegateNode,
  context: CalculationContext,
): CalculationTree {
  const child = simplifyCalculationNode(root.child, context);

  if (isNumericLeaf(child)) {
    return createNumericLeaf(
      negateNumericLeaf(child),
      root.numericType,
    );
  }

  if (child.type === 'negate') {
    return withNumericType(child.child, root.numericType);
  }

  if (child.type === 'sum') {
    return {
      type: 'sum',
      children: child.children.map((grandchild) => {
        if (isNumericLeaf(grandchild)) {
          return negateNumericLeaf(grandchild);
        }

        if (grandchild.type === 'negate') {
          return grandchild.child;
        }

        return createNegateNode(grandchild);
      }) as CalcSumNode['children'],
      numericType: cloneNumericType(root.numericType),
    };
  }

  return {
    ...root,
    child,
    numericType: cloneNumericType(root.numericType),
  };
}

function simplifyInvert(
  root: CalcInvertNode,
  context: CalculationContext,
): CalculationTree {
  const child = simplifyCalculationNode(root.child, context);

  if (child.type === 'number') {
    return createNumericLeaf(
      { type: 'number', value: 1 / child.value },
      root.numericType,
    );
  }

  if (child.type === 'invert') {
    return withNumericType(child.child, root.numericType);
  }

  return {
    ...root,
    child,
    numericType: cloneNumericType(root.numericType),
  };
}

function simplifySum(
  root: CalcSumNode,
  context: CalculationContext,
): CalculationTree {
  const simplified = root.children.map((child) => {
    if (child.type !== 'negate') {
      return simplifyCalculationNode(child, context);
    }

    const operand = simplifyCalculationNode(child.child, context);

    return isNumericLeaf(operand)
      ? { ...child, child: operand }
      : simplifyCalculationNode({ ...child, child: operand }, context);
  });
  const flattened = simplified.flatMap((child) => (
    child.type === 'sum' ? child.children : [child]
  ));
  const children = sortCalculationChildren(
    combineLikeNumericLeaves(flattened),
  );

  if (children.length === 1) {
    return withNumericType(children[0]!, root.numericType);
  }

  return {
    ...root,
    children: children as CalcSumNode['children'],
    numericType: cloneNumericType(root.numericType),
  };
}

function simplifyProduct(
  root: CalcProductNode,
  context: CalculationContext,
): CalculationTree {
  const simplified = root.children.map((child) => (
    simplifyCalculationNode(child, context)
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
      sum.children.every(isNumericLeaf)
    ) {
      return {
        type: 'sum',
        children: sum.children.map((child) => (
          scaleNumericLeaf(
            child as NumericLeaf,
            number,
          )
        )) as CalcSumNode['children'],
        numericType: cloneNumericType(root.numericType),
      };
    }
  }

  const product = evaluateNumericProduct(
    children,
    root.numericType,
  );

  if (product !== null) {
    return product;
  }

  return {
    ...root,
    children: children as CalcProductNode['children'],
    numericType: cloneNumericType(root.numericType),
  };
}

function isNumericLeaf(
  value: CalculationTree | null | undefined,
): value is NumericLeaf {
  return (
    value !== null &&
    value !== undefined &&
    (
      value.type === 'number' ||
      value.type === 'dimension' ||
      value.type === 'percentage'
    )
  );
}

function scaleNumericLeaf(
  leaf: NumericLeaf,
  factor: NumberLeaf,
): NumericLeaf {
  const numericType = multiplyNumericTypes([
    leaf.numericType,
    factor.numericType,
  ]);

  if (numericType === null) {
    throw new TypeError('Cannot multiply inconsistent numeric types');
  }

  return createNumericLeaf(
    { ...leaf, value: leaf.value * factor.value },
    numericType,
  );
}

function negateNumericLeaf(
  leaf: NumericLeaf,
): NumericLeaf {
  return { ...leaf, value: 0 - leaf.value };
}

function createNegateNode(
  child: CalculationTree,
): CalcNegateNode {
  return {
    type: 'negate',
    child,
    numericType: numericTypeOf(child),
  };
}

function combineLikeNumericLeaves(
  children: readonly CalculationTree[],
): CalculationTree[] {
  const totals = new Map<string, {
    value: number;
    leaf: NumericLeaf;
    numericType: NumericType;
  }>();

  for (const child of children) {
    const leaf = numericSumTermLeaf(child);

    if (leaf === null) {
      continue;
    }

    const key = numericUnitKey(leaf);
    const total = totals.get(key);
    const subtract = child.type === 'negate';
    let value = subtract ? 0 - leaf.value : leaf.value;

    if (total !== undefined) {
      value = subtract
        ? total.value - leaf.value
        : total.value + leaf.value;
    }

    totals.set(key, {
      value,
      leaf: total?.leaf ?? leaf,
      numericType: total?.numericType ?? child.numericType,
    });
  }

  const emitted = new Set<string>();
  const combined: CalculationTree[] = [];

  for (const child of children) {
    const leaf = numericSumTermLeaf(child);

    if (leaf === null) {
      combined.push(child);
      continue;
    }

    const key = numericUnitKey(leaf);

    if (!emitted.has(key)) {
      const total = totals.get(key)!;
      combined.push(createNumericLeaf(
        { ...total.leaf, value: total.value },
        total.numericType,
      ));
      emitted.add(key);
    }
  }

  return combined;
}

function numericSumTermLeaf(
  value: CalculationTree,
): NumericLeaf | null {
  if (isNumericLeaf(value)) {
    return value;
  }

  return value.type === 'negate' && isNumericLeaf(value.child)
    ? value.child
    : null;
}

function numericUnitKey(value: NumericLeaf): string {
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
  const numbers = children.filter(
    (child): child is NumericLeaf & NumberLiteral => child.type === 'number',
  );

  if (numbers.length < 2) {
    return [...children];
  }

  const product = numbers.reduce(
    (value, number) => value * number.value,
    1,
  );
  const numericType = multiplyNumericTypes(
    numbers.map((number) => number.numericType),
  );

  if (numericType === null) {
    throw new TypeError('Cannot combine inconsistent number types');
  }
  const combined: CalculationTree[] = [];
  let emitted = false;

  for (const child of children) {
    if (child.type !== 'number') {
      combined.push(child);
      continue;
    }

    if (!emitted) {
      combined.push(createNumericLeaf(
        { type: 'number', value: product },
        numericType,
      ));
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
  numericType: NumericType,
): NumericLeaf | null {
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
  const category = resolvedNumericCategory(numericType);

  if (remaining.length === 0) {
    return category === 'number'
      ? createNumericLeaf(
        { type: 'number', value },
        numericType,
      )
      : null;
  }

  if (remaining.length !== 1 || remaining[0]![1] !== 1) {
    return null;
  }

  const unit = remaining[0]![0];

  if (unit === '%') {
    return createNumericLeaf(
      { type: 'percentage', value },
      numericType,
    );
  }

  const unitType = createNumericTypeFromUnit(unit);

  if (
    unitType === null ||
    resolvedNumericCategory(unitType) !== category
  ) {
    return null;
  }

  return createNumericLeaf(
    { type: 'dimension', value, unit },
    numericType,
  );
}

function isNumericProductFactor(
  value: CalculationTree,
): value is NumericLeaf | (
  CalcInvertNode & { child: NumericLeaf; }
) {
  return (
    isNumericLeaf(value) ||
    (value.type === 'invert' && isNumericLeaf(value.child))
  );
}

function canonicalizeDimension(
  value: DimensionLeaf,
  context: CalculationContext,
): DimensionLeaf {
  const unit = asciiLower(value.unit);
  let resolved: DimensionLiteral<string, string> | null;

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
    : createNumericLeaf(
      {
        type: 'dimension',
        value: resolved.value,
        unit: resolved.unit,
      },
      value.numericType,
    );
}

function resolvePercentage(
  value: PercentageLeaf,
  context: CalculationContext,
): NumericLeaf {
  const reference = context.percentageReferenceValue;

  if (reference === undefined) {
    return value;
  }

  const resolved = createNumericLeaf(
    {
      ...reference,
      value: reference.value * value.value / 100,
    },
    value.numericType,
  );

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

export function serializeMathFunction(
  value: MathValue,
  context: CalculationSerializationContext = {},
): string {
  return serializeMathValue(value, context);
}

export function serializeMathValue(
  value: MathValue,
  context: CalculationSerializationContext = {},
): string {
  const stage = context.stage ?? 'specified';
  const { calculation } = value;

  if (isNumericLeaf(calculation)) {
    const serialized = serializeCalcTree(calculation);

    return stage === 'specified'
      ? `calc(${serialized})`
      : serialized;
  }

  if (isMathFunctionNode(calculation)) {
    return serializeMathFunctionNode(calculation);
  }

  return `calc(${unwrapParens(serializeCalcTree(calculation))})`;
}

function serializeMathFunctionNode(
  value: MathFunctionNode,
): string {
  switch (value.type) {
    case 'clamp':
      return `clamp(${[
        value.minimum === undefined
          ? 'none'
          : serializeMathFunctionArgument(value.minimum),
        serializeMathFunctionArgument(value.value),
        value.maximum === undefined
          ? 'none'
          : serializeMathFunctionArgument(value.maximum),
      ].join(', ')})`;

    case 'round':
      return `round(${[
        ...(value.strategy === 'nearest' ? [] : [value.strategy]),
        serializeMathFunctionArgument(value.value),
        ...(value.step === undefined
          ? []
          : [serializeMathFunctionArgument(value.step)]),
      ].join(', ')})`;

    case 'min':
    case 'max':
    case 'hypot':
    case 'mod':
    case 'rem':
    case 'atan2':
    case 'pow':
    case 'sin':
    case 'cos':
    case 'tan':
    case 'asin':
    case 'acos':
    case 'atan':
    case 'sqrt':
    case 'exp':
    case 'abs':
    case 'sign':
    case 'log':
      return `${value.type}(${value.arguments
        .map(serializeMathFunctionArgument)
        .join(', ')})`;
  }
}

function serializeMathFunctionArgument(
  value: CalculationTree,
): string {
  return unwrapParens(serializeCalcTree(value));
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
      return serializeNumericLeaf(root);

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
      return serializeMathFunctionNode(root);
  }
}

function serializeCalcSum(root: CalcSumNode): string {
  const [first, ...rest] = sortCalculationChildren(root.children);
  let serialized = `(${serializeCalcTree(first!)}`;

  for (const child of rest) {
    if (child.type === 'negate') {
      serialized += ` - ${serializeCalcTree(child.child)}`;
    } else if (isNegativeNumericLeaf(child)) {
      serialized += ` - ${serializeNumericLeaf(
        negateNumericLeaf(child),
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


function isNegativeNumericLeaf(
  value: CalculationTree,
): value is NumericLeaf {
  return (
    isNumericLeaf(value) &&
    (value.value < 0 || Object.is(value.value, -0))
  );
}

function serializeNumericLeaf(
  value: NumericLeaf,
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
  const type = createNumericTypeFromUnit(unit);
  const category = type === null
    ? null
    : resolvedNumericCategory(type);

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

// CSS Values, "Combination of Math Functions".
export function addMathFunctions(
  a: MathValue,
  b: MathValue,
  context: CalculationContext = {},
): MathValue {
  return combineMathFunctionCalculations(
    a.calculation,
    b.calculation,
    context,
  );
}

export function interpolateMathFunctions(
  a: MathValue,
  b: MathValue,
  p: number,
  context: CalculationContext = {},
): MathValue {
  return combineMathFunctionCalculations(
    scaleCalculationTree(
      a.calculation,
      1 - p,
    ),
    scaleCalculationTree(
      b.calculation,
      p,
    ),
    context,
  );
}

export function accumulateMathFunctions(
  a: MathValue,
  b: MathValue,
  context: CalculationContext = {},
): MathValue {
  return addMathFunctions(a, b, context);
}

function combineMathFunctionCalculations(
  a: CalculationTree,
  b: CalculationTree,
  context: CalculationContext,
): MathValue {
  const numericType = addNumericTypes([
    numericTypeOf(a),
    numericTypeOf(b),
  ]);

  if (numericType === null) {
    throw new TypeError('Math function types must be consistent');
  }

  return createMathValue(
    simplifyCalculationTree({
      type: 'sum',
      children: [a, b],
      numericType,
    }, context),
  );
}

function scaleCalculationTree(
  calculation: CalculationTree,
  factor: number,
): CalcProductNode {
  const numericType = numericTypeOf(calculation);

  return {
    type: 'product',
    children: [
      createNumericLeaf(
        { type: 'number', value: factor },
        numberNumericType(),
      ),
      calculation,
    ],
    numericType,
  };
}
