import type { ComponentCursor } from './component-cursor';
import { consumeComponentTrivia } from './syntax';
import { TokenKind } from './tokens';

// =============================================================================
// Public parser and multiplier types
// =============================================================================

export type TryComponentParser<T> = (c: ComponentCursor) => T | null;

export type OptionalValue<T> = [] | [T];
export type NonEmptyArray<T> = [T, ...T[]];

export type Multiplier<T, Output extends T[] = T[]> = TryComponentParser<Output> & {
  base: TryComponentParser<T>;
  min: number;
  max: number;
  separator: 'none' | 'comma';
};

type SequenceValue<P extends readonly AnyMultiplier[]> = {
  -readonly [I in keyof P]: MultiplierOutputOf<P[I]>;
};

type UnorderedValue<P extends readonly AnyMultiplier[]> = {
  -readonly [I in keyof P]: MultiplierOutputOf<P[I]> | undefined;
};

type AlternativeValue<P extends readonly AnyMultiplier[]> =
  MultiplierOutputOf<P[number]>;

type AnyMultiplier = Multiplier<unknown, unknown[]>;
type MultiplierOutputOf<P> = P extends Multiplier<unknown, infer Output> ? Output : never;

type Projector<Value, R> =
  (value: Value, context: unknown) => R | null;

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
  return (c: ComponentCursor): R | null => {
    const start = c.pos();
    let caps = parsers.map((parser) => parser.max);

    while (true) {
      c.restore(start);

      const attempt = __parseSequenceAttempt(c, parsers, caps);

      if (attempt.ok) {
        const raw = attempt.values as SequenceValue<P>;

        if (!requireAnyValue || hasAnyValue(raw)) {
          const projected = project(raw, c.context);

          if (projected !== null) {
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
  };
}

/**
 * CSS value alternative: `a | b`
 */
export function oneOf<const P extends readonly AnyMultiplier[], R>(
  parsers: P,
  project: Projector<AlternativeValue<P>, R>,
): TryComponentParser<R> {
  return (c: ComponentCursor): R | null => {
    const start = c.pos();

    for (const parser of parsers) {
      c.restore(start);

      const componentStart = c.pos();
      const value = parseMultiplier(c, parser);

      if (value === null) {
        c.restore(start);
        continue;
      }

      if (c.pos() === componentStart && hasAnyValue(value)) {
        c.error('Alternative parser produced a value without consuming input');
      }

      const projected = project(value as AlternativeValue<P>, c.context);

      if (projected !== null) {
        return projected;
      }

      c.restore(start);
      continue;
    }

    c.restore(start);
    return null;
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
  return (c: ComponentCursor): R | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parsers);

    for (let i = 0; i < parsers.length; i++) {
      if (result.seen.has(i)) {
        continue;
      }

      const empty = parseEmpty(c, parsers[i]!);

      if (empty === null) {
        c.restore(start);
        return null;
      }

      result.values[i] = empty;
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
  return (c: ComponentCursor): R | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parsers);
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

      result.values[i] = empty;
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
  return (c: ComponentCursor): T => {
    const start = c.pos();
    const value = parse(c);

    if (value !== null) {
      return value;
    }

    c.restore(start);
    c.error(expected);
  };
}

// =============================================================================
// Multiplicity constructors
// =============================================================================

export const DEFAULT_REPEAT_LIMIT = 20;

/**
 * CSS value default multiplicity: `a`.
 */
export function one<T>(parse: TryComponentParser<T>): Multiplier<T, [T]> {
  return createMultiplier<T, [T]>(parse, 1, 1, 'none');
}

/**
 * CSS value optional multiplicity: `a?`.
 */
export function opt<T>(parse: TryComponentParser<T>): Multiplier<T, OptionalValue<T>> {
  return createMultiplier<T, OptionalValue<T>>(parse, 0, 1, 'none');
}

/**
 * CSS value zero-or-more multiplicity: `a*`.
 */
export function any<T>(parse: TryComponentParser<T>): Multiplier<T, T[]> {
  return createMultiplier<T, T[]>(parse, 0, DEFAULT_REPEAT_LIMIT, 'none');
}

/**
 * CSS value one-or-more multiplicity: `a+`.
 */
export function plus<T>(parse: TryComponentParser<T>): Multiplier<T, NonEmptyArray<T>> {
  return createMultiplier<T, NonEmptyArray<T>>(parse, 1, DEFAULT_REPEAT_LIMIT, 'none');
}

/**
 * CSS value bounded repetition: `a{min,max}`.
 *
 * The parser is greedy. Backtracking support can later be attached here by
 * exposing repetition choices without changing the public shape.
 */
export function repeat<T>(item: TryComponentParser<T>, min: 1, max?: number): Multiplier<T, NonEmptyArray<T>>;
export function repeat<T>(item: TryComponentParser<T>, min: 0, max?: number): Multiplier<T, T[]>;
export function repeat<T>(item: TryComponentParser<T>, min: number, max?: number): Multiplier<T, T[]>;
export function repeat<T>(item: TryComponentParser<T>, min: number, max = DEFAULT_REPEAT_LIMIT): Multiplier<T, T[]> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid repeat maximum ${max}`);
  }

  return createMultiplier<T, T[]>(item, min, max, 'none');
}

/**
 * CSS value comma multiplier: `a#` / `a#{min,max}`.
 */
export function commaRepeat<T>(item: TryComponentParser<T>): Multiplier<T, NonEmptyArray<T>>;
export function commaRepeat<T>(item: TryComponentParser<T>, min: 1, max?: number): Multiplier<T, NonEmptyArray<T>>;
export function commaRepeat<T>(item: TryComponentParser<T>, min: 0, max?: number): Multiplier<T, T[]>;
export function commaRepeat<T>(item: TryComponentParser<T>, min: number, max?: number): Multiplier<T, T[]>;
export function commaRepeat<T>(item: TryComponentParser<T>, min = 1, max = DEFAULT_REPEAT_LIMIT): Multiplier<T, T[]> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid comma repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid comma repeat maximum ${max}`);
  }

  return createMultiplier<T, T[]>(item, min, max, 'comma');
}

function createMultiplier<T, Output extends T[]>(
  base: TryComponentParser<T>,
  min: number,
  max: number,
  separator: 'none' | 'comma',
): Multiplier<T, Output> {
  const multiplier = ((c: ComponentCursor): Output | null => {
    return parseMultiplier(c, multiplier);
  }) as Multiplier<T, Output>;

  multiplier.base = base;
  multiplier.min = min;
  multiplier.max = max;
  multiplier.separator = separator;

  return multiplier;
}

// =============================================================================
// Parser adapters
// =============================================================================

export function withComponentTrivia<T>(parse: TryComponentParser<T>): TryComponentParser<T> {
  return (c) => {
    const start = c.pos();

    consumeComponentTrivia(c);

    const value = parse(c);

    if (value === null) {
      c.restore(start);
      return null;
    }

    return value;
  };
}

// =============================================================================
// Grammar execution helpers
// =============================================================================

function parseMultiplier<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
  max = multiplier.max,
): Output | null {
  const value =
    multiplier.separator === 'comma'
      ? parseCommaMultiplier(c, multiplier, max)
      : parsePlainMultiplier(c, multiplier, max);

  return value as Output | null;
}

function parsePlainMultiplier<T>(
  c: ComponentCursor,
  multiplier: Multiplier<T, T[]>,
  max = multiplier.max,
): T[] | null {
  const start = c.pos();
  const values: T[] = [];

  while (values.length < max) {
    const itemStart = c.pos();
    const value = multiplier.base(c);

    if (value === null) {
      c.restore(itemStart);
      break;
    }

    if (c.pos() === itemStart) {
      c.error('Repeated parser matched without consuming input');
    }

    values.push(value);
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    return null;
  }

  return values;
}

function parseCommaMultiplier<T>(
  c: ComponentCursor,
  multiplier: Multiplier<T, T[]>,
  max = multiplier.max,
): T[] | null {
  const start = c.pos();
  const values: T[] = [];

  const parseItem = (): T | null => {
    const itemStart = c.pos();
    const value = multiplier.base(c);

    if (value === null) {
      c.restore(itemStart);
      return null;
    }

    if (c.pos() === itemStart) {
      c.error('Comma repeat matched without consuming input');
    }

    return value;
  };

  const first = parseItem();

  if (first === null) {
    if (multiplier.min === 0) {
      return [];
    }

    c.restore(start);
    return null;
  }

  values.push(first);

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

    values.push(next);
  }

  if (values.length < multiplier.min) {
    c.restore(start);
    return null;
  }

  return values;
}

function parseEmpty<T, Output extends T[]>(
  c: ComponentCursor,
  multiplier: Multiplier<T, Output>,
): Output | null {
  const start = c.pos();
  const value = parseMultiplier(c, multiplier);
  const end = c.pos();

  c.restore(start);

  if (value === null || end !== start) {
    return null;
  }

  if (hasAnyValue(value)) {
    c.error('Parser produced a value without consuming input');
  }

  return value;
}

function consumeUnordered<const P extends readonly AnyMultiplier[]>(
  c: ComponentCursor,
  parsers: P,
): {
  values: unknown[];
  seen: Set<number>;
} {
  const remaining = parsers.map((parser, index) => ({ parser, index }));
  const values: unknown[] = Array.from({ length: parsers.length });
  const seen = new Set<number>();

  while (remaining.length > 0) {
    let matchedIndex = -1;
    let matchedValue: unknown;

    for (let i = 0; i < remaining.length; i++) {
      const part = remaining[i]!;
      const start = c.pos();
      const value = parseMultiplier(c, part.parser);

      if (value === null) {
        c.restore(start);
        continue;
      }

      if (c.pos() === start && !hasAnyValue(value)) {
        c.restore(start);
        continue;
      }

      if (c.pos() === start && hasAnyValue(value)) {
        c.error('Unordered parser produced a value without consuming input');
      }

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

type SequenceAttempt = {
  ok: boolean;
  values: unknown[];
  frames: SequenceFrame[];
}

export function __parseSequenceAttempt<const P extends readonly AnyMultiplier[]>(
  c: ComponentCursor,
  parsers: P,
  caps: readonly number[],
): SequenceAttempt {
  const values: unknown[] = [];
  const frames: SequenceFrame[] = [];

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i]!;
    const slotStart = c.pos();
    const value = parseMultiplier(c, parser, caps[i]);

    if (value === null) {
      c.restore(slotStart);

      return {
        ok: false,
        values,
        frames,
      };
    }

    if (c.pos() === slotStart && hasAnyValue(value)) {
      c.error('Sequence parser produced a value without consuming input');
    }

    values[i] = value;
    frames[i] = {
      start: slotStart,
      values: value,
    };
  }

  return {
    ok: true,
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
