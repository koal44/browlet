import type { ComponentCursor } from '../parser/component-cursor';
import { consumeComponentTrivia, isTokenKind } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import {
  ok,
  type TryComponentParserResult,
} from '../parser/component-try-parser';
import { serializeNumber } from './number';

export type PercentageValue = {
  type: 'percentage';
  value: number;
};

export function tryParsePercentage(c: ComponentCursor): TryComponentParserResult<PercentageValue> {
  const start = c.pos();

  consumeComponentTrivia(c);

  const comp = c.next();

  if (!isTokenKind(comp, TokenKind.Percentage)) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'percentage',
    value: comp.value,
  });
}

export function serializePercentage(value: PercentageValue): string {
  return `${serializeNumber(value.value)}%`;
}
