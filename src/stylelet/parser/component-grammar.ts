import type { ComponentCursor } from './component-cursor';
import {
  isBad, ok, type ComponentConsumerBad, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from './component-try-consumer';
import { consumeComponentTrivia } from './syntax';
import { TokenKind } from './tokens';

// =============================================================================
// Consumer and multiplier types
// =============================================================================

type OptionalValue<T> = [] | [T];
type NonEmptyArray<T> = [T, ...T[]];

type Tuple<T, Length extends number, Result extends T[] = []> =
  number extends Length
    ? T[]
    : Result['length'] extends Length
      ? Result
      : Tuple<T, Length, [...Result, T]>;

type AtLeast<T, Minimum extends number> =
  Minimum extends 0 ? T[] :
  Minimum extends 1 ? [T, ...T[]] :
  Minimum extends 2 ? [T, T, ...T[]] :
  Minimum extends 3 ? [T, T, T, ...T[]] :
  Minimum extends 4 ? [T, T, T, T, ...T[]] :
  T[];

type Multiplier<T, Output extends T[] = T[]> = TryComponentConsumer<Output> & {
  base: TryComponentConsumer<T>;
  min: number;
  max: number;
  separator: 'none' | 'comma';
  contextAfter?: ContextAfter<T>;
};

type MultiplierOptions<T> = {
  contextAfter?: ContextAfter<T>;
};

type ContextAfter<T> =
  (value: T, context: unknown) => unknown;

type SequenceValue<P extends readonly AnyMultiplier[]> = {
  -readonly [I in keyof P]: MultiplierOutputOf<P[I]>;
};

type AllOfValue<P extends readonly AnyMultiplier[]> = SequenceValue<P>;

type SomeOfValue<P extends readonly AnyMultiplier[]> = {
  -readonly [I in keyof P]: MultiplierOutputOf<P[I]> | undefined;
};

type AlternativeValue<P extends readonly AnyMultiplier[]> =
  MultiplierOutputOf<P[number]>;

type AnyMultiplier = Multiplier<any, any>;

type MultiplierOutputOf<P> =
  P extends Multiplier<any, infer Output> ? Output : never;

type Projector<Value, R> =
  (value: Value, context: unknown) => TryComponentConsumerResult<R>;

// =============================================================================
// Structural grammar combinators
// =============================================================================

/**
 * CSS value juxtaposition: `a b`
 */
export function sequenceOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SequenceValue<P>, R>,
): TryComponentConsumer<R> {
  return tryConsumeSequenceOf(false, consumers, project);
}

/**
 * CSS value required group: `[ a b c ]!`
 */
export function requiredSequenceOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SequenceValue<P>, R>,
): TryComponentConsumer<R> {
  return tryConsumeSequenceOf(true, consumers, project);
}

// Local multiplier backtracking for direct sequence slots only. Nested consumers
// remain opaque; their internal multipliers are not re-entered.
function tryConsumeSequenceOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  consumers: P,
  project: Projector<SequenceValue<P>, R>,
): TryComponentConsumer<R> {
  return (c): TryComponentConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;
    let caps = consumers.map((consumer) => consumer.max);

    try {
      while (true) {
        c.restore(start);
        c.context = outerContext;

        const attempt = __consumeSequenceAttempt(c, consumers, caps, outerContext);

        if ('kind' in attempt && isBad(attempt)) {
          return attempt;
        }

        if (attempt.matched) {
          const raw = attempt.values as SequenceValue<P>;

          if (!requireAnyValue || hasAnyValue(raw)) {
            const projected = project(raw, c.context);

            if (projected === null) {
              // Try the next cap set.
            } else {
              return projected;
            }
          }
        }

        const nextCaps = __nextSequenceCaps(consumers, attempt.frames);

        if (nextCaps === null) {
          c.restore(start);
          return null;
        }

        caps = nextCaps;
      }
    } finally {
      c.context = outerContext;
    }
  };
}

/**
 * CSS value alternative: `a | b`
 */
