import type { Cursor } from '../../selectlet/parser/cursor';
import { consumeTrivia } from '../../selectlet/parser/lex';
import { serializeNumber, tryConsumeNumber } from './number';

export type PercentageValue = {
  type: 'percentage';
  value: number;
};

export function tryParsePercentage(c: Cursor): PercentageValue | null {
  const start = c.pos();

  consumeTrivia(c);

  const n = tryConsumeNumber(c);
  if (n === null) {
    c.restore(start);
    return null;
  }

  if (!c.match('%')) {
    c.restore(start);
    return null;
  }

  return { type: 'percentage', value: n.value };
}

export function serializePercentage(value: PercentageValue): string {
  return `${serializeNumber(value.value)}%`;
}
