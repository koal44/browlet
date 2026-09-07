import {
  isomorphicDecode, isomorphicEncode,
} from '@exodus/bytes/encoding-lite.js';

import { collectHTTPQuotedString, isHTTPToken, isHTTPWhitespace } from '../shared/http';
import { TextCursor } from '../shared/text-cursor';

/*
 * A MIME type record.
 *
 * https://mimesniff.spec.whatwg.org/#mime-type-representation
 */
export type MIMEType = {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: Map<string, string>;
};

export type SupportsMIMEType = (mimeType: MIMEType) => boolean;

/*
 * The essence of a MIME type.
 *
 * https://mimesniff.spec.whatwg.org/#mime-type-essence
 */
export function getMIMETypeEssence(mimeType: MIMEType): string {
  return `${mimeType.type}/${mimeType.subtype}`;
}

/*
 * Minimize a supported MIME type.
 *
 * Whether a MIME type is supported is a user-agent capability rather than a
 * property of the record. Keeping the predicate explicit preserves this
 * project's host-neutral boundary.
 *
 * https://mimesniff.spec.whatwg.org/#minimize-a-supported-mime-type
 */
export function minimizeSupportedMIMEType(
  mimeType: MIMEType,
  isSupportedByUserAgent: SupportsMIMEType,
): string {
  if (isJavaScriptMIMEType(mimeType)) return 'text/javascript';
  if (isJSONMIMEType(mimeType)) return 'application/json';

  const essence = getMIMETypeEssence(mimeType);
  if (essence === 'image/svg+xml') return essence;
  if (isXMLMIMEType(mimeType)) return 'application/xml';
  if (isSupportedByUserAgent(mimeType)) return essence;
  return '';
}

/*
 * Parse a MIME type.
 *
 * https://mimesniff.spec.whatwg.org/#parse-a-mime-type
 */
export function parseMIMEType(input: string): MIMEType | null {
  input = trimHTTPWhitespace(input);
  const position = new TextCursor(input);

  const typeStart = position.pos();
  position.consumeWhile((character) => character !== '/');
  const type = position.slice(typeStart);
  if (!isHTTPToken(type)) return null;
  if (position.eof()) return null;
  position.advance();

  const subtypeStart = position.pos();
  position.consumeWhile((character) => character !== ';');
  const subtype = trimTrailingHTTPWhitespace(position.slice(subtypeStart));
  if (!isHTTPToken(subtype)) return null;

  const mimeType: MIMEType = {
    type: toASCIILowercase(type),
    subtype: toASCIILowercase(subtype),
    parameters: new Map(),
  };

  while (!position.eof()) {
    position.advance();
    position.consumeWhile(isHTTPWhitespace);

    const nameStart = position.pos();
    position.consumeWhile((character) => character !== ';' && character !== '=');
    const parameterName = toASCIILowercase(position.slice(nameStart));

    if (!position.eof()) {
      if (position.peek() === ';') continue;
      position.advance();
    }

    if (position.eof()) break;

    let parameterValue: string;
    if (position.peek() === '"') {
      parameterValue = collectHTTPQuotedString(position, true);
      position.consumeWhile((character) => character !== ';');
    } else {
      const valueStart = position.pos();
      position.consumeWhile((character) => character !== ';');
      parameterValue = trimTrailingHTTPWhitespace(position.slice(valueStart));
      if (parameterValue === '') continue;
    }

    if (
      isHTTPToken(parameterName) &&
      containsOnly(parameterValue, isHTTPQuotedStringTokenCodePoint) &&
      !mimeType.parameters.has(parameterName)
    ) {
      mimeType.parameters.set(parameterName, parameterValue);
    }
  }

  return mimeType;
}

/*
 * Parse a MIME type from bytes.
 *
 * https://mimesniff.spec.whatwg.org/#parse-a-mime-type-from-bytes
 */
export function parseMIMETypeFromBytes(input: Uint8Array): MIMEType | null {
  return parseMIMEType(isomorphicDecode(input));
}

/*
 * Serialize a MIME type.
 *
 * https://mimesniff.spec.whatwg.org/#serialize-a-mime-type
 */
export function serializeMIMEType(mimeType: MIMEType): string {
  let serialization = getMIMETypeEssence(mimeType);

  for (const [name, parameter] of mimeType.parameters) {
    let value = parameter;
    if (!isHTTPToken(value)) {
      value = `"${escapeQuotedString(value)}"`;
    }
    serialization += `;${name}=${value}`;
  }

  return serialization;
}

/*
 * Serialize a MIME type to bytes.
 *
 * https://mimesniff.spec.whatwg.org/#serialize-a-mime-type-to-bytes
 */
export function serializeMIMETypeToBytes(mimeType: MIMEType): Uint8Array {
  return isomorphicEncode(serializeMIMEType(mimeType));
}

