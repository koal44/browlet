import { describe, expect, it } from 'vitest';

import { collectHTTPQuotedString, isHTTPNewline, isHTTPTabOrSpace, isHTTPToken, isHTTPWhitespace } from '../../../src/http/syntax';
import { TextCursor } from '../../../src/shared/text-cursor';

describe('HTTP syntax and quoted strings (Fetch §2.2)', () => {
  it('recognizes the exact token alphabet and HTTP whitespace bytes', () => {
    const alphabet = "!#$%&'*+-.^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    expect(isHTTPToken(alphabet)).toBe(true);
    expect(isHTTPToken('')).toBe(false);
    for (let byte = 0; byte < 256; byte++) {
      const character = String.fromCharCode(byte);
      expect(isHTTPToken(character), `token byte ${byte}`).toBe(alphabet.includes(character));
      expect(isHTTPNewline(character), `newline byte ${byte}`).toBe([10, 13].includes(byte));
      expect(isHTTPTabOrSpace(character), `space byte ${byte}`).toBe([9, 32].includes(byte));
      expect(isHTTPWhitespace(character), `whitespace byte ${byte}`).toBe([9, 10, 13, 32].includes(byte));
    }
  });

  it.each([
    ['"\\', '"\\', '\\', 2],
    ['"Hello" World', '"Hello"', 'Hello', 7],
    ['"Hello \\\\ World\\"" tail', '"Hello \\\\ World\\""', 'Hello \\ World"', 18],
    ['""tail', '""', '', 2],
    ['"unterminated', '"unterminated', 'unterminated', 13],
    ['"a,b"next', '"a,b"', 'a,b', 5],
    ['"\\😀"next', '"\\😀"', '😀', 5],
  ])('collects the consumed portion of %j', (input, raw, extracted, end) => {
    const cursor = new TextCursor(input);
    expect(collectHTTPQuotedString(cursor)).toBe(raw);
    expect(cursor.pos()).toBe(end);
    const extractCursor = new TextCursor(input);
    expect(collectHTTPQuotedString(extractCursor, true)).toBe(extracted);
    expect(extractCursor.pos()).toBe(end);
  });

  it('starts at the supplied position without consuming the following delimiter', () => {
    const cursor = new TextCursor('prefix "a\\"b", next', 7);
    expect(collectHTTPQuotedString(cursor)).toBe('"a\\"b"');
    expect(cursor.peek()).toBe(',');
  });
});
