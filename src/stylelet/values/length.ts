import { canStartIdent, consumeIdent, consumeTrivia, type Cursor } from '../parser/lex';
import { asciiLower } from '../../utils/css';
import { serializeNumber, tryConsumeNumber } from './number';

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

export function tryConsumeLengthUnit(c: Cursor): LengthUnit | null {
  const start = c.pos();

  if (!canStartIdent(c.peek())) return null;

  const raw = consumeIdent(c);
  const unit = lengthUnitFor(raw);

  if (unit === null) {
    c.restore(start);
    return null;
  }

  return unit;
}

export function tryParseLength(c: Cursor): LengthValue | null {
  const start = c.pos();

  consumeTrivia(c);

  const n = tryConsumeNumber(c);
  if (n === null) {
    c.restore(start);
    return null;
  }

  const unit = tryConsumeLengthUnit(c);
  if (unit !== null) {
    return { type: 'length', value: n.value, unit };
  }

  if (n.value === 0) {
    return { type: 'length', value: 0, unit: LengthUnit.None };
  }

  c.restore(start);
  return null;
}

export function serializeLength(value: LengthValue): string {
  return `${serializeNumber(value.value)}${serializeLengthUnit(value.unit)}`;
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
