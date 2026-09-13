import { isomorphicDecode } from '../../js-engine/byte-string';
import { utf8DecodeWithoutBOM } from '../../encoding/codecs/utf-8';
import { FileImpl } from '../../file/index';
import type { RuntimeContext } from '../../js-engine/index';
import { toScalarValueString } from '../../infra/index';
import type { MIMEType } from '../../mime/index';
import { TextCursor } from '../../infra/text-cursor';
import type { FormDataEntry } from '../../xhr/index';

/*
 * Fetch §5.3, formData() multipart branch; RFC 7578 and RFC 2046 §5.1.1.
 * https://fetch.spec.whatwg.org/#dom-body-formdata
 *
 * Parse a complete body into entries whose Files retain the consuming runtime.
 * Fetch's Body integration owns FormData creation, projection, and rejection.
 */
// SPEC_MISMATCH: Body.formData() -> Promise<FormData>
export function parseMultipartFormData(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: MIMEType,
  runtime: RuntimeContext,
): FormDataEntry[] {
  const boundary = mimeType.parameters.get('boundary');
  if (
    mimeType.type !== 'multipart' || mimeType.subtype !== 'form-data' ||
    boundary === undefined ||
    !/^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/.test(boundary)
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
    // RFC 2046's preamble/epilogue are ignored; the closing-only body also
    // accepts the empty FormData serialization required by browser WPT.
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
      }, runtime);
    entries.push([toScalarValueString(name), value]);
    position = nextDelimiter + 2;
  }
}

function parsePartHeaders(input: string) {
  let disposition: string | undefined;
  let contentType: string | undefined;
  // RFC 822 unfolding removes CRLF before continuation whitespace.
  for (const line of input.replace(/\r\n(?=[ \t])/g, '').split('\r\n')) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon);
    if (colon === -1 || !/^[\x21-\x39\x3b-\x7e]+$/.test(name) || /[\r\n]/.test(line)) {
      throw new TypeError('Invalid multipart header');
    }
    const value = line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '');
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

/** RFC 822 §§3.3–3.4, linear whitespace and nested comments. */
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
