import { Cursor } from "./cursor";
import { consumeAsciiWord, consumeDigits, consumeTrivia } from "./lex";

export type NthArgs = { step: number; offset: number; };

export function parseNthArgs(c: Cursor): NthArgs {
  c.expect('(');
  consumeTrivia(c);

  const nth = parseNthExpression(c);

  consumeTrivia(c);
  c.expect(')');

  return nth;
}

export function parseNthExpression(c: Cursor): NthArgs {
  const ch = c.peek();

  if (ch === 'o' || ch === 'O' || ch === 'e' || ch === 'E') {
    const start = c.pos();
    const word = consumeAsciiWord(c).toLowerCase();

    if (word === 'odd') return { step: 2, offset: 1 };
    if (word === 'even') return { step: 2, offset: 0 };

    c.restore(start);
  }

  const sign = parseOptionalSign(c);
  const digits = consumeDigits(c);
  const n = c.peek();

  if (n !== 'n' && n !== 'N') {
    if (digits === '') c.error(`Expected nth expression, got ${n || '<eof>'}`);

    return {
      step: 0,
      offset: normalizeZero(sign * Number(digits)),
    };
  }

  c.advance();

  const step = digits === '' ? sign : sign * Number(digits);

  consumeTrivia(c);

  let offset = 0;
  const offsetCh = c.peek();

  if (offsetCh === '+' || offsetCh === '-') {
    const offsetSign = parseOptionalSign(c);
    consumeTrivia(c);

    const offsetDigits = consumeDigits(c);
    if (offsetDigits === '') c.error(`Expected offset in nth expression, got ${c.peek() || '<eof>'}`);

    offset = offsetSign * Number(offsetDigits);
  }

  return {
    step: normalizeZero(step),
    offset: normalizeZero(offset),
  };
}

function parseOptionalSign(c: Cursor): 1 | -1 {
  const ch = c.peek();

  if (ch !== '+' && ch !== '-') return 1;

  c.advance();
  return ch === '-' ? -1 : 1;
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}
