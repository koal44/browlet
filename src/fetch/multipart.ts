import { encode, utf8DecodeWithoutBOM, type Encoding } from '../encoding/index';
import { BlobData, FileImpl } from '../file/index';
import { TypeError } from '../infra/exceptions';
import { toScalarValueString } from '../infra/index';
import { lineEndingPattern, surroundingTabOrSpacePattern } from '../infra/patterns';
import { TextCursor } from '../infra/text-cursor';
import { isomorphicDecode, isomorphicEncode, randomUUID, type JSEnvironment } from '../js-engine/index';
import type { MIMEType } from '../mime/index';
import { percentEncodeByte } from '../url/index';
import type { FormDataEntry } from '../xhr/index';

/** Encode headers and text, retaining File data and leaving the entry list unchanged. */
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm
export function encodeMultipartFormData(
  entries: FormDataEntry[],
  encoding: Encoding,
): MultipartEncoding {
  // A random boundary avoids eagerly reading every File to scan for collisions.
  const boundary = randomUUID();
  const lineEnding = BlobData.fromOwnedBytes(isomorphicEncode('\r\n'));
  const parts: BlobData[] = [];
  for (const [name, value] of entries) {
    const normalizedName = name.replace(lineEndingPattern, '\r\n');
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(normalizedName, encoding)}"`;
    if (typeof value === 'string') {
      parts.push(
        BlobData.fromOwnedBytes(isomorphicEncode(header + '\r\n\r\n')),
        BlobData.fromOwnedBytes(encode(value.replace(lineEndingPattern, '\r\n'), encoding)),
      );
    } else {
      header += `; filename="${escapeName(value.name, encoding)}"\r\n`;
      header += `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`;
      parts.push(BlobData.fromOwnedBytes(isomorphicEncode(header)), value.data);
    }
    parts.push(lineEnding);
  }
  // SPEC_CLASH(multipart-empty-body): The empty-FormData WPT expects zero bytes; browsers emit this closing boundary.
  parts.push(BlobData.fromOwnedBytes(isomorphicEncode(`--${boundary}--\r\n`)));
  return { boundary, data: BlobData.concatenate(parts) };
}

export type MultipartEncoding = {
  /** Boundary token shared by the multipart delimiters and the Content-Type parameter. */
  boundary: string;
  /** Complete encoded body, retaining shared file data instead of flattening it into bytes. */
  data: BlobData;
};

/** Parse a complete multipart body into entries and Files owned by the consuming environment. */
// The multipart branch of https://fetch.spec.whatwg.org/#dom-body-formdata
// https://www.rfc-editor.org/rfc/rfc7578.html#section-4
// https://www.rfc-editor.org/rfc/rfc2046.html#section-5.1.1
// SPEC_CLASH(multipart-part-recovery): Reject malformed parts as a whole; WebKit can keep valid siblings.
export function parseMultipartFormData(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: MIMEType,
  env: JSEnvironment,
): FormDataEntry[] {
  const boundary = mimeType.parameters.get('boundary');
  if (
    mimeType.type !== 'multipart' || mimeType.subtype !== 'form-data' ||
    boundary === undefined ||
    !boundaryPattern.test(boundary)
  ) throw new TypeError('Invalid multipart boundary or MIME type');

  // One code unit per byte keeps delimiter offsets exact, including binary
  // file data. Only header values and non-file bodies undergo UTF-8 decoding.
  const input = isomorphicDecode(bytes);
  const delimiter = `--${boundary}`;
  const entries: FormDataEntry[] = [];
  let position = 0;
  if (!input.startsWith(delimiter)) {
    position = input.indexOf(`\r\n${delimiter}`);
    if (position === -1) throw new TypeError('Missing multipart delimiter');
    position += 2;
  }

  while (true) {
    position += delimiter.length;
    const closing = input.startsWith('--', position);
    if (closing) position += 2;
    while (input[position] === ' ' || input[position] === '\t') position++;
    if (closing && position === input.length) return entries;
    if (!input.startsWith('\r\n', position)) {
      throw new TypeError('Invalid multipart delimiter ending');
    }
    position += 2;
    // SPEC_CLASH(multipart-empty-body): Accept browsers' closing-only empty FormData despite RFC 2046's first-part grammar.
    // Preamble/epilogue are ignored; no part or File is synthesized for an empty body.
    if (closing) return entries;

    const nextDelimiter = input.indexOf(`\r\n${delimiter}`, position);
    if (nextDelimiter === -1) throw new TypeError('Incomplete multipart body');
    const headerEnd = input.indexOf('\r\n\r\n', position);
    if (headerEnd === -1 || headerEnd + 4 > nextDelimiter) {
      throw new TypeError('Missing multipart header separator');
    }
    const { name, filename, contentType } = parsePartHeaders(
      utf8DecodeWithoutBOM(bytes.subarray(position, headerEnd)),
    );
    const body = bytes.subarray(headerEnd + 4, nextDelimiter);
    const value = filename === undefined
      ? toScalarValueString(utf8DecodeWithoutBOM(body))
      : new FileImpl([body], filename, {
        type: contentType ?? 'text/plain',
      }, env);
    entries.push([toScalarValueString(name), value]);
    position = nextDelimiter + 2;
  }
}