// https://mimesniff.spec.whatwg.org/#image-mime-type
export function isImageMIMEType(mimeType: MIMEType): boolean {
  return mimeType.type === 'image';
}

// https://mimesniff.spec.whatwg.org/#audio-or-video-mime-type
export function isAudioOrVideoMIMEType(mimeType: MIMEType): boolean {
  return mimeType.type === 'audio' ||
    mimeType.type === 'video' ||
    getMIMETypeEssence(mimeType) === 'application/ogg';
}

// https://mimesniff.spec.whatwg.org/#font-mime-type
export function isFontMIMEType(mimeType: MIMEType): boolean {
  return mimeType.type === 'font' ||
    fontMIMETypeEssences.has(getMIMETypeEssence(mimeType));
}

// https://mimesniff.spec.whatwg.org/#zip-based-mime-type
export function isZIPBasedMIMEType(mimeType: MIMEType): boolean {
  return mimeType.subtype.endsWith('+zip') ||
    getMIMETypeEssence(mimeType) === 'application/zip';
}

// https://mimesniff.spec.whatwg.org/#archive-mime-type
export function isArchiveMIMEType(mimeType: MIMEType): boolean {
  return archiveMIMETypeEssences.has(getMIMETypeEssence(mimeType));
}

// https://mimesniff.spec.whatwg.org/#xml-mime-type
export function isXMLMIMEType(mimeType: MIMEType): boolean {
  const essence = getMIMETypeEssence(mimeType);
  return mimeType.subtype.endsWith('+xml') ||
    essence === 'text/xml' ||
    essence === 'application/xml';
}

// https://mimesniff.spec.whatwg.org/#html-mime-type
export function isHTMLMIMEType(mimeType: MIMEType): boolean {
  return getMIMETypeEssence(mimeType) === 'text/html';
}

// https://mimesniff.spec.whatwg.org/#scriptable-mime-type
export function isScriptableMIMEType(mimeType: MIMEType): boolean {
  return isXMLMIMEType(mimeType) ||
    isHTMLMIMEType(mimeType) ||
    getMIMETypeEssence(mimeType) === 'application/pdf';
}

// https://mimesniff.spec.whatwg.org/#javascript-mime-type
export function isJavaScriptMIMEType(mimeType: MIMEType): boolean {
  return javaScriptMIMETypeEssences.has(getMIMETypeEssence(mimeType));
}

// https://mimesniff.spec.whatwg.org/#javascript-mime-type-essence-match
export function isJavaScriptMIMETypeEssenceMatch(input: string): boolean {
  return javaScriptMIMETypeEssences.has(toASCIILowercase(input));
}

// https://mimesniff.spec.whatwg.org/#json-mime-type
export function isJSONMIMEType(mimeType: MIMEType): boolean {
  const essence = getMIMETypeEssence(mimeType);
  return mimeType.subtype.endsWith('+json') ||
    essence === 'application/json' ||
    essence === 'text/json';
}

const fontMIMETypeEssences = new Set([
  'application/font-cff',
  'application/font-otf',
  'application/font-sfnt',
  'application/font-ttf',
  'application/font-woff',
  'application/vnd.ms-fontobject',
  'application/vnd.ms-opentype',
]);

const archiveMIMETypeEssences = new Set([
  'application/x-rar-compressed',
  'application/zip',
  'application/x-gzip',
]);

const javaScriptMIMETypeEssences = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

function trimHTTPWhitespace(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && isHTTPWhitespace(input[start]!)) start++;
  while (end > start && isHTTPWhitespace(input[end - 1]!)) end--;
  return input.slice(start, end);
}

function trimTrailingHTTPWhitespace(input: string): string {
  let end = input.length;
  while (end > 0 && isHTTPWhitespace(input[end - 1]!)) end--;
  return input.slice(0, end);
}

function isHTTPQuotedStringTokenCodePoint(character: string): boolean {
  const code = character.charCodeAt(0);
  return code === 0x09 ||
    code >= 0x20 && code <= 0x7e ||
    code >= 0x80 && code <= 0xff;
}

function containsOnly(
  input: string,
  predicate: (character: string) => boolean,
): boolean {
  for (let i = 0; i < input.length; i++) {
    if (!predicate(input[i]!)) return false;
  }
  return true;
}

function toASCIILowercase(input: string): string {
  let output = '';
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x41 || code > 0x5a) continue;
    output += input.slice(start, i) + String.fromCharCode(code + 0x20);
    start = i + 1;
  }

  return start === 0 ? input : output + input.slice(start);
}

function escapeQuotedString(input: string): string {
  let output = '';
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const character = input[i]!;
    if (character !== '"' && character !== '\\') continue;
    output += `${input.slice(start, i)}\\${character}`;
    start = i + 1;
  }

  return start === 0 ? input : output + input.slice(start);
}
