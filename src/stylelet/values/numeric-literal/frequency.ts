import { asciiLower } from '../../../infra/ascii';
import { assertNever } from '../../../infra/util';

import {
  consumeDimensionToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';

import { DimensionLiteral } from './dimension';

/** A literal <frequency> in a recognized unit. */
// https://drafts.csswg.org/css-values-4/#frequency
export class FrequencyLiteral<Unit extends FrequencyUnit = FrequencyUnit> extends DimensionLiteral<Unit> {
  override type = 'frequency' as const;

  constructor(value: number, unit: Unit) {
    super(value, unit);
  }

  /** Parse a complete literal. */
  static override parse(input: ParserInput, context: unknown): FrequencyLiteral | null {
    return frequencyParser(input, context);
  }

  /** Consume one literal with the default range. */
  static override consume(this: void, c: TokenCursor): TryConsumerResult<FrequencyLiteral> {
    return frequencyConsumer(c);
  }

  /** Configure inclusive bounds in the canonical unit. */
  static createConsumer(options: FrequencyConsumerOptions = {}): TryConsumer<FrequencyLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    const unbounded = min === -Infinity && max === Infinity;

    return adaptConsumer(consumeDimensionToken, (component) => {
      const unit = frequencyUnitFor(component.unit);
      if (unit === null) return null;
      const result = new FrequencyLiteral(component.value, unit);
      if (unbounded) return result;
      const canonical = result.canonicalize();
      return canonical.value < min || canonical.value > max ? null : result;
    });
  }

  /** Convert to the canonical unit from the computed stage onward. */
  override resolve(stage: ValueStage, _context: unknown): FrequencyLiteral {
    return stage < ValueStage.Computed ? this : this.canonicalize();
  }

  /** Convert the magnitude to hz, retaining an already canonical literal. */
  canonicalize(): CanonicalFrequencyLiteral {
    switch (this.unit) {
      case 'hz':
        return this as FrequencyLiteral<Unit & 'hz'>;
      case 'khz':
        return new FrequencyLiteral(this.value * 1000, 'hz');
      default:
        return assertNever(this.unit);
    }
  }

  /** Add same-unit literals without losing their concrete type. */
  override add(other: DimensionLiteral<FrequencyUnit>): FrequencyLiteral<Unit> {
    this.assertSameUnit(other);
    return new FrequencyLiteral(this.value + other.value, this.unit);
  }

  /** Interpolate same-unit literals without converting their units. */
  override interpolate(other: DimensionLiteral<FrequencyUnit>, progress: number): FrequencyLiteral<Unit> {
    this.assertSameUnit(other);
    return new FrequencyLiteral((1 - progress) * this.value + progress * other.value, this.unit);
  }

  /** Accumulation of these dimensions is addition. */
  override accumulate(other: DimensionLiteral<FrequencyUnit>): FrequencyLiteral<Unit> {
    return this.add(other);
  }
}

export type CanonicalFrequencyLiteral = FrequencyLiteral<'hz'>;
export const FREQUENCY_UNITS = ['hz', 'khz'] as const;
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number];

export type FrequencyConsumerOptions = {
  /** Inclusive lower bound in hz. */
  min?: number;
  /** Inclusive upper bound in hz. */
  max?: number;
};

function frequencyUnitFor(raw: string): FrequencyUnit | null {
  const normalized = asciiLower(raw);

  return FREQUENCY_UNITS.find((unit) => unit === normalized) ?? null;
}

const frequencyConsumer = FrequencyLiteral.createConsumer();
const frequencyParser = createComponentParser(withTrivia(frequencyConsumer));
