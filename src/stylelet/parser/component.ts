import type { ComponentCursor } from './component-cursor';
import { consumeComponentTrivia } from './syntax';
import { TokenKind } from './tokens';

export type TryValueParser<T> = (c: ComponentCursor) => T | null;
export type MultiplierParser<T> = {
  parse: TryValueParser<T>;
  min: number;
  max: number;
};

type SequenceValue<P extends MultiplierParser<unknown>[]> = {
  [I in keyof P]: MultiplierValueOfParser<P[I]>;
};

type MultiplierValueOfParser<P> =
  P extends MultiplierParser<infer V> ? V : never;

/**
 * CSS value juxtaposition: `a b`
 */
export function sequence<P extends MultiplierParser<unknown>[]>(
  ...parsers: P
): MultiplierParser<SequenceValue<P>> {
  return {
    parse: (c: ComponentCursor): SequenceValue<P> | null => {
      const start = c.pos();
      const values: unknown[] = [];

      for (const parser of parsers) {
        const componentStart = c.pos();
        const value = parser.parse(c);

        if (value === null) {
          c.restore(start);
          return null;
        }

        if (c.pos() === componentStart && hasAnyValue(value)) {
          c.error('Sequence parser produced a value without consuming input');
        }

        values.push(value);
      }

      return values as SequenceValue<P>;
    },
    min: 1,
    max: 1,
  };
}

/**
 * CSS value alternative: `a | b`
 */
export function oneOf<P extends MultiplierParser<unknown>[]>(
  ...parsers: P
): MultiplierParser<MultiplierValueOfParser<P[number]>> {
  return {
    parse: (c: ComponentCursor): MultiplierValueOfParser<P[number]> | null => {
      const start = c.pos();
      const branchStart = c.pos();

      for (const parser of parsers) {
        c.restore(branchStart);

        const componentStart = c.pos();
        const value = parser.parse(c);

        if (value === null) {
          c.restore(branchStart);
          continue;
        }

        if (c.pos() === componentStart && hasAnyValue(value)) {
          c.error('Alternative parser produced a value without consuming input');
        }

        return value as MultiplierValueOfParser<P[number]>;
      }

      c.restore(start);
      return null;
    },
    min: 1,
    max: 1,
  };
}

type UnorderedValue<P extends MultiplierParser<unknown>[]> = {
  [I in keyof P]: MultiplierValueOfParser<P[I]> | undefined;
};

/**
 * CSS value double ampersand: `a && b`
 */
export function allOf<P extends MultiplierParser<unknown>[]>(
  ...parsers: P
): MultiplierParser<UnorderedValue<P>> {
  return {
    parse: (c: ComponentCursor): UnorderedValue<P> | null => {
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

      return result.values as UnorderedValue<P>;
    },
    min: 1,
    max: 1,
  };
}

/**
 * CSS value double bar: `a || b`
 */
export function someOf<P extends MultiplierParser<unknown>[]>(
  ...parsers: P
): MultiplierParser<UnorderedValue<P>> {
  return {
    parse: (c: ComponentCursor): UnorderedValue<P> | null => {
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

      if (!hasConsumedValue && !canMatchEmpty) {
        c.restore(start);
        return null;
      }

      return result.values as UnorderedValue<P>;
    },
    min: 1,
    max: 1,
  };
}

export const DEFAULT_REPEAT_LIMIT = 20;
export type ValueParser<T> = (c: ComponentCursor) => T;

export function required<T>(
  parser: MultiplierParser<T>,
  expected: string,
): ValueParser<T> {
  return (c: ComponentCursor): T => {
    const start = c.pos();
    const value = parser.parse(c);

    if (value !== null && hasAnyValue(value)) {
      return value;
    }

    c.restore(start);
    c.error(expected);
  };
}

export function repeat<T>(
  parse: TryValueParser<T>,
  min: number,
  max = DEFAULT_REPEAT_LIMIT,
): MultiplierParser<T[]> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid repeat maximum ${max}`);
  }

  return {
    parse: (c: ComponentCursor): T[] | null => {
      const start = c.pos();
      const values: T[] = [];

      while (values.length < max) {
        const itemStart = c.pos();
        const value = parse(c);

        if (value === null) {
          c.restore(itemStart);
          break;
        }

        if (c.pos() === itemStart) {
          c.error('Repeated parser matched without consuming input');
        }

        values.push(value);
      }

      if (values.length < min) {
        c.restore(start);
        return null;
      }

      return values;
    },
    min,
    max,
  };
}

export function repeatComma<T>(
  parse: TryValueParser<T>,
  min = 1,
  max = DEFAULT_REPEAT_LIMIT,
): MultiplierParser<T[]> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid comma repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid comma repeat maximum ${max}`);
  }

  return {
    parse: (c: ComponentCursor): T[] | null => {
      const start = c.pos();
      const values: T[] = [];

      const parseItem = (): T | null => {
        const itemStart = c.pos();
        const value = parse(c);

        if (value === null) {
          c.restore(itemStart);
          return null;
        }

        if (c.pos() === itemStart) {
          c.error('Comma repeated parser matched without consuming input');
        }

        return value;
      };

      const first = parseItem();

      if (first === null) {
        if (min === 0) {
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

      if (values.length < min) {
        c.restore(start);
        return null;
      }

      return values;
    },
    min,
    max,
  };
}

export function one<T>(parse: TryValueParser<T>): MultiplierParser<T[]> {
  return repeat(parse, 1, 1);
}

export function opt<T>(parse: TryValueParser<T>): MultiplierParser<T[]> {
  return repeat(parse, 0, 1);
}

export function any<T>(parse: TryValueParser<T>): MultiplierParser<T[]> {
  return repeat(parse, 0, DEFAULT_REPEAT_LIMIT);
}

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

export function map<A, B>(
  parser: MultiplierParser<A>,
  fn: (value: A) => B,
): MultiplierParser<B> {
  return {
    parse: (c) => {
      const start = c.pos();
      const value = parser.parse(c);

      if (value === null) {
        c.restore(start);
        return null;
      }

      return fn(value);
    },
    min: parser.min,
    max: parser.max,
  };
}

export function requireAny<T>(parser: MultiplierParser<T>): MultiplierParser<T> {
  return {
    parse: (c) => {
      const start = c.pos();
      const value = parser.parse(c);

      if (value === null || !hasAnyValue(value)) {
        c.restore(start);
        return null;
      }

      return value;
    },
    min: parser.min,
    max: parser.max,
  };
}

function parseEmpty<T>(
  c: ComponentCursor,
  parser: MultiplierParser<T>,
): T | null {
  const start = c.pos();
  const value = parser.parse(c);
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

function consumeUnordered<P extends MultiplierParser<unknown>[]>(
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
      const value = part.parser.parse(c);

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

// function parseMultiplier<T>(
//   c: ComponentCursor,
//   multiplier: MultiplierParser<T>,
// ): T[] | null {
//   const start = c.pos();
//   const values: T[] = [];

//   while (values.length < multiplier.max) {
//     const itemStart = c.pos();
//     const value = multiplier.parse(c);

//     if (value === null) {
//       c.restore(itemStart);
//       break;
//     }

//     if (c.pos() === itemStart) {
//       c.error('Repeated parser matched without consuming input');
//     }

//     values.push(value);
//   }

//   if (values.length < multiplier.min) {
//     c.restore(start);
//     return null;
//   }

//   return values;
// }
