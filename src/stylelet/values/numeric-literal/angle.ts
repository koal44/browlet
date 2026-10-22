import { asciiLower } from '../../../infra/ascii';
import { assertNever } from '../../../infra/util';

import {
  consumeDimensionToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';

import { DimensionLiteral } from './dimension';

/** A literal <angle> in a recognized unit. Legacy grammars accepting bare zero must include <zero>. */
// https://drafts.csswg.org/css-values-4/#angles
export class AngleLiteral<Unit extends AngleUnit = AngleUnit> extends DimensionLiteral<Unit> {
  declare type: 'angle';

  constructor(value: number, unit: Unit) {
    super(value, unit);
    this.type = 'angle';
  }

  /** Parse a complete literal. */
  static override parse(input: ParserInput, context: unknown): AngleLiteral | null {
    return angleParser(input, context);
  }

  /** Consume one literal with the default range. */
  static override consume(this: void, c: TokenCursor): TryConsumerResult<AngleLiteral> {
    return angleConsumer(c);
  }

  /** Configure inclusive bounds in the canonical unit. */
  static createConsumer(options: AngleConsumerOptions = {}): TryConsumer<AngleLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    const unbounded = min === -Infinity && max === Infinity;

    return adaptConsumer(consumeDimensionToken, (component) => {
      const unit = angleUnitFor(component.unit);
      if (unit === null) return null;
      const result = new AngleLiteral(component.value, unit);
      if (unbounded) return result;
      const canonical = result.canonicalize();
      return canonical.value < min || canonical.value > max ? null : result;
    });
  }

  /** Convert to the canonical unit from the computed stage onward. */
  override resolve(stage: ValueStage, _context: unknown): AngleLiteral {
    return stage < ValueStage.Computed ? this : this.canonicalize();
  }

  /** Convert the magnitude to deg, retaining an already canonical literal. */
  canonicalize(): CanonicalAngleLiteral {
    switch (this.unit) {
      case 'deg':
        return this as AngleLiteral<Unit & 'deg'>;
      case 'grad':
        return new AngleLiteral(this.value * 0.9, 'deg');
      case 'rad':
        return new AngleLiteral(this.value * 180 / Math.PI, 'deg');
      case 'turn':
        return new AngleLiteral(this.value * 360, 'deg');
      default:
        return assertNever(this.unit);
    }
  }

  /** Add same-unit literals without losing their concrete type. */
  override add(other: DimensionLiteral<AngleUnit>): AngleLiteral<Unit> {
    this.assertSameUnit(other);
    return new AngleLiteral(this.value + other.value, this.unit);
  }

  /** Interpolate same-unit literals without converting their units. */
  override interpolate(other: DimensionLiteral<AngleUnit>, progress: number): AngleLiteral<Unit> {
    this.assertSameUnit(other);
    return new AngleLiteral((1 - progress) * this.value + progress * other.value, this.unit);
  }

  /** Accumulation of these dimensions is addition. */
  override accumulate(other: DimensionLiteral<AngleUnit>): AngleLiteral<Unit> {
    return this.add(other);
  }
}

export type CanonicalAngleLiteral = AngleLiteral<'deg'>;
export const ANGLE_UNITS = ['deg', 'grad', 'rad', 'turn'] as const;
export type AngleUnit = (typeof ANGLE_UNITS)[number];

export type AngleConsumerOptions = {
  /** Inclusive lower bound in deg. */
  min?: number;
  /** Inclusive upper bound in deg. */
  max?: number;
};

function angleUnitFor(raw: string): AngleUnit | null {
  const normalized = asciiLower(raw);

  return ANGLE_UNITS.find((unit) => unit === normalized) ?? null;
}

const angleConsumer = AngleLiteral.createConsumer();
const angleParser = createComponentParser(withTrivia(angleConsumer));
