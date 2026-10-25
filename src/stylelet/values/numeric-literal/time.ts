import { asciiLower } from '../../../infra/ascii';
import { assertNever } from '../../../infra/util';

import {
  consumeDimensionToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';

import { DimensionLiteral } from './dimension';

/** A literal <time> in a recognized unit. */
// https://drafts.csswg.org/css-values-4/#times
export class TimeLiteral<Unit extends TimeUnit = TimeUnit> extends DimensionLiteral<Unit> {
  override type = 'time' as const;

  constructor(value: number, unit: Unit) {
    super(value, unit);
  }

  /** Parse a complete literal. */
  static override parse(input: ParserInput, context: unknown): TimeLiteral | null {
    return timeParser(input, context);
  }

  /** Consume one literal with the default range. */
  static override consume(this: void, c: TokenCursor): TryConsumerResult<TimeLiteral> {
    return timeConsumer(c);
  }

  /** Configure inclusive bounds in the canonical unit. */
  static createConsumer(options: TimeConsumerOptions = {}): TryConsumer<TimeLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    const unbounded = min === -Infinity && max === Infinity;

    return adaptConsumer(consumeDimensionToken, (component) => {
      const unit = timeUnitFor(component.unit);
      if (unit === null) return null;
      const result = new TimeLiteral(component.value, unit);
      if (unbounded) return result;
      const canonical = result.canonicalize();
      return canonical.value < min || canonical.value > max ? null : result;
    });
  }

  /** Convert to the canonical unit from the computed stage onward. */
  override resolve(stage: ValueStage, _context: unknown): TimeLiteral {
    return stage < ValueStage.Computed ? this : this.canonicalize();
  }

  /** Convert the magnitude to s, retaining an already canonical literal. */
  canonicalize(): CanonicalTimeLiteral {
    switch (this.unit) {
      case 's':
        return this as TimeLiteral<Unit & 's'>;
      case 'ms':
        return new TimeLiteral(this.value / 1000, 's');
      default:
        return assertNever(this.unit);
    }
  }

  /** Add same-unit literals without losing their concrete type. */
  override add(other: DimensionLiteral<TimeUnit>): TimeLiteral<Unit> {
    this.assertSameUnit(other);
    return new TimeLiteral(this.value + other.value, this.unit);
  }

  /** Interpolate same-unit literals without converting their units. */
  override interpolate(other: DimensionLiteral<TimeUnit>, progress: number): TimeLiteral<Unit> {
    this.assertSameUnit(other);
    return new TimeLiteral((1 - progress) * this.value + progress * other.value, this.unit);
  }

  /** Accumulation of these dimensions is addition. */
  override accumulate(other: DimensionLiteral<TimeUnit>): TimeLiteral<Unit> {
    return this.add(other);
  }
}

export type CanonicalTimeLiteral = TimeLiteral<'s'>;
export const TIME_UNITS = ['s', 'ms'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export type TimeConsumerOptions = {
  /** Inclusive lower bound in s. */
  min?: number;
  /** Inclusive upper bound in s. */
  max?: number;
};

function timeUnitFor(raw: string): TimeUnit | null {
  const normalized = asciiLower(raw);

  return TIME_UNITS.find((unit) => unit === normalized) ?? null;
}

const timeConsumer = TimeLiteral.createConsumer();
const timeParser = createComponentParser(withTrivia(timeConsumer));
