import { asciiLower } from '../../shared/css';
import { assertNever } from '../../shared/util';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../syntax/component-cursor';
import {
  consumeWhitespace, createFunctionalNotationConsumer, consumeAsteriskDelim,
  consumeComma, consumeIdentToken, consumeParensBlock, consumeSlashDelim,
} from '../syntax/component-consumers';
import {
  commaRepeat, one, oneOf, opt, adaptConsumer, repeat, sequenceOf, withTrivia,
} from '../syntax/component-grammar';
import { isDelimToken, serializeCssIdentifier } from '../syntax/component-value';
import { parseAsComponentGrammar, type ParserInput } from '../syntax/parser';
import { TokenKind } from '../syntax/tokens';
import { ValueStage } from '../value-processing/stage';
import { createKeywordConsumer } from './keyword';
import {
  ANGLE_UNITS, canonicalizeAngle, type AngleLiteral, type CanonicalAngleLiteral,
} from './numeric-literal/angle';
import {
  serializeDimension, consumeDimension, type AnyDimensionLiteral,
  type DimensionLiteral,
} from './numeric-literal/dimension';
import {
  FREQUENCY_UNITS, canonicalizeFrequency, type CanonicalFrequencyLiteral,
  type FrequencyLiteral,
} from './numeric-literal/frequency';
import { type IntegerLiteral } from './numeric-literal/integer';
import {
  LENGTH_UNITS, snapLengthAsLineWidth, tryResolveLength, type CanonicalLengthLiteral,
  type LengthLiteral, type LengthResolutionContext,
} from './numeric-literal/length';
import { serializeNumber, consumeNumber, type NumberLiteral } from './numeric-literal/number';
import { serializePercentage, consumePercentage, type PercentageLiteral } from './numeric-literal/percentage';
import { RESOLUTION_UNITS, canonicalizeResolution, type ResolutionLiteral } from './numeric-literal/resolution';
import {
  TIME_UNITS, canonicalizeTime, type CanonicalTimeLiteral, type TimeLiteral,
} from './numeric-literal/time';

export type MathValue<Type extends MathValueType = MathValueType> = {
  type: 'math';
  calculation: CalculationTree;
  valueType: Type;
  promoted: boolean;
};

export type MathValueType = keyof MathLiteralByType;

type MathLiteralByType = {
  number: NumberLiteral;
  integer: IntegerLiteral;
  percentage: PercentageLiteral;
  length: LengthLiteral;
  angle: AngleLiteral;
  time: TimeLiteral;
  frequency: FrequencyLiteral;
  resolution: ResolutionLiteral;
  flex: DimensionLiteral;
  'length-percentage': LengthLiteral | PercentageLiteral;
  'angle-percentage': AngleLiteral | PercentageLiteral;
  'time-percentage': TimeLiteral | PercentageLiteral;
  'frequency-percentage': FrequencyLiteral | PercentageLiteral;
};

export type MathRange = readonly [
  minimum: number,
  maximum: number,
];

export type PercentageReferenceValue =
  | CanonicalLengthLiteral
  | CanonicalFrequencyLiteral
  | CanonicalAngleLiteral
  | CanonicalTimeLiteral;

export type MathContext = {
  /** Value-processing stage at which math values should become literals. */
  unwrapMathAt?: ValueStage;

  /** Inclusive range allowed for the outermost calculation. */
  range?: MathRange;

  /** Context used to reduce lengths to the canonical px unit. */
  length?: LengthResolutionContext;

  /** Number of device pixels in one CSS pixel. */
  devicePixelRatio?: number;

  /**
   * Percent hint assigned to percentages in this context. Defaults to
   * "percent", preserving percentages as percentages.
   */
  percentHint?: MathBase;

  /** Canonical value against which percentages can be resolved. */
  percentageReferenceValue?: PercentageReferenceValue;

  /**
   * ASCII-lowercase numeric variable names, values, and types.
   * An undefined value represents a variable that has not resolved yet.
   */
  numericVariables?: ReadonlyMap<string, NumericVariable>;
};

type InternalMathContext = {
  expectedType?: MathValueType;
  insideCalculation?: boolean;
  termCount?: number;
} & MathContext;

export type NumericVariable = {
  value: NumericLiteral | 'none' | undefined;
  valueType: MathValueType;
};

export function parseMathValue<Type extends MathValueType>(
  input: ParserInput,
  expectedType: Type,
  context: MathContext = {},
): MathValue<Type> | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(createMathValueConsumer({ expectedType })),
    context,
  );
}

export function createMathValueFromLiteral<Type extends MathValueType>(
  literal: MathLiteralByType[Type],
  valueType: Type,
  context: MathContext = {},
): MathValue<Type> {
  return createMathValue(
    createNumericLeafFromLiteral(literal, context),
    valueType,
  );
}

function createNumericLeafFromLiteral<Type extends MathValueType>(
  literal: MathLiteralByType[Type],
  context: MathContext,
): NumericLeaf {
  const calculationLiteral: NumericLiteral = 'unit' in literal
    ? { type: 'dimension', value: literal.value, unit: literal.unit }
    : literal.type === 'integer'
      ? { type: 'number', value: literal.value }
      : literal;
  const normalized = calculationLiteral.value === 0
    ? { ...calculationLiteral, value: 0 }
    : calculationLiteral;
  const mathHints = mathHintsFromValue(normalized, context);

  if (mathHints === null) {
    throw new TypeError('Cannot create a numeric leaf from an unknown dimension');
  }

  return createNumericLeaf(normalized, mathHints);
}

export function promoteNumericVariable<Type extends MathValueType>(
  name: string,
  valueType: Type,
  context: MathContext = {},
): MathValue<Type> {
  const normalizedName = asciiLower(name);
  const variable = context.numericVariables?.get(normalizedName);

  if (variable === undefined || variable.valueType !== valueType) {
    throw new TypeError('Cannot promote an unknown numeric variable');
  }

  return createMathValue(
    {
      type: 'variable',
      name: normalizedName,
      hints: mathHintsFromNumericVariable(variable, context),
    },
    valueType,
    true,
  );
}

export function tryGetMathVariableName(
  value: MathValue,
): string | null {
  return value.promoted && value.calculation.type === 'variable'
    ? value.calculation.name
    : null;
}

type MathValueConsumerOptions<Type extends MathValueType = MathValueType> = {
  expectedType: Type;
  range?: MathRange;
  percentHint?: MathBase;
};

export function createMathValueConsumer<Type extends MathValueType>(
  options: MathValueConsumerOptions<Type>,
): TryComponentConsumer<MathValue<Type>> {
  return (c) => {
    const outerContext = c.context;
    const mathContext = outerContext === null || outerContext === undefined
      ? {}
      : outerContext as InternalMathContext;

    try {
      c.context = {
        ...mathContext,
        expectedType: options.expectedType,
        ...(options.range === undefined ? {} : { range: options.range }),
        ...(options.percentHint === undefined ? {} : { percentHint: options.percentHint }),
      };

      return mathValueConsumer(c) as TryComponentConsumerResult<
        MathValue<Type>
      >;
    } finally {
      c.context = outerContext;
    }
  };
}

