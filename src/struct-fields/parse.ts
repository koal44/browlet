import { isomorphicDecode } from '@exodus/bytes/encoding-lite.js';

import { utf8DecodeWithoutBOMOrFail } from '../encoding/utf-8';
import { forgivingBase64Decode } from '../infra/base64';
import { TextCursor } from '../shared/text-cursor';

import type {
  StructuredBareItem, StructuredDictionary, StructuredField, StructuredInnerList,
  StructuredItem, StructuredList, StructuredParameters,
} from './values';

/*
 * RFC 9651 §4.2, Parsing Structured Fields.
 *
 * input is the combined field value, including commas between field lines.
 * Failure discards the whole field. No header-specific interpretation occurs.
 * https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2
 */
export function parseStructuredField<T extends StructuredField['type']>(
  input: Uint8Array, type: T,
): Extract<StructuredField, { type: T; }> | null;
export function parseStructuredField(
  input: Uint8Array, type: StructuredField['type'],
): StructuredField | null {
  if (input.some((byte) => byte > 0x7f)) return null;
  const cursor = new TextCursor(isomorphicDecode(input));
  cursor.consumeWhile((char) => char === ' ');

  let field: StructuredField | null;
  switch (type) {
    case 'list': field = parseList(cursor); break;
    case 'dictionary': field = parseDictionary(cursor); break;
    case 'item': field = parseItem(cursor); break;
  }
  cursor.consumeWhile((char) => char === ' ');
  return cursor.eof() ? field : null;
}

/** RFC 9651 §4.2.1, Lists. */
function parseList(input: TextCursor): StructuredList | null {
  const members: StructuredList['members'] = [];
  while (!input.eof()) {
    const member = parseMember(input);
    if (member === null) return null;
    members.push(member);
    input.consumeWhile(isOWS);
    if (input.eof()) break;
    if (!input.match(',')) return null;
    input.consumeWhile(isOWS);
    if (input.eof()) return null;
  }
  return { type: 'list', members };
}

/** RFC 9651 §4.2.1.1–§4.2.1.2, Items or Inner Lists. */
function parseMember(input: TextCursor): StructuredItem | StructuredInnerList | null {
  if (!input.match('(')) return parseItem(input);
  const items: StructuredItem[] = [];
  while (!input.eof()) {
    input.consumeWhile((char) => char === ' ');
    if (input.match(')')) {
      const parameters = parseParameters(input);
      return parameters === null ? null : { type: 'inner-list', items, parameters };
    }
    const item = parseItem(input);
    if (item === null) return null;
    items.push(item);
    if (input.peek() !== ' ' && input.peek() !== ')') return null;
  }
  return null;
}

/** RFC 9651 §4.2.2, Dictionaries. */
function parseDictionary(input: TextCursor): StructuredDictionary | null {
  const members: StructuredDictionary['members'] = new Map();
  while (!input.eof()) {
    const key = parseKey(input);
    if (key === null) return null;
    let member: StructuredItem | StructuredInnerList | null;
    if (input.match('=')) {
      member = parseMember(input);
      if (member === null) return null;
    } else {
      const parameters = parseParameters(input);
      if (parameters === null) return null;
      member = { type: 'item', value: { type: 'boolean', value: true }, parameters };
    }
    members.set(key, member);
    input.consumeWhile(isOWS);
    if (input.eof()) break;
    if (!input.match(',')) return null;
    input.consumeWhile(isOWS);
    if (input.eof()) return null;
  }
  return { type: 'dictionary', members };
}

/** RFC 9651 §4.2.3, Items. */
function parseItem(input: TextCursor): StructuredItem | null {
  const value = parseBareItem(input);
  if (value === null) return null;
  const parameters = parseParameters(input);
  return parameters === null ? null : { type: 'item', value, parameters };
}

