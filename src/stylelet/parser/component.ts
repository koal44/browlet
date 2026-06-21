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
