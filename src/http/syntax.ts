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
