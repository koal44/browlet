import type { Cursor } from '../../selectlet/parser/cursor';
import { consumeTrivia } from '../../selectlet/parser/lex';
import type { AutoValue } from './auto';
import { LengthUnit, serializeLength, tryConsumeLengthUnit, type LengthValue } from './length';
import { tryConsumeKeywordIn } from './keyword';
import { tryConsumeNumber } from './number';
import { serializePercentage, type PercentageValue } from './percentage';

export type LengthPercentageAuto =
  | LengthPercentage
  | AutoValue;

export type LengthPercentage =
  | LengthValue
  | PercentageValue;

export function parseLengthPercentageAuto(c: Cursor): LengthPercentageAuto {
  consumeTrivia(c);

  const auto = tryConsumeKeywordIn(c, ['auto'] as const);
  if (auto) return { type: 'auto' };

  const n = tryConsumeNumber(c);
  if (!n) c.error('Expected <length-percentage> or auto');

  if (c.match('%')) {
    return { type: 'percentage', value: n.value };
  }

  const unit = tryConsumeLengthUnit(c);
  if (unit !== null) {
    return { type: 'length', value: n.value, unit };
  }

  if (n.value === 0) {
    return { type: 'length', value: 0, unit: LengthUnit.None };
  }

  c.error('Expected length unit or % after number');
}

export function serializeLengthPercentageAuto(value: LengthPercentageAuto): string {
  switch (value.type) {
    case 'auto': return 'auto';
    case 'percentage': return serializePercentage(value);
    case 'length': return serializeLength(value);
  }
}
