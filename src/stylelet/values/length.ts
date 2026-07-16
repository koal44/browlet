import { asciiLower } from '../../shared/css';
import type { ComponentCursor } from '../parser/component-cursor';
import { consumeComponentTrivia, isTokenKind } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import {
  ok,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { serializeCssNumber } from './number';

export type LengthValue = {
  type: 'length';
  value: number;
  unit: LengthUnit;
};

export enum LengthUnit {
  None = 0,
  Px,
  Em,
  Rem,
  Vw,
  Vh,
}

export function tryConsumeLength(c: ComponentCursor): TryComponentConsumerResult<LengthValue> {
  const start = c.pos();

  consumeComponentTrivia(c);

  const comp = c.next();

  if (isTokenKind(comp, TokenKind.Dimension)) {
    const unit = lengthUnitFor(comp.unit);

    if (unit === null) {
      c.restore(start);
      return null;
    }

    return ok({
      type: 'length',
      value: comp.value,
      unit,
    });
  }

  if (isTokenKind(comp, TokenKind.Number) && comp.value === 0) {
    return ok({
      type: 'length',
      value: 0,
      unit: LengthUnit.None,
    });
  }

  c.restore(start);
  return null;
}

export function serializeLength(value: LengthValue): string {
  return `${serializeCssNumber(value.value)}${serializeLengthUnit(value.unit)}`;
}

function serializeLengthUnit(unit: LengthUnit): string {
  switch (unit) {
    case LengthUnit.None: return '';
    case LengthUnit.Px: return 'px';
    case LengthUnit.Em: return 'em';
    case LengthUnit.Rem: return 'rem';
    case LengthUnit.Vw: return 'vw';
    case LengthUnit.Vh: return 'vh';
  }
}

function lengthUnitFor(raw: string): LengthUnit | null {
  switch (asciiLower(raw)) {
    case 'px': return LengthUnit.Px;
    case 'em': return LengthUnit.Em;
    case 'rem': return LengthUnit.Rem;
    case 'vw': return LengthUnit.Vw;
    case 'vh': return LengthUnit.Vh;
    default: return null;
  }
}
