import { asciiLower } from '../../../shared/css';
import { assertNever } from '../../../shared/util';
import { tryConsumeDimensionToken } from '../../parser/component-consumers';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { dimensionLiteral, serializeDimension, type DimensionLiteral } from './dimension';

/*
 * <time> = <dimension-token with a time unit>
 */

export type TimeLiteral = DimensionLiteral<'time', TimeUnit>;

export type CanonicalTimeLiteral = DimensionLiteral<'time', 's'>;

export const TIME_UNITS = ['s', 'ms'] as const;

export type TimeUnit = (typeof TIME_UNITS)[number];

export function timeLiteral(value: number): CanonicalTimeLiteral;
export function timeLiteral<Unit extends TimeUnit>(
  value: number,
  unit: Unit,
): DimensionLiteral<'time', Unit>;
export function timeLiteral(
  value: number,
  unit: TimeUnit = 's',
): TimeLiteral {
  return dimensionLiteral('time', value, unit);
}

export function parseTime(
  input: ParserInput,
  context: unknown = undefined,
): TimeLiteral | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeTime),
    context,
  );
}

export type TimeConsumerOptions = {
  /** Inclusive lower bound in canonical seconds. */
  min?: number;

  /** Inclusive upper bound in canonical seconds. */
  max?: number;
};

export function createTimeConsumer(
  options: TimeConsumerOptions = {},
): TryComponentConsumer<TimeLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return adaptConsumer(tryConsumeDimensionToken, (component) => {
    const unit = timeUnitFor(component.unit);

    if (unit === null) return null;

    const result: TimeLiteral = {
      type: 'time',
      value: component.value,
      unit,
    };
    const canonical = canonicalizeTime(result);

    return canonical.value < min || canonical.value > max
      ? null
      : result;
  });
}

export const tryConsumeTime = createTimeConsumer();

function timeUnitFor(raw: string): TimeUnit | null {
  const normalized = asciiLower(raw);

  return isTimeUnit(normalized)
    ? normalized
    : null;
}

function isTimeUnit(value: string): value is TimeUnit {
  return TIME_UNITS.some((unit) => unit === value);
}

export function serializeTime(value: TimeLiteral): string {
  return serializeDimension(value);
}

export function serializeCanonicalTime(value: CanonicalTimeLiteral): string {
  return serializeDimension(value);
}

export function canonicalizeTime(value: TimeLiteral): CanonicalTimeLiteral {
  let seconds: number;

  switch (value.unit) {
    case 's':
      seconds = value.value;
      break;
    case 'ms':
      seconds = value.value / 1000;
      break;
    default:
      return assertNever(value.unit);
  }

  return {
    type: 'time',
    value: seconds,
    unit: 's',
  };
}