export function oneOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<AlternativeValue<P>, R>,
): TryComponentConsumer<R> {
  return (c): TryComponentConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      for (const consumer of consumers) {
        c.restore(start);
        c.context = outerContext;

        const componentStart = c.pos();
        const result = consumeMultiplier(c, consumer);

        if (result === null) {
          c.restore(start);
          c.context = outerContext;
          continue;
        }

        if (isBad(result)) {
          return result;
        }

        const value = result.value as AlternativeValue<P>;

        if (c.pos() === componentStart && hasAnyValue(value)) {
          return c.error('Alternative consumer produced a value without consuming input');
        }

        const projected = project(value, c.context);

        if (projected === null) {
          c.restore(start);
          c.context = outerContext;
          continue;
        }

        return projected;
      }

      c.restore(start);
      return null;
    } finally {
      c.context = outerContext;
    }
  };
}

/**
 * CSS value double ampersand: `a && b`
 */
export function allOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<AllOfValue<P>, R>,
): TryComponentConsumer<R> {
  return tryConsumeAllOf(false, consumers, project);
}

/**
 * CSS value required double ampersand group: `[ a && b ]!`
 */
export function requiredAllOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<AllOfValue<P>, R>,
): TryComponentConsumer<R> {
  return tryConsumeAllOf(true, consumers, project);
}

function tryConsumeAllOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  consumers: P,
  project: Projector<AllOfValue<P>, R>,
): TryComponentConsumer<R> {
  return (c): TryComponentConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consumeUnordered(c, consumers);

      if ('kind' in result && isBad(result)) {
        return result;
      }

      for (let i = 0; i < consumers.length; i++) {
        if (result.seen.has(i)) {
          continue;
        }

        const empty = consumeEmpty(c, consumers[i]!);

        if (empty === null) {
          c.restore(start);
          return null;
        }

        if (isBad(empty)) {
          return empty;
        }

        result.values[i] = empty.value;
      }

      const raw = result.values as AllOfValue<P>;

      if (requireAnyValue && !hasAnyValue(raw)) {
        c.restore(start);
        return null;
      }

      const projected = project(raw, c.context);

      if (projected === null) {
        c.restore(start);
        return null;
      }

      return projected;
    } finally {
      c.context = outerContext;
    }
  };
}

/**
 * CSS value double bar: `a || b`
 */
export function someOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SomeOfValue<P>, R>,
): TryComponentConsumer<R> {
  return tryConsumeSomeOf(false, consumers, project);
}

/**
 * CSS value required double bar group: `[ a || b ]!`
 */
export function requiredSomeOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SomeOfValue<P>, R>,
): TryComponentConsumer<R> {
  return tryConsumeSomeOf(true, consumers, project);
}

function tryConsumeSomeOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  consumers: P,
  project: Projector<SomeOfValue<P>, R>,
): TryComponentConsumer<R> {
  return (c): TryComponentConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consumeUnordered(c, consumers);

      if ('kind' in result && isBad(result)) {
        return result;
      }

      const hasConsumedValue = hasAnyValue(result.values);

      let canMatchEmpty = true;

      for (let i = 0; i < consumers.length; i++) {
        if (result.seen.has(i)) {
          continue;
        }

        const empty = consumeEmpty(c, consumers[i]!);

        if (empty === null) {
          canMatchEmpty = false;
          continue;
        }

        if (isBad(empty)) {
          return empty;
        }

        result.values[i] = empty.value;
      }

      const raw = result.values as SomeOfValue<P>;

      if ((!hasConsumedValue && !canMatchEmpty) || (requireAnyValue && !hasAnyValue(raw))) {
        c.restore(start);
        return null;
      }

      const projected = project(raw, c.context);

      if (projected === null) {
        c.restore(start);
        return null;
      }

      return projected;
    } finally {
      c.context = outerContext;
    }
  };
}

// =============================================================================
// Required consumer adapter
// =============================================================================

export type ComponentConsumer<T> = (c: ComponentCursor) => T;

