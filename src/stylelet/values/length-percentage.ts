import { ComponentCursor } from '../parser/component-cursor';
import { consumeComponentTrivia, type ComponentValue } from '../parser/syntax';
import { one, oneOf } from '../parser/component';
import { tryParseAuto, type AutoValue } from './auto';
import { serializeLength, tryParseLength, type LengthValue } from './length';
import { serializePercentage, tryParsePercentage, type PercentageValue } from './percentage';

export type LengthPercentageAuto =
  | LengthPercentage
  | AutoValue;

export type LengthPercentage =
  | LengthValue
  | PercentageValue;

const tryParseLengthPercentageAuto = oneOf(
  one(tryParseAuto),
  one(tryParsePercentage),
  one(tryParseLength),
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

  return value[0];
}

export function serializeLengthPercentageAuto(value: LengthPercentageAuto): string {
  switch (value.type) {
    case 'auto': return 'auto';
    case 'percentage': return serializePercentage(value);
    case 'length': return serializeLength(value);
  }
}
