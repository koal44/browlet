import { type TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
import { isWhitespaceToken } from './component-value';
import { TokenKind } from './tokens';

// =============================================================================
// Consumer and multiplier types
// =============================================================================

type OptionalValue<T> = [] | [T];
type NonEmptyArray<T> = [T, ...T[]];

type Tuple<T, Length extends number, Result extends T[] = []> =
  number extends Length ? T[] :
  Result['length'] extends Length ? Result :
  Tuple<T, Length, [...Result, T]>;

type AtLeast<T, Minimum extends number> =
  Minimum extends 0 ? T[] :
  Minimum extends 1 ? [T, ...T[]] :
  Minimum extends 2 ? [T, T, ...T[]] :
  Minimum extends 3 ? [T, T, T, ...T[]] :
  Minimum extends 4 ? [T, T, T, T, ...T[]] :
  T[];

type Multiplier<T, Output extends T[] = T[]> = TryConsumer<Output> & {
  base: TryConsumer<T>;
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
  (value: Value, context: unknown) => TryConsumerResult<R>;

// =============================================================================
// Structural grammar combinators
// =============================================================================

/**
 * CSS value juxtaposition: `a b`
 *
 * Multipliers are greedy. Callers must factor productions where an earlier
 * multiplier can consume input required by a later component.
 */
export function sequenceOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SequenceValue<P>, R>,
): TryConsumer<R> {
  return consumeSequenceOf(false, consumers, project);
}

/**
 * CSS value required group: `[ a b c ]!`
 *
 * Shares the greedy multiplier behavior of `sequenceOf`.
 */
export function requiredSequenceOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SequenceValue<P>, R>,
): TryConsumer<R> {
  return consumeSequenceOf(true, consumers, project);
}

function consumeSequenceOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  consumers: P,
  project: Projector<SequenceValue<P>, R>,
): TryConsumer<R> {
  return (c): TryConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const values: unknown[] = [];

      for (const consumer of consumers) {
        const slotStart = c.pos();
        const result: unknown = consumeMultiplier(c, consumer);

        if (result === null) {
          c.restore(start);
          return null;
        }

        if (c.pos() === slotStart && hasMultiplierValue(result)) {
          return c.error('Sequence consumer produced a value without consuming input');
        }

        values.push(result);
      }

      const raw = values as SequenceValue<P>;

      if (requireAnyValue && !hasMultiplierValue(raw)) {
        c.restore(start);
        return null;
      }

      const projection = project(raw, c.context);

      if (projection === null) {
        c.restore(start);
      }

      return projection;
    } finally {
      c.context = outerContext;
    }
  };
}

/**
 * CSS value alternative: `a | b`
 *
 * Alternatives are tried in order and commit to the first success. Callers
 * must factor productions where one alternative can accept a prefix of another.
 */
export function oneOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<AlternativeValue<P>, R>,
): TryConsumer<R> {
  return (c): TryConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      for (const consumer of consumers) {
        c.restore(start);
        c.context = outerContext;

        const componentStart = c.pos();
        const result: unknown = consumeMultiplier(c, consumer);

        if (result === null) {
          c.restore(start);
          c.context = outerContext;
          continue;
        }

        const value = result as AlternativeValue<P>;

        if (c.pos() === componentStart && hasMultiplierValue(value)) {
          return c.error('Alternative consumer produced a value without consuming input');
        }

        const projection = project(value, c.context);

        if (projection === null) {
          c.restore(start);
          c.context = outerContext;
          continue;
        }

        return projection;
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
 *
 * Components are tried in declaration order. Callers must factor productions
 * whose components can consume the same leading input.
 */
export function allOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<AllOfValue<P>, R>,
): TryConsumer<R> {
  return consumeAllOf(false, consumers, project);
}

/**
 * CSS value required double ampersand group: `[ a && b ]!`
 *
 * Shares the overlapping-component constraint of `allOf`.
 */
export function requiredAllOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<AllOfValue<P>, R>,
): TryConsumer<R> {
  return consumeAllOf(true, consumers, project);
}

function consumeAllOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  consumers: P,
  project: Projector<AllOfValue<P>, R>,
): TryConsumer<R> {
  return (c): TryConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consumeUnordered(c, consumers);

      for (let i = 0; i < consumers.length; i++) {
        if (result.seen.has(i)) {
          continue;
        }

        const empty: unknown = consumeEmpty(c, consumers[i]!);

        if (empty === null) {
          c.restore(start);
          return null;
        }

        result.values[i] = empty;
      }

      const raw = result.values as AllOfValue<P>;

      if (requireAnyValue && !hasMultiplierValue(raw)) {
        c.restore(start);
        return null;
      }

      const projection = project(raw, c.context);

      if (projection === null) {
        c.restore(start);
        return null;
      }

      return projection;
    } finally {
      c.context = outerContext;
    }
  };
}

/**
 * CSS value double bar: `a || b`
 *
 * Components are tried in declaration order. Callers must factor productions
 * whose components can consume the same leading input.
 */
export function someOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SomeOfValue<P>, R>,
): TryConsumer<R> {
  return consumeSomeOf(false, consumers, project);
}

/**
 * CSS value required double bar group: `[ a || b ]!`
 *
 * Shares the overlapping-component constraint of `someOf`.
 */
export function requiredSomeOf<const P extends readonly AnyMultiplier[], R>(
  consumers: P,
  project: Projector<SomeOfValue<P>, R>,
): TryConsumer<R> {
  return consumeSomeOf(true, consumers, project);
}

function consumeSomeOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  consumers: P,
  project: Projector<SomeOfValue<P>, R>,
): TryConsumer<R> {
  return (c): TryConsumerResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consumeUnordered(c, consumers);

      const hasConsumedValue = hasMultiplierValue(result.values);

      let canMatchEmpty = true;

      for (let i = 0; i < consumers.length; i++) {
        if (result.seen.has(i)) {
          continue;
        }

        const empty: unknown = consumeEmpty(c, consumers[i]!);

        if (empty === null) {
          canMatchEmpty = false;
          continue;
        }

        result.values[i] = empty;
      }

      const raw = result.values as SomeOfValue<P>;

      if ((!hasConsumedValue && !canMatchEmpty) || (requireAnyValue && !hasMultiplierValue(raw))) {
        c.restore(start);
        return null;
      }

      const projection = project(raw, c.context);

      if (projection === null) {
        c.restore(start);
        return null;
      }

      return projection;
    } finally {
      c.context = outerContext;
    }
  };
}

// =============================================================================
// Required consumer adapter
// =============================================================================

type RequiredComponentConsumer<T> = (c: TokenCursor) => T;

