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
import { serializeDimension, type DimensionLiteral } from './dimension';

/*
 * <resolution> = <nonnegative dimension-token with a resolution unit>
 */

export type ResolutionLiteral = DimensionLiteral<'resolution', ResolutionUnit>;

export type CanonicalResolutionLiteral =
  DimensionLiteral<'resolution', 'dppx'>;

export const RESOLUTION_UNITS = ['dpi', 'dpcm', 'dppx', 'x'] as const;

export type ResolutionUnit = (typeof RESOLUTION_UNITS)[number];

export function parseResolution(
  input: ParserInput,
  context: unknown = undefined,
): ResolutionLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeResolution),
      context,
    ),
    'resolution',
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

  return (c): TryComponentConsumerResult<ResolutionLiteral> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedResolution(c);

    if (result === null || isBad(result)) {
      return result;
    }

    const canonical = resolveResolution(result.value);

    if (canonical.value < min || canonical.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

export const tryConsumeResolution = createResolutionConsumer();

function tryConsumeUnrestrictedResolution(
  c: ComponentCursor,
): TryComponentConsumerResult<ResolutionLiteral> {
  const start = c.pos();
  const component = c.next();

  if (isTokenKind(component, TokenKind.Dimension)) {
    const unit = resolutionUnitFor(component.unit);

    if (unit !== null) {
      return ok({
        type: 'resolution',
        value: component.value,
        unit,
      });
    }
  }

  c.restore(start);
  return null;
}

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

export function resolveResolution(
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
