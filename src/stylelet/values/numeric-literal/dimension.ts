import { InternalError } from '../../../infra/internal-error';

import {
  consumeDimensionToken, serializeCssDimensionUnit, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import type { ValueStage } from '../../value-processing/index';
import type { Value } from '../value';

import { serializeCssNumber } from './number';

/** A magnitude and unit, also serving as the base of recognized dimension literals. */
// https://drafts.csswg.org/css-values-4/#dimensions
export class DimensionLiteral<Unit extends string = string> implements Value {
  /** The numeric family, or dimension when the unit has not been classified. */
  type: DimensionType = 'dimension';
  /** The magnitude in the retained unit. */
  value: number;
  /** The literal's unit identifier; an unknown identifier remains uninterpreted. */
  unit: Unit;

  constructor(value: number, unit: Unit) {
    this.value = value;
    this.unit = unit;
  }

  /** Parse a complete dimension, without requiring a recognized unit. */
  static parse(input: ParserInput, context: unknown): DimensionLiteral | null {
    return dimensionParser(input, context);
  }

  /** Consume one dimension, retaining its unit spelling. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<DimensionLiteral> {
    return dimensionConsumer(c);
  }

  /** A generic dimension has no known contextual conversion. */
  resolve(_stage: ValueStage, _context: unknown): DimensionLiteral {
    return this;
  }

  /** Serialize the current magnitude and unit without converting them. */
  serialize(): string {
    return `${serializeCssNumber(this.value)}${serializeCssDimensionUnit(this.unit)}`;
  }

  /** Add magnitudes expressed in the same unit. */
  // https://drafts.csswg.org/css-values-4/#combine-dimensions
  add(other: DimensionLiteral): DimensionLiteral {
    this.assertSameUnit(other);
    return new DimensionLiteral(this.value + other.value, this.unit);
  }

  /** Interpolate magnitudes expressed in the same unit. */
  interpolate(other: DimensionLiteral, progress: number): DimensionLiteral {
    this.assertSameUnit(other);
    return new DimensionLiteral((1 - progress) * this.value + progress * other.value, this.unit);
  }

  /** Accumulation of dimensions is addition. */
  accumulate(other: DimensionLiteral): DimensionLiteral {
    return this.add(other);
  }

  protected assertSameUnit(other: DimensionLiteral): void {
    if (this.unit !== other.unit) {
      throw new InternalError(`Dimension units must match: ${this.unit} and ${other.unit}`);
    }
  }
}

export type DimensionType = 'dimension' | 'length' | 'angle' | 'time' | 'frequency' | 'resolution' | 'flex';

const dimensionConsumer = adaptConsumer(
  consumeDimensionToken,
  (token) => new DimensionLiteral(token.value, token.unit),
);
const dimensionParser = createComponentParser(withTrivia(dimensionConsumer));
