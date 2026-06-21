import type { Cursor } from './cursor';
import type { Combinator } from './parser';

export function consumeTrivia(c: Cursor): boolean {
  let consumed = false;

  while (true) {
    // Whitespace run.
    if (c.consumeWhile(isCssWhitespace) !== 0) consumed = true;

    // Block comment.
    if (c.peek() !== '/' || c.peek(1) !== '*') return consumed;

    consumed = true;
    c.advance(2);

    while (true) {
      const ch = c.next();
      if (ch === '') c.error('Unterminated comment');
      if (ch !== '*' || c.peek() !== '/') continue;
      c.advance();
      break;
    }
  }
}

export function consumeIdent(c: Cursor): string {
  const start = c.pos();
  const ch = c.peek();

  if (ch === '-') {
    c.advance();

    if (c.peek() === '-') {
      c.advance();
    } else if (!consumeIdentHead(c)) {
      c.restore(start);
      c.error(`Expected identifier after "-", got ${c.peek() || '<eof>'}`);
    }

    while (consumeIdentTail(c)) { /* eat */ }
    return c.slice(start);
  }

  if (!consumeIdentHead(c)) {
    c.error(`Expected identifier, got ${ch || '<eof>'}`);
  }

  while (consumeIdentTail(c)) { /* eat */ }
  return c.slice(start);
}

export function consumeStringValue(c: Cursor): string {
  const quote = c.next();
  const start = c.pos();

  while (!c.eof()) {
    if (c.match(quote)) {
      return c.slice(start, c.pos() - 1);
    }

    if (consumeEscapedChar(c)) continue;

    c.advance();
  }

  // Browser selector parsing accepts EOF as the end of a quoted string.
  return c.slice(start);
}

export function consumeDigits(c: Cursor): string {
  const start = c.pos();
  c.consumeWhile(isDigit);
  return c.slice(start);
}

export function consumeAsciiWord(c: Cursor): string {
  const start = c.pos();
  c.consumeWhile(isAlpha);
  return c.slice(start);
}

export function consumeEscapedChar(c: Cursor): boolean {
  if (!c.match('\\')) return false;
  if (!c.eof()) c.advance();
  return true;
}

function consumeCssEscape(c: Cursor): boolean {
  const start = c.pos();

  if (c.peek() !== '\\') return false;
  c.advance();

  const ch = c.peek();

  // CSS backslash EOF escape. Keep the raw backslash in the identifier;
  // cssIdentUnescape later maps it to U+FFFD.
  if (ch === '') return true;

  if (isHexDigit(ch)) {
    let n = 1;

    while (n < 6 && isHexDigit(c.peek(n))) n++;

    c.advance(n);

    if (c.peek() === '\r' && c.peek(1) === '\n') {
      c.advance(2);
    } else if (isCssWhitespace(c.peek())) {
      c.advance();
    }

    return true;
  }

  if (!isVerticalWhitespace(ch)) {
    c.advance();
    return true;
  }

  c.restore(start);
  return false;
}

function consumeIdentHead(c: Cursor): boolean {
  const ch = c.peek();

  if (ch === '\x00' || isIdentHeadChar(ch)) {
    c.advance();
    return true;
  }

  return consumeCssEscape(c);
}

function consumeIdentTail(c: Cursor): boolean {
  const ch = c.peek();

  if (ch === '\x00' || isIdentTailChar(ch)) {
    c.advance();
    return true;
  }

  return consumeCssEscape(c);
}

export function canStartSimpleSelector(ch: string): boolean {
  return (
    ch === '#' ||
    ch === '.' ||
    ch === '[' ||
    ch === ':' ||
    ch === '*' ||
    ch === '|' ||
    ch === '&' ||
    canStartIdent(ch)
  );
}

export function canStartIdent(ch: string): boolean {
  return ch === '-' || ch === '\\' || isIdentHeadChar(ch);
}

export function isCombinator(ch: string): ch is Combinator {
  return ch === '>' || ch === '+' || ch === '~';
}

export function isCssWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
}

function isVerticalWhitespace(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === '\f';
}

function isHexDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||  // 0-9
    (code >= 65 && code <= 70) ||  // A-F
    (code >= 97 && code <= 102)    // a-f
  );
}

function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

export function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isIdentHeadChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return ch === '_' || code > 0x9f || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentTailChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return ch === '-' || ch === '_' || code > 0x9f || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
