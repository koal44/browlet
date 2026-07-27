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
 * <length> = <dimension-token with a length unit> | <zero>
 *
 * In an ambiguous grammar, consume <number> before <length> so that a
 * unitless zero is parsed as a number, as required by CSS Values.
 */

export type LengthLiteral =
  | DimensionLiteral<'length', LengthUnit>
  | (DimensionLiteral<'length', ''> & { value: 0; });

export type CanonicalLengthLiteral = DimensionLiteral<'length', 'px'>;

export type LengthResolutionContext = {
  // Effective font-relative reference lengths, in CSS pixels per unit.
  em?: number;
  rem?: number;
  ex?: number;
  rex?: number;
  cap?: number;
  rcap?: number;
  ch?: number;
  rch?: number;
  ic?: number;
  ric?: number;
  lh?: number;
  rlh?: number;

  // Effective physical viewport dimensions, in CSS pixels.
  smallViewportWidth?: number;
  smallViewportHeight?: number;
  largeViewportWidth?: number;
  largeViewportHeight?: number;
  dynamicViewportWidth?: number;
  dynamicViewportHeight?: number;

  // Effective query-container reference sizes (or small viewport fallbacks),
  // in CSS pixels. Each axis may select a different query container.
  containerWidth?: number;
  containerHeight?: number;
  containerInlineSize?: number;
  containerBlockSize?: number;

  // The physical axis used to resolve logical viewport units.
  viewportInlineAxis?: InlineAxis;
};

export type InlineAxis = 'horizontal' | 'vertical';

export const LENGTH_UNITS = [
  // Font-relative lengths.
  'em', 'rem',
  'ex', 'rex',
  'cap', 'rcap',
  'ch', 'rch',
  'ic', 'ric',
  'lh', 'rlh',

  // Viewport-percentage lengths.
  'vw', 'svw', 'lvw', 'dvw',
  'vh', 'svh', 'lvh', 'dvh',
  'vi', 'svi', 'lvi', 'dvi',
  'vb', 'svb', 'lvb', 'dvb',
  'vmin', 'svmin', 'lvmin', 'dvmin',
  'vmax', 'svmax', 'lvmax', 'dvmax',

  // Absolute lengths.
  'cm', 'mm', 'q', 'in', 'pt', 'pc', 'px',

  // Container query lengths (CSS Conditional 5).
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax',
] as const;

export type LengthUnit = (typeof LENGTH_UNITS)[number];

export function parseLength(
  input: ParserInput,
  context: unknown = undefined,
): LengthLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeLength),
      context,
    ),
    'length',
  );
}

export type LengthConsumerOptions = {
  /** Inclusive lower bound in canonical CSS pixels. */
  min?: number;

  /** Inclusive upper bound in canonical CSS pixels. */
  max?: number;
};

