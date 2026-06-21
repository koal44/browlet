import type { Cursor } from '../../selectlet/parser/cursor';
import { tryParseAuto, type AutoValue } from './auto';
import { serializeLength, tryParseLength, type LengthValue } from './length';
import { serializePercentage, tryParsePercentage, type PercentageValue } from './percentage';
import { oneOf, repeat } from '../parser/component';

export type LengthPercentageAuto =
  | LengthPercentage
  | AutoValue;

export type LengthPercentage =
  | LengthValue
  | PercentageValue;

const tryParseLengthPercentageAuto = oneOf(
  repeat(tryParseAuto, 1, 1),
  repeat(tryParsePercentage, 1, 1),
  repeat(tryParseLength, 1, 1),
);

export function parseLengthPercentageAuto(c: Cursor): LengthPercentageAuto {
  const value = tryParseLengthPercentageAuto(c);

  if (value !== null) {
    return value[0];
  }

  c.error('Expected <length-percentage> or auto');
}

export function serializeLengthPercentageAuto(value: LengthPercentageAuto): string {
  switch (value.type) {
    case 'auto': return 'auto';
    case 'percentage': return serializePercentage(value);
    case 'length': return serializeLength(value);
  }
}
