import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import { tryConsumeDimensionToken } from '../../parser/component-consumers';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { dimensionLiteral, serializeDimension, type DimensionLiteral } from './dimension';

/*
 * <resolution> = <nonnegative dimension-token with a resolution unit>
 */

export type ResolutionLiteral = DimensionLiteral<'resolution', ResolutionUnit>;

export type CanonicalResolutionLiteral =
  DimensionLiteral<'resolution', 'dppx'>;

export const RESOLUTION_UNITS = ['dpi', 'dpcm', 'dppx', 'x'] as const;

export type ResolutionUnit = (typeof RESOLUTION_UNITS)[number];

export function resolutionLiteral(value: number): CanonicalResolutionLiteral;
export function resolutionLiteral<Unit extends ResolutionUnit>(
  value: number,
  unit: Unit,
): DimensionLiteral<'resolution', Unit>;
export function resolutionLiteral(
  value: number,
  unit: ResolutionUnit = 'dppx',
): ResolutionLiteral {
  return dimensionLiteral('resolution', value, unit);
}

export function parseResolution(
  input: ParserInput,
  context: unknown = undefined,
): ResolutionLiteral | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeResolution),
    context,
  );
}

export type ResolutionConsumerOptions = {
  /** Inclusive lower bound in canonical dots per CSS pixel. */
  min?: number;

  /** Inclusive upper bound in canonical dots per CSS pixel. */
  max?: number;
};

export function createResolutionConsumer(
  options: ResolutionConsumerOptions = {},
): TryComponentConsumer<ResolutionLiteral> {
  const min = Math.max(0, options.min ?? -Infinity);
  const max = options.max ?? Infinity;

  return adaptConsumer(tryConsumeDimensionToken, (component) => {
    const unit = resolutionUnitFor(component.unit);

    if (unit === null) return null;

    const result: ResolutionLiteral = {
      type: 'resolution',
      value: component.value,
      unit,
    };
    const canonical = canonicalizeResolution(result);

    return canonical.value < min || canonical.value > max
      ? null
      : result;
  });
}

export const tryConsumeResolution = createResolutionConsumer();

function resolutionUnitFor(raw: string): ResolutionUnit | null {
  const normalized = asciiLower(raw);

  return isResolutionUnit(normalized)
    ? normalized
    : null;
}

function isResolutionUnit(value: string): value is ResolutionUnit {
  return RESOLUTION_UNITS.some((unit) => unit === value);
}

export function serializeResolution(value: ResolutionLiteral): string {
  return serializeDimension(value);
}

export function serializeCanonicalResolution(
  value: CanonicalResolutionLiteral,
): string {
  return serializeDimension(value);
}

export function canonicalizeResolution(
  value: ResolutionLiteral,
): CanonicalResolutionLiteral {
  let dotsPerPixel: number;

  switch (value.unit) {
    case 'dpi':
      dotsPerPixel = value.value / 96;
      break;
    case 'dpcm':
      dotsPerPixel = value.value * 2.54 / 96;
      break;
    case 'dppx': case 'x':
      dotsPerPixel = value.value;
      break;
    default:
      return assertNever(value.unit);
  }

  return {
    type: 'resolution',
    value: dotsPerPixel,
    unit: 'dppx',
  };
}
