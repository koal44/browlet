import { utf8DecodeWithoutBOMOrFail, utf8Encode } from '../encoding/index';
import { forgivingBase64Decode, forgivingBase64Encode } from '../infra/base64';
import { TextCursor } from '../infra/text-cursor';
import { isomorphicDecode } from '../js-engine/index';

/** Parse a combined field value; discard the whole field on malformed syntax. */
// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2
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

/** Serialize without mutation: undefined omits an empty list/dictionary; null means failure. */
// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1
export function serializeStructuredField(
  field: StructuredField,
): string | null | undefined {
  switch (field.type) {
    case 'list': {
      if (field.members.length === 0) return undefined;
      const output: string[] = [];
      for (const member of field.members) {
        const value = serializeMember(member);
        if (value === null) return null;
        output.push(value);
      }
      return output.join(', ');
    }
    case 'dictionary': {
      if (field.members.size === 0) return undefined;
      const output: string[] = [];
      for (const [key, member] of field.members) {
        if (!isKey(key)) return null;
        if (
          member.type === 'item' &&
          member.bareItem.type === 'boolean' && member.bareItem.value
        ) {
          const parameters = serializeParameters(member.parameters);
          if (parameters === null) return null;
          output.push(key + parameters);
        } else {
          const value = serializeMember(member);
          if (value === null) return null;
          output.push(`${key}=${value}`);
        }
      }
      return output.join(', ');
    }
    case 'item':
      return serializeMember(field);
  }
}

/** Tagged values preserve wire-type distinctions; Maps retain dictionary and parameter order. */
// https://www.rfc-editor.org/rfc/rfc9651.html#section-3
export type StructuredField = StructuredList | StructuredDictionary | StructuredItem;

export type StructuredList = {
  type: 'list';
  members: (StructuredItem | StructuredInnerList)[];
};

export type StructuredDictionary = {
  type: 'dictionary';
  members: Map<string, StructuredItem | StructuredInnerList>;
};

export type StructuredItem = {
  type: 'item';
  bareItem: StructuredBareItem;
  parameters: StructuredParameters;
};

export type StructuredInnerList = {
  type: 'inner-list';
  items: StructuredItem[];
  parameters: StructuredParameters;
};

export type StructuredParameters = Map<string, StructuredBareItem>;

