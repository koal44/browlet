import type { Cursor } from '../../selectlet/parser/cursor';
import { consumeTrivia } from '../../selectlet/parser/lex';

export function consumeComponentValue(c: Cursor): void {
  const ch = c.peek();

  if (!ch) return;

  if (ch === '/' && c.peek(1) === '*') {
    consumeTrivia(c);
    return;
  }

  if (ch === '"' || ch === "'") {
    consumeQuotedText(c);
    return;
  }

  if (ch === '(') {
    consumeBalancedText(c, '(', ')');
    return;
  }

  if (ch === '[') {
    consumeBalancedText(c, '[', ']');
    return;
  }

  if (ch === '{') {
    consumeRawBlock(c);
    return;
  }

  c.advance();
}

function consumeQuotedText(c: Cursor): void {
  const quote = c.next();

  while (!c.eof()) {
    const ch = c.next();

    if (ch === '\\' && !c.eof()) {
      c.advance();
      continue;
    }

    if (ch === quote) return;
  }
}

function consumeBalancedText(c: Cursor, open: string, close: string): void {
  if (c.peek() !== open) {
    c.error(`Expected ${open}, got ${c.peek() || '<eof>'}`);
  }

  c.advance();

  while (!c.eof()) {
    const ch = c.peek();

    if (ch === close) {
      c.advance();
      return;
    }

    // Do not eat the style block boundary while recovering an unclosed paren/bracket.
    if (ch === '}') {
      return;
    }

    consumeComponentValue(c);
  }
}

export function consumeRawBlock(c: Cursor): string {
  if (c.peek() !== '{') {
    c.error(`Expected block, got ${c.peek() || '<eof>'}`);
  }

  let text = '';
  let depth = 0;
  let quote = '';

  while (!c.eof()) {
    const ch = c.peek();

    text += ch;
    c.advance();

    if (quote) {
      if (ch === '\\' && !c.eof()) {
        text += c.peek();
        c.advance();
        continue;
      }

      if (ch === quote) {
        quote = '';
      }

      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
      continue;
    }

    if (ch === '}') {
      depth--;

      if (depth === 0) {
        return text;
      }
    }
  }

  c.error('Unexpected EOF in block');
}


export type TryValueParser<T> = (c: Cursor) => T | null;

export type AnyUnorderedPart = UnorderedPart<string, unknown>;

export type UnorderedPart<K extends string, V> = {
  key: K;
  parse: TryValueParser<V>;
  required?: boolean;
};

export type UnorderedResult<P extends AnyUnorderedPart[]> = {
  [K in P[number]['key']]?: PartValue<P[number], K>;
};

type PartValue<P, K extends string> =
  P extends UnorderedPart<K, infer V> ? V : never;

export function part<K extends string, V>(key: K, parse: TryValueParser<V>): UnorderedPart<K, V> {
  return { key, parse };
}

export function optionalPart<K extends string, V>(key: K, parse: TryValueParser<V>): UnorderedPart<K, V> {
  return { key, parse, required: false };
}

export function parseUnorderedAll<P extends AnyUnorderedPart[]>(
  c: Cursor,
  parts: P,
): UnorderedResult<P> {
  const result = consumeUnordered(c, parts);

  for (const part of parts) {
    if (part.required !== false && !(part.key in result.values)) {
      c.error(`Expected ${part.key}`);
    }
  }

  return result.values as UnorderedResult<P>;
}

export function parseUnorderedSome<P extends AnyUnorderedPart[]>(
  c: Cursor,
  parts: P,
): UnorderedResult<P> {
  const result = consumeUnordered(c, parts);

  if (result.count === 0) {
    c.error('Expected one or more value components');
  }

  return result.values as UnorderedResult<P>;
}

function consumeUnordered<P extends AnyUnorderedPart[]>(
  c: Cursor,
  parts: P,
): { values: Record<string, unknown>; count: number; } {
  const remaining = [...parts];
  const values: Record<string, unknown> = {};
  let count = 0;

  consumeTrivia(c);

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

      if (c.pos() === start) {
        c.error(`Parser for ${part.key} matched without consuming input`);
      }

      matchedIndex = i;
      matchedValue = value;
      break;
    }

    if (matchedIndex === -1) break;

    const [part] = remaining.splice(matchedIndex, 1);
    values[part.key] = matchedValue;
    count++;

    consumeTrivia(c);
  }

  return { values, count };
}

type ValueOfParser<P> =
  P extends TryValueParser<infer V> ? V : never;

type SequenceValue<P extends TryValueParser<unknown>[]> = {
  [I in keyof P]: ValueOfParser<P[I]>;
};

/**
 * CSS value juxtaposition: `a b`
 */
export function sequence<P extends TryValueParser<unknown>[]>(
  ...parsers: P
): TryValueParser<SequenceValue<P>> {
  return (c: Cursor): SequenceValue<P> | null => {
    const start = c.pos();
    const values: unknown[] = [];

    consumeTrivia(c);

    for (const parse of parsers) {
      const componentStart = c.pos();
      const value = parse(c);

      if (value === null) {
        c.restore(start);
        return null;
      }

      if (c.pos() === componentStart) {
        c.error('Sequence parser matched without consuming input');
      }

      values.push(value);
      consumeTrivia(c);
    }

    return values as SequenceValue<P>;
  };
}

/**
 * CSS value alternative: `a | b`
 */
export function oneOf<P extends TryValueParser<unknown>[]>(
  ...parsers: P
): TryValueParser<ValueOfParser<P[number]>> {
  return (c: Cursor): ValueOfParser<P[number]> | null => {
    const start = c.pos();

    consumeTrivia(c);

    const branchStart = c.pos();

    for (const parse of parsers) {
      c.restore(branchStart);

      const componentStart = c.pos();
      const value = parse(c);

      if (value === null) {
        c.restore(branchStart);
        continue;
      }

      if (c.pos() === componentStart) {
        c.error('Alternative parser matched without consuming input');
      }

      consumeTrivia(c);

      return value as ValueOfParser<P[number]>;
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
): TryValueParser<UnorderedResult<P>> {
  return (c: Cursor): UnorderedResult<P> | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parts);

    if (result.count === 0) {
      c.restore(start);
      return null;
    }

    for (const part of parts) {
      if (part.required !== false && !(part.key in result.values)) {
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
): TryValueParser<UnorderedResult<P>> {
  return (c: Cursor): UnorderedResult<P> | null => {
    const start = c.pos();
    const result = consumeUnordered(c, parts);

    if (result.count === 0) {
      c.restore(start);
      return null;
    }

    return result.values as UnorderedResult<P>;
  };
}
