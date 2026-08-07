import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import { consumeDimensionToken } from '../../syntax/component-consumers';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../../syntax/token-cursor';
import { adaptConsumer, withTrivia } from '../../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
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
  return angleParser(input, context);
}

export function consumeAngle(
  c: TokenCursor,
): TryConsumerResult<AngleLiteral> {
  return angleConsumer(c);
}

export type AngleConsumerOptions = {
  /** Inclusive lower bound in canonical degrees. */
  min?: number;

  /** Inclusive upper bound in canonical degrees. */
  max?: number;
};

export function createAngleConsumer(
  options: AngleConsumerOptions = {},
): TryConsumer<AngleLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return adaptConsumer(consumeDimensionToken, (component) => {
    const unit = angleUnitFor(component.unit);

    if (unit === null) return null;

    const result: AngleLiteral = {
      type: 'angle',
      value: component.value,
      unit,
    };
    const canonical = canonicalizeAngle(result);

    return canonical.value < min || canonical.value > max
      ? null
      : result;
  });
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

function angleUnitFor(raw: string): AngleUnit | null {
  const normalized = asciiLower(raw);

  return isAngleUnit(normalized)
    ? normalized
    : null;
}

function isAngleUnit(value: string): value is AngleUnit {
  return ANGLE_UNITS.some((unit) => unit === value);
}

// <angle> = <dimension-token with an angle unit>
const angleConsumer = createAngleConsumer();
const angleParser = createComponentParser(withTrivia(angleConsumer));
