import { isomorphicEncode } from '../js-engine/index';
import { getEncoding, type Encoding } from '../encoding/index';
import { TypeError } from '../infra/exceptions';
import { getMIMETypeEssence, parseMIMEType, type MIMEType, type MIMETypeEssence } from '../mime/index';
import {
  collectHTTPQuotedString, isHTTPTabOrSpace, isHTTPToken, parseStructuredField, serializeStructuredField,
  type StructuredField,
} from '../http/index';
import { TextCursor } from '../infra/text-cursor';
import { nonASCIIDigitPattern, surroundingTabOrSpacePattern } from '../infra/patterns';
import {
  arg, ctor, defineInterface, defineTypedef, idlType, impl, iter, nullable, op,
  record, reference, sequence, union,
} from '../web-idl/index';
import type { FetchEnvironment } from './environment';

/** An ordered header list shared by Fetch algorithms and guarded Headers implementations. */
// https://fetch.spec.whatwg.org/#concept-header-list
export class FetchHeaders {
  /** Raw byte-string pairs, preserving duplicate lines and their order. */
  list: Header[];

  constructor(list: Header[] = []) {
    this.list = list;
  }

  /** Test whether the case-insensitive name is present. */
  has(name: string): boolean {
    const lower = name.toLowerCase();
    return this.list.some((header) => header[0].toLowerCase() === lower);
  }

  /** Combine matching values, or return null when the name is absent. */
  // https://fetch.spec.whatwg.org/#concept-header-list-get
  get(name: string): string | null {
    const lower = name.toLowerCase();
    let combined: string | null = null;
    for (const [headerName, value] of this.list) {
      if (headerName.toLowerCase() === lower) {
        combined = combined === null ? value : `${combined}, ${value}`;
      }
    }
    return combined;
  }

  /** Append a line using the first matching name's spelling. */
  // https://fetch.spec.whatwg.org/#concept-header-list-append
  append(name: string, value: string): void {
    const lower = name.toLowerCase();
    const existing = this.list.find((header) => header[0].toLowerCase() === lower);
    this.list.push([existing?.[0] ?? name, value]);
  }