export function required<T>(
  consume: TryComponentConsumer<T>,
  expected: string,
): ComponentConsumer<T> {
  return (c): T => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consume(c);

      if (result === null) {
        c.restore(start);
        return c.error(expected);
      }

      if (isBad(result)) {
        return c.error(result.message ?? result.reason);
      }

      return result.value;
    } finally {
      c.context = outerContext;
    }
  };
}

// =============================================================================
// Multiplicity constructors
// =============================================================================

export const DEFAULT_REPEAT_LIMIT = 20;

/**
 * CSS value default multiplicity: `a`.
 */
export function one<T>(
  consumer: TryComponentConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, [T]> {
  return createMultiplier<T, [T]>(consumer, 1, 1, 'none', options);
}

/**
 * CSS value optional multiplicity: `a?`.
 */
export function opt<T>(
  consumer: TryComponentConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, OptionalValue<T>> {
  return createMultiplier<T, OptionalValue<T>>(consumer, 0, 1, 'none', options);
}

/**
 * CSS value zero-or-more multiplicity: `a*`.
 */
export function any<T>(
  consumer: TryComponentConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, T[]> {
  return createMultiplier<T, T[]>(consumer, 0, DEFAULT_REPEAT_LIMIT, 'none', options);
}

/**
 * CSS value one-or-more multiplicity: `a+`.
 */
export function plus<T>(
  consumer: TryComponentConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, NonEmptyArray<T>> {
  return createMultiplier<T, NonEmptyArray<T>>(consumer, 1, DEFAULT_REPEAT_LIMIT, 'none', options);
}

/**
 * CSS value bounded repetition: `a{min,max}`.
 *
 * The consumer is greedy. Backtracking support can later be attached here by
 * exposing repetition choices without changing the public shape.
 */
export function repeat<T, const Count extends number>(item: TryComponentConsumer<T>, min: Count, max: NoInfer<Count>, options?: MultiplierOptions<T>): Multiplier<T, Tuple<T, Count>>;
export function repeat<T, const Minimum extends number>(item: TryComponentConsumer<T>, min: Minimum, max?: number, options?: MultiplierOptions<T>): Multiplier<T, AtLeast<T, Minimum>>;
export function repeat<T, Output extends T[]>(item: TryComponentConsumer<T>, min: number, max = DEFAULT_REPEAT_LIMIT, options?: MultiplierOptions<T>): Multiplier<T, Output> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid repeat maximum ${max}`);
  }

  return createMultiplier<T, Output>(item, min, max, 'none', options);
}

/**
 * CSS value comma multiplier: `a#` / `a#{min,max}`.
 */
export function commaRepeat<T>(item: TryComponentConsumer<T>, options?: MultiplierOptions<T>): Multiplier<T, NonEmptyArray<T>>;
export function commaRepeat<T, const Count extends number>(item: TryComponentConsumer<T>, min: Count, max: NoInfer<Count>, options?: MultiplierOptions<T>): Multiplier<T, Tuple<T, Count>>;
export function commaRepeat<T, const Minimum extends number>(item: TryComponentConsumer<T>, min: Minimum, max?: number, options?: MultiplierOptions<T>): Multiplier<T, AtLeast<T, Minimum>>;
export function commaRepeat<T, Output extends T[]>(item: TryComponentConsumer<T>, minOrOptions: number | MultiplierOptions<T> = 1, max = DEFAULT_REPEAT_LIMIT, options?: MultiplierOptions<T>): Multiplier<T, Output> {
  const min =
    typeof minOrOptions === 'number'
      ? minOrOptions
      : 1;

  const resolvedOptions =
    typeof minOrOptions === 'number'
      ? options
      : minOrOptions;

  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid comma repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid comma repeat maximum ${max}`);
  }

  return createMultiplier<T, Output>(
    item,
    min,
    max,
    'comma',
    resolvedOptions,
  );
}

function createMultiplier<T, Output extends T[]>(
  base: TryComponentConsumer<T>,
  min: number,
  max: number,
  separator: 'none' | 'comma',
  options?: MultiplierOptions<T>,
): Multiplier<T, Output> {
  const multiplier = ((c: ComponentCursor): TryComponentConsumerResult<Output> => {
    return consumeMultiplier(c, multiplier);
  }) as Multiplier<T, Output>;

  multiplier.base = base;
  multiplier.min = min;
  multiplier.max = max;
  multiplier.separator = separator;
  multiplier.contextAfter = options?.contextAfter;

  return multiplier;
}

// =============================================================================
// Consumer adapters
// =============================================================================

export function withComponentTrivia<T>(consume: TryComponentConsumer<T>): TryComponentConsumer<T> {
  return (c) => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      consumeComponentTrivia(c);

      const result = consume(c);

      if (result === null) {
        c.restore(start);
        return null;
      }

      return result;
    } finally {
      c.context = outerContext;
    }
  };
}

// =============================================================================
// Grammar execution helpers
// =============================================================================

function consumeMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): TryComponentConsumerResult<Output> {
  // TODO: Consider consuming through the multiplier after a bad item while retaining
  // the first bad result, so recovery can resume at the multiplier boundary.
  return multiplier.separator === 'comma'
    ? consumeCommaMultiplier(c, multiplier, max)
    : consumePlainMultiplier(c, multiplier, max);
}

function consumePlainMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): TryComponentConsumerResult<Output> {
  const start = c.pos();
  const outerContext = c.context;
  const values: T[] = [];

  while (values.length < max) {
    const itemStart = c.pos();
    const itemContext = c.context;
    const result = multiplier.base(c);

    if (result === null) {
      c.restore(itemStart);
      c.context = itemContext;
      break;
    }

    if (isBad(result)) {
      c.context = outerContext;
      return result;
    }

    if (c.pos() === itemStart) {
      c.context = outerContext;
      return c.error('Repeated consumer matched without consuming input');
    }

    values.push(result.value);

    c.context = multiplier.contextAfter === undefined
      ? itemContext
      : multiplier.contextAfter(result.value, itemContext);
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    c.context = outerContext;
    return null;
  }

  return ok(values as Output);
}

function consumeCommaMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): TryComponentConsumerResult<Output> {
  const start = c.pos();
  const outerContext = c.context;
  const values: T[] = [];

  if (max === 0) {
    return multiplier.min === 0
      ? ok([] as unknown as Output)
      : null;
  }

  const consumeItem = (): TryComponentConsumerResult<T> => {
    const itemStart = c.pos();
    const itemContext = c.context;
    const result = multiplier.base(c);

    if (result === null) {
      c.restore(itemStart);
      c.context = itemContext;
      return null;
    }

    if (isBad(result)) {
      c.context = outerContext;
      return result;
    }

    if (c.pos() === itemStart) {
      c.context = outerContext;
      return c.error('Comma repeat matched without consuming input');
    }

    c.context = multiplier.contextAfter === undefined
      ? itemContext
      : multiplier.contextAfter(result.value, itemContext);

    return result;
  };

  const first = consumeItem();

  if (first === null) {
    c.context = outerContext;

    if (multiplier.min === 0) {
      return ok([] as unknown as Output);
    }

    c.restore(start);
    return null;
  }

  if (isBad(first)) {
    return first;
  }

  values.push(first.value);

  while (values.length < max) {
    const separatorStart = c.pos();

    consumeComponentTrivia(c);

    if (!c.match(TokenKind.Comma)) {
      c.restore(separatorStart);
      break;
    }

    consumeComponentTrivia(c);

    const next = consumeItem();

    if (next === null) {
      c.restore(separatorStart);
      break;
    }

    if (isBad(next)) {
      return next;
    }

    values.push(next.value);
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    c.context = outerContext;
    return null;
  }

  return ok(values as Output);
}

function consumeEmpty<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
): TryComponentConsumerResult<Output> {
  const start = c.pos();
  const outerContext = c.context;

  const result = consumeMultiplier(c, multiplier);
  const end = c.pos();

  if (isBad(result)) {
    return result;
  }

  c.restore(start);
  c.context = outerContext;

  if (result === null || end !== start) {
    return null;
  }

  if (hasAnyValue(result.value)) {
    return c.error('Consumer produced a value without consuming input');
  }

  return result;
}

type UnorderedConsumeResult =
  | ComponentConsumerBad
  | { values: unknown[]; seen: Set<number>; };

function consumeUnordered<const P extends readonly AnyMultiplier[]>(
  c: ComponentCursor,
  consumers: P,
): UnorderedConsumeResult {
  const remaining = consumers.map((consumer, index) => ({ consumer, index }));
  const values: unknown[] = Array.from({ length: consumers.length });
  const seen = new Set<number>();

  while (remaining.length > 0) {
    let matchedIndex = -1;
    let matchedValue: unknown;

    for (let i = 0; i < remaining.length; i++) {
      const part = remaining[i]!;
      const start = c.pos();
      const outerContext = c.context;
      const result = consumeMultiplier(c, part.consumer);

      if (result === null) {
        c.restore(start);
        c.context = outerContext;
        continue;
      }

      if (isBad(result)) {
        c.context = outerContext;
        return result;
      }

      const value = result.value as unknown;

      if (c.pos() === start && !hasAnyValue(value)) {
        c.restore(start);
        c.context = outerContext;
        continue;
      }

      if (c.pos() === start && hasAnyValue(value)) {
        c.context = outerContext;
        return c.error('Unordered consumer produced a value without consuming input');
      }

      c.context = outerContext;

      matchedIndex = i;
      matchedValue = value;
      break;
    }

    if (matchedIndex === -1) {
      break;
    }

    const matched = remaining[matchedIndex]!;

    remaining.splice(matchedIndex, 1);
    seen.add(matched.index);
    values[matched.index] = matchedValue;
  }

  return { values, seen };
}

function hasAnyValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasAnyValue);
  }

  if (value && typeof value === 'object') {
    const values = Object.values(value);
    return values.length > 0 && values.some(hasAnyValue);
  }

  return value !== null && value !== undefined;
}

// =============================================================================
// Backtracking support
// =============================================================================

type SequenceFrame = {
  start: number;
  values: unknown[];
};

type SequenceAttempt =
  | ComponentConsumerBad
  | { matched: boolean; values: unknown[]; frames: SequenceFrame[]; };

export function __consumeSequenceAttempt<const P extends readonly AnyMultiplier[]>(
  c: ComponentCursor,
  consumers: P,
  caps: readonly number[],
  context: unknown = c.context,
): SequenceAttempt {
  c.context = context;

  const values: unknown[] = [];
  const frames: SequenceFrame[] = [];

  for (let i = 0; i < consumers.length; i++) {
    const consumer = consumers[i]!;
    const slotStart = c.pos();
    const result = consumeMultiplier(c, consumer, caps[i]);

    if (result === null) {
      c.restore(slotStart);
      c.context = context;

      return {
        matched: false,
        values,
        frames,
      };
    }

    if (isBad(result)) {
      c.context = context;
      return result;
    }

    const value = result.value as unknown;

    if (c.pos() === slotStart && hasAnyValue(value)) {
      c.context = context;
      return c.error('Sequence consumer produced a value without consuming input');
    }

    values[i] = value;
    frames[i] = {
      start: slotStart,
      values: value as unknown[],
    };
  }

  return {
    matched: true,
    values,
    frames,
  };
}

export function __nextSequenceCaps<const P extends readonly AnyMultiplier[]>(
  consumers: P,
  frames: readonly SequenceFrame[],
): number[] | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const consumer = consumers[i]!;
    const frame = frames[i]!;
    const nextCap = frame.values.length - 1;

    if (nextCap < consumer.min) {
      continue;
    }

    const caps = consumers.map((consumer) => consumer.max);

    for (let j = 0; j < i; j++) {
      caps[j] = frames[j]!.values.length;
    }

    caps[i] = nextCap;

    return caps;
  }

  return null;
}
