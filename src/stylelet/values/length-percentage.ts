import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { one, oneOf, withComponentTrivia, type TryComponentParser } from '../parser/component-grammar';
import { tryParseAuto, type AutoValue } from './auto';
import { serializeLength, tryParseLength, type LengthValue } from './length';
import { serializePercentage, tryParsePercentage, type PercentageValue } from './percentage';

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
  return parseAsComponentGrammar(
    input,
    withComponentTrivia(tryConsumeLengthPercentageAuto),
    context,
  );
}

const tryConsumeLengthPercentageAuto: TryComponentParser<LengthPercentageAuto> = oneOf(
  [
    one(tryParseAuto),
    one(tryParsePercentage),
    one(tryParseLength),
  ],
  ([value]): LengthPercentageAuto => value,
);

export function serializeLengthPercentageAuto(value: LengthPercentageAuto): string {
  switch (value.type) {
    case 'auto': return 'auto';
    case 'percentage': return serializePercentage(value);
    case 'length': return serializeLength(value);
  }
}
