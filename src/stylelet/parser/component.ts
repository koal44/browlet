import type { ComponentCursor } from './component-cursor';
import { consumeComponentTrivia } from './syntax';
import { TokenKind } from './tokens';

// =============================================================================
// Public parser and multiplier types
// =============================================================================

export type TryValueParser<T> = (c: ComponentCursor) => T | null;

export type Multiplier<T> = TryValueParser<T[]> & {
  base: TryValueParser<T>;
  min: number;
  max: number;
  separator: 'none' | 'comma';
};

type SequenceValue<P extends readonly Multiplier<unknown>[]> = {
  [I in keyof P]: MultiplierValueOf<P[I]>[];
};

type UnorderedValue<P extends readonly Multiplier<unknown>[]> = {
  [I in keyof P]: MultiplierValueOf<P[I]>[] | undefined;
};

type AlternativeValue<P extends readonly Multiplier<unknown>[]> =
  MultiplierValueOf<P[number]>[];

type MultiplierValueOf<P> = P extends Multiplier<infer V> ? V : never;

// =============================================================================
// Structural grammar combinators
// =============================================================================

/**
 * CSS value juxtaposition: `a b`
 */
export function sequenceOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: SequenceValue<P>) => R]
): TryValueParser<R> {
  return parseSequenceOf(false, ...args);
}

/**
 * CSS value required group: `[ a b c ]!`
 */
export function requiredSequenceOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: SequenceValue<P>) => R]
): TryValueParser<R> {
  return parseSequenceOf(true, ...args);
}

function parseSequenceOf<P extends readonly Multiplier<unknown>[], R>(
  requireAnyValue: boolean,
  ...args: [...parsers: P, project: (value: SequenceValue<P>) => R]
): TryValueParser<R> {
  const project = args[args.length - 1] as (value: SequenceValue<P>) => R;
  const parsers = args.slice(0, -1) as unknown as P;

  return (c: ComponentCursor): R | null => {
    const start = c.pos();
    const values: unknown[] = [];

    for (const parser of parsers) {
      const componentStart = c.pos();
      const value = parseMultiplier(c, parser);

      if (value === null) {
        c.restore(start);
        return null;
      }

      if (c.pos() === componentStart && hasAnyValue(value)) {
        c.error('Sequence parser produced a value without consuming input');
      }

      values.push(value);
    }

    const raw = values as SequenceValue<P>;

    if (requireAnyValue && !hasAnyValue(raw)) {
      c.restore(start);
      return null;
    }

    return project(raw);
  };
}

/**
 * CSS value alternative: `a | b`
 */
export function oneOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: AlternativeValue<P>) => R]
): TryValueParser<R> {
  const project = args[args.length - 1] as (value: AlternativeValue<P>) => R;
  const parsers = args.slice(0, -1) as unknown as P;

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

      return project(value as AlternativeValue<P>);
    }

    c.restore(start);
    return null;
  };
}

/**
 * CSS value double ampersand: `a && b`
 */
export function allOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: UnorderedValue<P>) => R]
): TryValueParser<R> {
  return parseAllOf(false, ...args);
}

/**
 * CSS value required double ampersand group: `[ a && b ]!`
 */
export function requiredAllOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: UnorderedValue<P>) => R]
): TryValueParser<R> {
  return parseAllOf(true, ...args);
}

function parseAllOf<P extends readonly Multiplier<unknown>[], R>(
  requireAnyValue: boolean,
  ...args: [...parsers: P, project: (value: UnorderedValue<P>) => R]
): TryValueParser<R> {
  const project = args[args.length - 1] as (value: UnorderedValue<P>) => R;
  const parsers = args.slice(0, -1) as unknown as P;

  return (c: ComponentCursor): R | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parsers);

    for (let i = 0; i < parsers.length; i++) {
      if (result.seen.has(i)) {
        continue;
      }

      const empty = parseEmpty(c, parsers[i]);

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

    return project(raw);
  };
}

/**
 * CSS value double bar: `a || b`
 */
export function someOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: UnorderedValue<P>) => R]
): TryValueParser<R> {
  return parseSomeOf(false, ...args);
}

/**
 * CSS value required double bar group: `[ a || b ]!`
 */