  /** Delete every line with the case-insensitive name. */
  // https://fetch.spec.whatwg.org/#concept-header-list-delete
  delete(name: string): void {
    const lower = name.toLowerCase();
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]![0].toLowerCase() === lower) this.list.splice(i, 1);
    }
  }

  /** Replace matches in place, preserving the first entry's spelling and position. */
  // https://fetch.spec.whatwg.org/#concept-header-list-set
  set(name: string, value: string): void {
    const lower = name.toLowerCase();
    const first = this.list.findIndex((header) => header[0].toLowerCase() === lower);
    if (first === -1) {
      this.list.push([name, value]);
      return;
    }
    this.list[first]![1] = value;
    for (let i = this.list.length - 1; i > first; i--) {
      if (this.list[i]![0].toLowerCase() === lower) this.list.splice(i, 1);
    }
  }

  /** Append to the first matching value without deleting later entries. */
  // https://fetch.spec.whatwg.org/#concept-header-list-combine
  combine(name: string, value: string): void {
    const lower = name.toLowerCase();
    const existing = this.list.find((header) => header[0].toLowerCase() === lower);
    if (existing) existing[1] += `, ${value}`;
    else this.list.push([name, value]);
  }

  /** Copy the list and its pairs so either copy can be changed independently. */
  clone(): FetchHeaders {
    return new FetchHeaders(this.list.map(([name, value]) => [name, value]));
  }

  [Symbol.iterator](): ArrayIterator<Header> {
    return this.list[Symbol.iterator]();
  }

  /** Return sorted copies, combining regular fields and keeping Set-Cookie lines separate. */
  // https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
  sortAndCombine(): Header[] {
    const headers: Header[] = [];
    const names = new Set<string>();
    for (const [name] of this.list) names.add(name.toLowerCase());
    for (const name of [...names].sort()) {
      if (name === 'set-cookie') {
        for (const [headerName, value] of this.list) {
          if (headerName.toLowerCase() === name) headers.push([name, value]);
        }
      } else {
        headers.push([name, this.get(name)!]);
      }
    }
    return headers;
  }

  /** Return separate Set-Cookie values in their original order. */
  getSetCookie(): string[] {
    const values: string[] = [];
    for (const [name, value] of this.list) {
      if (name.toLowerCase() === 'set-cookie') values.push(value);
    }
    return values;
  }

  /** Parse a structured field; absent and invalid both return null. */
  // https://fetch.spec.whatwg.org/#concept-header-list-get-structured-header
  getStructuredFieldValue<T extends StructuredField['type']>(
    name: string, type: T,
  ): Extract<StructuredField, { type: T; }> | null {
    const value = this.get(name);
    return value === null ? null : parseStructuredField(isomorphicEncode(value), type);
  }

  /** Set a structured field, omitting empty containers and leaving the list intact on failure. */
  // https://fetch.spec.whatwg.org/#concept-header-list-set-structured-header
  setStructuredFieldValue(name: string, structuredValue: StructuredField): void {
    const value = serializeStructuredField(structuredValue);
    if (value === null) throw new TypeError('Cannot serialize structured field value');
    if (value === undefined) this.delete(name);
    else this.set(name, value);
  }

  /** Split the combined value at unquoted commas, or return null when absent. */
  // https://fetch.spec.whatwg.org/#concept-header-list-get-decode-split
  getDecodeAndSplit(name: string): string[] | null {
    const value = this.get(name);
    return value === null ? null : getDecodeAndSplitHeaderValue(value);
  }

  /** Extract a length; undefined means absent/unusable, and null means conflicting values. */
  // https://fetch.spec.whatwg.org/#header-list-extract-a-length
  extractLength(): bigint | undefined | null {
    const values = this.getDecodeAndSplit('Content-Length');
    if (values === null) return undefined;
    const candidate = values[0]!;
    if (values.some((value) => value !== candidate)) return null;
    if (candidate === '' || nonASCIIDigitPattern.test(candidate)) return undefined;
    return BigInt(candidate);
  }

  /** Extract Content-Type, preserving charset across repeated matching MIME types. */
  // https://fetch.spec.whatwg.org/#concept-header-extract-mime-type
  extractMIMEType(): MIMEType | null {
    let charset: string | undefined;
    let essence: MIMETypeEssence | undefined;
    let mimeType: MIMEType | null = null;
    const values = this.getDecodeAndSplit('Content-Type');
    if (values === null) return null;

    for (const value of values) {
      const temporaryMimeType = parseMIMEType(value);
      if (temporaryMimeType === null) continue;
      const temporaryEssence = getMIMETypeEssence(temporaryMimeType);
      if (temporaryEssence === '*/*') continue;
      mimeType = temporaryMimeType;
      if (temporaryEssence !== essence) {
        charset = mimeType.parameters.get('charset');
        essence = temporaryEssence;
      } else if (!mimeType.parameters.has('charset') && charset !== undefined) {
        mimeType.parameters.set('charset', charset);
      }
    }
    return mimeType;
  }

  /** Require MIME checking only when the first field value is nosniff, ignoring ASCII case. */
  // https://fetch.spec.whatwg.org/#determine-nosniff
  determineNosniff(): boolean {
    return this.getDecodeAndSplit('X-Content-Type-Options')?.[0]?.toLowerCase() === 'nosniff';
  }

  /** Undefined means absent; null means invalid syntax or disallowed multiplicity. */
  // The parser and multiplicity arguments supply the field's ABNF rules.
  // https://fetch.spec.whatwg.org/#extract-header-list-values
  extractValues<T>(
    name: string, parseValues: (value: string) => T[] | null, allowMultiple: boolean,
  ): T[] | null | undefined {
    const lower = name.toLowerCase();
    const headers = this.list.filter((header) => header[0].toLowerCase() === lower);
    if (headers.length === 0) return undefined;
    if (!allowMultiple && headers.length > 1) return null;
    const values: T[] = [];
    for (const [, value] of headers) {
      const extracted = parseValues(value);
      if (extracted === null) return null;
      values.push(...extracted);
    }
    return values;
  }

  /** Collect unsafe names, including safelisted fields when their total exceeds 1024 bytes. */
  // https://fetch.spec.whatwg.org/#cors-unsafe-request-header-names
  getCORSUnsafeRequestHeaderNames(): string[] {
    const unsafeNames: string[] = [];
    const potentiallyUnsafeNames: string[] = [];
    let safelistValueSize = 0;
    for (const header of this.list) {
      if (!isCORSSafelistedRequestHeader(header)) {
        unsafeNames.push(header[0]);
      } else {
        potentiallyUnsafeNames.push(header[0]);
        safelistValueSize += header[1].length;
      }
    }
    if (safelistValueSize > 1024) unsafeNames.push(...potentiallyUnsafeNames);
    return convertHeaderNamesToSortedLowercaseSet(unsafeNames);
  }
}

