import type { TextCursor } from '../infra/text-cursor';

/**
 * Fetch §2.2 — collect an HTTP quoted string, starting at its opening quote.
 * The cursor combines the specification's input string and mutable position.
 */
export function collectHTTPQuotedString(c: TextCursor, extractValue = false): string {
  const positionStart = c.pos();
  c.advance();
  let value = '';

  while (true) {
    const start = c.pos();
    c.consumeWhile((character) => character !== '"' && character !== '\\');
    value += c.slice(start);
    if (c.eof()) break;

    const quoteOrBackslash = c.next();
    if (quoteOrBackslash === '"') break;
    if (c.eof()) {
      value += '\\';
      break;
    }
    value += c.next();
  }

  return extractValue ? value : c.slice(positionStart);
}

/** RFC 9110 §5.6.2 — the nonempty token production, also used for methods/names. */
export function isHTTPToken(value: string): boolean {
  return value !== '' && !/[^!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(value);
}

/** Fetch §2.2. These predicates operate on one isomorphically decoded byte. */
export function isHTTPWhitespace(character: string): boolean {
  return isHTTPNewline(character) || isHTTPTabOrSpace(character);
}

export function isHTTPNewline(character: string): boolean {
  return character === '\n' || character === '\r';
}

export function isHTTPTabOrSpace(character: string): boolean {
  return character === '\t' || character === ' ';
}
