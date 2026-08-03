import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../../parser/component-cursor';
import { withTrivia } from '../../parser/component-grammar';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { TokenKind } from '../../parser/tokens';
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
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeFrequency),
    context,
  );
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

  return (c): TryComponentConsumerResult<FrequencyLiteral> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedFrequency(c);

    if (result === null) return null;

    const canonical = canonicalizeFrequency(result);

    if (canonical.value < min || canonical.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

export const tryConsumeFrequency = createFrequencyConsumer();

function tryConsumeUnrestrictedFrequency(
  c: ComponentCursor,
): TryComponentConsumerResult<FrequencyLiteral> {
  const start = c.pos();
  const component = c.next();

  if (isTokenKind(component, TokenKind.Dimension)) {
    const unit = frequencyUnitFor(component.unit);

    if (unit !== null) {
      return {
        type: 'frequency',
        value: component.value,
        unit,
      };
    }
  }

  c.restore(start);
  return null;
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
