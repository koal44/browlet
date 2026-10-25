import { asciiLower } from '../../../infra/ascii';
import { assertNever } from '../../../infra/util';
import { InternalError } from '../../../infra/internal-error';

import {
  consumeDimensionToken, consumeNumberToken, one, oneOf, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';

import { DimensionLiteral } from './dimension';

/** A length in its specified unit, including the unitless-zero spelling. */
// https://drafts.csswg.org/css-values-4/#lengths
export class LengthLiteral<Unit extends LengthUnit | '' = LengthUnit | ''> extends DimensionLiteral<Unit> {
  override type = 'length' as const;

  constructor(value: number, unit: Unit & LengthUnit);
  constructor(value: 0, unit: Unit & '');
  constructor(value: number, unit: Unit) {
    super(value, unit);
  }

  /** Parse a complete length literal. */
  static override parse(input: ParserInput, context: unknown): LengthLiteral | null {
    return lengthParser(input, context);
  }

  /** Consume a length; ambiguous grammars must try numbers before unitless zero. */
  static override consume(this: void, c: TokenCursor): TryConsumerResult<LengthLiteral> {
    return lengthConsumer(c);
  }

  /** Configure the bounds that can be checked before contextual unit resolution. */
  static createConsumer(options: LengthConsumerOptions = {}): TryConsumer<LengthLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    if (!canCheckLengthRangeWithoutResolution(min, max)) {
      throw new InternalError('Length ranges with finite nonzero bounds are not yet supported');
    }
    return oneOf([
      one(lengthDimensionConsumer),
      one(unitlessZeroLengthConsumer),
    ], ([literal]) => literal.value < min || literal.value > max ? null : literal);
  }

  /** Resolve available length references from the computed stage onward. */
  override resolve(stage: ValueStage, context: LengthResolutionContext = {}): LengthLiteral {
    return stage < ValueStage.Computed ? this : this.tryResolve(context) ?? this;
  }

  /** Preserve the unitless-zero spelling without introducing a unit. */
  override serialize(): string {
    return this.unit === '' ? '0' : super.serialize();
  }

  /** Return CSS pixels, or null when a required reference is unavailable. */
  tryResolve(this: LengthLiteral, context: LengthResolutionContext = {}): CanonicalLengthLiteral | null {
    let pixelsPerUnit: number | undefined;
    const unit = this.unit;

    switch (unit) {
      case '':
        return new LengthLiteral(0, 'px');
      case 'px':
        return this as CanonicalLengthLiteral;
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

    return new LengthLiteral(this.value * pixelsPerUnit, 'px');
  }

  /** Snap a canonical line width to the device-pixel grid. */
  // https://drafts.csswg.org/css-values-4/#snap-a-length-as-a-border-width
  snapAsLineWidth(this: CanonicalLengthLiteral, devicePixelRatio: number): CanonicalLengthLiteral {
    const devicePixels = this.value * devicePixelRatio;

    if (Number.isInteger(devicePixels)) {
      return this;
    }

    const magnitude = Math.abs(devicePixels);

    if (magnitude > 0 && magnitude < 1) {
      return new LengthLiteral(Math.sign(devicePixels) / devicePixelRatio, 'px');
    }

    if (magnitude > 1) {
      return new LengthLiteral(Math.trunc(devicePixels) / devicePixelRatio, 'px');
    }

    return this;
  }

  /** Add same-unit lengths. Unitless zero remains unitless. */
  override add(this: LengthLiteral, other: DimensionLiteral<LengthUnit | ''>): LengthLiteral {
    this.assertSameUnit(other);
    const unit = this.unit;
    return unit === '' ? new LengthLiteral(0, '') : new LengthLiteral(this.value + other.value, unit);
  }

  /** Interpolate same-unit lengths. */
  override interpolate(this: LengthLiteral, other: DimensionLiteral<LengthUnit | ''>, progress: number): LengthLiteral {
    this.assertSameUnit(other);
    const unit = this.unit;
    return unit === '' ? new LengthLiteral(0, '')
      : new LengthLiteral((1 - progress) * this.value + progress * other.value, unit);
  }

  /** Accumulation of lengths is addition. */
  override accumulate(other: DimensionLiteral<LengthUnit | ''>): LengthLiteral {
    return this.add(other);
  }
}

export type CanonicalLengthLiteral = LengthLiteral<'px'>;

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

export type LengthConsumerOptions = {
  /** Inclusive lower bound in CSS pixels. */
  min?: number;
  /** Inclusive upper bound in CSS pixels. */
  max?: number;
};

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

/*
 * Implementation factorization of <length>:
 *
 * <length-dimension> = <dimension-token with a length unit>
 * <length> = <length-dimension> | <zero>
 */

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

  return LENGTH_UNITS.find((unit) => unit === normalized) ?? null;
}

// <length-dimension> = <dimension-token with a length unit>
const lengthDimensionConsumer: TryConsumer<LengthLiteral> = adaptConsumer(
  consumeDimensionToken,
  (component) => {
    const unit = lengthUnitFor(component.unit);

    return unit === null
      ? null
      : new LengthLiteral(component.value, unit);
  },
);

// <zero> = <number-token with a value of 0>
const unitlessZeroLengthConsumer: TryConsumer<LengthLiteral> = adaptConsumer(
  consumeNumberToken,
  (component) => component.value === 0
    ? new LengthLiteral(0, '')
    : null,
);

const lengthConsumer = LengthLiteral.createConsumer();
const lengthParser = createComponentParser(withTrivia(lengthConsumer));
