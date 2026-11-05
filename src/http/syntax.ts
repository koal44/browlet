import type { TextCursor } from '../infra/text-cursor';

/** Consume from the opening quote; return the source text or its unescaped value. */
// https://fetch.spec.whatwg.org/#collect-an-http-quoted-string
// The cursor combines the specification's input string and mutable position.
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

/** Consume one token or complete quoted string, unescaping its value; return null for invalid syntax. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4
// Unlike Fetch's quoted-string collector, RFC 9110 requires a closing quote
// and only permits HTAB, SP, visible ASCII, and obs-text within quoted pairs.
export function collectHTTPTokenOrQuotedString(cursor: TextCursor): string | null {
  if (!cursor.match('"')) {
    const start = cursor.pos();
    cursor.consumeWhile(isHTTPToken);
    return cursor.slice(start) || null;
  }
  let value = '';
  while (!cursor.eof()) {
    let ch = cursor.next();
    if (ch === '"') return value;
    if (ch === '\\') {
      if (cursor.eof()) return null;
      ch = cursor.next();
    }
    if (ch !== '\t' && (ch < ' ' || ch === '\x7f' || ch > '\xff')) return null;
    value += ch;
  }
  return null;
}

/** Test a nonempty HTTP token, such as a method or header name. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2
export function isHTTPToken(value: string): boolean {
  return value !== '' && !invalidTokenCharacterPattern.test(value);
}

/** Test one decoded byte for an HTTP space, tab, or newline. */
// https://fetch.spec.whatwg.org/#http-whitespace
export function isHTTPWhitespace(character: string): boolean {
  return isHTTPNewline(character) || isHTTPTabOrSpace(character);
}

function isHTTPNewline(character: string): boolean {
  return character === '\n' || character === '\r';
}

/** Test one decoded byte for an HTTP tab or space. */
// https://fetch.spec.whatwg.org/#http-tab-or-space
export function isHTTPTabOrSpace(character: string): boolean {
  return character === '\t' || character === ' ';
}

const invalidTokenCharacterPattern = /[^!#$%&'*+\-.^_`|~0-9A-Za-z]/;
