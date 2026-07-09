import type { ComponentCursor } from './component-cursor';
import { isBad, ok, type TryComponentParserResult, type ComponentParserBad, type TryComponentParser } from './component-try-parser';
import { consumeComponentTrivia } from './syntax';
import { TokenKind } from './tokens';

// =============================================================================
// Public parser and multiplier types
// =============================================================================

export type OptionalValue<T> = [] | [T];
export type NonEmptyArray<T> = [T, ...T[]];

export type Multiplier<T, Output extends T[] = T[]> = TryComponentParser<Output> & {
  base: TryComponentParser<T>;
  min: number;
  max: number;
  separator: 'none' | 'comma';
  contextAfter?: ContextAfter<Output>;
};

type MultiplierOptions<Output> = {
  contextAfter?: ContextAfter<Output>;
};

type ContextAfter<Output> =
  (output: Output, context: unknown) => unknown;

type SequenceValue<P extends readonly AnyMultiplier[]> = {
  -readonly [I in keyof P]: MultiplierOutputOf<P[I]>;
};

type UnorderedValue<P extends readonly AnyMultiplier[]> = {
  -readonly [I in keyof P]: MultiplierOutputOf<P[I]> | undefined;
};

type AlternativeValue<P extends readonly AnyMultiplier[]> =
  MultiplierOutputOf<P[number]>;

type AnyMultiplier = Multiplier<any, any>;

type MultiplierOutputOf<P> =
  P extends Multiplier<any, infer Output> ? Output : never;

type Projector<Value, R> =
  (value: Value, context: unknown) => TryComponentParserResult<R>;

// =============================================================================
// Structural grammar combinators
// =============================================================================

/**
 * CSS value juxtaposition: `a b`
 */
export function sequenceOf<const P extends readonly AnyMultiplier[], R>(
  parsers: P,
  project: Projector<SequenceValue<P>, R>,
): TryComponentParser<R> {
  return parseSequenceOf(false, parsers, project);
}

/**
 * CSS value required group: `[ a b c ]!`
 */
export function requiredSequenceOf<const P extends readonly AnyMultiplier[], R>(
  parsers: P,
  project: Projector<SequenceValue<P>, R>,
): TryComponentParser<R> {
  return parseSequenceOf(true, parsers, project);
}

