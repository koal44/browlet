import { ByteCursor } from '../infra/byte-cursor';
import { TypeError } from '../infra/exceptions';
import { isomorphicDecode, isomorphicEncode } from '../js-engine/index';

/** Frame a multipart byte stream without buffering its body parts. */
// https://www.rfc-editor.org/rfc/rfc2046.html#section-5.1.1
export class MultipartParser {
  /** Input storage and reading position, independent of multipart grammar state. */
  #input = new ByteCursor();
  /** Recipient of ordered part headers, body chunks, and completion. */
  #handler: MultipartHandler;
  /** A delimiter includes the CRLF belonging to it, not to the preceding body. */
  #delimiter: Uint8Array;
  /** Start as though CRLF preceded the stream, permitting an initial --boundary. */
  #matched = 2;
  /** Current framing operation, independent of transport chunk boundaries. */
  #state: MultipartState = 'preamble';
  /** Progress through the suffix after a matched boundary. */
  #suffix: DelimiterSuffix = 'start';
  /** Whether the current delimiter terminates the multipart entity. */
  #closing = false;
  /** A closing delimiter must follow a part, not the preamble. */
  #closingAllowed = false;
  /** Fragments of the current header line; body bytes are never accumulated here. */
  #headerLine: string[] = [];
  /** Header fields collected for the current part, preserving order and duplicates. */
  #headers: MultipartHeaders = [];

  /** Supply an RFC 2046 boundary and synchronous handlers; handlers may cancel parsing. */
  constructor(boundary: string, handler: MultipartHandler) {
    if (!boundaryPattern.test(boundary)) throw new TypeError('Invalid multipart boundary');
    this.#delimiter = isomorphicEncode(`\r\n--${boundary}`);
    this.#handler = handler;
  }

  /**
   * Consume a chunk, delivering any available part data immediately.
   * Returns false for malformed input, cancellation, or data after finish().
   * Do not call appendData() or finish() recursively from a handler.
   */
  appendData(bytes: Uint8Array): boolean {
    const state = this.#state;
    if (state === 'epilogue') return true;
    if (state === 'failed' || state === 'canceled' || state === 'finished') return false;
    this.#input.appendData(bytes);
    while (this.#input.chunk.length > 0) {
      switch (this.#state) {
        case 'preamble':
        case 'body':
          this.#scanData();
          break;
        case 'delimiter':
          this.#readDelimiterSuffix();
          break;
        case 'headers':
          this.#readHeaders();
          break;
        case 'epilogue':
          this.#input.clear();
          return true;
        default:
          return false;
      }
    }
    return this.#state !== 'failed' && this.#state !== 'canceled' && this.#state !== 'finished';
  }

