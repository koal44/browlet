import type { ComponentCursor } from './component-cursor';
import { TokenKind } from './tokens';

export type TryValueParser<T> = (c: ComponentCursor) => T | null;
export type TryMultiplierParser<T> = (c: ComponentCursor) => T | null;
export type ValueParser<T> = (c: ComponentCursor) => T;

export function consumeComponentTrivia(c: ComponentCursor): void {
  while (true) {
    const value = c.peek();

    if (
      value !== null &&
      'kind' in value &&
      value.kind === TokenKind.Whitespace
    ) {
      c.next();
      continue;
    }

    return;
  }
}

export type AnyUnorderedPart = UnorderedPart<string, unknown>;

export type UnorderedPart<K extends string, V> = {
  key: K;
  parse: TryMultiplierParser<V>;
  required?: boolean;
};

export type UnorderedResult<P extends AnyUnorderedPart[]> = {
  [K in P[number]['key']]?: PartValue<P[number], K>;
};

type PartValue<P, K extends string> =
  P extends UnorderedPart<K, infer V> ? V : never;

export function part<K extends string, V>(
  key: K,
  parse: TryMultiplierParser<V>,
): UnorderedPart<K, V> {
  return { key, parse };
}

export function optionalPart<K extends string, V>(
  key: K,
  parse: TryMultiplierParser<V>,
): UnorderedPart<K, V> {
  return { key, parse, required: false };
}

function hasAnyMultiplierValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasAnyMultiplierValue);
  }

  if (value && typeof value === 'object') {
    const values = Object.values(value);
    return values.length > 0 && values.some(hasAnyMultiplierValue);
  }

  return value !== null && value !== undefined;
}

export function parseUnorderedAll<P extends AnyUnorderedPart[]>(
  c: ComponentCursor,
  parts: P,
): UnorderedResult<P> {
  const result = consumeUnordered(c, parts);

  for (const part of parts) {
    if (part.required !== false && !result.seen.has(part.key)) {
      c.error(`Expected ${part.key}`);
    }
  }

  return result.values as UnorderedResult<P>;
}

export function parseUnorderedSome<P extends AnyUnorderedPart[]>(
  c: ComponentCursor,
  parts: P,
): UnorderedResult<P> {
  const result = consumeUnordered(c, parts);

  if (!hasAnyMultiplierValue(result.values)) {
    const allOptional = parts.every((part) => part.required === false);

    if (!allOptional) {
      c.error('Expected one or more value components');
    }
  }

  return result.values as UnorderedResult<P>;
}

function consumeUnordered<P extends AnyUnorderedPart[]>(
  c: ComponentCursor,
  parts: P,
): {
  values: Record<string, unknown>;
  seen: Set<string>;
} {
  const remaining = [...parts];
  const values: Record<string, unknown> = {};
  const seen = new Set<string>();

  consumeComponentTrivia(c);

  while (remaining.length > 0) {
    let matchedIndex = -1;
    let matchedValue: unknown;

    for (let i = 0; i < remaining.length; i++) {
      const part = remaining[i];
      const start = c.pos();
      const value = part.parse(c);

      if (value === null) {
        c.restore(start);
        continue;
      }

      if (c.pos() === start && !hasAnyMultiplierValue(value)) {
        c.restore(start);
        continue;
      }

      if (c.pos() === start && hasAnyMultiplierValue(value)) {
        c.error(`Parser for ${part.key} produced a value without consuming input`);
      }

      matchedIndex = i;
      matchedValue = value;
      break;
    }

    if (matchedIndex === -1) break;

    const matchedPart = remaining[matchedIndex];

    remaining.splice(matchedIndex, 1);
    seen.add(matchedPart.key);
    values[matchedPart.key] = matchedValue;

    consumeComponentTrivia(c);
  }

  return { values, seen };
}

type MultiplierValueOfParser<P> =
  P extends TryMultiplierParser<infer V> ? V : never;

// type MultiplierValueOfPart<P> =
//   P extends UnorderedPart<string, infer V> ? V : never;

type SequenceValue<P extends TryMultiplierParser<unknown>[]> = {
  [I in keyof P]: MultiplierValueOfParser<P[I]>;
};

/**
 * CSS value juxtaposition: `a b`
 */