function escapeName(value: string, encoding: Encoding): string {
  return isomorphicDecode(encode(value, encoding)).replace(nameEscapePattern,
    (char) => percentEncodeByte(char.charCodeAt(0)));
}

const nameEscapePattern = /[\r\n"]/g;

function parsePartHeaders(input: string) {
  let disposition: string | undefined;
  let contentType: string | undefined;
  // RFC 822 unfolding removes CRLF before continuation whitespace.
  for (const line of input.replace(headerFoldingPattern, '').split('\r\n')) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon);
    if (colon === -1 || !headerNamePattern.test(name) || lineBreakPattern.test(line)) {
      throw new TypeError('Invalid multipart header');
    }
    const value = line.slice(colon + 1).replace(surroundingTabOrSpacePattern, '');
    switch (name.toLowerCase()) {
      case 'content-disposition':
        if (disposition !== undefined) throw new TypeError('Duplicate Content-Disposition');
        disposition = value;
        break;
      case 'content-type':
        if (contentType !== undefined) throw new TypeError('Duplicate Content-Type');
        contentType = value;
        break;
    }
  }
  if (disposition === undefined) throw new TypeError('Missing Content-Disposition');

  // RFC 2183 §2 imports RFC 2045 §5.1's token/parameter grammar and RFC
  // 822's quoted pairs. RFC 7578 permits raw UTF-8 in quoted names/filenames.
  const cursor = new TextCursor(disposition);
  skipWhitespaceAndComments(cursor);
  const typeStart = cursor.pos();
  cursor.consumeWhile(isMIMETokenCharacter);
  if (cursor.slice(typeStart).toLowerCase() !== 'form-data') {
    throw new TypeError('Expected form-data Content-Disposition');
  }
  skipWhitespaceAndComments(cursor);
  const parameters = new Map<string, string>();
  while (!cursor.eof()) {
    if (!cursor.match(';')) throw new TypeError('Invalid disposition parameter');
    skipWhitespaceAndComments(cursor);
    const nameStart = cursor.pos();
    cursor.consumeWhile(isMIMETokenCharacter);
    const name = cursor.slice(nameStart).toLowerCase();
    skipWhitespaceAndComments(cursor);
    if (name === '' || !cursor.match('=')) {
      throw new TypeError('Invalid disposition parameter name');
    }
    skipWhitespaceAndComments(cursor);
    let value = '';
    if (cursor.match('"')) {
      while (true) {
        if (cursor.eof()) throw new TypeError('Unterminated disposition parameter');
        const character = cursor.next();
        if (character === '"') break;
        if (character === '\\') {
          if (cursor.eof()) throw new TypeError('Unterminated quoted pair');
          value += cursor.next();
        } else {
          value += character;
        }
      }
    } else {
      const start = cursor.pos();
      cursor.consumeWhile(isMIMETokenCharacter);
      value = cursor.slice(start);
      if (value === '') throw new TypeError('Missing disposition parameter value');
    }
    if (parameters.has(name)) throw new TypeError('Duplicate disposition parameter');
    parameters.set(name, value);
    skipWhitespaceAndComments(cursor);
  }
  const name = parameters.get('name');
  if (name === undefined) throw new TypeError('Missing form-data name');
  return { name, filename: parameters.get('filename'), contentType };
}

function isMIMETokenCharacter(character: string): boolean {
  return character > ' ' && character < '\x7f' &&
    !'()<>@,;:\\"/[]?='.includes(character);
}

// RFC 822 linear whitespace and nested comments.
// https://www.rfc-editor.org/rfc/rfc822.html#section-3.4
function skipWhitespaceAndComments(cursor: TextCursor): void {
  while (true) {
    cursor.consumeWhile((character) => character === ' ' || character === '\t');
    if (!cursor.match('(')) return;
    let depth = 1;
    while (depth !== 0) {
      if (cursor.eof()) throw new TypeError('Unterminated MIME comment');
      switch (cursor.next()) {
        case '(':
          depth++;
          break;
        case ')':
          depth--;
          break;
        case '\\':
          if (cursor.eof()) throw new TypeError('Unterminated MIME quoted pair');
          cursor.advance();
          break;
      }
    }
  }
}

const boundaryPattern = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/;
const headerFoldingPattern = /\r\n(?=[ \t])/g;
const headerNamePattern = /^[\x21-\x39\x3b-\x7e]+$/;
const lineBreakPattern = /[\r\n]/;
