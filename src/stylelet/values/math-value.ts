import { asciiLower } from '../../infra/ascii';
import { assertNever, mapTuple } from '../../infra/util';
import { InternalError } from '../../infra/internal-error';
import type { NumericRange } from '../../infra/range';

import {
  createKeywordConsumer, consumeWhitespace, createFunctionalNotationConsumer, consumeAsteriskDelim, consumeComma,
  consumeIdentToken, consumeParensBlock, consumeSlashDelim, commaRepeat, one, oneOf, opt,
  adaptConsumer, repeat, sequenceOf, withTrivia, isDelimToken, serializeCssIdentifier,
  parseAsComponentGrammar, serializeCssDimensionUnit, consumeNumberToken, consumeDimensionToken,
  consumePercentageToken, TokenKind,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import {
  AngleLiteral, DimensionLiteral, FrequencyLiteral, IntegerLiteral, LengthLiteral, NumberLiteral,
  PercentageLiteral, ResolutionLiteral, TimeLiteral, serializeCssNumber,
  ANGLE_UNITS, FREQUENCY_UNITS, LENGTH_UNITS, RESOLUTION_UNITS, TIME_UNITS,
  type CanonicalAngleLiteral, type CanonicalFrequencyLiteral, type CanonicalLengthLiteral,
  type CanonicalTimeLiteral, type LengthResolutionContext, type NumericLiteral,
} from './numeric-literal/index';

import type { Value } from './value';

/** A typed calculation whose representation can become a literal during resolution. */
// https://drafts.csswg.org/css-values-4/#math
export class MathValue<
  Type extends MathValueType = MathValueType,
  Representation extends MathRepresentation<Type> = MathRepresentation<Type>,
> implements Value<MathContext> {
  /** The expression or literal at the current lifecycle stage. */
  value: Representation;
  /** Numeric grammar retained even when a calculation resolves to a shared literal form. */
  valueType: Type;

  constructor(value: Representation, valueType: Type) {
    this.value = value;
    this.valueType = valueType;
  }

  /** Parse a complete math function against the requested numeric grammar. */
  static parse<Type extends MathValueType>(
    input: ParserInput,
    expectedType: Type,
    context: MathContext,
  ): MathValue<Type> | null {
    return parseAsComponentGrammar(input, withTrivia(MathValue.createConsumer({ expectedType })), context);
  }

  /** Consume a math function in the requested numeric grammar. */
  static consume<Type extends MathValueType>(
    this: void,
    c: TokenCursor<ComponentValue, MathContext>,
    options: MathValueConsumerOptions<Type>,
  ): TryConsumerResult<MathValue<Type>> {
    return c.withContext({
      ...c.context,
      expectedType: options.expectedType,
      ...(options.range === undefined ? {} : { range: options.range }),
      ...(options.percentHint === undefined ? {} : { percentHint: options.percentHint }),
    }, mathValueConsumer) as TryConsumerResult<MathValue<Type>>;
  }

  /** Bind a numeric grammar and its optional range and percentage hint to a consumer. */
  static createConsumer<Type extends MathValueType>(
    options: MathValueConsumerOptions<Type>,
  ): TryConsumer<MathValue<Type>, MathContext> {
    return (c) => MathValue.consume(c, options);
  }

  /** Promote a literal into calculation syntax for combination with another math value. */
  static fromLiteral<Type extends MathValueType>(
    literal: MathLiteralByType[Type],
    valueType: Type,
    context: MathContext = {},
  ): MathValue<Type> {
    return new MathValue(new MathExpression(createNumericLeafFromLiteral(literal, context)), valueType);
  }

  /** Promote a known numeric variable, retaining its bare identifier spelling. */
  static fromVariable<Type extends MathValueType>(
    name: string,
    valueType: Type,
    context: MathContext,
  ): MathValue<Type> {
    const normalizedName = asciiLower(name);
    const variable = context.numericVariables?.get(normalizedName);

    if (variable === undefined || variable.valueType !== valueType) {
      throw new InternalError('Cannot promote an unknown numeric variable');
    }

    const calculation = new VariableLeaf(normalizedName, mathHintsFromNumericVariable(variable, context));
    return new MathValue(new MathExpression(calculation, true), valueType);
  }

  /** Resolve with current inputs, retaining the value object when its representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): MathValue<Type> {
    const previous = this.value;
    const calculation = simplifyCalculationTree(this.#calculation(context), stage, context, this.valueType);
    const unwrapMathAt = context.unwrapMathAt ?? ValueStage.Computed;

    if (isNumericLeaf(calculation) && (stage >= unwrapMathAt || !(previous instanceof MathExpression))) {
      const literal = resolvedMathLiteralFromLeaf(calculation, this.valueType);
      if (!(previous instanceof MathExpression) && sameMathLiteral(previous, literal)) return this;
      return new MathValue(literal, this.valueType);
    }

    if (previous instanceof MathExpression && calculation === previous.calculation) return this;
    return new MathValue(new MathExpression(
      calculation,
      previous instanceof MathExpression && previous.promoted,
    ), this.valueType);
  }

  /** Serialize the current representation without resolving or converting it. */
  serialize(): string {
    return this.value.serialize();
  }

  /** Add calculations of the same numeric grammar. */
  // https://drafts.csswg.org/css-values-4/#combine-math
  add(other: MathValue<Type>, context: MathContext = {}): MathValue<Type> {
    return this.#combine(other, this.#calculation(context), other.#calculation(context), context);
  }

  /** Interpolate calculations while retaining terms that require later context. */
  interpolate(other: MathValue<Type>, progress: number, context: MathContext = {}): MathValue<Type> {
    return this.#combine(
      other,
      scaleCalculationTree(this.#calculation(context), 1 - progress),
      scaleCalculationTree(other.#calculation(context), progress),
      context,
    );
  }

  /** Accumulation of math functions is addition. */
  accumulate(other: MathValue<Type>, context: MathContext = {}): MathValue<Type> {
    return this.add(other, context);
  }

  /** Convert percentage math to a number in the caller's component scales. */
  toNumber(this: MathValue<'percentage'>, percentageScale: number, numberScale: number): MathValue<'number'> {
    const calculation = this.#calculation({ percentHint: 'percent' });
    const percentageBasis = createNumericLeaf(
      { type: 'percentage', value: 100 },
      percentageMathHints({ percentHint: 'percent' }),
    );
    const invertedPercentageBasis = new CalcInvertNode(percentageBasis, invertMathHints(percentageBasis.hints));
    const multiplier = createNumericLeaf({
      type: 'number',
      value: 100 * percentageScale / numberScale,
    }, numberMathHints());
    const hints = multiplyMathHints([
      mathHintsOf(calculation),
      multiplier.hints,
      mathHintsOf(invertedPercentageBasis),
    ]);
    if (hints === null) throw new InternalError('Cannot coerce inconsistent percentage math');

    const product = new CalcProductNode([calculation, multiplier, invertedPercentageBasis], hints);
    const simplified = simplifyCalculationTree(product, ValueStage.Declared, { percentHint: 'percent' }, 'number');
    return new MathValue(new MathExpression(simplified), 'number');
  }

  #calculation(context: MathContext): CalculationTree {
    return this.value instanceof MathExpression
      ? this.value.calculation : createNumericLeafFromLiteral(this.value, context);
  }

  #combine(
    other: MathValue<Type>,
    a: CalculationTree,
    b: CalculationTree,
    context: MathContext,
  ): MathValue<Type> {
    if (other.valueType !== this.valueType) throw new InternalError('Math value types must be consistent');
    const hints = addMathHints([mathHintsOf(a), mathHintsOf(b)]);
    if (hints === null) throw new InternalError('Math function types must be consistent');

    const sum = new CalcSumNode([a, b], hints);
    const simplified = simplifyCalculationTree(sum, ValueStage.Declared, context, this.valueType);
    return new MathValue(new MathExpression(simplified), this.valueType);
  }
}