/** Each string code unit represents one byte. */
export type Header = [name: string, value: string];

/*
 * typedef (sequence<sequence<ByteString>> or record<ByteString, ByteString>) HeadersInit;
 *
 * [Exposed=(Window,Worker)]
 * interface Headers {
 *   constructor(optional HeadersInit init);
 *
 *   undefined append(ByteString name, ByteString value);
 *   undefined delete(ByteString name);
 *   ByteString? get(ByteString name);
 *   sequence<ByteString> getSetCookie();
 *   boolean has(ByteString name);
 *   undefined set(ByteString name, ByteString value);
 *   iterable<ByteString, ByteString>;
 * };
 */
export class HeadersImpl {
  /** The shared request/response list, or a list owned by these headers. */
  headerList: FetchHeaders;
  /** Restrictions applied to author mutations, without filtering reads. */
  guard: HeadersGuard;

  /** Retain a header list and its mutation guard. */
  constructor(headerList: FetchHeaders = new FetchHeaders(), guard: HeadersGuard = 'none') {
    this.headerList = headerList;
    this.guard = guard;
  }

  /** Append a normalized value if the guard permits it. */
  // https://fetch.spec.whatwg.org/#concept-headers-append
  append(name: string, value: string): void {
    value = normalizeHeaderValue(value);
    if (!this.#validate(name, value)) return;

    if (this.guard === 'request-no-cors') {
      const existingValue = this.headerList.get(name);
      const temporaryValue = existingValue === null ? value : `${existingValue}, ${value}`;
      if (!isNoCORSSafelistedRequestHeader([name, temporaryValue])) return;
    }

    this.headerList.append(name, value);
    if (this.guard === 'request-no-cors') this.#removePrivilegedNoCORSRequestHeaders();
  }

  /** Delete all matching values if the guard permits it. */
  // https://fetch.spec.whatwg.org/#dom-headers-delete
  delete(name: string): void {
    if (!this.#validate(name, '')) return;
    if (this.guard === 'request-no-cors' && !isNoCORSSafelistedRequestHeaderName(name) &&
      !isPrivilegedNoCORSRequestHeaderName(name)) return;
    if (!this.headerList.has(name)) return;

    this.headerList.delete(name);
    if (this.guard === 'request-no-cors') this.#removePrivilegedNoCORSRequestHeaders();
  }

  /** Combine matching values, or return null when the name is absent. */
  // https://fetch.spec.whatwg.org/#dom-headers-get
  get(name: string): string | null {
    if (!isHeaderName(name)) throw new TypeError('Invalid header name');
    return this.headerList.get(name);
  }

  /** Return separate Set-Cookie values in their original order. */
  // https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
  getSetCookie(): string[] {
    return this.headerList.getSetCookie();
  }

  /** Test whether the list contains the case-insensitive name. */
  // https://fetch.spec.whatwg.org/#dom-headers-has
  has(name: string): boolean {
    if (!isHeaderName(name)) throw new TypeError('Invalid header name');
    return this.headerList.has(name);
  }

  /** Replace matching values with one normalized value if the guard permits it. */
  // https://fetch.spec.whatwg.org/#dom-headers-set
  set(name: string, value: string): void {
    value = normalizeHeaderValue(value);
    if (!this.#validate(name, value)) return;
    if (this.guard === 'request-no-cors' && !isNoCORSSafelistedRequestHeader([name, value])) return;

    this.headerList.set(name, value);
    if (this.guard === 'request-no-cors') this.#removePrivilegedNoCORSRequestHeaders();
  }

  /** Append already-converted initial entries, respecting this list's guard. */
  // https://fetch.spec.whatwg.org/#concept-headers-fill
  fill(init: HeadersInitValue): void {
    if (Array.isArray(init)) {
      for (const header of init) {
        if (header.length !== 2) throw new TypeError('A header entry must contain exactly two items');
        this.append(header[0]!, header[1]!);
      }
    } else {
      for (const [name, value] of Object.entries(init)) this.append(name, value);
    }
  }

  /** Supply the current sorted and combined entries to Web IDL iteration. */
  // https://fetch.spec.whatwg.org/#headers-class
  getEntryList(): Header[] {
    return this.headerList.sortAndCombine();
  }

  // https://fetch.spec.whatwg.org/#headers-validate
  #validate(name: string, value: string): boolean {
    if (!isHeaderName(name)) throw new TypeError('Invalid header name');
    if (!isHeaderValue(value)) throw new TypeError('Invalid header value');
    if (this.guard === 'immutable') throw new TypeError('Headers are immutable');
    if (this.guard === 'request' && isForbiddenRequestHeader([name, value])) return false;
    if (this.guard === 'response' && isForbiddenResponseHeaderName(name)) return false;
    return true;
  }

  // https://fetch.spec.whatwg.org/#concept-headers-remove-privileged-no-cors-request-headers
  #removePrivilegedNoCORSRequestHeaders(): void {
    this.headerList.delete('Range');
  }
}

export type HeadersGuard = 'immutable' | 'request' | 'request-no-cors' | 'response' | 'none';

/** Binding converts HeadersInit's sequence/record branches to arrays/plain objects. */
export type HeadersInitValue = string[][] | Record<string, string>;

/** Validate method syntax, including extension methods. */
// https://fetch.spec.whatwg.org/#concept-method
export function isValidMethod(value: string): boolean {
  return isHTTPToken(value);
}

// https://fetch.spec.whatwg.org/#cors-safelisted-method
export function isCORSSafelistedMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'POST';
}