export function createLengthConsumer(
  options: LengthConsumerOptions = {},
): TryComponentConsumer<LengthLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckLengthRangeWithoutResolution(min, max)) {
    throw new Error(
      'Length ranges with finite nonzero bounds are not yet supported',
    );
  }

  return (c): TryComponentConsumerResult<LengthLiteral> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedLength(c);

    if (result === null || isBad(result)) {
      return result;
    }

    const value = result.value;

    if (value.value < min || value.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

export const tryConsumeLength = createLengthConsumer();

function tryConsumeUnrestrictedLength(
  c: ComponentCursor,
): TryComponentConsumerResult<LengthLiteral> {
  const start = c.pos();
  const component = c.next();

  if (isTokenKind(component, TokenKind.Dimension)) {
    const unit = lengthUnitFor(component.unit);

    if (unit !== null) {
      return ok({
        type: 'length',
        value: component.value,
        unit,
      });
    }
  } else if (isTokenKind(component, TokenKind.Number) && component.value === 0) {
    return ok({
      type: 'length',
      value: 0,
      unit: '',
    });
  }

  c.restore(start);
  return null;
}

function canCheckLengthRangeWithoutResolution(min: number, max: number): boolean {
  // All length-unit conversions preserve sign, so zero and infinite bounds
  // do not require the contextual value to be reduced to pixels first.
  return (
    (min === -Infinity || min === 0) &&
    (max === 0 || max === Infinity)
  );
}

function lengthUnitFor(raw: string): LengthUnit | null {
  const normalized = asciiLower(raw);

  return isLengthUnit(normalized)
    ? normalized
    : null;
}

function isLengthUnit(value: string): value is LengthUnit {
  return LENGTH_UNITS.some((unit) => unit === value);
}

export function serializeLength(value: LengthLiteral): string {
  return value.unit === '' ? '0' : serializeDimension(value);
}

export function serializeCanonicalLength(value: CanonicalLengthLiteral): string {
  return serializeDimension(value);
}

export function snapLengthAsLineWidth(
  value: CanonicalLengthLiteral,
  devicePixelRatio: number,
): CanonicalLengthLiteral {
  const devicePixels = value.value * devicePixelRatio;

  if (Number.isInteger(devicePixels)) {
    return value;
  }

  const magnitude = Math.abs(devicePixels);

  if (magnitude > 0 && magnitude < 1) {
    return {
      ...value,
      value: Math.sign(devicePixels) / devicePixelRatio,
    };
  }

  if (magnitude > 1) {
    return {
      ...value,
      value: Math.trunc(devicePixels) / devicePixelRatio,
    };
  }

  return value;
}

export function tryResolveLength(
  value: LengthLiteral,
  context: LengthResolutionContext = {},
): CanonicalLengthLiteral | null {
  let pixelsPerUnit: number | undefined;
  const unit = value.unit;

  switch (unit) {
    case '':
      return { type: 'length', value: 0, unit: 'px' };
    case 'px':
      return { type: 'length', value: value.value, unit: 'px' };
    case 'in':
      pixelsPerUnit = 96;
      break;
    case 'cm':
      pixelsPerUnit = 96 / 2.54;
      break;
    case 'mm':
      pixelsPerUnit = 96 / 25.4;
      break;
    case 'q':
      pixelsPerUnit = 96 / 101.6;
      break;
    case 'pt':
      pixelsPerUnit = 96 / 72;
      break;
    case 'pc':
      pixelsPerUnit = 16;
      break;

    case 'em': case 'rem':
    case 'ex': case 'rex':
    case 'cap': case 'rcap':
    case 'ch': case 'rch':
    case 'ic': case 'ric':
    case 'lh': case 'rlh':
      pixelsPerUnit = context[unit];
      break;

    case 'vw': case 'lvw':
      pixelsPerUnit = percentOf(context.largeViewportWidth);
      break;
    case 'vh': case 'lvh':
      pixelsPerUnit = percentOf(context.largeViewportHeight);
      break;
    case 'vi': case 'lvi':
      pixelsPerUnit = percentOf(inlineSize(
        context.largeViewportWidth,
        context.largeViewportHeight,
        context.viewportInlineAxis,
      ));
      break;
    case 'vb': case 'lvb':
      pixelsPerUnit = percentOf(blockSize(
        context.largeViewportWidth,
        context.largeViewportHeight,
        context.viewportInlineAxis,
      ));
      break;
    case 'vmin': case 'lvmin':
      pixelsPerUnit = percentOf(minimumSize(
        context.largeViewportWidth,
        context.largeViewportHeight,
      ));
      break;
    case 'vmax': case 'lvmax':
      pixelsPerUnit = percentOf(maximumSize(
        context.largeViewportWidth,
        context.largeViewportHeight,
      ));
      break;

    case 'svw':
      pixelsPerUnit = percentOf(context.smallViewportWidth);
      break;
    case 'svh':
      pixelsPerUnit = percentOf(context.smallViewportHeight);
      break;
    case 'svi':
      pixelsPerUnit = percentOf(inlineSize(
        context.smallViewportWidth,
        context.smallViewportHeight,
        context.viewportInlineAxis,
      ));
      break;
    case 'svb':
      pixelsPerUnit = percentOf(blockSize(
        context.smallViewportWidth,
        context.smallViewportHeight,
        context.viewportInlineAxis,
      ));
      break;
    case 'svmin':
      pixelsPerUnit = percentOf(minimumSize(
        context.smallViewportWidth,
        context.smallViewportHeight,
      ));
      break;
    case 'svmax':
      pixelsPerUnit = percentOf(maximumSize(
        context.smallViewportWidth,
        context.smallViewportHeight,
      ));
      break;

    case 'dvw':
      pixelsPerUnit = percentOf(context.dynamicViewportWidth);
      break;
    case 'dvh':
      pixelsPerUnit = percentOf(context.dynamicViewportHeight);
      break;
    case 'dvi':
      pixelsPerUnit = percentOf(inlineSize(
        context.dynamicViewportWidth,
        context.dynamicViewportHeight,
        context.viewportInlineAxis,
      ));
      break;
    case 'dvb':
      pixelsPerUnit = percentOf(blockSize(
        context.dynamicViewportWidth,
        context.dynamicViewportHeight,
        context.viewportInlineAxis,
      ));
      break;
    case 'dvmin':
      pixelsPerUnit = percentOf(minimumSize(
        context.dynamicViewportWidth,
        context.dynamicViewportHeight,
      ));
      break;
    case 'dvmax':
      pixelsPerUnit = percentOf(maximumSize(
        context.dynamicViewportWidth,
        context.dynamicViewportHeight,
      ));
      break;

    case 'cqw':
      pixelsPerUnit = percentOf(context.containerWidth);
      break;
    case 'cqh':
      pixelsPerUnit = percentOf(context.containerHeight);
      break;
    case 'cqi':
      pixelsPerUnit = percentOf(context.containerInlineSize);
      break;
    case 'cqb':
      pixelsPerUnit = percentOf(context.containerBlockSize);
      break;
    case 'cqmin':
      pixelsPerUnit = percentOf(minimumSize(
        context.containerInlineSize,
        context.containerBlockSize,
      ));
      break;
    case 'cqmax':
      pixelsPerUnit = percentOf(maximumSize(
        context.containerInlineSize,
        context.containerBlockSize,
      ));
      break;
    default:
      return assertNever(unit);
  }

  if (pixelsPerUnit === undefined) {
    return null;
  }

  return {
    type: 'length',
    value: value.value * pixelsPerUnit,
    unit: 'px',
  };
}

function percentOf(value?: number): number | undefined {
  return value === undefined ? undefined : value / 100;
}

function inlineSize(
  width?: number,
  height?: number,
  inlineAxis?: InlineAxis,
): number | undefined {
  if (inlineAxis === undefined) {
    return undefined;
  }

  return inlineAxis === 'horizontal' ? width : height;
}

function blockSize(
  width?: number,
  height?: number,
  inlineAxis?: InlineAxis,
): number | undefined {
  if (inlineAxis === undefined) {
    return undefined;
  }

  return inlineAxis === 'horizontal' ? height : width;
}

function minimumSize(
  width?: number,
  height?: number,
): number | undefined {
  return width === undefined || height === undefined
    ? undefined
    : Math.min(width, height);
}

function maximumSize(
  width?: number,
  height?: number,
): number | undefined {
  return width === undefined || height === undefined
    ? undefined
    : Math.max(width, height);
}