// Local multiplier backtracking for direct sequence slots only. Nested parsers
// remain opaque; their internal multipliers are not re-entered.
function parseSequenceOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  parsers: P,
  project: Projector<SequenceValue<P>, R>,
): TryComponentParser<R> {
  return (c): TryComponentParserResult<R> => {
    const start = c.pos();
    const outerContext = c.context;
    let caps = parsers.map((parser) => parser.max);

    try {
      while (true) {
        c.restore(start);
        c.context = outerContext;

        const attempt = __parseSequenceAttempt(c, parsers, caps, outerContext);

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

        const nextCaps = __nextSequenceCaps(parsers, attempt.frames);

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
  parsers: P,
  project: Projector<AlternativeValue<P>, R>,
): TryComponentParser<R> {
  return (c): TryComponentParserResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      for (const parser of parsers) {
        c.restore(start);
        c.context = outerContext;

        const componentStart = c.pos();
        const result = parseMultiplier(c, parser);

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
          return c.error('Alternative parser produced a value without consuming input');
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
  parsers: P,
  project: Projector<UnorderedValue<P>, R>,
): TryComponentParser<R> {
  return parseAllOf(false, parsers, project);
}

/**
 * CSS value required double ampersand group: `[ a && b ]!`
 */
export function requiredAllOf<const P extends readonly AnyMultiplier[], R>(
  parsers: P,
  project: Projector<UnorderedValue<P>, R>,
): TryComponentParser<R> {
  return parseAllOf(true, parsers, project);
}

function parseAllOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  parsers: P,
  project: Projector<UnorderedValue<P>, R>,
): TryComponentParser<R> {
  return (c): TryComponentParserResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consumeUnordered(c, parsers);

      if ('kind' in result && isBad(result)) {
        return result;
      }

      for (let i = 0; i < parsers.length; i++) {
        if (result.seen.has(i)) {
          continue;
        }

        const empty = parseEmpty(c, parsers[i]!);

        if (empty === null) {
          c.restore(start);
          return null;
        }

        if (isBad(empty)) {
          return empty;
        }

        result.values[i] = empty.value;
      }

      const raw = result.values as UnorderedValue<P>;

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
  parsers: P,
  project: Projector<UnorderedValue<P>, R>,
): TryComponentParser<R> {
  return parseSomeOf(false, parsers, project);
}

/**
 * CSS value required double bar group: `[ a || b ]!`
 */
export function requiredSomeOf<const P extends readonly AnyMultiplier[], R>(
  parsers: P,
  project: Projector<UnorderedValue<P>, R>,
): TryComponentParser<R> {
  return parseSomeOf(true, parsers, project);
}

function parseSomeOf<const P extends readonly AnyMultiplier[], R>(
  requireAnyValue: boolean,
  parsers: P,
  project: Projector<UnorderedValue<P>, R>,
): TryComponentParser<R> {
  return (c): TryComponentParserResult<R> => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = consumeUnordered(c, parsers);

      if ('kind' in result && isBad(result)) {
        return result;
      }

      const hasConsumedValue = hasAnyValue(result.values);

      let canMatchEmpty = true;

      for (let i = 0; i < parsers.length; i++) {
        if (result.seen.has(i)) {
          continue;
        }

        const empty = parseEmpty(c, parsers[i]!);

        if (empty === null) {
          canMatchEmpty = false;
          continue;
        }

        if (isBad(empty)) {
          return empty;
        }

        result.values[i] = empty.value;
      }

      const raw = result.values as UnorderedValue<P>;

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
// Required parser adapter
// =============================================================================

export type ValueParser<T> = (c: ComponentCursor) => T;

export function required<T>(
  parse: TryComponentParser<T>,
  expected: string,
): ValueParser<T> {
  return (c): T => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      const result = parse(c);

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
  parse: TryComponentParser<T>,
  options?: MultiplierOptions<[T]>,
): Multiplier<T, [T]> {
  return createMultiplier<T, [T]>(parse, 1, 1, 'none', options);
}

/**
 * CSS value optional multiplicity: `a?`.
 */
export function opt<T>(
  parse: TryComponentParser<T>,
  options?: MultiplierOptions<OptionalValue<T>>,
): Multiplier<T, OptionalValue<T>> {
  return createMultiplier<T, OptionalValue<T>>(parse, 0, 1, 'none', options);
}

/**
 * CSS value zero-or-more multiplicity: `a*`.
 */
export function any<T>(
  parse: TryComponentParser<T>,
  options?: MultiplierOptions<T[]>,
): Multiplier<T, T[]> {
  return createMultiplier<T, T[]>(parse, 0, DEFAULT_REPEAT_LIMIT, 'none', options);
}

/**
 * CSS value one-or-more multiplicity: `a+`.
 */
export function plus<T>(
  parse: TryComponentParser<T>,
  options?: MultiplierOptions<NonEmptyArray<T>>,
): Multiplier<T, NonEmptyArray<T>> {
  return createMultiplier<T, NonEmptyArray<T>>(parse, 1, DEFAULT_REPEAT_LIMIT, 'none', options);
}

/**
 * CSS value bounded repetition: `a{min,max}`.
 *
 * The parser is greedy. Backtracking support can later be attached here by
 * exposing repetition choices without changing the public shape.
 */
export function repeat<T>(item: TryComponentParser<T>, min: 1, max?: number, options?: MultiplierOptions<NonEmptyArray<T>>): Multiplier<T, NonEmptyArray<T>>;
export function repeat<T>(item: TryComponentParser<T>, min: 0, max?: number, options?: MultiplierOptions<T[]>): Multiplier<T, T[]>;
export function repeat<T>(item: TryComponentParser<T>, min: number, max?: number, options?: MultiplierOptions<T[]>): Multiplier<T, T[]>;
export function repeat<T, Output extends T[]>(item: TryComponentParser<T>, min: number, max = DEFAULT_REPEAT_LIMIT, options?: MultiplierOptions<Output>): Multiplier<T, Output> {
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
export function commaRepeat<T>(item: TryComponentParser<T>, options?: MultiplierOptions<NonEmptyArray<T>>): Multiplier<T, NonEmptyArray<T>>;
export function commaRepeat<T>(item: TryComponentParser<T>, min: 1, max?: number, options?: MultiplierOptions<NonEmptyArray<T>>): Multiplier<T, NonEmptyArray<T>>;
export function commaRepeat<T>(item: TryComponentParser<T>, min: 0, max?: number, options?: MultiplierOptions<T[]>): Multiplier<T, T[]>;
export function commaRepeat<T>(item: TryComponentParser<T>, min: number, max?: number, options?: MultiplierOptions<T[]>): Multiplier<T, T[]>;
export function commaRepeat<T, Output extends T[]>(item: TryComponentParser<T>, minOrOptions: number | MultiplierOptions<Output> = 1, max = DEFAULT_REPEAT_LIMIT, options?: MultiplierOptions<Output>): Multiplier<T, Output> {
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

  return createMultiplier<T, Output>(item, min, max, 'comma', resolvedOptions);
}

function createMultiplier<T, Output extends T[]>(
  base: TryComponentParser<T>,
  min: number,
  max: number,
  separator: 'none' | 'comma',
  options?: MultiplierOptions<Output>,
): Multiplier<T, Output> {
  const multiplier = ((c: ComponentCursor): TryComponentParserResult<Output> => {
    return parseMultiplier(c, multiplier);
  }) as Multiplier<T, Output>;

  multiplier.base = base;
  multiplier.min = min;
  multiplier.max = max;
  multiplier.separator = separator;
  multiplier.contextAfter = options?.contextAfter;

  return multiplier;
}

// =============================================================================
// Parser adapters
// =============================================================================

export function withComponentTrivia<T>(parse: TryComponentParser<T>): TryComponentParser<T> {
  return (c) => {
    const start = c.pos();
    const outerContext = c.context;

    try {
      consumeComponentTrivia(c);

      const result = parse(c);

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

function parseMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): TryComponentParserResult<Output> {
  return multiplier.separator === 'comma'
    ? parseCommaMultiplier(c, multiplier, max)
    : parsePlainMultiplier(c, multiplier, max);
}

function parsePlainMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): TryComponentParserResult<Output> {
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
      c.context = itemContext;
      return result;
    }

    if (c.pos() === itemStart) {
      c.context = itemContext;
      return c.error('Repeated parser matched without consuming input');
    }

    values.push(result.value);
    c.context = itemContext;
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    c.context = outerContext;
    return null;
  }

  c.context = outerContext;
  return ok(values as Output);
}

function parseCommaMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): TryComponentParserResult<Output> {
  const start = c.pos();
  const outerContext = c.context;
  const values: T[] = [];

  const parseItem = (): TryComponentParserResult<T> => {
    const itemStart = c.pos();
    const itemContext = c.context;
    const result = multiplier.base(c);

    if (result === null) {
      c.restore(itemStart);
      c.context = itemContext;
      return null;
    }

    if (isBad(result)) {
      c.context = itemContext;
      return result;
    }

    if (c.pos() === itemStart) {
      c.context = itemContext;
      return c.error('Comma repeat matched without consuming input');
    }

    c.context = itemContext;
    return result;
  };

  const first = parseItem();

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

    const next = parseItem();

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

  c.context = outerContext;
  return ok(values as Output);
}

function parseEmpty<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
): TryComponentParserResult<Output> {
  const start = c.pos();
  const outerContext = c.context;

  const result = parseMultiplier(c, multiplier);
  const end = c.pos();

  c.restore(start);
  c.context = outerContext;

  if (result === null || end !== start) {
    return null;
  }

  if (isBad(result)) {
    return result;
  }

  if (hasAnyValue(result.value)) {
    return c.error('Parser produced a value without consuming input');
  }

  return result;
}

type UnorderedConsumeResult =
  | ComponentParserBad
  | { values: unknown[]; seen: Set<number>; };

function consumeUnordered<const P extends readonly AnyMultiplier[]>(
  c: ComponentCursor,
  parsers: P,
): UnorderedConsumeResult {
  const remaining = parsers.map((parser, index) => ({ parser, index }));
  const values: unknown[] = Array.from({ length: parsers.length });
  const seen = new Set<number>();

  while (remaining.length > 0) {
    let matchedIndex = -1;
    let matchedValue: unknown;

    for (let i = 0; i < remaining.length; i++) {
      const part = remaining[i]!;
      const start = c.pos();
      const outerContext = c.context;
      const result = parseMultiplier(c, part.parser);

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
        return c.error('Unordered parser produced a value without consuming input');
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
  | ComponentParserBad
  | { matched: boolean; values: unknown[]; frames: SequenceFrame[]; };

export function __parseSequenceAttempt<const P extends readonly AnyMultiplier[]>(
  c: ComponentCursor,
  parsers: P,
  caps: readonly number[],
  context: unknown = c.context,
): SequenceAttempt {
  c.context = context;

  const values: unknown[] = [];
  const frames: SequenceFrame[] = [];

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i]!;
    const slotStart = c.pos();
    const result = parseMultiplier(c, parser, caps[i]);

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
      return c.error('Sequence parser produced a value without consuming input');
    }

    values[i] = value;
    frames[i] = {
      start: slotStart,
      values: value as unknown[],
    };

    if (parser.contextAfter !== undefined) {
      c.context = parser.contextAfter(value, c.context);
    }
  }

  return {
    matched: true,
    values,
    frames,
  };
}

export function __nextSequenceCaps<const P extends readonly AnyMultiplier[]>(
  parsers: P,
  frames: readonly SequenceFrame[],
): number[] | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const parser = parsers[i]!;
    const frame = frames[i]!;
    const nextCap = frame.values.length - 1;

    if (nextCap < parser.min) {
      continue;
    }

    const caps = parsers.map((parser) => parser.max);

    for (let j = 0; j < i; j++) {
      caps[j] = frames[j]!.values.length;
    }

    caps[i] = nextCap;

    return caps;
  }

  return null;
}