// https://fetch.spec.whatwg.org/#forbidden-method
export function isForbiddenMethod(method: string): boolean {
  return ['CONNECT', 'TRACE', 'TRACK'].includes(method.toUpperCase());
}

/** Uppercase the six legacy methods; preserve other spellings, including patch. */
// https://fetch.spec.whatwg.org/#concept-method-normalize
export function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(upper) ? upper : method;
}

/** Split at unquoted commas and trim surrounding tabs/spaces; input is already decoded. */
// https://fetch.spec.whatwg.org/#header-value-get-decode-and-split
export function getDecodeAndSplitHeaderValue(value: string): string[] {
  const position = new TextCursor(value);
  const values: string[] = [];
  let temporaryValue = '';
  while (true) {
    const start = position.pos();
    position.consumeWhile((character) => character !== '"' && character !== ',');
    temporaryValue += position.slice(start);
    if (position.peek() === '"') {
      temporaryValue += collectHTTPQuotedString(position);
      if (!position.eof()) continue;
    }
    values.push(temporaryValue.replace(surroundingTabOrSpacePattern, ''));
    temporaryValue = '';
    if (position.eof()) return values;
    position.advance();
  }
}

/** Parse the CORS Allow-Methods, Allow-Headers, and Expose-Headers token-list grammar. */
// https://fetch.spec.whatwg.org/#http-new-header-syntax
export function parseCORSTokenList(value: string): string[] | null {
  const tokens: string[] = [];
  for (const member of value.split(',')) {
    const token = member.replace(surroundingTabOrSpacePattern, '');
    if (token === '') continue;
    if (!isHTTPToken(token)) return null;
    tokens.push(token);
  }
  return tokens;
}

/** Select the charset's encoding, retaining the fallback when it is absent or unrecognized. */
// https://fetch.spec.whatwg.org/#legacy-extract-an-encoding
export function legacyExtractEncoding(mimeType: MIMEType | null, fallbackEncoding: Encoding): Encoding {
  const charset = mimeType?.parameters.get('charset');
  return charset === undefined ? fallbackEncoding : getEncoding(charset) ?? fallbackEncoding;
}

// https://fetch.spec.whatwg.org/#convert-header-names-to-a-sorted-lowercase-set
export function convertHeaderNamesToSortedLowercaseSet(names: string[]): string[] {
  const unique = new Set<string>();
  for (const name of names) unique.add(name.toLowerCase());
  return [...unique].sort();
}