// Integer and Date limits fit exactly in a JavaScript number. Dates retain
// epoch seconds, without the narrower range or millisecond units of JS Date.
// Decimal serialization interprets a number's shortest decimal spelling and
// applies RFC 9651 §4.1.5 rounding. Other invalid values fail serialization.
export type StructuredBareItem =
  | { type: 'integer'; value: number; }
  | { type: 'decimal'; value: number; }
  | { type: 'string'; value: string; }
  | { type: 'token'; value: string; }
  | { type: 'bytes'; value: Uint8Array; }
  | { type: 'boolean'; value: boolean; }
  | { type: 'date'; value: number; }
  | { type: 'display-string'; value: string; };

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.1
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.1.1
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.2
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
      member = {
        type: 'item',
        bareItem: { type: 'boolean', value: true },
        parameters,
      };
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.3
function parseItem(input: TextCursor): StructuredItem | null {
  const bareItem = parseBareItem(input);
  if (bareItem === null) return null;
  const parameters = parseParameters(input);
  return parameters === null ? null : { type: 'item', bareItem, parameters };
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.3.1
function parseBareItem(input: TextCursor): StructuredBareItem | null {
  const first = input.peek();
  if (first === '-' || isDigit(first)) return parseNumber(input);
  if (tokenStartPattern.test(first)) {
    const start = input.pos();
    input.consumeWhile((char) => tokenCharacterPattern.test(char));
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.3.2
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.3.3
function parseKey(input: TextCursor): string | null {
  if (!keyStartPattern.test(input.peek())) return null;
  const start = input.pos();
  input.consumeWhile((char) => keyCharacterPattern.test(char));
  return input.slice(start);
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.4
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.5
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

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.7
function parseBytes(input: TextCursor): StructuredBareItem | null {
  input.advance();
  const start = input.pos();
  input.consumeWhile((char) => base64CharacterPattern.test(char));
  const encoded = input.slice(start);
  if (!input.match(':')) return null;
  // Validate the alphabet before the shared forgiving decoder can strip space.
  const value = forgivingBase64Decode(encoded);
  return value === null ? null : { type: 'bytes', value };
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.2.10
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
      if (!lowercaseHexBytePattern.test(hex)) return null;
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

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.1.1
function serializeMember(member: StructuredItem | StructuredInnerList): string | null {
  let value: string | null;
  if (member.type === 'inner-list') {
    const items: string[] = [];
    for (const item of member.items) {
      const serialized = serializeMember(item);
      if (serialized === null) return null;
      items.push(serialized);
    }
    value = `(${items.join(' ')})`;
  } else {
    value = serializeBareItem(member.bareItem);
    if (value === null) return null;
  }

  const parameters = serializeParameters(member.parameters);
  return parameters === null ? null : value + parameters;
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.1.2
function serializeParameters(parameters: StructuredParameters): string | null {
  let output = '';
  for (const [key, value] of parameters) {
    if (!isKey(key)) return null;
    output += `;${key}`;
    if (value.type === 'boolean' && value.value) continue;
    const serialized = serializeBareItem(value);
    if (serialized === null) return null;
    output += `=${serialized}`;
  }
  return output;
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.1.3
function isKey(key: string): boolean {
  return keyStartPattern.test(key) && !invalidKeyCharacterPattern.test(key);
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.3.1
function serializeBareItem(item: StructuredBareItem): string | null {
  switch (item.type) {
    case 'integer':
      return serializeInteger(item.value);
    case 'decimal':
      return serializeDecimal(item.value);
    case 'string':
      if (invalidStringCharacterPattern.test(item.value)) return null;
      return `"${item.value.replace(stringEscapePattern, '\\$&')}"`;
    case 'token':
      if (
        !tokenStartPattern.test(item.value) ||
        invalidTokenCharacterPattern.test(item.value)
      ) return null;
      return item.value;
    case 'bytes':
      return `:${forgivingBase64Encode(item.value)}:`;
    case 'boolean':
      return item.value ? '?1' : '?0';
    case 'date': {
      const seconds = serializeInteger(item.value);
      return seconds === null ? null : `@${seconds}`;
    }
    case 'display-string':
      return serializeDisplayString(item.value);
  }
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.4
function serializeInteger(value: number): string | null {
  if (!Number.isInteger(value) || Math.abs(value) > 999_999_999_999_999) {
    return null;
  }
  return String(value);
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.5
function serializeDecimal(value: number): string | null {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(value) || magnitude >= 1_000_000_000_000) return null;
  if (magnitude <= 0.0005) return '0.0';

  // Remaining magnitudes have no exponent in their shortest decimal spelling.
  // Round those digits, avoiding binary multiplication changing a decimal tie.
  const [integer, fraction = ''] = String(magnitude).split('.');
  let thousandths = Number(integer) * 1000 +
    Number(fraction.padEnd(3, '0').slice(0, 3));
  const discarded = fraction.slice(3);
  if (
    discarded[0] !== undefined && (
      discarded[0] > '5' ||
      discarded[0] === '5' && (
        nonzeroDigitPattern.test(discarded.slice(1)) || thousandths % 2 !== 0
      )
    )
  ) thousandths++;

  if (thousandths > 999_999_999_999_999) return null;
  const whole = Math.floor(thousandths / 1000);
  const fractional = String(thousandths % 1000).padStart(3, '0')
    .replace(trailingZerosPattern, '') || '0';
  return `${value < 0 ? '-' : ''}${whole}.${fractional}`;
}

// https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1.10
function serializeDisplayString(value: string): string | null {
  if (!value.isWellFormed()) return null;
  let output = '%"';
  for (const byte of utf8Encode(value)) {
    output += byte === 0x25 || byte === 0x22 || byte < 0x20 || byte > 0x7e
      ? `%${byte.toString(16).padStart(2, '0')}`
      : String.fromCharCode(byte);
  }
  return output + '"';
}

const tokenStartPattern = /^[A-Za-z*]/;
const tokenCharacterPattern = /[A-Za-z0-9!#$%&'*+\-.^_`|~:/]/;
const keyStartPattern = /^[a-z*]/;
const keyCharacterPattern = /[a-z0-9_.*-]/;
const base64CharacterPattern = /[A-Za-z0-9+/=]/;
const lowercaseHexBytePattern = /^[0-9a-f]{2}$/;
const invalidKeyCharacterPattern = /[^a-z0-9_.*-]/;
const invalidStringCharacterPattern = /[^\x20-\x7e]/;
const stringEscapePattern = /["\\]/g;
const invalidTokenCharacterPattern = /[^A-Za-z0-9!#$%&'*+\-.^_`|~:/]/;
const nonzeroDigitPattern = /[1-9]/;
const trailingZerosPattern = /0+$/;
