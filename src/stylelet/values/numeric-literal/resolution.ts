import { asciiLower } from '../../../infra/ascii';
import { assertNever } from '../../../infra/util';

import {
  consumeDimensionToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';

import { DimensionLiteral } from './dimension';

/** A literal <resolution> in a recognized unit. */
// https://drafts.csswg.org/css-values-4/#resolutions
export class ResolutionLiteral<Unit extends ResolutionUnit = ResolutionUnit> extends DimensionLiteral<Unit> {
  override type = 'resolution' as const;

  constructor(value: number, unit: Unit) {
    super(value, unit);
  }

  /** Parse a complete literal. */
  static override parse(input: ParserInput, context: unknown): ResolutionLiteral | null {
    return resolutionParser(input, context);
  }

  /** Consume one literal with the default range. */
  static override consume(this: void, c: TokenCursor): TryConsumerResult<ResolutionLiteral> {
    return resolutionConsumer(c);
  }

  /** Configure inclusive bounds in the canonical unit. */
  static createConsumer(options: ResolutionConsumerOptions = {}): TryConsumer<ResolutionLiteral> {
    const min = Math.max(0, options.min ?? -Infinity);
    const max = options.max ?? Infinity;
    const needsCanonicalBounds = min !== 0 || max !== Infinity;

    return adaptConsumer(consumeDimensionToken, (component) => {
      const unit = resolutionUnitFor(component.unit);
      if (unit === null) return null;
      const result = new ResolutionLiteral(component.value, unit);
      const magnitude = needsCanonicalBounds ? result.canonicalize().value : result.value;
      return magnitude < min || magnitude > max ? null : result;
    });
  }

  /** Convert to the canonical unit from the computed stage onward. */
  override resolve(stage: ValueStage, _context: unknown): ResolutionLiteral {
    return stage < ValueStage.Computed ? this : this.canonicalize();
  }

  /** Convert the magnitude to dppx, retaining an already canonical literal. */
  canonicalize(): CanonicalResolutionLiteral {
    switch (this.unit) {
      case 'dpi':
        return new ResolutionLiteral(this.value / 96, 'dppx');
      case 'dpcm':
        return new ResolutionLiteral(this.value * 2.54 / 96, 'dppx');
      case 'dppx':
        return this as ResolutionLiteral<Unit & 'dppx'>;
      case 'x':
        return new ResolutionLiteral(this.value, 'dppx');
      default:
        return assertNever(this.unit);
    }
  }

  /** Add same-unit literals without losing their concrete type. */
  override add(other: DimensionLiteral<ResolutionUnit>): ResolutionLiteral<Unit> {
    this.assertSameUnit(other);
    return new ResolutionLiteral(this.value + other.value, this.unit);
  }

  /** Interpolate same-unit literals without converting their units. */
  override interpolate(other: DimensionLiteral<ResolutionUnit>, progress: number): ResolutionLiteral<Unit> {
    this.assertSameUnit(other);
    return new ResolutionLiteral((1 - progress) * this.value + progress * other.value, this.unit);
  }

  /** Accumulation of these dimensions is addition. */
  override accumulate(other: DimensionLiteral<ResolutionUnit>): ResolutionLiteral<Unit> {
    return this.add(other);
  }
}

export type CanonicalResolutionLiteral = ResolutionLiteral<'dppx'>;
export const RESOLUTION_UNITS = ['dpi', 'dpcm', 'dppx', 'x'] as const;
export type ResolutionUnit = (typeof RESOLUTION_UNITS)[number];

export type ResolutionConsumerOptions = {
  /** Inclusive lower bound in dppx. */
  min?: number;
  /** Inclusive upper bound in dppx. */
  max?: number;
};

function resolutionUnitFor(raw: string): ResolutionUnit | null {
  const normalized = asciiLower(raw);

  return RESOLUTION_UNITS.find((unit) => unit === normalized) ?? null;
}

const resolutionConsumer = ResolutionLiteral.createConsumer();
const resolutionParser = createComponentParser(withTrivia(resolutionConsumer));