// https://fetch.spec.whatwg.org/#header-name
export function isHeaderName(name: string): boolean {
  return isHTTPToken(name);
}

// https://fetch.spec.whatwg.org/#header-value
export function isHeaderValue(value: string): boolean {
  return !invalidHeaderValuePattern.test(value);
}

/** Strip leading and trailing HTTP whitespace without changing the interior. */
// https://fetch.spec.whatwg.org/#concept-header-value-normalize
export function normalizeHeaderValue(value: string): string {
  return value.replace(surroundingHTTPWhitespacePattern, '');
}

/** Check the name, value restrictions, and 128-byte safelist limit. */
// https://fetch.spec.whatwg.org/#cors-safelisted-request-header
export function isCORSSafelistedRequestHeader([name, value]: Header): boolean {
  if (value.length > 128) return false;
  switch (name.toLowerCase()) {
    case 'accept':
    case 'content-type': {
      for (let i = 0; i < value.length; i++) {
        if (isCORSUnsafeRequestHeaderByte(value.charCodeAt(i))) return false;
      }
      if (name.toLowerCase() === 'accept') return true;
      const mimeType = parseMIMEType(value);
      return mimeType !== null && ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']
        .includes(getMIMETypeEssence(mimeType));
    }
    case 'accept-language':
    case 'content-language':
      return !corsUnsafeLanguageValuePattern.test(value);
    case 'range': {
      const range = parseSingleRangeHeaderValue(value, false);
      return range !== null && range[0] !== undefined;
    }
    default:
      return false;
  }
}

// https://fetch.spec.whatwg.org/#cors-unsafe-request-header-byte
export function isCORSUnsafeRequestHeaderByte(byte: number): boolean {
  return byte < 0x20 && byte !== 0x09 || byte === 0x7f ||
    '"():<>?@[\\]{}'.includes(String.fromCharCode(byte));
}

// https://fetch.spec.whatwg.org/#cors-non-wildcard-request-header-name
export function isCORSNonWildcardRequestHeaderName(name: string): boolean {
  return name.toLowerCase() === 'authorization';
}

// https://fetch.spec.whatwg.org/#privileged-no-cors-request-header-name
export function isPrivilegedNoCORSRequestHeaderName(name: string): boolean {
  return name.toLowerCase() === 'range';
}

/** Include explicit exposure while always excluding forbidden response fields. */
// https://fetch.spec.whatwg.org/#cors-safelisted-response-header-name
export function isCORSSafelistedResponseHeaderName(name: string, exposedNames: string[]): boolean {
  const lower = name.toLowerCase();
  return corsSafelistedResponseHeaderNames.has(lower) ||
    !isForbiddenResponseHeaderName(name) && exposedNames.some((exposed) => exposed.toLowerCase() === lower);
}

// https://fetch.spec.whatwg.org/#no-cors-safelisted-request-header-name
export function isNoCORSSafelistedRequestHeaderName(name: string): boolean {
  return ['accept', 'accept-language', 'content-language', 'content-type'].includes(name.toLowerCase());
}

// https://fetch.spec.whatwg.org/#no-cors-safelisted-request-header
export function isNoCORSSafelistedRequestHeader(header: Header): boolean {
  return isNoCORSSafelistedRequestHeaderName(header[0]) && isCORSSafelistedRequestHeader(header);
}

/** Check reserved names and method-override fields that name forbidden methods. */
// https://fetch.spec.whatwg.org/#forbidden-request-header
export function isForbiddenRequestHeader([name, value]: Header): boolean {
  const lower = name.toLowerCase();
  if (forbiddenRequestHeaderNames.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
    return true;
  }
  return ['x-http-method', 'x-http-method-override', 'x-method-override'].includes(lower) &&
    getDecodeAndSplitHeaderValue(value).some(isForbiddenMethod);
}

// https://fetch.spec.whatwg.org/#forbidden-response-header-name
export function isForbiddenResponseHeaderName(name: string): boolean {
  return ['set-cookie', 'set-cookie2'].includes(name.toLowerCase());
}

// https://fetch.spec.whatwg.org/#request-body-header-name
export function isRequestBodyHeaderName(name: string): boolean {
  return ['content-encoding', 'content-language', 'content-location', 'content-type'].includes(name.toLowerCase());
}

