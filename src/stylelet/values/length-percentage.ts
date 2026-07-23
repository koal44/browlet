import { withComponentTrivia } from '../parser/component-grammar';
import { unwrapConsumeResultOrThrow, type TryComponentConsumer } from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  serializeLength, tryConsumeLength, tryResolveLength,
  type CanonicalLengthValue, type LengthResolutionContext, type LengthValue,
} from './length';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAccumulateDimensionPercentages,
  tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageValue,
} from './dimension-percentage';

/*
 * <length-percentage> = [ <length> | <percentage> ]
 */

export type LengthPercentageValue = DimensionPercentageValue<LengthValue>;

export type LengthPercentageResolutionContext = LengthResolutionContext & {
  /** Percentage basis in canonical CSS pixels. */
  percentageBasis?: number;
};

export function parseLengthPercentage(
  input: ParserInput,
  context: unknown = undefined,
): LengthPercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeLengthPercentage),
      context,
    ),
    'length-percentage',
  );
}

export type LengthPercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createLengthPercentageConsumer(
  options: LengthPercentageConsumerOptions = {},
): TryComponentConsumer<LengthPercentageValue> {
  return createDimensionPercentageConsumer(
    tryConsumeLength,
    'Length-percentage',
    options,
  );
}

export const tryConsumeLengthPercentage = createLengthPercentageConsumer();

export function serializeLengthPercentage(value: LengthPercentageValue): string {
  return serializeDimensionPercentage(value, serializeLength);
}

export function tryResolveLengthPercentage(
  value: LengthPercentageValue,
  context: LengthPercentageResolutionContext = {},
): CanonicalLengthValue | null {
  if (value.type === 'length') {
    return tryResolveLength(value, context);
  }

  if (context.percentageBasis === undefined) {
    return null;
  }

  return {
    type: 'length',
    value: context.percentageBasis * value.value / 100,
    unit: 'px',
  };
}

export function tryAddLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
): LengthPercentageValue | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  p: number,
): LengthPercentageValue | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}

export function tryAccumulateLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
): LengthPercentageValue | null {
  return tryAccumulateDimensionPercentages(a, b);
}