/** RFC 9651 §4.2.3.1, Bare Items. */
function parseBareItem(input: TextCursor): StructuredBareItem | null {
  const first = input.peek();
  if (first === '-' || isDigit(first)) return parseNumber(input);
  if (/^[A-Za-z*]/.test(first)) {
    const start = input.pos();
    input.consumeWhile((char) => /[A-Za-z0-9!#$%&'*+\-.^_`|~:/]/.test(char));
    return { type: 'token', value: input.slice(start) };
  }
  switch (first) {
    case '"':
      return parseString(input);
    case ':':
      return parseBytes(input);
    case '?': {
      input.advance();
      const value = input.next();
      return value === '1' || value === '0' ? { type: 'boolean', value: value === '1' } : null;
    }
    case '@': {
      input.advance();
      const number = parseNumber(input);
      return number?.type === 'integer' ? { type: 'date', value: number.value } : null;
    }
    case '%':
      return parseDisplayString(input);
    default:
      return null;
  }
}

/** RFC 9651 §4.2.3.2, Parameters. */
function parseParameters(input: TextCursor): StructuredParameters | null {
  const parameters: StructuredParameters = new Map();
  while (input.match(';')) {
    input.consumeWhile((char) => char === ' ');
    const key = parseKey(input);
    if (key === null) return null;
    const value: StructuredBareItem | null = input.match('=')
      ? parseBareItem(input) : { type: 'boolean', value: true };
    if (value === null) return null;
    parameters.set(key, value);
  }
  return parameters;
}

/** RFC 9651 §4.2.3.3, Keys. */
function parseKey(input: TextCursor): string | null {
  if (!/^[a-z*]/.test(input.peek())) return null;
  const start = input.pos();
  input.consumeWhile((char) => /[a-z0-9_.*-]/.test(char));
  return input.slice(start);
}

/** RFC 9651 §4.2.4, Integers or Decimals. */
function parseNumber(input: TextCursor): StructuredBareItem | null {
  const start = input.pos();
  input.match('-');
  const digits = input.consumeWhile(isDigit);
  if (digits === 0 || digits > 15) return null;
  let type: 'integer' | 'decimal' = 'integer';
  if (input.match('.')) {
    if (digits > 12) return null;
    const fractionalDigits = input.consumeWhile(isDigit);
    if (fractionalDigits === 0 || fractionalDigits > 3) return null;
    type = 'decimal';
  }
  const value = Number(input.slice(start));
  return { type, value: value === 0 ? 0 : value };
}

/** RFC 9651 §4.2.5, Strings. */
function parseString(input: TextCursor): StructuredBareItem | null {
  input.advance();
  let value = '';
  while (!input.eof()) {
    const char = input.next();
    if (char === '"') return { type: 'string', value };
    if (char === '\\') {
      const escaped = input.next();
      if (escaped !== '"' && escaped !== '\\') return null;
      value += escaped;
    } else {
      if (char < ' ' || char > '~') return null;
      value += char;
    }
  }
  return null;
}

/** RFC 9651 §4.2.7, Byte Sequences. */
function parseBytes(input: TextCursor): StructuredBareItem | null {
  input.advance();
  const start = input.pos();
  input.consumeWhile((char) => /[A-Za-z0-9+/=]/.test(char));
  const encoded = input.slice(start);
  if (!input.match(':')) return null;
  // Validate the alphabet before the shared forgiving decoder can strip space.
  const value = forgivingBase64Decode(encoded);
  return value === null ? null : { type: 'bytes', value };
}

/** RFC 9651 §4.2.10, Display Strings. */
function parseDisplayString(input: TextCursor): StructuredBareItem | null {
  input.advance();
  if (!input.match('"')) return null;
  const bytes: number[] = [];
  while (!input.eof()) {
    const char = input.next();
    if (char === '"') {
      const value = utf8DecodeWithoutBOMOrFail(Uint8Array.from(bytes));
      return value === null ? null : { type: 'display-string', value };
    }
    if (char < ' ' || char > '~') return null;
    if (char === '%') {
      const hex = input.next() + input.next();
      if (!/^[0-9a-f]{2}$/.test(hex)) return null;
      bytes.push(Number.parseInt(hex, 16));
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }
  return null;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isOWS(char: string): boolean {
  return char === ' ' || char === '\t';
}
