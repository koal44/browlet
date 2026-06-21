import type { Cursor } from '../../selectlet/parser/cursor';
import { isDigit } from '../../selectlet/parser/lex';

export type NumberToken = {
  raw: string;
  value: number;
};

export function tryConsumeNumber(c: Cursor): NumberToken | null {
  const start = c.pos();

  if (c.peek() === '+' || c.peek() === '-') c.advance();

  let before = 0;
  while (isDigit(c.peek())) {
    before++;
    c.advance();
  }

  let after = 0;
  if (c.peek() === '.') {
    c.advance();

    while (isDigit(c.peek())) {
      after++;
      c.advance();
    }
  }

  if (before === 0 && after === 0) {
    c.restore(start);
    return null;
  }

  const raw = c.slice(start, c.pos());
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    c.error(`Invalid number ${JSON.stringify(raw)}`);
  }

  return { raw, value };
}

export function serializeNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}
