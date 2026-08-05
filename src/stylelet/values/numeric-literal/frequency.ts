import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import { consumeDimensionToken } from '../../syntax/component-consumers';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../syntax/component-cursor';
import { adaptConsumer, withTrivia } from '../../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import { dimensionLiteral, serializeDimension, type DimensionLiteral } from './dimension';

/*
 * <frequency> = <dimension-token with a frequency unit>
 */

export type FrequencyLiteral = DimensionLiteral<'frequency', FrequencyUnit>;
export type CanonicalFrequencyLiteral = DimensionLiteral<'frequency', 'hz'>;

export const FREQUENCY_UNITS = ['hz', 'khz'] as const;
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number];

export function frequencyLiteral(value: number): CanonicalFrequencyLiteral;
export function frequencyLiteral<Unit extends FrequencyUnit>(
  value: number,
  unit: Unit,
): DimensionLiteral<'frequency', Unit>;
export function frequencyLiteral(
  value: number,
  unit: FrequencyUnit = 'hz',
): FrequencyLiteral {
  return dimensionLiteral('frequency', value, unit);
}

export function parseFrequency(
  input: ParserInput,
  context: unknown = undefined,
): FrequencyLiteral | null {
  return frequencyParser(input, context);
}

export function consumeFrequency(
  c: ComponentCursor,
): TryComponentConsumerResult<FrequencyLiteral> {
  return frequencyConsumer(c);
}

export type FrequencyConsumerOptions = {
  /** Inclusive lower bound in canonical hertz. */
  min?: number;

  /** Inclusive upper bound in canonical hertz. */
  max?: number;
};

export function createFrequencyConsumer(
  options: FrequencyConsumerOptions = {},
): TryComponentConsumer<FrequencyLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return adaptConsumer(consumeDimensionToken, (component) => {
    const unit = frequencyUnitFor(component.unit);

    if (unit === null) return null;

    const result: FrequencyLiteral = {
      type: 'frequency',
      value: component.value,
      unit,
    };
    const canonical = canonicalizeFrequency(result);

    return canonical.value < min || canonical.value > max
      ? null
      : result;
  });
}

export function serializeFrequency(value: FrequencyLiteral): string {
  return serializeDimension(value);
}

export function serializeCanonicalFrequency(
  value: CanonicalFrequencyLiteral,
): string {
  return serializeDimension(value);
}

export function canonicalizeFrequency(
  value: FrequencyLiteral,
): CanonicalFrequencyLiteral {
  let hertz: number;

  switch (value.unit) {
    case 'hz':
      hertz = value.value;
      break;
    case 'khz':
      hertz = value.value * 1000;
      break;
    default:
      return assertNever(value.unit);
  }

  return {
    type: 'frequency',
    value: hertz,
    unit: 'hz',
  };
}

function frequencyUnitFor(raw: string): FrequencyUnit | null {
  const normalized = asciiLower(raw);

  return isFrequencyUnit(normalized)
    ? normalized
    : null;
}

function isFrequencyUnit(value: string): value is FrequencyUnit {
  return FREQUENCY_UNITS.some((unit) => unit === value);
}

// <frequency> = <dimension-token with a frequency unit>
const frequencyConsumer = createFrequencyConsumer();
const frequencyParser = createComponentParser(withTrivia(frequencyConsumer));
