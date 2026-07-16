import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  resolveAngle, serializeAngle, tryConsumeAngle,
  type AngleValue, type CanonicalAngleValue,
} from './angle';
import {
  serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * <angle-percentage> = [ <angle> | <percentage> ]
 */

export type AnglePercentageValue =
  | AngleValue
  | PercentageValue;

export type AnglePercentageResolutionContext = {
  /** Percentage basis in canonical degrees. */
  percentageBasis?: number;
};

export function parseAnglePercentage(
  input: ParserInput,
  context: unknown = undefined,
): AnglePercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeAnglePercentage),
      context,
    ),
    'angle-percentage',
  );
}

export type AnglePercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved angle-percentage quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved angle-percentage quantity. */
  max?: number;
};

export function createAnglePercentageConsumer(
  options: AnglePercentageConsumerOptions = {},
): TryComponentConsumer<AnglePercentageValue> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      'Angle-percentage ranges with finite nonzero bounds are not yet supported',
    );
  }

  return (c): TryComponentConsumerResult<AnglePercentageValue> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedAnglePercentage(c);

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

const tryConsumeUnrestrictedAnglePercentage: TryComponentConsumer<AnglePercentageValue> = oneOf(
  [
    one(tryConsumeAngle),
    one(tryConsumePercentage),
  ],
  ([value]) => ok(value),
);

export const tryConsumeAnglePercentage = createAnglePercentageConsumer();

function canCheckRangeWithoutResolution(min: number, max: number): boolean {
  // All angle and percentage resolutions preserve sign, so zero and infinite
  // bounds do not require a percentage basis.
  return (
    (min === -Infinity || min === 0) &&
    (max === 0 || max === Infinity)
  );
}

export function serializeAnglePercentage(value: AnglePercentageValue): string {
  switch (value.type) {
    case 'angle':
      return serializeAngle(value);
    case 'percentage':
      return serializePercentage(value);
  }
}

export function tryResolveAnglePercentage(
  value: AnglePercentageValue,
  context: AnglePercentageResolutionContext = {},
): CanonicalAngleValue | null {
  if (value.type === 'angle') {
    return resolveAngle(value);
  }

  if (context.percentageBasis === undefined) {
    return null;
  }

  return {
    type: 'angle',
    value: context.percentageBasis * value.value / 100,
    unit: 'deg',
  };
}
