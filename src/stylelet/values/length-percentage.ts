import { ComponentCursor } from '../parser/component-cursor';
import { consumeComponentTrivia, type ComponentValue } from '../parser/syntax';
import { one, oneOf, type TryValueParser } from '../parser/component-grammar';
import { tryParseAuto, type AutoValue } from './auto';
import { serializeLength, tryParseLength, type LengthValue } from './length';
import { serializePercentage, tryParsePercentage, type PercentageValue } from './percentage';

export type LengthPercentageAuto =
  | LengthPercentage
  | AutoValue;

export type LengthPercentage =
  | LengthValue
  | PercentageValue;

const tryParseLengthPercentageAuto: TryValueParser<LengthPercentageAuto> = oneOf(
  one(tryParseAuto),
  one(tryParsePercentage),
  one(tryParseLength),
  ([value]): LengthPercentageAuto => value,
);

export function parseLengthPercentageAuto(
  components: readonly ComponentValue[],
): LengthPercentageAuto | null {
  const c = new ComponentCursor(components);
  const value = tryParseLengthPercentageAuto(c);

  if (value === null) {
    return null;
  }

  consumeComponentTrivia(c);

  if (c.peek() !== null) {
    return null;
  }

  return value;
}

export function serializeLengthPercentageAuto(value: LengthPercentageAuto): string {
  switch (value.type) {
    case 'auto': return 'auto';
    case 'percentage': return serializePercentage(value);
    case 'length': return serializeLength(value);
  }
}
