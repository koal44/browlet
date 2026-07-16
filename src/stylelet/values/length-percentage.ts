import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  serializeLength, tryConsumeLength, tryResolveLength,
  type CanonicalLengthValue, type LengthResolutionContext, type LengthValue,
} from './length';
import {
  serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * <length-percentage> = [ <length> | <percentage> ]
 */

export type LengthPercentageValue =
  | LengthValue
  | PercentageValue;

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

export type LengthPercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved length-percentage quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved length-percentage quantity. */
  max?: number;
};

export function createLengthPercentageConsumer(
  options: LengthPercentageConsumerOptions = {},
): TryComponentConsumer<LengthPercentageValue> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      'Length-percentage ranges with finite nonzero bounds are not yet supported',
    );
  }

  return (c): TryComponentConsumerResult<LengthPercentageValue> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedLengthPercentage(c);

    if (result === null || isBad(result)) {
      return result;
    }

    if (result.value.value < min || result.value.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

const tryConsumeUnrestrictedLengthPercentage: TryComponentConsumer<LengthPercentageValue> = oneOf(
  [
    one(tryConsumeLength),
    one(tryConsumePercentage),
  ],
  ([value]) => ok(value),
);

export const tryConsumeLengthPercentage = createLengthPercentageConsumer();

function canCheckRangeWithoutResolution(min: number, max: number): boolean {
  // All length and percentage resolutions preserve sign, so zero and infinite
  // bounds do not require a percentage basis or length context.
  return (
    (min === -Infinity || min === 0) &&
    (max === 0 || max === Infinity)
  );
}

export function serializeLengthPercentage(value: LengthPercentageValue): string {
  switch (value.type) {
    case 'length':
      return serializeLength(value);
    case 'percentage':
      return serializePercentage(value);
  }
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
