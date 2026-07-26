import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathFunctions, addMathFunctions,
  createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathFunctions, resolveMathValue, serializeMathValue,
  type CalculationContext, type CalculationRange, type MathValue,
} from './calc';
import { accumulateDimensions, addDimensions, interpolateDimensions } from './numeric-literal/dimension';
import {
  createLengthConsumer as createLengthLiteralConsumer,
  serializeLength as serializeLengthLiteral,
  type LengthConsumerOptions, type LengthLiteral,
} from './numeric-literal/length';

/*
 * <length> =
 *   <dimension-token with a length unit> | <zero> | <math-function>
 */

export type LengthValue = LengthLiteral | MathValue<'length'>;

export function parseLength(
  input: ParserInput,
  context: CalculationContext = {},
): LengthValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeLength),
      context,
    ),
    'length',
  );
}

export function createLengthConsumer(
  options: LengthConsumerOptions = {},
): TryComponentConsumer<LengthValue> {
  const tryConsumeLiteral = createLengthLiteralConsumer(options);
  const range = lengthRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'length',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeLength = createLengthConsumer();

export function resolveLength(
  value: LengthValue,
  context: CalculationContext = {},
): LengthValue {
  return value.type === 'math'
    ? resolveMathValue(value, context)
    : value;
}

export function serializeLength(
  value: LengthValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeLengthLiteral(value);
}

export function addLengths(
  a: LengthValue,
  b: LengthValue,
  context: CalculationContext = {},
): LengthValue {
  if (a.type === 'length' && b.type === 'length') {
    return normalizeUnitlessZero(addDimensions(a, b));
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateLengths(
  a: LengthValue,
  b: LengthValue,
  p: number,
  context: CalculationContext = {},
): LengthValue {
  if (a.type === 'length' && b.type === 'length') {
    return normalizeUnitlessZero(interpolateDimensions(a, b, p));
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateLengths(
  a: LengthValue,
  b: LengthValue,
  context: CalculationContext = {},
): LengthValue {
  if (a.type === 'length' && b.type === 'length') {
    return normalizeUnitlessZero(accumulateDimensions(a, b));
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: LengthValue,
  context: CalculationContext,
): MathValue<'length'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'length', context);
}

function normalizeUnitlessZero(
  value: ReturnType<typeof addDimensions<'length', LengthLiteral['unit']>>,
): LengthLiteral {
  const unit = value.unit;

  return unit === ''
    ? { type: 'length', value: 0, unit }
    : { type: 'length', value: value.value, unit };
}

function lengthRange(
  options: LengthConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