export function requiredSomeOf<P extends readonly Multiplier<unknown>[], R>(
  ...args: [...parsers: P, project: (value: UnorderedValue<P>) => R]
): TryValueParser<R> {
  return parseSomeOf(true, ...args);
}

function parseSomeOf<P extends readonly Multiplier<unknown>[], R>(
  requireAnyValue: boolean,
  ...args: [...parsers: P, project: (value: UnorderedValue<P>) => R]
): TryValueParser<R> {
  const project = args[args.length - 1] as (value: UnorderedValue<P>) => R;
  const parsers = args.slice(0, -1) as unknown as P;

  return (c: ComponentCursor): R | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parsers);
    const hasConsumedValue = hasAnyValue(result.values);

    let canMatchEmpty = true;

    for (let i = 0; i < parsers.length; i++) {
      if (result.seen.has(i)) {
        continue;
      }

      const empty = parseEmpty(c, parsers[i]);

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

    return project(raw);
  };
}

// =============================================================================
// Required parser adapter
// =============================================================================

export type ValueParser<T> = (c: ComponentCursor) => T;

export function required<T>(
  parse: TryValueParser<T>,
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
export function one<T>(parse: TryValueParser<T>): Multiplier<T> {
  return repeat(parse, 1, 1);
}

/**
 * CSS value optional multiplicity: `a?`.
 */
export function opt<T>(parse: TryValueParser<T>): Multiplier<T> {
  return repeat(parse, 0, 1);
}

/**
 * CSS value zero-or-more multiplicity: `a*`.
 */
export function any<T>(parse: TryValueParser<T>): Multiplier<T> {
  return repeat(parse, 0, DEFAULT_REPEAT_LIMIT);
}

/**
 * CSS value one-or-more multiplicity: `a+`.
 */
export function plus<T>(parse: TryValueParser<T>): Multiplier<T> {
  return repeat(parse, 1, DEFAULT_REPEAT_LIMIT);
}

/**
 * CSS value bounded repetition: `a{min,max}`.
 *
 * The parser is greedy. Backtracking support can later be attached here by
 * exposing repetition choices without changing the public shape.
 */
export function repeat<T>(
  item: TryValueParser<T>,
  min: number,
  max = DEFAULT_REPEAT_LIMIT,
): Multiplier<T> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid repeat maximum ${max}`);
  }

  return createMultiplier(item, min, max, 'none');
}

/**
 * CSS value comma multiplier: `a#` / `a#{min,max}`.
 */
export function commaRepeat<T>(
  item: TryValueParser<T>,
  min = 1,
  max = DEFAULT_REPEAT_LIMIT,
): Multiplier<T> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid comma repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid comma repeat maximum ${max}`);
  }

  return createMultiplier(item, min, max, 'comma');
}

function createMultiplier<T>(
  base: TryValueParser<T>,
  min: number,
  max: number,
  separator: 'none' | 'comma',
): Multiplier<T> {
  const multiplier = ((c: ComponentCursor): T[] | null => {
    return parseMultiplier(c, multiplier);
  }) as Multiplier<T>;

  multiplier.base = base;
  multiplier.min = min;
  multiplier.max = max;
  multiplier.separator = separator;

  return multiplier;
}

// =============================================================================
// Parser adapters
// =============================================================================

export function withComponentTrivia<T>(parse: TryValueParser<T>): TryValueParser<T> {
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

function parseMultiplier<T>(
  c: ComponentCursor,
  multiplier: Multiplier<T>,
  max = multiplier.max,
): T[] | null {
  if (multiplier.separator === 'comma') {
    return parseCommaMultiplier(c, multiplier, max);
  }

  return parsePlainMultiplier(c, multiplier, max);
}

function parsePlainMultiplier<T>(
  c: ComponentCursor,
  multiplier: Multiplier<T>,
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
  multiplier: Multiplier<T>,
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

function parseEmpty<T>(
  c: ComponentCursor,
  multiplier: Multiplier<T>,
): T[] | null {
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

function consumeUnordered<P extends readonly Multiplier<unknown>[]>(
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
      const part = remaining[i];
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

    const matched = remaining[matchedIndex];

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