export function required<T>(
  consume: TryConsumer<T>,
  expected: string,
): RequiredComponentConsumer<T> {
  return (c): T => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consume(c);

      if (result === null) {
        c.restore(start);
        return c.error(expected);
      }

      return result;
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
  consumer: TryConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, [T]> {
  return createMultiplier<T, [T]>(consumer, 1, 1, 'none', options);
}

/**
 * CSS value optional multiplicity: `a?`.
 */
export function opt<T>(
  consumer: TryConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, OptionalValue<T>> {
  return createMultiplier<T, OptionalValue<T>>(consumer, 0, 1, 'none', options);
}

/**
 * CSS value zero-or-more multiplicity: `a*`.
 */
export function any<T>(
  consumer: TryConsumer<T>,
  options?: MultiplierOptions<T>,
): Multiplier<T, T[]> {
  return createMultiplier<T, T[]>(consumer, 0, DEFAULT_REPEAT_LIMIT, 'none', options);
}

/**
 * CSS value one-or-more multiplicity: `a+`.
 */
export function plus<T>(
  consumer: TryConsumer<T>,
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
export function repeat<T, const Count extends number>(item: TryConsumer<T>, min: Count, max: NoInfer<Count>, options?: MultiplierOptions<T>): Multiplier<T, Tuple<T, Count>>;
export function repeat<T, const Minimum extends number>(item: TryConsumer<T>, min: Minimum, max?: number, options?: MultiplierOptions<T>): Multiplier<T, AtLeast<T, Minimum>>;
export function repeat<T, Output extends T[]>(item: TryConsumer<T>, min: number, max = DEFAULT_REPEAT_LIMIT, options?: MultiplierOptions<T>): Multiplier<T, Output> {
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
export function commaRepeat<T>(item: TryConsumer<T>, options?: MultiplierOptions<T>): Multiplier<T, NonEmptyArray<T>>;
export function commaRepeat<T, const Count extends number>(item: TryConsumer<T>, min: Count, max: NoInfer<Count>, options?: MultiplierOptions<T>): Multiplier<T, Tuple<T, Count>>;
export function commaRepeat<T, const Minimum extends number>(item: TryConsumer<T>, min: Minimum, max?: number, options?: MultiplierOptions<T>): Multiplier<T, AtLeast<T, Minimum>>;
export function commaRepeat<T, Output extends T[]>(item: TryConsumer<T>, minOrOptions: number | MultiplierOptions<T> = 1, max = DEFAULT_REPEAT_LIMIT, options?: MultiplierOptions<T>): Multiplier<T, Output> {
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
  base: TryConsumer<T>,
  min: number,
  max: number,
  separator: 'none' | 'comma',
  options?: MultiplierOptions<T>,
): Multiplier<T, Output> {
  const multiplier = ((c: TokenCursor): TryConsumerResult<Output> => {
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

export type AdaptConsumerOptions = {
  /** Requires consumption through eof (trailing trivia allowed). */
  complete?: boolean;
};

/**
 * Adapts a consumer to project an alternative result.
 *
 * The `complete` option requires consumption through eof.
 */
export function adaptConsumer<Input, Output>(
  consume: TryConsumer<Input>,
  projector: Projector<Input, Output>,
  options: AdaptConsumerOptions = {},
): TryConsumer<Output> {
  return (c): TryConsumerResult<Output> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consume(c);

      if (result === null) {
        c.restore(start);
        return null;
      }

      if (options.complete) {
        c.consumeWhile(isWhitespaceToken);

        if (c.peek().type !== TokenKind.EOF) {
          c.restore(start);
          return null;
        }
      }

      const projection = projector(result, c.context);

      if (projection === null) {
        c.restore(start);
      }

      return projection;
    } finally {
      c.context = outerContext;
    }
  };
}

export function withTrivia<T>(consume: TryConsumer<T>): TryConsumer<T> {
  return (c) => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      c.consumeWhile(isWhitespaceToken);

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
// Recursive grammar construction
// =============================================================================

/**
 * Builds a recursive grammar around a stable reference to its own consumer.
 * A recursive branch must consume input or enter a nested component cursor
 * before invoking that reference again.
 */
export function recursive<T>(
  create: (self: TryConsumer<T>) => TryConsumer<T>,
): TryConsumer<T> {
  const reference: {
    consume?: TryConsumer<T>;
  } = {};

  const self: TryConsumer<T> = (c) => {
    const consume = reference.consume;

    if (consume === undefined) {
      throw new Error('Recursive consumer used during construction');
    }

    return consume(c);
  };

  reference.consume = create(self);

  return self;
}

// =============================================================================
// Grammar execution helpers
// =============================================================================

function consumeMultiplier<T, Output extends T[]>(
  c: TokenCursor,
  multiplier: Multiplier<T, Output>,
): TryConsumerResult<Output> {
  return multiplier.separator === 'comma'
    ? consumeCommaMultiplier(c, multiplier)
    : consumePlainMultiplier(c, multiplier);
}

function consumePlainMultiplier<T, Output extends T[]>(
  c: TokenCursor,
  multiplier: Multiplier<T, Output>,
): TryConsumerResult<Output> {
  const start = c.pos();
  const outerContext = c.context;
  const values: T[] = [];

  while (values.length < multiplier.max) {
    const itemStart = c.pos();
    const itemContext = c.context;
    const result = multiplier.base(c);

    if (result === null) {
      c.restore(itemStart);
      c.context = itemContext;
      break;
    }

    if (c.pos() === itemStart) {
      c.context = outerContext;
      return c.error('Repeated consumer matched without consuming input');
    }

    values.push(result);

    c.context = multiplier.contextAfter === undefined
      ? itemContext
      : multiplier.contextAfter(result, itemContext);
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    c.context = outerContext;
    return null;
  }

  return values as Output;
}

function consumeCommaMultiplier<T, Output extends T[]>(
  c: TokenCursor,
  multiplier: Multiplier<T, Output>,
): TryConsumerResult<Output> {
  const start = c.pos();
  const outerContext = c.context;
  const values: T[] = [];

  if (multiplier.max === 0) {
    return multiplier.min === 0
      ? [] as unknown as Output
      : null;
  }

  const consumeItem = (): TryConsumerResult<T> => {
    const itemStart = c.pos();
    const itemContext = c.context;
    const result = multiplier.base(c);

    if (result === null) {
      c.restore(itemStart);
      c.context = itemContext;
      return null;
    }

    if (c.pos() === itemStart) {
      c.context = outerContext;
      return c.error('Comma repeat matched without consuming input');
    }

    c.context = multiplier.contextAfter === undefined
      ? itemContext
      : multiplier.contextAfter(result, itemContext);

    return result;
  };

  const first = consumeItem();

  if (first === null) {
    c.context = outerContext;

    if (multiplier.min === 0) {
      return [] as unknown as Output;
    }

    c.restore(start);
    return null;
  }

  values.push(first);

  while (values.length < multiplier.max) {
    const separatorStart = c.pos();

    c.consumeWhile(isWhitespaceToken);

    if (!c.match(TokenKind.Comma)) {
      c.restore(separatorStart);
      break;
    }

    c.consumeWhile(isWhitespaceToken);

    const next = consumeItem();

    if (next === null) {
      c.restore(separatorStart);
      break;
    }

    values.push(next);
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    c.context = outerContext;
    return null;
  }

  return values as Output;
}

function consumeEmpty<T, Output extends T[]>(
  c: TokenCursor,
  multiplier: Multiplier<T, Output>,
): TryConsumerResult<Output> {
  const start = c.pos();
  const outerContext = c.context;

  const result = consumeMultiplier(c, multiplier);
  const end = c.pos();

  c.restore(start);
  c.context = outerContext;

  if (result === null || end !== start) {
    return null;
  }

  if (hasMultiplierValue(result)) {
    return c.error('Consumer produced a value without consuming input');
  }

  return result;
}

type UnorderedConsumeResult = {
  values: unknown[];
  seen: Set<number>;
};

function consumeUnordered<const P extends readonly AnyMultiplier[]>(
  c: TokenCursor,
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
      const result: unknown = consumeMultiplier(c, part.consumer);

      if (result === null) {
        c.restore(start);
        c.context = outerContext;
        continue;
      }

      const value = result as unknown;

      if (c.pos() === start && !hasMultiplierValue(value)) {
        c.restore(start);
        c.context = outerContext;
        continue;
      }

      if (c.pos() === start && hasMultiplierValue(value)) {
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

function hasMultiplierValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasMultiplierValue);
  }

  if (value && typeof value === 'object') {
    const values = Object.values(value);
    return values.length > 0 && values.some(hasMultiplierValue);
  }

  return value !== null && value !== undefined;
}