/** Calculation syntax retained until resolution can produce a numeric literal. */
export class MathExpression {
  /** The retained calculation tree, including dimensional hints. */
  calculation: CalculationTree;
  /** Whether an unresolved variable keeps its bare identifier spelling. */
  promoted: boolean;

  constructor(calculation: CalculationTree, promoted = false) {
    this.calculation = calculation;
    this.promoted = promoted;
  }

  /** Serialize the retained calculation without resolving or converting it. */
  serialize(): string {
    const promotedName = this.variableName();
    if (promotedName !== null) return promotedName;

    const { calculation } = this;
    if (isNumericLeaf(calculation)) return `calc(${serializeCalcTree(calculation)})`;
    if (calculation instanceof MathFunctionNodeBase) return calculation.serialize();
    return `calc(${unwrapParens(serializeCalcTree(calculation))})`;
  }

  /** Return the bare identifier retained for a promoted variable, if it remains unresolved. */
  variableName(): string | null {
    return this.promoted && this.calculation.type === 'variable' ? this.calculation.name : null;
  }
}

export type MathValueType = keyof MathLiteralByType;

type MathRepresentation<Type extends MathValueType> = MathExpression | MathLiteralByType[Type];

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

export type PercentageReferenceValue =
  | CanonicalLengthLiteral
  | CanonicalFrequencyLiteral
  | CanonicalAngleLiteral
  | CanonicalTimeLiteral;

