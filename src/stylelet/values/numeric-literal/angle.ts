import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import type { ComponentCursor } from '../../parser/component-cursor';
import { withComponentTrivia } from '../../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from '../../parser/component-try-consumer';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { TokenKind } from '../../parser/tokens';
import { dimensionLiteral, serializeDimension, type DimensionLiteral } from './dimension';

/*
 * <angle> = <dimension-token with an angle unit>
 *
 * Legacy grammars that accept a bare zero must explicitly include <zero>.
 */

export type AngleLiteral = DimensionLiteral<'angle', AngleUnit>;

export type CanonicalAngleLiteral = DimensionLiteral<'angle', 'deg'>;

export const ANGLE_UNITS = ['deg', 'grad', 'rad', 'turn'] as const;

export type AngleUnit = (typeof ANGLE_UNITS)[number];

export function angleLiteral(value: number): CanonicalAngleLiteral;
export function angleLiteral<Unit extends AngleUnit>(
  value: number,
  unit: Unit,
): DimensionLiteral<'angle', Unit>;
export function angleLiteral(
  value: number,
  unit: AngleUnit = 'deg',
): AngleLiteral {
  return dimensionLiteral('angle', value, unit);
}

export function parseAngle(
  input: ParserInput,
  context: unknown = undefined,
): AngleLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeAngle),
      context,
    ),
    'angle',
  );
}

export type AngleConsumerOptions = {
  /** Inclusive lower bound in canonical degrees. */
  min?: number;

  /** Inclusive upper bound in canonical degrees. */
  max?: number;
};

export function createAngleConsumer(
  options: AngleConsumerOptions = {},
): TryComponentConsumer<AngleLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return (c): TryComponentConsumerResult<AngleLiteral> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedAngle(c);

    if (result === null || isBad(result)) {
      return result;
    }

    const canonical = canonicalizeAngle(result.value);

    if (canonical.value < min || canonical.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

export const tryConsumeAngle = createAngleConsumer();

function tryConsumeUnrestrictedAngle(
  c: ComponentCursor,
): TryComponentConsumerResult<AngleLiteral> {
  const start = c.pos();
  const component = c.next();

  if (isTokenKind(component, TokenKind.Dimension)) {
    const unit = angleUnitFor(component.unit);

    if (unit !== null) {
      return ok({
        type: 'angle',
        value: component.value,
        unit,
      });
    }
  }

  c.restore(start);
  return null;
}

function angleUnitFor(raw: string): AngleUnit | null {
  const normalized = asciiLower(raw);

  return isAngleUnit(normalized)
    ? normalized
    : null;
}

function isAngleUnit(value: string): value is AngleUnit {
  return ANGLE_UNITS.some((unit) => unit === value);
}

export function serializeAngle(value: AngleLiteral): string {
  return serializeDimension(value);
}

export function serializeCanonicalAngle(value: CanonicalAngleLiteral): string {
  return serializeDimension(value);
}

export function canonicalizeAngle(value: AngleLiteral): CanonicalAngleLiteral {
  let degrees: number;

  switch (value.unit) {
    case 'deg':
      degrees = value.value;
      break;
    case 'grad':
      degrees = value.value * 0.9;
      break;
    case 'rad':
      degrees = value.value * 180 / Math.PI;
      break;
    case 'turn':
      degrees = value.value * 360;
      break;
    default:
      return assertNever(value.unit);
  }

  return {
    type: 'angle',
    value: degrees,
    unit: 'deg',
  };
}