export function sequence<P extends TryMultiplierParser<unknown>[]>(
  ...parsers: P
): TryMultiplierParser<SequenceValue<P>> {
  return (c: ComponentCursor): SequenceValue<P> | null => {
    const start = c.pos();
    const values: unknown[] = [];

    consumeComponentTrivia(c);

    for (const parse of parsers) {
      const componentStart = c.pos();
      const value = parse(c);

      if (value === null) {
        c.restore(start);
        return null;
      }

      if (c.pos() === componentStart && hasAnyMultiplierValue(value)) {
        c.error('Sequence parser produced a value without consuming input');
      }

      values.push(value);
      consumeComponentTrivia(c);
    }

    return values as SequenceValue<P>;
  };
}

/**
 * CSS value alternative: `a | b`
 */
export function oneOf<P extends TryMultiplierParser<unknown>[]>(
  ...parsers: P
): TryMultiplierParser<MultiplierValueOfParser<P[number]>> {
  return (c: ComponentCursor): MultiplierValueOfParser<P[number]> | null => {
    const start = c.pos();

    consumeComponentTrivia(c);

    const branchStart = c.pos();

    for (const parse of parsers) {
      c.restore(branchStart);

      const componentStart = c.pos();
      const value = parse(c);

      if (value === null) {
        c.restore(branchStart);
        continue;
      }

      if (c.pos() === componentStart && hasAnyMultiplierValue(value)) {
        c.error('Alternative parser produced a value without consuming input');
      }

      consumeComponentTrivia(c);

      return value as MultiplierValueOfParser<P[number]>;
    }

    c.restore(start);
    return null;
  };
}

/**
 * CSS value double ampersand: `a && b`
 */
export function allOf<P extends AnyUnorderedPart[]>(
  parts: P,
): TryMultiplierParser<UnorderedResult<P>> {
  return (c: ComponentCursor): UnorderedResult<P> | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parts);

    for (const part of parts) {
      if (part.required !== false && !result.seen.has(part.key)) {
        c.restore(start);
        return null;
      }
    }

    return result.values as UnorderedResult<P>;
  };
}

/**
 * CSS value double bar: `a || b`
 */
export function someOf<P extends AnyUnorderedPart[]>(
  parts: P,
): TryMultiplierParser<UnorderedResult<P>> {
  return (c: ComponentCursor): UnorderedResult<P> | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parts);

    if (!hasAnyMultiplierValue(result.values)) {
      const allOptional = parts.every((part) => part.required === false);

      if (!allOptional) {
        c.restore(start);
        return null;
      }
    }

    return result.values as UnorderedResult<P>;
  };
}

export const DEFAULT_REPEAT_LIMIT = 20;

export function required<T>(
  parse: TryMultiplierParser<T>,
  expected: string,
): ValueParser<T> {
  return (c: ComponentCursor): T => {
    const start = c.pos();
    const value = parse(c);

    if (value !== null && hasAnyMultiplierValue(value)) {
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
): TryMultiplierParser<T[]> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid repeat maximum ${max}`);
  }

  return (c: ComponentCursor): T[] | null => {
    const start = c.pos();
    const values: T[] = [];

    consumeComponentTrivia(c);

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
      consumeComponentTrivia(c);
    }

    if (values.length < min) {
      c.restore(start);
      return null;
    }

    return values;
  };
}

export function repeatComma<T>(
  parse: TryValueParser<T>,
  min = 1,
  max = DEFAULT_REPEAT_LIMIT,
): TryMultiplierParser<T[]> {
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Invalid comma repeat minimum ${min}`);
  }

  if (!Number.isInteger(max) || max < min) {
    throw new Error(`Invalid comma repeat maximum ${max}`);
  }

  return (c: ComponentCursor): T[] | null => {
    const start = c.pos();
    const values: T[] = [];

    consumeComponentTrivia(c);

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

      consumeComponentTrivia(c);
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
      const commaStart = c.pos();

      if (!c.match(TokenKind.Comma)) {
        break;
      }

      consumeComponentTrivia(c);

      const next = parseItem();

      if (next === null) {
        c.restore(commaStart);
        break;
      }

      values.push(next);
    }

    if (values.length < min) {
      c.restore(start);
      return null;
    }

    return values;
  };
}

export function one<T>(parse: TryValueParser<T>): TryMultiplierParser<T[]> {
  return repeat(parse, 1, 1);
}