export function resolveMathValue<Type extends MathValueType>(
  value: MathValue<Type>,
  stage: ValueStage,
  context: MathContext = {},
): MathValue<Type> | MathLiteralByType[Type] {
  const calculation = simplifyCalculationTree(
    value.calculation,
    stage,
    context,
    value.valueType,
  );
  const unwrapMathAt = context.unwrapMathAt ?? ValueStage.Computed;

  if (
    stage >= unwrapMathAt &&
    isNumericLeaf(calculation)
  ) {
    return resolvedMathLiteralFromLeaf(
      calculation,
      value.valueType,
    );
  }

  return calculation === value.calculation
    ? value
    : { ...value, calculation };
}

export function serializeMathValue(
  value: MathValue,
): string {
  const { calculation } = value;
  const promotedName = tryGetMathVariableName(value);

  if (promotedName !== null) {
    return promotedName;
  }

  if (isNumericLeaf(calculation)) {
    return `calc(${serializeCalcTree(calculation)})`;
  }

  if (isMathFunctionNode(calculation)) {
    return serializeMathFunctionNode(calculation);
  }

  return `calc(${unwrapParens(serializeCalcTree(calculation))})`;
}

// CSS Values, "Combination of Math Functions".
export function addMathValues<Type extends MathValueType>(
  a: MathValue<Type>,
  b: MathValue<Type>,
  context: MathContext = {},
): MathValue<Type> {
  return combineMathValues(
    a,
    b,
    context,
  );
}

export function coercePercentageMathToNumber(
  value: MathValue<'percentage'>,
  percentageScale: number,
  numberScale: number,
): MathValue<'number'> {
  const percentageBasis = createNumericLeaf(
    { type: 'percentage', value: 100 },
    percentageMathHints({ percentHint: 'percent' }),
  );
  const invertedPercentageBasis = {
    type: 'invert' as const,
    child: percentageBasis,
    hints: invertMathHints(percentageBasis.hints),
  };
  const multiplier = createNumericLeaf(
    {
      type: 'number',
      value: 100 * percentageScale / numberScale,
    },
    numberMathHints(),
  );
  const mathHints = multiplyMathHints([
    mathHintsOf(value.calculation),
    multiplier.hints,
    mathHintsOf(invertedPercentageBasis),
  ]);

  if (mathHints === null) {
    throw new TypeError('Cannot coerce inconsistent percentage math');
  }

  return createMathValue(
    simplifyCalculationTree({
      type: 'product',
      children: [
        value.calculation,
        multiplier,
        invertedPercentageBasis,
      ],
      hints: mathHints,
    }, ValueStage.Declared, { percentHint: 'percent' }, 'number'),
    'number',
  );
}

export function interpolateMathValues<Type extends MathValueType>(
  a: MathValue<Type>,
  b: MathValue<Type>,
  p: number,
  context: MathContext = {},
): MathValue<Type> {
  return combineMathValues(
    {
      ...a,
      calculation: scaleCalculationTree(
        a.calculation,
        1 - p,
      ),
    },
    {
      ...b,
      calculation: scaleCalculationTree(
        b.calculation,
        p,
      ),
    },
    context,
  );
}

export function accumulateMathValues<Type extends MathValueType>(
  a: MathValue<Type>,
  b: MathValue<Type>,
  context: MathContext = {},
): MathValue<Type> {
  return addMathValues(a, b, context);
}

function combineMathValues<Type extends MathValueType>(
  a: MathValue<Type>,
  b: MathValue<Type>,
  context: MathContext,
): MathValue<Type> {
  const valueType = commonValueType(a, b);
  const mathHints = addMathHints([
    mathHintsOf(a.calculation),
    mathHintsOf(b.calculation),
  ]);

  if (mathHints === null) {
    throw new TypeError('Math function types must be consistent');
  }

  return createMathValue(
    simplifyCalculationTree({
      type: 'sum',
      children: [a.calculation, b.calculation],
      hints: mathHints,
    }, ValueStage.Declared, context, valueType),
    valueType,
  );
}

function commonValueType<Type extends MathValueType>(
  a: MathValue<Type>,
  b: MathValue<Type>,
): Type {
  const valueType = a.valueType;

  if (b.valueType !== valueType) {
    throw new TypeError('Math value types must be consistent');
  }

  return valueType;
}

function scaleCalculationTree(
  calculation: CalculationTree,
  factor: number,
): CalcProductNode {
  const mathHints = mathHintsOf(calculation);

  return {
    type: 'product',
    children: [
      createNumericLeaf(
        { type: 'number', value: factor },
        numberMathHints(),
      ),
      calculation,
    ],
    hints: mathHints,
  };
}

// █     █  ███▌  █████▌ █▌  █▌
// ██   ██ ▐█ ▐█    █▌   █▌  █▌
// █▌█ █▐█ █▌  █▌   █▌   █▌  █▌
// █▌ █ ▐█ █▌  █▌   █▌   █████▌
// █▌   ▐█ █████▌   █▌   █▌  █▌
// █▌   ▐█ █▌  █▌   █▌   █▌  █▌
// █▌   ▐█ █▌  █▌   █▌   █▌  █▌

const CALC_TERM_LIMIT = 32;
const CALC_COMPLEXITY_LIMIT = 64;

type CalculationTree =
  | CalculationLeaf
  | CalculationNode;

type CalculationLeaf =
  | NumericLeaf
  | VariableLeaf;

type CalculationNode =
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
  hints: MathHints;
};

type NumberLeaf = NumberLiteral & { hints: MathHints; };
type DimensionLeaf = DimensionLiteral & { hints: MathHints; };
type PercentageLeaf = PercentageLiteral & { hints: MathHints; };

type VariableLeaf = {
  type: 'variable';
  name: string;
  hints: MathHints;
};

// Interfaces are required to break the recursive CalculationTree alias.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface CalculationNodeWithChildren<
  Type extends string,
  Children extends readonly CalculationTree[],
