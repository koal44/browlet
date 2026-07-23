import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { serializeAuto, tryConsumeAuto, type AutoValue } from '../values/auto';
import {
  serializeLengthPercentage, tryConsumeLengthPercentage,
  type LengthPercentageLiteral,
} from '../values/numeric-literal/length-percentage';

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 */

export type MarginSideValue =
  | LengthPercentageLiteral
  | AutoValue;

export function parseMarginSideValue(
  input: ParserInput,
  context: unknown = undefined,
): MarginSideValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeMarginSideValue),
      context,
    ),
    'margin side value',
  );
}

export const tryConsumeMarginSideValue: TryComponentConsumer<MarginSideValue> = oneOf(
  [
    one(tryConsumeLengthPercentage),
    one(tryConsumeAuto),
  ],
  ([value]) => ok(value),
);

export function serializeMarginSideValue(value: MarginSideValue): string {
  return value.type === 'auto'
    ? serializeAuto(value)
    : serializeLengthPercentage(value);
}