  /** End input. A closing delimiter is required, but its final CRLF is optional. */
  finish(): boolean {
    this.#input.finish();
    if (this.#state === 'delimiter' && this.#closing && this.#suffix === 'padding') {
      this.#state = 'epilogue';
    }
    if (this.#state === 'epilogue') this.#state = 'finished';
    if (this.#state === 'finished') return true;
    if (this.#state !== 'canceled') this.#fail();
    return false;
  }

  /** Release unread input and retained headers, suppressing all subsequent notifications. */
  cancel(): void {
    this.#state = 'canceled';
    this.#input.clear();
    this.#headerLine = [];
    this.#headers = [];
  }

  /** Scan body or preamble with only a possible delimiter prefix held back. */
  #scanData(): void {
    const input = this.#input;
    const bytes = input.chunk;
    const start = input.position;
    let position = start;
    // Commit a bulk scan on return. Cancellation from a handler clears the cursor.
    const preamble = this.#state === 'preamble';
    while (position < bytes.length) {
      if (this.#matched === 0) {
        // Skip ordinary bytes in one operation; deliver views of the input chunk.
        const cr = bytes.indexOf(0x0d, position);
        const end = cr === -1 ? bytes.length : cr;
        if (!preamble && end > position) {
          this.#handler.onPartData(bytes.subarray(position, end));
          if (this.#state !== 'body') return;
        }
        position = end;
        if (position === bytes.length) break;
      }

      if (bytes[position] === this.#delimiter[this.#matched]) {
        position++;
        this.#matched++;
        if (this.#matched === this.#delimiter.length) {
          this.#matched = 0;
          this.#state = 'delimiter';
          this.#suffix = 'start';
          this.#closing = false;
          this.#closingAllowed = !preamble;
          input.advance(position - start);
          // HTML §7.5.5 treats the boundary as this part's EOF, even if the
          // server waits before sending the suffix or the next part's headers.
          if (!preamble) this.#handler.onPartEnd();
          return;
        }
      } else {
        // Boundaries cannot contain CR, so a mismatch can restart at this byte.
        const matched = this.#matched;
        this.#matched = 0;
        if (!preamble) {
          this.#handler.onPartData(this.#delimiter.subarray(0, matched));
          if (this.#state !== 'body') return;
        }
      }
    }
    input.advance(position - start);
  }

  /** Accept transport padding, the closing -- marker, and the delimiter CRLF. */
  #readDelimiterSuffix(): void {
    const input = this.#input;
    const bytes = input.chunk;
    let position = input.position;
    while (position < bytes.length) {
      const byte = bytes[position++];
      switch (this.#suffix) {
        case 'start':
          if (byte === 0x2d) {
            this.#suffix = 'closing';
            break;
          }
          this.#suffix = 'padding';
          position--;
          break;
        case 'closing':
          if (byte !== 0x2d || !this.#closingAllowed) {
            this.#fail();
            return;
          }
          this.#closing = true;
          this.#suffix = 'padding';
          break;
        case 'padding':
          if (byte === 0x20 || byte === 0x09) break;
          if (byte !== 0x0d) {
            this.#fail();
            return;
          }
          this.#suffix = 'lf';
          break;
        case 'lf':
          if (byte !== 0x0a) {
            this.#fail();
            return;
          }
          this.#state = this.#closing ? 'epilogue' : 'headers';
          input.advance(position - input.position);
          return;
      }
    }
    input.advance(position - input.position);
  }

  /** Collect and unfold RFC 822 fields without interpreting their contents. */
  #readHeaders(): void {
    const input = this.#input;
    const bytes = input.chunk;
    let position = input.position;
    while (position < bytes.length) {
      const lf = bytes.indexOf(0x0a, position);
      if (lf === -1) {
        this.#headerLine.push(isomorphicDecode(bytes.subarray(position)));
        input.advance(bytes.length - input.position);
        return;
      }
      this.#headerLine.push(isomorphicDecode(bytes.subarray(position, lf)));
      const terminatedLine = this.#headerLine.join('');
      this.#headerLine = [];
      position = lf + 1;
      if (!terminatedLine.endsWith('\r')) {
        this.#fail();
        return;
      }
      const line = terminatedLine.slice(0, -1);
      if (line === '') {
        const headers = this.#headers;
        this.#headers = [];
        for (const header of headers) header[1] = header[1].replace(surroundingWhitespace, '');
        this.#state = 'body';
        input.advance(position - input.position);
        this.#handler.onPartHeaders(headers);
        return;
      }

      if (line[0] === ' ' || line[0] === '\t') {
        const previous = this.#headers.at(-1);
        if (!previous || !headerValuePattern.test(line)) {
          this.#fail();
          return;
        }
        previous[1] += line;
      } else {
        const colon = line.indexOf(':');
        const name = line.slice(0, colon);
        const value = line.slice(colon + 1);
        if (colon < 1 || !headerNamePattern.test(name) || !headerValuePattern.test(value)) {
          this.#fail();
          return;
        }
        this.#headers.push([name, value]);
      }
    }
    input.advance(position - input.position);
  }

  /** Stop on malformed framing without manufacturing a missing boundary. */
  #fail(): void {
    this.#state = 'failed';
    this.#input.clear();
    this.#headerLine = [];
    this.#headers = [];
  }
}

/** Synchronous notifications in wire order; callbacks may retain headers and byte views. */
export interface MultipartHandler {
  onPartHeaders(headers: MultipartHeaders): void;
  /** Treat bytes as immutable. Ordinary body chunks share the caller's input buffer. */
  onPartData(bytes: Uint8Array): void;
  onPartEnd(): void;
}

/** Uninterpreted, unfolded fields; the consumer owns defaults and field-specific parsing. */
export type MultipartHeaders = [name: string, value: string][];

type MultipartState = 'preamble' | 'delimiter' | 'headers' | 'body' | 'epilogue' | 'failed' | 'finished' | 'canceled';
type DelimiterSuffix = 'start' | 'closing' | 'padding' | 'lf';

const boundaryPattern = /^[0-9A-Za-z'()+_,./:=? -]{0,69}[0-9A-Za-z'()+_,./:=?-]$/;
const headerNamePattern = /^[\x21-\x39\x3b-\x7e]+$/;
// TODO(RFC 2046 §5.1): Audit non-ASCII header-value acceptance before loader integration.
const headerValuePattern = /^[\t\x20-\x7e\x80-\xff]*$/;
const surroundingWhitespace = /^[\t ]+|[\t ]+$/g;