> {
  type: Type;
  children: Children;
  hints: MathHints;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface MathFunctionNodeWithArguments<
  Type extends string,
  Arguments extends readonly CalculationTree[],
> {
  type: Type;
  arguments: Arguments;
  hints: MathHints;
}

type MathFunctionNode =
  | MathVariadicFunctionNode
  | MathClampNode
  | MathRoundNode
  | MathBinaryFunctionNode
  | MathUnaryFunctionNode
  | MathLogNode;

type MathVariadicFunctionNode<
  Name extends VariadicMathFunctionName = VariadicMathFunctionName,
> = MathFunctionNodeWithArguments<
  Name,
  [CalculationTree, ...CalculationTree[]]
>;

type MathClampNode = {
  type: 'clamp';
  minimum?: CalculationTree;
  value: CalculationTree;
  maximum?: CalculationTree;
  hints: MathHints;
};

type MathRoundNode = {
  type: 'round';
  strategy: RoundingStrategy;
  value: CalculationTree;
  step?: CalculationTree;
  hints: MathHints;
};

type MathBinaryFunctionNode<
  Name extends BinaryMathFunctionName = BinaryMathFunctionName,
> = MathFunctionNodeWithArguments<
  Name,
  [CalculationTree, CalculationTree]
>;

type MathUnaryFunctionNode<
  Name extends UnaryMathFunctionName = UnaryMathFunctionName,
> = MathFunctionNodeWithArguments<Name, [CalculationTree]>;

type MathLogNode = MathFunctionNodeWithArguments<
  'log',
  [value: CalculationTree] | [value: CalculationTree, base: CalculationTree]
>;

type RoundingStrategy =
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

function consumeCalc(
  c: ComponentCursor,
): TryComponentConsumerResult<MathValue> {
  return calcConsumer(c);
}

/*
 * <calc()> = calc( <calc-sum> )
 */

const calcCalculationConsumer = createFunctionalNotationConsumer(
  'calc',
  consumeCalcSum,
  (calculation) => calculation,
  {
    contextForArguments: enterCalculationContext,
  },
);

const calcConsumer = adaptConsumer(
  calcCalculationConsumer,
  (result, rawContext) => {
    const context = mathContextFor(rawContext);
    const mathHints = mathHintsOf(result);

    if (!context.insideCalculation && mathCategory(mathHints) === null) {
      return null;
    }

    const expectedType = requiredExpectedType(rawContext as InternalMathContext);

    if (
      !context.insideCalculation &&
      !matchesExpectedCalculationType(mathHints, expectedType, context)
    ) {
      return null;
    }

    return createMathValue(
      simplifyCalculationTree(result, ValueStage.Declared, context, expectedType),
      expectedType,
    );
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

const minConsumer = createVariadicMathFunctionConsumer('min');
const maxConsumer = createVariadicMathFunctionConsumer('max');
const clampConsumer = createClampConsumer();
const roundConsumer = createRoundConsumer();
const modConsumer = createBinaryMathFunctionConsumer(
  'mod',
  'same',
);
const remConsumer = createBinaryMathFunctionConsumer(
  'rem',
  'same',
);
const sinConsumer = createUnaryMathFunctionConsumer(
  'sin',
  'number',
  ['number', 'angle'],
);
const cosConsumer = createUnaryMathFunctionConsumer(
  'cos',
  'number',
  ['number', 'angle'],
);
const tanConsumer = createUnaryMathFunctionConsumer(
  'tan',
  'number',
  ['number', 'angle'],
);
const asinConsumer = createUnaryMathFunctionConsumer(
  'asin',
  'angle',
  ['number'],
);
const acosConsumer = createUnaryMathFunctionConsumer(
  'acos',
  'angle',
  ['number'],
);
const atanConsumer = createUnaryMathFunctionConsumer(
  'atan',
  'angle',
  ['number'],
);
const atan2Consumer = createBinaryMathFunctionConsumer(
  'atan2',
  'angle',
);
const powConsumer = createBinaryMathFunctionConsumer(
  'pow',
  'number',
  ['number'],
);
const sqrtConsumer = createUnaryMathFunctionConsumer(
  'sqrt',
  'number',
  ['number'],
);
const hypotConsumer = createVariadicMathFunctionConsumer('hypot');
const logConsumer = createLogConsumer();
const expConsumer = createUnaryMathFunctionConsumer(
  'exp',
  'number',
  ['number'],
);
const absConsumer = createUnaryMathFunctionConsumer(
  'abs',
  'consistent',
);
const signConsumer = createUnaryMathFunctionConsumer(
  'sign',
  'number',
);

const nonCalcMathFunctionConsumer: TryComponentConsumer<
  MathFunctionNode | NumericLeaf
> =
  oneOf(
    [
      one(minConsumer), one(maxConsumer), one(clampConsumer),
      one(roundConsumer), one(modConsumer), one(remConsumer),
      one(sinConsumer), one(cosConsumer), one(tanConsumer),
      one(asinConsumer), one(acosConsumer), one(atanConsumer),
      one(atan2Consumer), one(powConsumer), one(sqrtConsumer),
      one(hypotConsumer), one(logConsumer), one(expConsumer),
      one(absConsumer), one(signConsumer),
    ],
    ([value]) => value,
  );

function createMathValue<Type extends MathValueType>(
  calculation: CalculationTree,
  valueType: Type,
  promoted = false,
): MathValue<Type> {
  return {
    type: 'math',
    calculation,
    valueType,
    promoted,
  };
}

type MathFunctionTypeRule =
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
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeCalcSum, 1, CALC_TERM_LIMIT),
    (args) => createMathFunctionNode<
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
  typeRule: MathFunctionTypeRule,
  argumentCategories?: readonly MathCategory[],
): TryComponentConsumer<
  MathBinaryFunctionNode<Name> | NumericLeaf
> {
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeCalcSum, 2, 2),
    (args) => {
      const [first, second] = args;

      return createMathFunctionNode<MathBinaryFunctionNode<Name>>(
        { type: name, arguments: [first, second] },
        args,
        typeRule,
        argumentCategories,
      );
    },
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createUnaryMathFunctionConsumer<
  Name extends UnaryMathFunctionName,
>(
  name: Name,
  typeRule: MathFunctionTypeRule,
  argumentCategories?: readonly MathCategory[],
): TryComponentConsumer<
  MathUnaryFunctionNode<Name> | NumericLeaf
> {
  const consumeArguments = adaptConsumer(
    consumeCalcSum,
    (child) => createMathFunctionNode<
      MathUnaryFunctionNode<Name>
    >(
      { type: name, arguments: [child] },
      [child],
      typeRule,
      argumentCategories,
    ),
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createClampConsumer(): TryComponentConsumer<
  MathClampNode | NumericLeaf
> {
  const consumeArgument: TryComponentConsumer<CalculationTree | 'none'> = oneOf(
    [
      one(consumeCalcSum),
      one(createKeywordConsumer('none')),
    ],
    ([value]) => value,
  );
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeArgument, 3, 3),
    (args) => {
      const [minimumArgument, value, maximumArgument] = args;

      if (value === 'none') {
        return null;
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
      opt(consumeRoundingStrategyPrefix),
      commaRepeat(withTrivia(consumeCalcSum), 1, 2),
    ],
    ([[explicitStrategy], children]) => {
      const [value, step] = children;

      const strategy = explicitStrategy ?? 'nearest';
      const valueHints = mathHintsOf(value);
      const valueCategory = mathCategory(valueHints);

      if (
        valueCategory === null ||
        (strategy === 'line-width' && valueCategory !== 'length') ||
        (
          step === undefined &&
          valueCategory !== 'number' &&
          strategy !== 'line-width'
        )
      ) {
        return null;
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
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeCalcSum, 1, 2),
    (args) => {
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
  return createFunctionalNotationConsumer(
    name,
    consumeArguments,
    (result, rawContext) => {
      const context = mathContextFor(rawContext);

      if (!context.insideCalculation && mathCategory(result.hints) === null) {
        return null;
      }

      const valueType = context.insideCalculation
        ? undefined
        : requiredExpectedType(rawContext as InternalMathContext);

      if (
        valueType !== undefined &&
        !matchesExpectedCalculationType(
          result.hints,
          valueType,
          context,
        )
      ) {
        return null;
      }

      return simplifyCalculationTree(
        result,
        ValueStage.Declared,
        context,
        valueType,
      ) as Node | NumericLeaf;
    },
    {
      contextForArguments: enterCalculationContext,
    },
  );
}

function createMathFunctionNode<
  Node extends MathFunctionNode,
>(
  node: Omit<Node, 'hints'>,
  calculations: readonly CalculationTree[],
  typeRule: MathFunctionTypeRule,
  argumentCategories?: readonly MathCategory[],
): Node | null {
  const hints = calculations.map(mathHintsOf);
  const categories = hints.map(mathCategory);

  if (
    categories.some((category) => category === null) ||
    (
      argumentCategories !== undefined &&
      categories.some((category) =>
        !argumentCategories.includes(category!)
      )
    ) ||
    (
      typeRule === 'same' &&
      !hints.every((argumentHints) =>
        haveSameMathHints(argumentHints, hints[0]!)
      )
    )
  ) {
    return null;
  }

  const consistentHints = addMathHints(hints);

  if (consistentHints === null) {
    return null;
  }

  let mathHints: MathHints;

  switch (typeRule) {
    case 'consistent':
    case 'same':
      mathHints = consistentHints;
      break;
    case 'number':
      mathHints = createMathHints(
        [],
        consistentHints.percentHint,
      );
      break;
    case 'angle':
      mathHints = createMathHints(
        [['angle', 1]],
        consistentHints.percentHint,
      );
      break;
  }

  if (mathCategory(mathHints) === null) {
    return null;
  }

  return {
    ...node,
    hints: mathHints,
  } as Node;
}

const roundingStrategyConsumer: TryComponentConsumer<RoundingStrategy> =
  createKeywordConsumer('nearest', 'up', 'down', 'to-zero', 'line-width');

function consumeRoundingStrategyPrefix(
  c: ComponentCursor,
): TryComponentConsumerResult<RoundingStrategy> {
  return roundingStrategyPrefixConsumer(c);
}

const roundingStrategyPrefixConsumer = sequenceOf(
  [
    one(roundingStrategyConsumer),
    one(withTrivia(consumeComma)),
  ],
  ([[strategy]]) => strategy,
);

function haveSameMathHints(
  a: MathHints,
  b: MathHints,
): boolean {
  return (
    a.percentHint === b.percentHint &&
    haveEqualExponents(a, b)
  );
}

/*
 * <calc-sum> = <calc-product> [ [ '+' | '-' ] <calc-product> ]*
 */

type CalcSumNode = CalculationNodeWithChildren<
  'sum',
  [CalculationTree, CalculationTree, ...CalculationTree[]]
>;

type CalcSumTail = {
  operator: '+' | '-';
  value: CalculationTree;
};

function consumeCalcSum(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return calcSumConsumer(c);
}

// Repeated <calc-sum> fragment: [ '+' | '-' ] <calc-product>
const calcSumTailConsumer: TryComponentConsumer<CalcSumTail> = sequenceOf(
  [
    one(consumeCalcSumOperator),
    one(consumeCalcProduct),
  ],
  ([[operator], [value]]) => ({ operator, value }),
);

const calcSumConsumer: TryComponentConsumer<CalculationTree> = sequenceOf(
  [
    one(consumeCalcProduct),
    repeat(calcSumTailConsumer, 0, CALC_TERM_LIMIT - 1),
  ],
  ([[first], tail]) => {
    if (tail.length === 0) {
      return first;
    }

    const children: CalculationTree[] = [first];
    let mathHints = mathHintsOf(first);

    for (const { operator, value } of tail) {
      const valueHints = mathHintsOf(value);

      if (operator === '+') {
        children.push(value);
      } else {
        children.push({
          type: 'negate',
          child: value,
          hints: valueHints,
        });
      }

      const sumHints = addMathHints(
        [mathHints, valueHints],
      );

      if (sumHints === null) {
        return null;
      }

      mathHints = sumHints;
    }

    return {
      type: 'sum',
      children: children as CalcSumNode['children'],
      hints: mathHints,
    };
  },
);

function consumeCalcSumOperator(
  c: ComponentCursor,
): TryComponentConsumerResult<'+' | '-'> {
  const start = c.pos();

  if (!c.match(TokenKind.Whitespace)) {
    return null;
  }

  consumeWhitespace(c);
  const component = c.next();

  if (!isDelimToken(component, '+') && !isDelimToken(component, '-')) {
    c.restore(start);
    return null;
  }

  if (!c.match(TokenKind.Whitespace)) {
    c.restore(start);
    return null;
  }

  consumeWhitespace(c);
  return component.value as '+' | '-';
}

/*
 * <calc-product> = <calc-value> [ [ '*' | '/' ] <calc-value> ]*
 */

type CalcProductNode = CalculationNodeWithChildren<
  'product',
  [CalculationTree, CalculationTree, ...CalculationTree[]]
>;

type CalcNegateNode = {
  type: 'negate';
  child: CalculationTree;
  hints: MathHints;
};

type CalcInvertNode = {
  type: 'invert';
  child: CalculationTree;
  hints: MathHints;
};

type CalcProductTail = {
  operator: '*' | '/';
  value: CalculationTree;
};

function consumeCalcProduct(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return calcProductConsumer(c);
}

const calcProductOperatorConsumer: TryComponentConsumer<'*' | '/'> = oneOf(
  [
    one(consumeAsteriskDelim),
    one(consumeSlashDelim),
  ],
  ([operator]) => operator,
);

// Repeated <calc-product> fragment: [ '*' | '/' ] <calc-value>
const calcProductTailConsumer: TryComponentConsumer<CalcProductTail> = sequenceOf(
  [
    one(withTrivia(calcProductOperatorConsumer)),
    one(withTrivia(consumeCalcValue)),
  ],
  ([[operator], [value]]) => ({ operator, value }),
);

const calcProductConsumer: TryComponentConsumer<CalculationTree> = sequenceOf(
  [
    one(consumeCalcValue),
    repeat(calcProductTailConsumer, 0, CALC_TERM_LIMIT - 1),
  ],
  ([[first], tail]) => {
    if (tail.length === 0) {
      return first;
    }

    const children: CalculationTree[] = [first];
    let mathHints = mathHintsOf(first);

    for (const { operator, value } of tail) {
      const valueHints = mathHintsOf(value);

      const childHints = operator === '*'
        ? valueHints
        : invertMathHints(valueHints);

      children.push(operator === '*'
        ? value
        : {
          type: 'invert',
          child: value,
          hints: childHints,
        });
      const productHints = multiplyMathHints(
        [mathHints, childHints],
      );

      if (productHints === null) {
        return null;
      }

      mathHints = productHints;
    }

    return {
      type: 'product',
      children: children as CalcProductNode['children'],
      hints: mathHints,
    };
  },
);

/*
 * <calc-value> = <number> | <dimension> | <percentage> |
 *                <calc-keyword> | ( <calc-sum> )
 *
 * Math functions are also calculation components. Nested calc() functions
 * are unwrapped because their parentheses provide equivalent grouping.
 */

function consumeCalcValue(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return calcValueConsumer(c);
}

const mathFunctionCalculationConsumer: TryComponentConsumer<CalculationTree> =
  oneOf(
    [
      one(consumeCalcCalculation),
      one(nonCalcMathFunctionConsumer),
    ],
    ([value]) => value,
  );

const mathValueConsumer: TryComponentConsumer<MathValue> = adaptConsumer(
  mathFunctionCalculationConsumer,
  (calculation, context) => createMathValue(
    calculation,
    requiredExpectedType(context as InternalMathContext),
  ),
);

const calcNumericLeafConsumer: TryComponentConsumer<NumericLeaf> = oneOf(
  [
    one(consumeNumber),
    one(consumeDimension),
    one(consumePercentage),
  ],
  ([value], context) => {
    const normalized = value.value === 0
      ? { ...value, value: 0 }
      : value;
    const mathHints = mathHintsFromValue(
      normalized,
      mathContextFor(context),
    );

    return mathHints === null
      ? null
      : createNumericLeaf(normalized, mathHints);
  },
);

const calcValueConsumer: TryComponentConsumer<CalculationTree> = oneOf(
  [
    one(calcNumericLeafConsumer),
    one(consumeCalcKeyword),
    one(consumeParenthesizedCalcSum),
    one(mathFunctionCalculationConsumer),
  ],
  ([result], rawContext) => {
    const context = rawContext as InternalMathContext;

    if (
      context.termCount !== undefined &&
      context.termCount + 1 > CALC_COMPLEXITY_LIMIT
    ) {
      return null;
    }

    if (context.termCount !== undefined) {
      context.termCount++;
    }

    return result;
  },
);

function consumeParenthesizedCalcSum(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return parenthesizedCalcSumConsumer(c);
}

const parenthesizedCalcSumConsumer = adaptConsumer(
  consumeParensBlock,
  (component, context) => parseAsComponentGrammar(
    component.value,
    withTrivia(consumeCalcSum),
    context,
  ),
);

function consumeCalcCalculation(
  c: ComponentCursor,
): TryComponentConsumerResult<CalculationTree> {
  return (
    mathContextFor(c.context).insideCalculation
      ? nestedCalcCalculationConsumer
      : topLevelCalcCalculationConsumer
  )(c);
}

// A top-level calc() first applies expected-type validation. A nested calc()
// contributes its calculation tree directly and is simplified as grouping.
const topLevelCalcCalculationConsumer = adaptConsumer(
  consumeCalc,
  (value) => value.calculation,
);

const nestedCalcCalculationConsumer = adaptConsumer(
  calcCalculationConsumer,
  (calculation, context) => simplifyCalculationTree(
    calculation,
    ValueStage.Declared,
    mathContextFor(context),
  ),
);

/*
 * <calc-keyword> = e | pi | infinity | -infinity | NaN
 *
 * A calculation context can define additional numeric variables.
 */

function consumeCalcKeyword(
  c: ComponentCursor,
): TryComponentConsumerResult<NumericLeaf | VariableLeaf> {
  return calcKeywordConsumer(c);
}

const calcKeywordConsumer: TryComponentConsumer<NumericLeaf | VariableLeaf> = adaptConsumer(
  consumeIdentToken,
  (token, rawContext) => {
    const name = asciiLower(token.value);
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
      return createNumericLeaf(
        { type: 'number', value },
        numberMathHints(),
      );
    }

    const context = mathContextFor(rawContext);
    const variable = context.numericVariables?.get(name);

    if (variable === undefined) return null;

    return {
      type: 'variable',
      name,
      hints: mathHintsFromNumericVariable(variable, context),
    };
  },
);

// █████▌ █   ▐▌ ████▌  █████▌  ███▌
//   █▌   ▐▌  █  █▌  █▌ █▌     █▌  █▌
//   █▌    █ ▐▌  █▌  █▌ █▌     █▌
//   █▌    ▐▌█   ████▌  ████    ███▌
//   █▌     █▌   █▌     █▌         █▌
//   █▌     █▌   █▌     █▌     █▌  █▌
//   █▌     █▌   █▌     █████▌  ███▌
//
// Math Hints
//
// CSS Typed OM calls this structure a numeric type. It records the
// dimensional-analysis exponents and the authoritative percent hint.

const MATH_BASES = [
  'length',
  'angle',
  'time',
  'frequency',
  'resolution',
  'flex',
  'percent',
] as const;

export type MathBase =
  (typeof MATH_BASES)[number];

type MathExponent =
  readonly [base: MathBase, power: number];

type MathHints = {
  exponents: readonly MathExponent[];
  percentHint: MathBase | null;
};

type MathCategory =
  | 'number'
  | MathBase;

function mathHintsOf(calculation: CalculationTree): MathHints {
  return cloneMathHints(calculation.hints);
}

function mathHintsFromValue(
  value: NumericLiteral,
  context: MathContext,
): MathHints | null {
  switch (value.type) {
    case 'number':
      return numberMathHints();
    case 'percentage':
      return percentageMathHints(context);
    case 'dimension':
      return createMathHintsFromUnit(value.unit);
  }
}

function mathHintsFromNumericVariable(
  variable: NumericVariable,
  context: MathContext,
): MathHints {
  const hints = mathHintsFromValueType(variable.valueType, context);

  if (variable.value !== undefined && variable.value !== 'none') {
    const valueHints = mathHintsFromValue(variable.value, context);

    if (
      valueHints === null ||
      !matchesExpectedCalculationType(
        valueHints,
        variable.valueType,
        context,
      )
    ) {
      throw new TypeError('Numeric variable value does not match its value type');
    }
  }

  return hints;
}

function mathHintsFromValueType(
  valueType: MathValueType,
  context: MathContext,
): MathHints {
  switch (valueType) {
    case 'number':
    case 'integer':
      return numberMathHints();
    case 'percentage':
      return percentageMathHints(context);
    case 'length':
    case 'angle':
    case 'time':
    case 'frequency':
    case 'resolution':
    case 'flex':
      return createMathHints([[valueType, 1]], null);
    case 'length-percentage':
      return createMathHints([['length', 1]], 'length');
    case 'angle-percentage':
      return createMathHints([['angle', 1]], 'angle');
    case 'time-percentage':
      return createMathHints([['time', 1]], 'time');
    case 'frequency-percentage':
      return createMathHints([['frequency', 1]], 'frequency');
  }
}

function zeroNumericLiteral(valueType: MathValueType): NumericLiteral {
  switch (valueType) {
    case 'number':
    case 'integer':
      return { type: 'number', value: 0 };
    case 'percentage':
      return { type: 'percentage', value: 0 };
    case 'angle':
    case 'angle-percentage':
      return { type: 'dimension', value: 0, unit: 'deg' };
    case 'frequency':
    case 'frequency-percentage':
      return { type: 'dimension', value: 0, unit: 'hz' };
    case 'length':
    case 'length-percentage':
      return { type: 'dimension', value: 0, unit: 'px' };
    case 'resolution':
      return { type: 'dimension', value: 0, unit: 'dppx' };
    case 'time':
    case 'time-percentage':
      return { type: 'dimension', value: 0, unit: 's' };
    case 'flex':
      return { type: 'dimension', value: 0, unit: 'fr' };
  }
}

function createNumericLeaf<Value extends NumericLiteral>(
  value: Value,
  hints: MathHints,
): Value & { hints: MathHints; } {
  return {
    ...value,
    hints: cloneMathHints(hints),
  };
}

function withMathHints<Calculation extends CalculationTree>(
  calculation: Calculation,
  hints: MathHints,
): Calculation {
  return {
    ...calculation,
    hints: cloneMathHints(hints),
  };
}

function addMathHints(
  hints: readonly (MathHints | null)[],
): MathHints | null {
  const [first, ...rest] = hints;

  if (first === undefined) {
    throw new RangeError('Math hint addition requires an operand');
  }

  if (first === null) {
    return null;
  }

  let result = cloneMathHints(first);

  for (const nextHints of rest) {
    if (nextHints === null) {
      return null;
    }

    const sum = addTwoMathHints(result, nextHints);

    if (sum === null) {
      return null;
    }

    result = sum;
  }

  return result;
}

function multiplyMathHints(
  hints: readonly (MathHints | null)[],
): MathHints | null {
  let result = numberMathHints();

  for (const nextHints of hints) {
    if (nextHints === null) {
      return null;
    }

    const product = multiplyTwoMathHints(result, nextHints);

    if (product === null) {
      return null;
    }

    result = product;
  }

  return result;
}

function invertMathHints(
  hints: MathHints,
): MathHints {
  return createMathHints(
    hints.exponents.map(([base, power]) => [base, -power]),
    hints.percentHint,
  );
}

function mathCategory(
  hints: MathHints,
): MathCategory | null {
  if (hints.exponents.length === 0) {
    return 'number';
  }

  if (hints.exponents.length !== 1) {
    return null;
  }

  const [base, power] = hints.exponents[0]!;
  return power === 1
    ? base
    : null;
}

function matchesExpectedCalculationType(
  hints: MathHints,
  expectedType: MathValueType,
  context: MathContext,
): boolean {
  switch (expectedType) {
    case 'number':
    case 'integer':
      return matchesNumberType(hints, context.percentHint);

    case 'percentage':
      return matchesPercentageType(hints);

    case 'length':
    case 'angle':
    case 'time':
    case 'frequency':
    case 'resolution':
    case 'flex':
      return matchesDimensionType(
        hints,
        expectedType,
        context.percentHint ?? null,
      );

    case 'length-percentage':
      return matchesMixedType(hints, 'length');

    case 'angle-percentage':
      return matchesMixedType(hints, 'angle');

    case 'time-percentage':
      return matchesMixedType(hints, 'time');

    case 'frequency-percentage':
      return matchesMixedType(hints, 'frequency');
  }
}

function matchesNumberType(
  hints: MathHints,
  percentHint: MathBase | undefined,
): boolean {
  return (
    hints.exponents.length === 0 &&
    (
      hints.percentHint === null ||
      (
        percentHint !== undefined &&
        hints.percentHint === percentHint
      )
    )
  );
}

function matchesPercentageType(hints: MathHints): boolean {
  return (
    hasSingleExponent(hints, 'percent') &&
    (
      hints.percentHint === null ||
      hints.percentHint === 'percent'
    )
  );
}

function matchesDimensionType(
  hints: MathHints,
  base: Exclude<MathBase, 'percent'>,
  percentHint: MathBase | null,
): boolean {
  return (
    hasSingleExponent(hints, base) &&
    (
      hints.percentHint === null ||
      hints.percentHint === percentHint
    )
  );
}

function matchesMixedType(
  hints: MathHints,
  base: 'length' | 'angle' | 'time' | 'frequency',
): boolean {
  return (
    matchesDimensionType(hints, base, base) ||
    matchesPercentageType(hints)
  );
}

function hasSingleExponent(
  hints: MathHints,
  base: MathBase,
): boolean {
  return (
    hints.exponents.length === 1 &&
    hints.exponents[0]![0] === base &&
    hints.exponents[0]![1] === 1
  );
}

function addTwoMathHints(
  a: MathHints,
  b: MathHints,
): MathHints | null {
  let left = cloneMathHints(a);
  let right = cloneMathHints(b);

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
    return createMathHints(
      left.exponents,
      left.percentHint,
    );
  }

  if (!containMixedPercentAndDimension(left, right)) {
    return null;
  }

  const unhintedLeft = cloneMathHints(left);
  const unhintedRight = cloneMathHints(right);

  if (
    unhintedLeft.percentHint !== null ||
    unhintedRight.percentHint !== null
  ) {
    return null;
  }

  for (const hint of MATH_BASES) {
    if (hint === 'percent') {
      continue;
    }

    const hintedLeft = applyPercentHint(unhintedLeft, hint);
    const hintedRight = applyPercentHint(unhintedRight, hint);

    if (haveEqualExponents(hintedLeft, hintedRight)) {
      return createMathHints(
        hintedLeft.exponents,
        hint,
      );
    }
  }

  return null;
}

function multiplyTwoMathHints(
  a: MathHints,
  b: MathHints,
): MathHints | null {
  let left = cloneMathHints(a);
  let right = cloneMathHints(b);

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

  return mathHintsFromMap(exponents, left.percentHint);
}

function applyPercentHint(
  hints: MathHints,
  hint: MathBase,
): MathHints {
  const exponents = exponentMap(hints);

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

  return mathHintsFromMap(exponents, hint);
}

function createMathHintsFromUnit(unit: string): MathHints | null {
  const normalized = asciiLower(unit);
  let base: MathBase;

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

  return createMathHints([[base, 1]], null);
}

function percentageMathHints(
  context: MathContext,
): MathHints {
  const hint = context.percentHint ?? 'percent';
  return createMathHints([[hint, 1]], hint);
}

function numberMathHints(): MathHints {
  return createMathHints([], null);
}

function createMathHints(
  exponents: readonly MathExponent[],
  percentHint: MathBase | null,
): MathHints {
  const powers = new Map<MathBase, number>(exponents);
  return mathHintsFromMap(powers, percentHint);
}

function mathHintsFromMap(
  powers: ReadonlyMap<MathBase, number>,
  percentHint: MathBase | null,
): MathHints {
  const exponents: MathExponent[] = [];

  for (const base of MATH_BASES) {
    const power = powers.get(base) ?? 0;

    if (power !== 0) {
      exponents.push([base, power]);
    }
  }

  return { exponents, percentHint };
}

function cloneMathHints(hints: MathHints): MathHints {
  return createMathHints(hints.exponents, hints.percentHint);
}

function exponentMap(
  hints: MathHints,
): Map<MathBase, number> {
  return new Map(hints.exponents);
}

function haveEqualExponents(
  a: MathHints,
  b: MathHints,
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
  a: MathHints,
  b: MathHints,
): boolean {
  const combined = [...a.exponents, ...b.exponents];
  return combined.some(([base, power]) =>
    base === 'percent' && power !== 0
  ) && combined.some(([base, power]) =>
    base !== 'percent' && power !== 0
  );
}

function mathContextFor(
  context: unknown,
): InternalMathContext {
  return context === null || context === undefined
    ? {}
    : context;
}

function requiredExpectedType(
  context?: InternalMathContext,
): MathValueType {
  if (context?.expectedType === undefined) {
    throw new TypeError('Math value expected type is required');
  }

  return context.expectedType;
}

function enterCalculationContext(
  context: unknown,
): unknown {
  const mathContext = mathContextFor(context);
  const parserContext = context as InternalMathContext;

  if (
    mathContext.insideCalculation &&
    parserContext.termCount !== undefined
  ) {
    return context;
  }

  return {
    ...mathContext,
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

function simplifyCalculationTree(
  root: CalculationTree,
  stage: ValueStage,
  context: InternalMathContext = {},
  valueType?: MathValueType,
): CalculationTree {
  const simplified = simplifyCalculationNode(root, context);

  if (
    stage === ValueStage.Declared ||
    stage === ValueStage.Cascaded ||
    stage === ValueStage.Specified ||
    context.insideCalculation ||
    !isNumericLeaf(simplified)
  ) {
    return simplified;
  }

  return finalizeNumericLeaf(simplified, context, valueType);
}

function resolvedMathLiteralFromLeaf<Type extends MathValueType>(
  value: NumericLeaf,
  valueType: Type,
): MathLiteralByType[Type] {
  const literal = reifyNumericLiteral(value, valueType);

  if (!matchesResolvedMathLiteral(literal, valueType)) {
    throw new TypeError(
      'Resolved math value does not match its value type',
    );
  }

  return literal;
}

function reifyNumericLiteral(
  value: NumericLeaf,
  valueType: MathValueType,
): MathLiteralByType[MathValueType] {
  if (valueType === 'integer' && value.type === 'number') {
    return { type: 'integer', value: value.value };
  }

  if (value.type === 'dimension') {
    switch (valueType) {
      case 'angle':
      case 'angle-percentage':
        if (isUnit(ANGLE_UNITS, value.unit)) {
          return { type: 'angle', value: value.value, unit: value.unit };
        }
        break;
      case 'frequency':
      case 'frequency-percentage':
        if (isUnit(FREQUENCY_UNITS, value.unit)) {
          return { type: 'frequency', value: value.value, unit: value.unit };
        }
        break;
      case 'length':
      case 'length-percentage':
        if (value.unit === '' && value.value === 0) {
          return { type: 'length', value: 0, unit: '' };
        }
        if (isUnit(LENGTH_UNITS, value.unit)) {
          return { type: 'length', value: value.value, unit: value.unit };
        }
        break;
      case 'resolution':
        if (isUnit(RESOLUTION_UNITS, value.unit)) {
          return { type: 'resolution', value: value.value, unit: value.unit };
        }
        break;
      case 'time':
      case 'time-percentage':
        if (isUnit(TIME_UNITS, value.unit)) {
          return { type: 'time', value: value.value, unit: value.unit };
        }
        break;
    }
  }

  return numericLiteralFromLeaf(value);
}

function matchesResolvedMathLiteral<Type extends MathValueType>(
  value: MathLiteralByType[MathValueType],
  valueType: Type,
): value is MathLiteralByType[Type] {
  switch (valueType) {
    case 'number':
      return value.type === 'number';
    case 'integer':
      return value.type === 'integer';
    case 'percentage':
      return value.type === 'percentage';
    case 'angle':
      return value.type === 'angle';
    case 'frequency':
      return value.type === 'frequency';
    case 'length':
      return value.type === 'length';
    case 'resolution':
      return value.type === 'resolution';
    case 'time':
      return value.type === 'time';
    case 'angle-percentage':
      return value.type === 'angle' || value.type === 'percentage';
    case 'frequency-percentage':
      return value.type === 'frequency' || value.type === 'percentage';
    case 'length-percentage':
      return value.type === 'length' || value.type === 'percentage';
    case 'time-percentage':
      return value.type === 'time' || value.type === 'percentage';
    case 'flex':
      return value.type === 'dimension';
  }
}

function numericLiteralFromLeaf(value: NumericLeaf): NumericLiteral {
  switch (value.type) {
    case 'number':
      return {
        type: 'number',
        value: value.value,
      };
    case 'percentage':
      return {
        type: 'percentage',
        value: value.value,
      };
    case 'dimension':
      return {
        type: 'dimension',
        value: value.value,
        unit: value.unit,
      };
  }
}

function simplifyCalculationNode(
  root: CalculationTree,
  context: MathContext,
): CalculationTree {
  const simplified = simplifyCalculationNodeInternal(root, context);

  return simplified.type === 'dimension'
    ? canonicalizeDimension(simplified, context)
    : simplified;
}

function simplifyCalculationNodeInternal(
  root: CalculationTree,
  context: MathContext,
): CalculationTree {
  switch (root.type) {
    case 'number':
      return root;

    case 'percentage':
      return resolvePercentage(root, context);

    case 'dimension':
      return root;

    case 'variable': {
      const variable = context.numericVariables?.get(root.name);

      if (variable === undefined || variable.value === undefined) {
        return root;
      }

      const hints = mathHintsFromNumericVariable(variable, context);

      if (!haveSameMathHints(root.hints, hints)) {
        throw new TypeError('Numeric variable value type changed during resolution');
      }

      return simplifyCalculationNode(
        createNumericLeaf(
          variable.value === 'none'
            ? zeroNumericLiteral(variable.valueType)
            : variable.value,
          hints,
        ),
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
  context: MathContext,
  valueType?: MathValueType,
): NumericLeaf {
  const [rangeMinimum, rangeMaximum] =
    context.range ?? [-Infinity, Infinity];
  const minimum = Math.max(rangeMinimum, -Number.MAX_VALUE);
  const maximum = Math.min(rangeMaximum, Number.MAX_VALUE);
  const censored = censorNumericLeaf(root, minimum, maximum);
  const clamped = Math.min(maximum, Math.max(minimum, censored.value));

  return {
    ...censored,
    value: valueType === 'integer'
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
  context: MathContext,
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
        return withMathHints(args[0]!, mathNode.hints);
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
        mathNode.hints,
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
        numberMathHints(),
      );

      switch (strategy) {
        case 'nearest': {
          if (!haveSameMathHintsAndUnit(input, step)) {
            return mathNode;
          }

          const [lower, upper] = roundingBounds(input.value, step.value);
          const result = input.value - lower < upper - input.value
            ? lower
            : upper;

          return createNumericLeaf(
            { ...input, value: result },
            mathNode.hints,
          );
        }

        case 'up': {
          if (!haveSameMathHintsAndUnit(input, step)) {
            return mathNode;
          }

          const [, upper] = roundingBounds(input.value, step.value);
          return createNumericLeaf(
            { ...input, value: upper },
            mathNode.hints,
          );
        }

        case 'down': {
          if (!haveSameMathHintsAndUnit(input, step)) {
            return mathNode;
          }

          const [lower] = roundingBounds(input.value, step.value);
          return createNumericLeaf(
            { ...input, value: lower },
            mathNode.hints,
          );
        }

        case 'to-zero': {
          if (!haveSameMathHintsAndUnit(input, step)) {
            return mathNode;
          }

          const [lower, upper] = roundingBounds(input.value, step.value);
          const result = input.value < 0 || Object.is(input.value, -0)
            ? upper
            : lower;

          return createNumericLeaf(
            { ...input, value: result },
            mathNode.hints,
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
              mathNode.hints,
            );
          }

          if (!haveSameMathHintsAndUnit(input, step)) {
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
            mathNode.hints,
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

      if (!haveSameMathHintsAndUnit(value, step)) {
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
        mathNode.hints,
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
        mathNode.hints,
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
        mathNode.hints,
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
        mathNode.hints,
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
        mathNode.hints,
      );
    }

    case 'sqrt': {
      const [input] = mathNode.arguments;

      if (input.type !== 'number') {
        return mathNode;
      }

      return createNumericLeaf(
        { type: 'number', value: Math.sqrt(input.value) },
        mathNode.hints,
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
        !haveSameMathHintsAndUnit(first, ...args.slice(1))
      ) {
        return mathNode;
      }

      const result = args.some((argument) => Number.isNaN(argument.value))
        ? NaN
        : Math.hypot(...args.map((argument) => argument.value));

      return createNumericLeaf(
        { ...first, value: result },
        mathNode.hints,
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
        mathNode.hints,
      );
    }

    case 'exp': {
      const [input] = mathNode.arguments;

      if (input.type !== 'number') {
        return mathNode;
      }

      return createNumericLeaf(
        { type: 'number', value: Math.exp(input.value) },
        mathNode.hints,
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
          mathNode.hints,
        )
        : createNumericLeaf(
          { type: 'number', value: Math.sign(input.value) },
          mathNode.hints,
        );
    }

    default:
      return mathNode;
  }
}

function simplifyMathFunctionArguments(
  root: MathFunctionNode,
  context: MathContext,
): MathFunctionNode {
  const simplify = (calculation: CalculationTree): CalculationTree =>
    simplifyCalculationNode(calculation, context);
  const mathHints = cloneMathHints(root.hints);

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
        hints: mathHints,
      };

    case 'round':
      return {
        ...root,
        value: simplify(root.value),
        step: root.step === undefined
          ? undefined
          : simplify(root.step),
        hints: mathHints,
      };

    default:
      return {
        ...root,
        arguments: root.arguments.map(simplify),
        hints: mathHints,
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
  context: MathContext,
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
  context: MathContext,
): boolean {
  return (
    haveSameMathHintsAndUnit(first, second) &&
    hasResolvedNumericMagnitude(first, context)
  );
}

function hasResolvedNumericMagnitude(
  value: NumericLeaf,
  context: MathContext,
): boolean {
  return (
    value.type !== 'percentage' ||
    context.percentHint === 'percent'
  );
}

function snapPixelDimension(
  value: number,
  devicePixelRatio: number,
  hints: MathHints,
): DimensionLiteral<'dimension', 'px'> & { hints: MathHints; } {
  const snapped = snapLengthAsLineWidth(
    { type: 'length', value, unit: 'px' },
    devicePixelRatio,
  );

  return createNumericLeaf(
    { ...snapped, type: 'dimension' },
    hints,
  );
}

function isPixelDimension(
  value: NumericLeaf,
): value is DimensionLeaf & { unit: 'px'; } {
  return value.type === 'dimension' && value.unit === 'px';
}

function haveSameMathHintsAndUnit(
  first: NumericLeaf,
  ...rest: readonly NumericLeaf[]
): boolean {
  return rest.every((value) =>
    first.type === value.type &&
    (
      first.type !== 'dimension' ||
      (value.type === 'dimension' && first.unit === value.unit)
    )
  );
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
  context: MathContext,
): CalculationTree {
  const child = simplifyCalculationNode(root.child, context);

  if (isNumericLeaf(child)) {
    return createNumericLeaf(
      negateNumericLeaf(child),
      root.hints,
    );
  }

  if (child.type === 'negate') {
    return withMathHints(child.child, root.hints);
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
      hints: cloneMathHints(root.hints),
    };
  }

  return {
    ...root,
    child,
    hints: cloneMathHints(root.hints),
  };
}

function simplifyInvert(
  root: CalcInvertNode,
  context: MathContext,
): CalculationTree {
  const child = simplifyCalculationNode(root.child, context);

  if (child.type === 'number') {
    return createNumericLeaf(
      { type: 'number', value: 1 / child.value },
      root.hints,
    );
  }

  if (child.type === 'invert') {
    return withMathHints(child.child, root.hints);
  }

  return {
    ...root,
    child,
    hints: cloneMathHints(root.hints),
  };
}

function simplifySum(
  root: CalcSumNode,
  context: MathContext,
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
  const flattened = simplified.flatMap((child) =>
    child.type === 'sum' ? child.children : [child]
  );
  const children = sortCalculationChildren(
    combineLikeNumericLeaves(flattened),
  );

  if (children.length === 1) {
    return withMathHints(children[0]!, root.hints);
  }

  return {
    ...root,
    children: children as CalcSumNode['children'],
    hints: cloneMathHints(root.hints),
  };
}

function simplifyProduct(
  root: CalcProductNode,
  context: MathContext,
): CalculationTree {
  const simplified = root.children.map((child) =>
    simplifyCalculationNode(child, context)
  );
  const flattened = simplified.flatMap((child) =>
    child.type === 'product' ? child.children : [child]
  );
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
        children: sum.children.map((child) =>
          scaleNumericLeaf(
            child as NumericLeaf,
            number,
          )
        ) as CalcSumNode['children'],
        hints: cloneMathHints(root.hints),
      };
    }
  }

  const product = evaluateNumericProduct(
    children,
    root.hints,
  );

  if (product !== null) {
    return product;
  }

  return {
    ...root,
    children: children as CalcProductNode['children'],
    hints: cloneMathHints(root.hints),
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
  const mathHints = multiplyMathHints([
    leaf.hints,
    factor.hints,
  ]);

  if (mathHints === null) {
    throw new TypeError('Cannot multiply inconsistent math hints');
  }

  return createNumericLeaf(
    { ...leaf, value: leaf.value * factor.value },
    mathHints,
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
    hints: mathHintsOf(child),
  };
}

function combineLikeNumericLeaves(
  children: readonly CalculationTree[],
): CalculationTree[] {
  const totals = new Map<string, {
    value: number;
    leaf: NumericLeaf;
    mathHints: MathHints;
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
      mathHints: total?.mathHints ?? child.hints,
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
        total.mathHints,
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

  if (
    numbers.length === 1 &&
    numbers[0]!.value === 1 &&
    children.length > 1
  ) {
    return children.filter((child) => child !== numbers[0]);
  }

  if (numbers.length < 2) {
    return [...children];
  }

  const product = numbers.reduce(
    (value, number) => value * number.value,
    1,
  );
  const mathHints = multiplyMathHints(
    numbers.map((number) => number.hints),
  );

  if (mathHints === null) {
    throw new TypeError('Cannot combine inconsistent number math hints');
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
        mathHints,
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
  mathHints: MathHints,
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
  const category = mathCategory(mathHints);

  if (remaining.length === 0) {
    return category === 'number'
      ? createNumericLeaf(
        { type: 'number', value },
        mathHints,
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
      mathHints,
    );
  }

  const unitHints = createMathHintsFromUnit(unit);

  if (
    unitHints === null ||
    mathCategory(unitHints) !== category
  ) {
    return null;
  }

  return createNumericLeaf(
    { type: 'dimension', value, unit },
    mathHints,
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
  context: MathContext,
): DimensionLeaf {
  const unit = asciiLower(value.unit);

  if (!Number.isFinite(value.value)) {
    return {
      ...value,
      unit: canonicalUnitForDimension(unit),
    };
  }

  let resolved: AnyDimensionLiteral | null;

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
    resolved = canonicalizeAngle({
      type: 'angle',
      value: value.value,
      unit,
    });
  } else if (isUnit(TIME_UNITS, unit)) {
    resolved = canonicalizeTime({
      type: 'time',
      value: value.value,
      unit,
    });
  } else if (isUnit(FREQUENCY_UNITS, unit)) {
    resolved = canonicalizeFrequency({
      type: 'frequency',
      value: value.value,
      unit,
    });
  } else if (isUnit(RESOLUTION_UNITS, unit)) {
    resolved = canonicalizeResolution({
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
      value.hints,
    );
}

function canonicalUnitForDimension(unit: string): string {
  const hints = createMathHintsFromUnit(unit);
  const category = hints === null
    ? null
    : mathCategory(hints);

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
      throw new TypeError(`Cannot canonicalize unknown dimension unit: ${unit}`);
  }
}

function resolvePercentage(
  value: PercentageLeaf,
  context: MathContext,
): NumericLeaf {
  const reference = context.percentageReferenceValue;

  if (reference === undefined) {
    return value;
  }

  const scaled = reference.value * value.value / 100;
  const literal: NumericLiteral = {
    type: 'dimension',
    value: scaled,
    unit: reference.unit,
  };

  return createNumericLeaf(literal, value.hints);
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

function serializeCalcTree(root: CalculationTree): string {
  switch (root.type) {
    case 'number':
    case 'percentage':
    case 'dimension':
      return serializeNumericLeaf(root);

    case 'variable':
      return serializeCssIdentifier(root.name);

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
  const [first, ...rest] = root.children;
  let serialized = `(${serializeCalcTree(first)}`;

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
  const [first, ...rest] = root.children;
  let serialized = `(${serializeCalcTree(first)}`;

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
        unit: value.unit,
      })}`;
  }
}
