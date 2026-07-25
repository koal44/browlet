import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathFunctions, addMathFunctions,
  createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathFunctions, serializeMathValue,
  type CalculationContext, type CalculationSerializationContext,
  type MathValue,
} from './calc';
import {
  accumulateDimensions as accumulateDimensionLiterals,
  addDimensions as addDimensionLiterals,
  interpolateDimensions as interpolateDimensionLiterals,
  serializeDimension as serializeDimensionLiteral,
  tryConsumeDimension as tryConsumeDimensionLiteral,
  type DimensionLiteral,
} from './numeric-literal/dimension';

/*
 * <dimension> = <dimension-token> | <math-function>
 */

export type DimensionValue = DimensionLiteral | MathValue;

export function parseDimension(
  input: ParserInput,
  context: CalculationContext = {},
): DimensionValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeDimension),
      context,
    ),
    'dimension',
  );
}

export const tryConsumeDimension: TryComponentConsumer<DimensionValue> = oneOf(
  [
    one(tryConsumeDimensionLiteral),
    one(createMathValueConsumer({ expectedType: 'dimension' })),
  ],
  ([value]) => ok(value),
);

export function serializeDimension(
  value: DimensionValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeDimensionLiteral(value);
}

export function addDimensions(
  a: DimensionValue,
  b: DimensionValue,
  context: CalculationContext = {},
): DimensionValue {
  if (a.type === 'dimension' && b.type === 'dimension') {
    return addDimensionLiterals(a, b);
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateDimensions(
  a: DimensionValue,
  b: DimensionValue,
  p: number,
  context: CalculationContext = {},
): DimensionValue {
  if (a.type === 'dimension' && b.type === 'dimension') {
    return interpolateDimensionLiterals(a, b, p);
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateDimensions(
  a: DimensionValue,
  b: DimensionValue,
  context: CalculationContext = {},
): DimensionValue {
  if (a.type === 'dimension' && b.type === 'dimension') {
    return accumulateDimensionLiterals(a, b);
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: DimensionValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'dimension', context);
}
