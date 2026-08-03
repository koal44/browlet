import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import { tryConsumeDimensionToken } from '../../parser/component-consumers';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
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
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeAngle),
    context,
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

  return adaptConsumer(tryConsumeDimensionToken, (component) => {
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

export const tryConsumeAngle = createAngleConsumer();

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
