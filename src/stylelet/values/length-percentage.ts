import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import { tryConsumeAuto, type AutoValue } from './auto';
import { serializeLength, tryConsumeLength, type LengthValue } from './length';
import { serializePercentage, tryConsumePercentage, type PercentageValue } from './percentage';
import {
  ok,
  unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';

export type LengthPercentageAuto =
  | LengthPercentage
  | AutoValue;

export type LengthPercentage =
  | LengthValue
  | PercentageValue;

export function parseLengthPercentageAuto(
  input: ParserInput,
  context: unknown = undefined,
): LengthPercentageAuto | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeLengthPercentageAuto),
      context,
    ),
    'length-percentage-auto value',
  );
}

const tryConsumeLengthPercentageAuto: TryComponentConsumer<LengthPercentageAuto> = oneOf(
  [
    one(tryConsumeAuto),
    one(tryConsumePercentage),
    one(tryConsumeLength),
  ],
  ([value]) => ok(value),
);

export function serializeLengthPercentageAuto(value: LengthPercentageAuto): string {
  switch (value.type) {
    case 'auto': return 'auto';
    case 'percentage': return serializePercentage(value);
    case 'length': return serializeLength(value);
  }
}