export type MathContext = {
  /** Value-processing stage at which math values should become literals. */
  unwrapMathAt?: ValueStage;

  /** Inclusive range allowed for the outermost calculation. */
  range?: NumericRange;

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

type MathValueConsumerOptions<Type extends MathValueType = MathValueType> = {
  expectedType: Type;
  range?: NumericRange;
  percentHint?: MathBase;
};

function createNumericLeafFromLiteral(
  literal: NumericLiteral,
  context: MathContext,
): NumericLeaf {
  const calculation = calculationLiteralFromValue(literal);
  // Ordinary literals lose a negative-zero sign when promoted into a calculation.
  if (calculation.value === 0) calculation.value = 0;
  const mathHints = mathHintsFromValue(calculation, context);

  if (mathHints === null) {
    throw new InternalError('Cannot create a numeric leaf from an unknown dimension');
  }

  return createNumericLeaf(calculation, mathHints);
}

/** Lower a concrete literal to a calculation terminal, without copying its methods. */
function calculationLiteralFromValue(literal: NumericLiteral): CalculationLiteral {
  // A unitless zero accepted by the length grammar still has length dimensions.
  if (literal instanceof LengthLiteral && literal.unit === '') return { type: 'dimension', value: 0, unit: 'px' };
  if (literal instanceof DimensionLiteral) return { type: 'dimension', value: literal.value, unit: literal.unit };
  return { type: literal.type === 'percentage' ? 'percentage' : 'number', value: literal.value };
}

function sameMathLiteral(a: MathLiteralByType[MathValueType], b: MathLiteralByType[MathValueType]): boolean {
  return a.type === b.type && Object.is(a.value, b.value) &&
    (!('unit' in a) || ('unit' in b && a.unit === b.unit));
}

function scaleCalculationTree(
  calculation: CalculationTree,
  factor: number,
): CalcProductNode {
  const mathHints = mathHintsOf(calculation);

  return new CalcProductNode([
    createNumericLeaf(
      { type: 'number', value: factor },
      numberMathHints(),
    ),
    calculation,
  ], mathHints);
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

// Calculation terminals carry expression bookkeeping, not the public literal methods.
type CalculationNumber = { type: 'number'; value: number; };
type CalculationPercentage = { type: 'percentage'; value: number; };
type CalculationDimension = { type: 'dimension'; value: number; unit: string; };
type CalculationLiteral = CalculationNumber | CalculationDimension | CalculationPercentage;

type NumericLeaf = CalculationLiteral & {
  hints: MathHints;
};

type NumberLeaf = CalculationNumber & { hints: MathHints; };
type DimensionLeaf = CalculationDimension & { hints: MathHints; };
type PercentageLeaf = CalculationPercentage & { hints: MathHints; };

/** Shared dimensional bookkeeping for a structural calculation node. */
abstract class CalculationNodeBase {
  /** The dimensional exponents and percentage hint of this calculation. */
  hints: MathHints;

  constructor(hints: MathHints) {
    this.hints = hints;
  }

  /** Simplify using current inputs; the result may be a different node kind or a numeric terminal. */
  abstract simplify(context: MathContext): CalculationTree;
  /** Serialize this node without simplifying its operands. */
  abstract serialize(): string;
  /** Copy this node with replacement dimensional hints, retaining its operands. */
  abstract withHints(hints: MathHints): CalculationTree;
}

/** A numeric variable whose current value is supplied at resolution time. */
class VariableLeaf extends CalculationNodeBase {
  /** Identifies a variable when preserving its promoted spelling. */
  type = 'variable' as const;
  /** The ASCII-lowercase variable name in the numeric context. */
  name: string;

  constructor(name: string, hints: MathHints) {
    super(hints);
    this.name = name;
  }

  simplify(context: MathContext): CalculationTree {
    const variable = context.numericVariables?.get(this.name);

    if (variable === undefined || variable.value === undefined) {
      return this;
    }

    const hints = mathHintsFromNumericVariable(variable, context);

    if (!haveSameMathHints(this.hints, hints)) {
      throw new InternalError('Numeric variable value type changed during resolution');
    }

    return simplifyCalculationNode(
      createNumericLeaf(
        variable.value === 'none'
          ? zeroNumericLiteral(variable.valueType)
          : calculationLiteralFromValue(variable.value),
        hints,
      ),
      context,
    );
  }

  serialize(): string {
    return serializeCssIdentifier(this.name);
  }

  withHints(hints: MathHints): VariableLeaf {
    return new VariableLeaf(this.name, hints);
  }
}

/** A sum operation in the calculation tree. */
class CalcSumNode extends CalculationNodeBase {
  /** Identifies sums for flattening and distribution. */
  type = 'sum' as const;
  /** The operands in calculation order. */
  children: [CalculationTree, CalculationTree, ...CalculationTree[]];

  constructor(children: [CalculationTree, CalculationTree, ...CalculationTree[]], hints: MathHints) {
    super(hints);
    this.children = children;
  }

  simplify(context: MathContext): CalculationTree {
    const simplified = this.children.map((child) => {
      if (child.type !== 'negate') {
        return simplifyCalculationNode(child, context);
      }

      const operand = simplifyCalculationNode(child.child, context);

      return isNumericLeaf(operand)
        ? new CalcNegateNode(operand, child.hints)
        : simplifyCalculationNode(new CalcNegateNode(operand, child.hints), context);
    });
    const flattened = simplified.flatMap((child) =>
      child.type === 'sum' ? child.children : [child]
    );
    const children = sortCalculationChildren(
      combineLikeNumericLeaves(flattened),
    );

    if (children.length === 1) {
      return withMathHints(children[0]!, this.hints);
    }

    return new CalcSumNode(children as CalcSumNode['children'], cloneMathHints(this.hints));
  }

  serialize(): string {
    const [first, ...rest] = this.children;
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

  withHints(hints: MathHints): CalcSumNode {
    return new CalcSumNode(this.children, hints);
  }
}

/** A product operation in the calculation tree. */
class CalcProductNode extends CalculationNodeBase {
  /** Identifies products for flattening and factor ordering. */
  type = 'product' as const;
  /** The operands in calculation order. */
  children: [CalculationTree, CalculationTree, ...CalculationTree[]];

  constructor(children: [CalculationTree, CalculationTree, ...CalculationTree[]], hints: MathHints) {
    super(hints);
    this.children = children;
  }

  simplify(context: MathContext): CalculationTree {
    const simplified = this.children.map((child) =>
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
        return new CalcSumNode(sum.children.map((child) =>
          scaleNumericLeaf(
            child as NumericLeaf,
            number,
          )
        ) as CalcSumNode['children'], cloneMathHints(this.hints));
      }
    }

    const product = evaluateNumericProduct(
      children,
      this.hints,
    );

    if (product !== null) {
      return product;
    }

    return new CalcProductNode(children as CalcProductNode['children'], cloneMathHints(this.hints));
  }

  serialize(): string {
    const [first, ...rest] = this.children;
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

  withHints(hints: MathHints): CalcProductNode {
    return new CalcProductNode(this.children, hints);
  }
}

/** A negate operation in the calculation tree. */
class CalcNegateNode extends CalculationNodeBase {
  /** Identifies subtraction terms and double negation. */
  type = 'negate' as const;
  /** The operand of this operation. */
  child: CalculationTree;

  constructor(child: CalculationTree, hints: MathHints) {
    super(hints);
    this.child = child;
  }

  simplify(context: MathContext): CalculationTree {
    const child = simplifyCalculationNode(this.child, context);

    if (isNumericLeaf(child)) {
      return createNumericLeaf(
        negateNumericLeaf(child),
        this.hints,
      );
    }

    if (child.type === 'negate') {
      return withMathHints(child.child, this.hints);
    }

    if (child.type === 'sum') {
      return new CalcSumNode(child.children.map((grandchild) => {
        if (isNumericLeaf(grandchild)) {
          return negateNumericLeaf(grandchild);
        }

        if (grandchild.type === 'negate') {
          return grandchild.child;
        }

        return new CalcNegateNode(grandchild, mathHintsOf(grandchild));
      }) as CalcSumNode['children'], cloneMathHints(this.hints));
    }

    return new CalcNegateNode(child, cloneMathHints(this.hints));
  }

  serialize(): string {
    return `(-1 * ${serializeCalcTree(this.child)})`;
  }

  withHints(hints: MathHints): CalcNegateNode {
    return new CalcNegateNode(this.child, hints);
  }
}

/** An invert operation in the calculation tree. */
class CalcInvertNode extends CalculationNodeBase {
  /** Identifies divisors and double inversion. */
  type = 'invert' as const;
  /** The operand of this operation. */
  child: CalculationTree;

  constructor(child: CalculationTree, hints: MathHints) {
    super(hints);
    this.child = child;
  }

  simplify(context: MathContext): CalculationTree {
    const child = simplifyCalculationNode(this.child, context);

    if (child.type === 'number') {
      return createNumericLeaf(
        { type: 'number', value: 1 / child.value },
        this.hints,
      );
    }

    if (child.type === 'invert') {
      return withMathHints(child.child, this.hints);
    }

    return new CalcInvertNode(child, cloneMathHints(this.hints));
  }

  serialize(): string {
    return `(1 / ${serializeCalcTree(this.child)})`;
  }

  withHints(hints: MathHints): CalcInvertNode {
    return new CalcInvertNode(this.child, hints);
  }
}

/** A named math function, whose own notation supplies its outer parentheses. */
abstract class MathFunctionNodeBase extends CalculationNodeBase {}

/** Common storage and serialization for comma-separated calculation arguments. */
abstract class MathFunctionNodeWithArguments<Name extends string, Arguments extends CalculationTree[]>
  extends MathFunctionNodeBase {
  /** The function name. */
  type: Name;
  /** The arguments in grammar order. */
  arguments: Arguments;

  constructor(type: Name, args: Arguments, hints: MathHints) {
    super(hints);
    this.type = type;
    this.arguments = args;
  }

  serialize(): string {
    return `${this.type}(${this.arguments.map(serializeMathFunctionArgument).join(', ')})`;
  }
}

/** Comparison and hypotenuse functions with one or more arguments. */
class MathVariadicFunctionNode<Name extends VariadicMathFunctionName = VariadicMathFunctionName>
  extends MathFunctionNodeWithArguments<Name, [CalculationTree, ...CalculationTree[]]> {
  simplify(context: MathContext): CalculationTree {
    const mathNode = new MathVariadicFunctionNode(this.type,
      mapTuple(this.arguments, (argument) => simplifyCalculationNode(argument, context)),
      cloneMathHints(this.hints),
    );
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

        return new MathVariadicFunctionNode(mathNode.type, args as [CalculationTree, ...CalculationTree[]], mathNode.hints);
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
    }
    return mathNode;
  }

  withHints(hints: MathHints): MathVariadicFunctionNode<Name> {
    return new MathVariadicFunctionNode(this.type, this.arguments, hints);
  }
}

/** Remainder, angle, and power functions with two ordered arguments. */
class MathBinaryFunctionNode<Name extends BinaryMathFunctionName = BinaryMathFunctionName>
  extends MathFunctionNodeWithArguments<Name, [CalculationTree, CalculationTree]> {
  simplify(context: MathContext): CalculationTree {
    const mathNode = new MathBinaryFunctionNode(this.type,
      mapTuple(this.arguments, (argument) => simplifyCalculationNode(argument, context)),
      cloneMathHints(this.hints),
    );
    switch (mathNode.type) {
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
    }
    return mathNode;
  }

  withHints(hints: MathHints): MathBinaryFunctionNode<Name> {
    return new MathBinaryFunctionNode(this.type, this.arguments, hints);
  }
}

/** Trigonometric, exponential, and sign functions with one argument. */
class MathUnaryFunctionNode<Name extends UnaryMathFunctionName = UnaryMathFunctionName>
  extends MathFunctionNodeWithArguments<Name, [CalculationTree]> {
  simplify(context: MathContext): CalculationTree {
    const mathNode = new MathUnaryFunctionNode(this.type,
      mapTuple(this.arguments, (argument) => simplifyCalculationNode(argument, context)),
      cloneMathHints(this.hints),
    );
    switch (mathNode.type) {
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
    }
    return mathNode;
  }

  withHints(hints: MathHints): MathUnaryFunctionNode<Name> {
    return new MathUnaryFunctionNode(this.type, this.arguments, hints);
  }
}

/** A logarithm with an optional base. */
class MathLogNode
  extends MathFunctionNodeWithArguments<'log', [CalculationTree] | [CalculationTree, CalculationTree]> {
  simplify(context: MathContext): CalculationTree {
    const mathNode = new MathLogNode(this.type,
      mapTuple(this.arguments, (argument) => simplifyCalculationNode(argument, context)),
      cloneMathHints(this.hints),
    );
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

  withHints(hints: MathHints): MathLogNode {
    return new MathLogNode(this.type, this.arguments, hints);
  }
}

/** A value bounded by optional minimum and maximum calculations. */
class MathClampNode extends MathFunctionNodeBase {
  /** The function name retained in the calculation tree. */
  type = 'clamp' as const;
  /** The optional lower bound; undefined represents none. */
  minimum: CalculationTree | undefined;
  /** The calculation being bounded. */
  value: CalculationTree;
  /** The optional upper bound; undefined represents none. */
  maximum: CalculationTree | undefined;

  constructor(
    minimum: CalculationTree | undefined,
    value: CalculationTree,
    maximum: CalculationTree | undefined,
    hints: MathHints,
  ) {
    super(hints);
    this.minimum = minimum;
    this.value = value;
    this.maximum = maximum;
  }

  simplify(context: MathContext): CalculationTree {
    const mathNode = new MathClampNode(
      this.minimum === undefined ? undefined : simplifyCalculationNode(this.minimum, context),
      simplifyCalculationNode(this.value, context),
      this.maximum === undefined ? undefined : simplifyCalculationNode(this.maximum, context),
      cloneMathHints(this.hints),
    );
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

  serialize(): string {
    return `clamp(${[
            this.minimum === undefined
              ? 'none'
              : serializeMathFunctionArgument(this.minimum),
            serializeMathFunctionArgument(this.value),
            this.maximum === undefined
              ? 'none'
              : serializeMathFunctionArgument(this.maximum),
    ].join(', ')})`;
  }

  withHints(hints: MathHints): MathClampNode {
    return new MathClampNode(this.minimum, this.value, this.maximum, hints);
  }
}

/** Rounding with an optional interval and the selected rounding strategy. */
class MathRoundNode extends MathFunctionNodeBase {
  /** The function name retained in the calculation tree. */
  type = 'round' as const;
  /** How the nearest rounding boundaries are chosen. */
  strategy: RoundingStrategy;
  /** The calculation to round. */
  value: CalculationTree;
  /** The optional rounding interval. */
  step: CalculationTree | undefined;

  constructor(
    strategy: RoundingStrategy,
    value: CalculationTree,
    step: CalculationTree | undefined,
    hints: MathHints,
  ) {
    super(hints);
    this.strategy = strategy;
    this.value = value;
    this.step = step;
  }

  simplify(context: MathContext): CalculationTree {
    const mathNode = new MathRoundNode(this.strategy,
      simplifyCalculationNode(this.value, context),
      this.step === undefined ? undefined : simplifyCalculationNode(this.step, context),
      cloneMathHints(this.hints),
    );
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

  serialize(): string {
    return `round(${[
      ...(this.strategy === 'nearest' ? [] : [this.strategy]),
      serializeMathFunctionArgument(this.value),
      ...(this.step === undefined
              ? []
              : [serializeMathFunctionArgument(this.step)]),
    ].join(', ')})`;
  }

  withHints(hints: MathHints): MathRoundNode {
    return new MathRoundNode(this.strategy, this.value, this.step, hints);
  }
}

type MathFunctionNode =
  | MathVariadicFunctionNode
  | MathClampNode
  | MathRoundNode
  | MathBinaryFunctionNode
  | MathUnaryFunctionNode
  | MathLogNode;

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

const topLevelCalcCalculationConsumer = adaptConsumer(
  calcCalculationConsumer,
  (result, context: InternalMathContext) => {

    const mathHints = mathHintsOf(result);

    if (!context.insideCalculation && mathCategory(mathHints) === null) {
      return null;
    }

    const expectedType = requiredExpectedType(context);

    if (
      !context.insideCalculation &&
      !matchesExpectedCalculationType(mathHints, expectedType, context)
    ) {
      return null;
    }

    return simplifyCalculationTree(result, ValueStage.Declared, context, expectedType);
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

const nonCalcMathFunctionConsumer: TryConsumer<CalculationTree, InternalMathContext> =
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

type MathFunctionTypeRule =
  | 'consistent'
  | 'same'
  | 'number'
  | 'angle';

function createVariadicMathFunctionConsumer<
  Name extends VariadicMathFunctionName,
>(
  name: Name,
): TryConsumer<CalculationTree, InternalMathContext> {
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeCalcSum, 1, CALC_TERM_LIMIT),
    (args) => {
      const hints = mathFunctionHints(args, 'consistent');
      return hints === null ? null : new MathVariadicFunctionNode(name, args, hints);
    },
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createBinaryMathFunctionConsumer<
  Name extends BinaryMathFunctionName,
>(
  name: Name,
  typeRule: MathFunctionTypeRule,
  argumentCategories?: MathCategory[],
): TryConsumer<CalculationTree, InternalMathContext> {
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeCalcSum, 2, 2),
    (args) => {
      const [first, second] = args;

      const hints = mathFunctionHints(args, typeRule, argumentCategories);
      return hints === null ? null : new MathBinaryFunctionNode(name, [first, second], hints);
    },
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createUnaryMathFunctionConsumer<
  Name extends UnaryMathFunctionName,
>(
  name: Name,
  typeRule: MathFunctionTypeRule,
  argumentCategories?: MathCategory[],
): TryConsumer<CalculationTree, InternalMathContext> {
  const consumeArguments = adaptConsumer(
    consumeCalcSum,
    (child) => {
      const hints = mathFunctionHints([child], typeRule, argumentCategories);
      return hints === null ? null : new MathUnaryFunctionNode(name, [child], hints);
    },
  );

  return createMathFunctionConsumer(name, consumeArguments);
}

function createClampConsumer(): TryConsumer<CalculationTree, InternalMathContext> {
  const consumeArgument: TryConsumer<CalculationTree | 'none', InternalMathContext> = oneOf(
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
      const hints = mathFunctionHints(calculations, 'consistent');
      return hints === null ? null : new MathClampNode(minimum, value, maximum, hints);
    },
  );

  return createMathFunctionConsumer('clamp', consumeArguments);
}

function createRoundConsumer(): TryConsumer<CalculationTree, InternalMathContext> {
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

      const hints = mathFunctionHints(step === undefined ? [value] : [value, step], 'consistent');
      return hints === null ? null : new MathRoundNode(strategy, value, step, hints);
    },
  );

  return createMathFunctionConsumer('round', consumeArguments);
}

function createLogConsumer(): TryConsumer<CalculationTree, InternalMathContext> {
  const consumeArguments = adaptConsumer(
    commaRepeat(consumeCalcSum, 1, 2),
    (args) => {
      const [value, base] = args;

      const hints = mathFunctionHints(args, 'number', ['number']);
      return hints === null ? null : new MathLogNode('log', base === undefined ? [value] : [value, base], hints);
    },
  );

  return createMathFunctionConsumer('log', consumeArguments);
}

function createMathFunctionConsumer<Node extends MathFunctionNode>(
  name: string,
  consumeArguments: TryConsumer<Node, InternalMathContext>,
): TryConsumer<CalculationTree, InternalMathContext> {
  return createFunctionalNotationConsumer(
    name,
    consumeArguments,
    (result, context: InternalMathContext) => {

      if (!context.insideCalculation && mathCategory(result.hints) === null) {
        return null;
      }

      const valueType = context.insideCalculation
        ? undefined
        : requiredExpectedType(context);

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
      );
    },
    {
      contextForArguments: enterCalculationContext,
    },
  );
}

function mathFunctionHints(
  calculations: CalculationTree[],
  typeRule: MathFunctionTypeRule,
  argumentCategories?: MathCategory[],
): MathHints | null {
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

  return mathHints;
}

const roundingStrategyConsumer: TryConsumer<RoundingStrategy, InternalMathContext> =
  createKeywordConsumer('nearest', 'up', 'down', 'to-zero', 'line-width');

function consumeRoundingStrategyPrefix(
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<RoundingStrategy> {
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

type CalcSumTail = {
  operator: '+' | '-';
  value: CalculationTree;
};

function consumeCalcSum(
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<CalculationTree> {
  return calcSumConsumer(c);
}

// Repeated <calc-sum> fragment: [ '+' | '-' ] <calc-product>
const calcSumTailConsumer: TryConsumer<CalcSumTail, InternalMathContext> = sequenceOf(
  [
    one(consumeCalcSumOperator),
    one(consumeCalcProduct),
  ],
  ([[operator], [value]]) => ({ operator, value }),
);

const calcSumConsumer: TryConsumer<CalculationTree, InternalMathContext> = sequenceOf(
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
        children.push(new CalcNegateNode(value, valueHints));
      }

      const sumHints = addMathHints(
        [mathHints, valueHints],
      );

      if (sumHints === null) {
        return null;
      }

      mathHints = sumHints;
    }

    return new CalcSumNode(children as CalcSumNode['children'], mathHints);
  },
);

function consumeCalcSumOperator(
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<'+' | '-'> {
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

type CalcProductTail = {
  operator: '*' | '/';
  value: CalculationTree;
};

function consumeCalcProduct(
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<CalculationTree> {
  return calcProductConsumer(c);
}

const calcProductOperatorConsumer: TryConsumer<'*' | '/', InternalMathContext> = oneOf(
  [
    one(consumeAsteriskDelim),
    one(consumeSlashDelim),
  ],
  ([operator]) => operator,
);

// Repeated <calc-product> fragment: [ '*' | '/' ] <calc-value>
const calcProductTailConsumer: TryConsumer<CalcProductTail, InternalMathContext> = sequenceOf(
  [
    one(withTrivia(calcProductOperatorConsumer)),
    one(withTrivia(consumeCalcValue)),
  ],
  ([[operator], [value]]) => ({ operator, value }),
);

const calcProductConsumer: TryConsumer<CalculationTree, InternalMathContext> = sequenceOf(
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
        : new CalcInvertNode(value, childHints));
      const productHints = multiplyMathHints(
        [mathHints, childHints],
      );

      if (productHints === null) {
        return null;
      }

      mathHints = productHints;
    }

    return new CalcProductNode(children as CalcProductNode['children'], mathHints);
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
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<CalculationTree> {
  return calcValueConsumer(c);
}

const mathFunctionCalculationConsumer: TryConsumer<CalculationTree, InternalMathContext> =
  oneOf(
    [
      one(consumeCalcCalculation),
      one(nonCalcMathFunctionConsumer),
    ],
    ([value]) => value,
  );

const mathValueConsumer: TryConsumer<MathValue, InternalMathContext> = adaptConsumer(
  mathFunctionCalculationConsumer,
  (calculation, context: InternalMathContext) =>
    new MathValue(new MathExpression(calculation), requiredExpectedType(context)),
);

const calcNumericLeafConsumer: TryConsumer<NumericLeaf, InternalMathContext> = oneOf(
  [
    one(consumeNumberToken),
    one(consumeDimensionToken),
    one(consumePercentageToken),
  ],
  ([token], context: InternalMathContext) => {
    const value = token.value === 0 ? 0 : token.value;
    const literal: CalculationLiteral = token.type === TokenKind.Dimension
      ? { type: 'dimension', value, unit: token.unit }
      : { type: token.type === TokenKind.Percentage ? 'percentage' : 'number', value };
    const mathHints = mathHintsFromValue(
      literal,
      context,
    );

    return mathHints === null
      ? null
      : createNumericLeaf(literal, mathHints);
  },
);

const calcValueConsumer: TryConsumer<CalculationTree, InternalMathContext> = oneOf(
  [
    one(calcNumericLeafConsumer),
    one(consumeCalcKeyword),
    one(consumeParenthesizedCalcSum),
    one(mathFunctionCalculationConsumer),
  ],
  ([result], context: InternalMathContext) => {

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
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<CalculationTree> {
  return parenthesizedCalcSumConsumer(c);
}

const parenthesizedCalcSumConsumer = adaptConsumer(
  consumeParensBlock,
  (component, context: InternalMathContext) => parseAsComponentGrammar(
    component.value,
    withTrivia(consumeCalcSum),
    context,
  ),
);

function consumeCalcCalculation(
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<CalculationTree> {
  return (
    c.context.insideCalculation
      ? nestedCalcCalculationConsumer
      : topLevelCalcCalculationConsumer
  )(c);
}

// A top-level calc() first applies expected-type validation. A nested calc()
// contributes its calculation tree directly and is simplified as grouping.
const nestedCalcCalculationConsumer = adaptConsumer(
  calcCalculationConsumer,
  (calculation, context: InternalMathContext) => simplifyCalculationTree(
    calculation,
    ValueStage.Declared,
    context,
  ),
);

/*
 * <calc-keyword> = e | pi | infinity | -infinity | NaN
 *
 * A calculation context can define additional numeric variables.
 */

function consumeCalcKeyword(
  c: TokenCursor<ComponentValue, InternalMathContext>,
): TryConsumerResult<NumericLeaf | VariableLeaf> {
  return calcKeywordConsumer(c);
}

const calcKeywordConsumer: TryConsumer<NumericLeaf | VariableLeaf, InternalMathContext> = adaptConsumer(
  consumeIdentToken,
  (token, context: InternalMathContext) => {
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

    const variable = context.numericVariables?.get(name);

    if (variable === undefined) return null;

    return new VariableLeaf(name, mathHintsFromNumericVariable(variable, context));
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
  [base: MathBase, power: number];

type MathHints = {
  exponents: MathExponent[];
  percentHint: MathBase | null;
};

type MathCategory =
  | 'number'
  | MathBase;

function mathHintsOf(calculation: CalculationTree): MathHints {
  return cloneMathHints(calculation.hints);
}

function mathHintsFromValue(
  value: CalculationLiteral,
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
    const valueHints = mathHintsFromValue(calculationLiteralFromValue(variable.value), context);

    if (
      valueHints === null ||
      !matchesExpectedCalculationType(
        valueHints,
        variable.valueType,
        context,
      )
    ) {
      throw new InternalError('Numeric variable value does not match its value type');
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

function zeroNumericLiteral(valueType: MathValueType): CalculationLiteral {
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

function createNumericLeaf<Value extends CalculationLiteral>(
  value: Value,
  hints: MathHints,
): Value & { hints: MathHints; } {
  return {
    ...value,
    hints: cloneMathHints(hints),
  };
}

function withMathHints(calculation: CalculationTree, hints: MathHints): CalculationTree {
  const copied = cloneMathHints(hints);
  return isNumericLeaf(calculation) ? { ...calculation, hints: copied } : calculation.withHints(copied);
}

function addMathHints(
  hints: (MathHints | null)[],
): MathHints | null {
  const [first, ...rest] = hints;

  if (first === undefined) {
    throw new InternalError('Math hint addition requires an operand');
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
  hints: (MathHints | null)[],
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
  exponents: MathExponent[],
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

function requiredExpectedType(
  context?: InternalMathContext,
): MathValueType {
  if (context?.expectedType === undefined) {
    throw new InternalError('Math value expected type is required');
  }

  return context.expectedType;
}

function enterCalculationContext(
  context: InternalMathContext,
): InternalMathContext {
  if (
    context.insideCalculation &&
    context.termCount !== undefined
  ) {
    return context;
  }

  return {
    ...context,
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
    throw new InternalError(
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
    return new IntegerLiteral(value.value);
  }

  if (value.type === 'dimension') {
    switch (valueType) {
      case 'angle':
      case 'angle-percentage':
        if (isUnit(ANGLE_UNITS, value.unit)) {
          return new AngleLiteral(value.value, value.unit);
        }
        break;
      case 'frequency':
      case 'frequency-percentage':
        if (isUnit(FREQUENCY_UNITS, value.unit)) {
          return new FrequencyLiteral(value.value, value.unit);
        }
        break;
      case 'length':
      case 'length-percentage':
        if (value.unit === '' && value.value === 0) {
          return new LengthLiteral(0, '');
        }
        if (isUnit(LENGTH_UNITS, value.unit)) {
          return new LengthLiteral(value.value, value.unit);
        }
        break;
      case 'resolution':
        if (isUnit(RESOLUTION_UNITS, value.unit)) {
          return new ResolutionLiteral(value.value, value.unit);
        }
        break;
      case 'time':
      case 'time-percentage':
        if (isUnit(TIME_UNITS, value.unit)) {
          return new TimeLiteral(value.value, value.unit);
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

function numericLiteralFromLeaf(value: NumericLeaf): NumberLiteral | PercentageLiteral | DimensionLiteral {
  switch (value.type) {
    case 'number':
      return new NumberLiteral(value.value);
    case 'percentage':
      return new PercentageLiteral(value.value);
    case 'dimension':
      return new DimensionLiteral(value.value, value.unit);
  }
}

function simplifyCalculationNode(
  root: CalculationTree,
  context: MathContext,
): CalculationTree {
  const simplified = isNumericLeaf(root)
    ? root.type === 'percentage' ? resolvePercentage(root, context) : root
    : root.simplify(context);

  return simplified.type === 'dimension'
    ? canonicalizeDimension(simplified, context)
    : simplified;
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

function areResolvedNumericArguments(
  args: [CalculationTree, ...CalculationTree[]],
): args is [NumericLeaf, ...NumericLeaf[]] {
  return args.every(isNumericLeaf);
}

function combineComparableNumericArguments(
  args: CalculationTree[],
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
): DimensionLeaf & { unit: 'px'; } {
  const snapped = new LengthLiteral(value, 'px').snapAsLineWidth(devicePixelRatio);

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
  ...rest: NumericLeaf[]
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
): [lower: number, upper: number] {
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
    throw new InternalError('Cannot multiply inconsistent math hints');
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

function combineLikeNumericLeaves(
  children: CalculationTree[],
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
  children: CalculationTree[],
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
    throw new InternalError('Cannot combine inconsistent number math hints');
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
  children: CalculationTree[],
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
  children: CalculationTree[],
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

  let resolved: DimensionLiteral | null;

  if (isUnit(LENGTH_UNITS, unit)) {
    resolved = new LengthLiteral(value.value, unit).tryResolve(context.length);
  } else if (isUnit(ANGLE_UNITS, unit)) {
    resolved = new AngleLiteral(value.value, unit).canonicalize();
  } else if (isUnit(TIME_UNITS, unit)) {
    resolved = new TimeLiteral(value.value, unit).canonicalize();
  } else if (isUnit(FREQUENCY_UNITS, unit)) {
    resolved = new FrequencyLiteral(value.value, unit).canonicalize();
  } else if (isUnit(RESOLUTION_UNITS, unit)) {
    resolved = new ResolutionLiteral(value.value, unit).canonicalize();
  } else if (unit === 'fr') {
    resolved = new DimensionLiteral(value.value, unit);
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
      throw new InternalError(`Cannot canonicalize unknown dimension unit: ${unit}`);
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
  const literal: CalculationLiteral = {
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

function serializeMathFunctionArgument(
  value: CalculationTree,
): string {
  return unwrapParens(serializeCalcTree(value));
}

function serializeCalcTree(root: CalculationTree): string {
  return isNumericLeaf(root) ? serializeNumericLeaf(root) : root.serialize();
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
        return serializeCssNumber(value.value);
      case 'percentage':
        return `${serializeCssNumber(value.value)}%`;
      case 'dimension':
        return `${serializeCssNumber(value.value)}${serializeCssDimensionUnit(value.unit)}`;
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
      return `${keyword} * 1%`;
    case 'dimension':
      return `${keyword} * 1${serializeCssDimensionUnit(value.unit)}`;
  }
}
