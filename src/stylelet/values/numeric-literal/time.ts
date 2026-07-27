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
 * <time> = <dimension-token with a time unit>
 */

export type TimeLiteral = DimensionLiteral<'time', TimeUnit>;

export type CanonicalTimeLiteral = DimensionLiteral<'time', 's'>;

export const TIME_UNITS = ['s', 'ms'] as const;

export type TimeUnit = (typeof TIME_UNITS)[number];

export function parseTime(
  input: ParserInput,
  context: unknown = undefined,
): TimeLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeTime),
      context,
    ),
    'time',
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

  return (c): TryComponentConsumerResult<TimeLiteral> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedTime(c);

    if (result === null || isBad(result)) {
      return result;
    }

    const canonical = resolveTime(result.value);

    if (canonical.value < min || canonical.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

export const tryConsumeTime = createTimeConsumer();

function tryConsumeUnrestrictedTime(
  c: ComponentCursor,
): TryComponentConsumerResult<TimeLiteral> {
  const start = c.pos();
  const component = c.next();

  if (isTokenKind(component, TokenKind.Dimension)) {
    const unit = timeUnitFor(component.unit);

    if (unit !== null) {
      return ok({
        type: 'time',
        value: component.value,
        unit,
      });
    }
  }

  c.restore(start);
  return null;
}

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

export function resolveTime(value: TimeLiteral): CanonicalTimeLiteral {
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