/** Serialize an integer in decimal, without exponent notation or padding. */
// https://fetch.spec.whatwg.org/#serialize-an-integer
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}

/** Parse exact byte offsets; null means invalid and an undefined endpoint means omitted. */
// https://fetch.spec.whatwg.org/#simple-range-header-value
// BigInts preserve the ordering of unbounded decimal offsets.
export function parseSingleRangeHeaderValue(
  value: string, allowWhitespace: boolean,
): [start?: bigint, end?: bigint] | null {
  if (!value.startsWith('bytes')) return null;
  const position = new TextCursor(value, 5);
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);
  if (!position.match('=')) return null;
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);

  const start = position.pos();
  position.consumeWhile(isASCIIDigit);
  const startValue = position.slice(start);
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);
  if (!position.match('-')) return null;
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);

  const end = position.pos();
  position.consumeWhile(isASCIIDigit);
  const endValue = position.slice(end);
  if (!position.eof() || startValue === '' && endValue === '') return null;

  const rangeStart = startValue === '' ? undefined : BigInt(startValue);
  const rangeEnd = endValue === '' ? undefined : BigInt(endValue);
  if (rangeStart !== undefined && rangeEnd !== undefined && rangeStart > rangeEnd) return null;
  return [rangeStart, rangeEnd];
}

/** Accept Fetch's internal status domain, including zero. */
// https://fetch.spec.whatwg.org/#concept-status
// UNUSED: only direct tests call this status-range predicate.
export function isStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 999;
}

// https://fetch.spec.whatwg.org/#null-body-status
export function isNullBodyStatus(status: number): boolean {
  return [101, 103, 204, 205, 304].includes(status);
}

// https://fetch.spec.whatwg.org/#ok-status
export function isOkStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

// https://fetch.spec.whatwg.org/#range-status
export function isRangeStatus(status: number): boolean {
  return status === 206 || status === 416;
}

// https://fetch.spec.whatwg.org/#redirect-status
export function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

/** Select this environment's identification header value, including an explicit empty override. */
// https://fetch.spec.whatwg.org/#environment-default-user-agent-value
export function getEnvironmentDefaultUserAgent(env: FetchEnvironment): string {
  // Header values already use isomorphic strings; no intermediate byte array is needed.
  const { userAgent } = env;
  return userAgent.webDriverBiDiEmulatedUserAgent(env) ?? userAgent.defaultUserAgentValue;
}

// https://fetch.spec.whatwg.org/#document-accept-header-value
export const documentAcceptHeaderValue = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function isASCIIDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

const invalidHeaderValuePattern = /^[ \t]|[ \t]$|[\0\r\n\u0100-\uffff]/;
const surroundingHTTPWhitespacePattern = /^[\t\n\r ]+|[\t\n\r ]+$/g;
const corsUnsafeLanguageValuePattern = /[^0-9A-Za-z *,\-.;=]/;

const corsSafelistedResponseHeaderNames = new Set([
  'cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma',
]);

const forbiddenRequestHeaderNames = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

// -- Web IDL ------------------------------------------------------------

export const headersInitIDL = defineTypedef({
  name: 'HeadersInit',
  type: union(sequence(sequence(idlType.ByteString)), record(idlType.ByteString, idlType.ByteString)),
});

export const headersIDL = defineInterface({
  name: 'Headers',
  exposed: ['Window', 'Worker'],
  implementation: impl(HeadersImpl),
  members: [
    ctor(
      [arg('init', reference('HeadersInit'), { optional: true })],
      {
        // https://fetch.spec.whatwg.org/#dom-headers
        invoke(_ctx, init) {
          if (init !== undefined) (this as HeadersImpl).fill(init as HeadersInitValue);
        },
      },
    ),
    op('append', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    op('delete', idlType.undefined, [arg('name', idlType.ByteString)]),
    op('get', nullable(idlType.ByteString), [arg('name', idlType.ByteString)]),
    op('getSetCookie', sequence(idlType.ByteString)),
    op('has', idlType.boolean, [arg('name', idlType.ByteString)]),
    op('set', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    iter(idlType.ByteString, { key: idlType.ByteString }),
  ],
});
