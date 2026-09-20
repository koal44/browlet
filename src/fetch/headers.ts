import { isomorphicEncode } from '../js-engine/byte-string';
import { TypeError } from '../js-engine/exceptions';
import { getMIMETypeEssence, parseMIMEType, type MIMEType, type MIMETypeEssence } from '../mime/index';
import {
  collectHTTPQuotedString, isHTTPToken, parseStructuredField, serializeStructuredField,
  type StructuredField,
} from '../http/index';
import { TextCursor } from '../infra/text-cursor';
import {
  arg, ctor, defineInterface, defineTypedef, idlType, impl, iter, nullable, op,
  record, reference, sequence, union,
} from '../web-idl/index';
import { isForbiddenMethod } from './http/methods';
import { parseSingleRangeHeaderValue } from './http/ranges';

/*
 * Fetch §§2.2.2 and 5.1. Names and values are byte strings: each string code
 * unit represents one byte. The list preserves order, duplicates, and identity.
 */
export type Header = [name: string, value: string];
export type HeaderList = Header[];

/** Fetch §2.2.2 — get a structured field value; absent and invalid both return null. */
export function getStructuredFieldValue<T extends StructuredField['type']>(
  name: string, type: T, list: HeaderList,
): Extract<StructuredField, { type: T; }> | null {
  const value = getHeader(name, list);
  return value === null ? null : parseStructuredField(isomorphicEncode(value), type);
}

/**
 * Fetch §2.2.2 / RFC 9651 §4.1 — set a structured field value. Empty containers
 * omit the field; serialization failure leaves the original header list intact.
 */
export function setStructuredFieldValue(
  [name, structuredValue]: [name: string, value: StructuredField], list: HeaderList,
): void {
  const value = serializeStructuredField(structuredValue);
  if (value === null) throw new TypeError('Cannot serialize structured field value');
  if (value === undefined) deleteHeader(name, list);
  else setHeader([name, value], list);
}

/** Fetch §2.2.2 — header-list operations retain order, duplicates, and list identity. */
export function containsHeader(name: string, list: HeaderList): boolean {
  const lower = name.toLowerCase();
  return list.some((header) => header[0].toLowerCase() === lower);
}

export function getHeader(name: string, list: HeaderList): string | null {
  const lower = name.toLowerCase();
  const values = list.filter((header) => header[0].toLowerCase() === lower)
    .map((header) => header[1]);
  return values.length === 0 ? null : values.join(', ');
}

export function getDecodeAndSplitHeader(name: string, list: HeaderList): string[] | null {
  const value = getHeader(name, list);
  return value === null ? null : getDecodeAndSplitHeaderValue(value);
}

/** Input is already isomorphically decoded. Most consumers use the list operation. */
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
    values.push(temporaryValue.replace(/^[ \t]+|[ \t]+$/g, ''));
    temporaryValue = '';
    if (position.eof()) return values;
    position.advance();
  }
}

/** https://fetch.spec.whatwg.org/#concept-header-extract-mime-type */
export function extractMIMEType(headers: HeaderList): MIMEType | null {
  let charset: string | undefined;
  let essence: MIMETypeEssence | undefined;
  let mimeType: MIMEType | null = null;
  const values = getDecodeAndSplitHeader('Content-Type', headers);
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

export function appendHeader([name, value]: Header, list: HeaderList): void {
  const lower = name.toLowerCase();
  const existing = list.find((header) => header[0].toLowerCase() === lower);
  list.push([existing?.[0] ?? name, value]);
}

export function deleteHeader(name: string, list: HeaderList): void {
  const lower = name.toLowerCase();
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]![0].toLowerCase() === lower) list.splice(i, 1);
  }
}

export function setHeader([name, value]: Header, list: HeaderList): void {
  const lower = name.toLowerCase();
  const first = list.findIndex((header) => header[0].toLowerCase() === lower);
  if (first === -1) {
    list.push([name, value]);
    return;
  }
  list[first]![1] = value;
  for (let i = list.length - 1; i > first; i--) {
    if (list[i]![0].toLowerCase() === lower) list.splice(i, 1);
  }
}

/** Combine changes only the first match; unlike set, it does not delete later matches. */
export function combineHeader([name, value]: Header, list: HeaderList): void {
  const lower = name.toLowerCase();
  const existing = list.find((header) => header[0].toLowerCase() === lower);
  if (existing) existing[1] += `, ${value}`;
  else list.push([name, value]);
}

export function convertHeaderNamesToSortedLowercaseSet(names: string[]): string[] {
  return [...new Set(names.map((name) => name.toLowerCase()))].sort();
}

/** Set-Cookie lines stay separate, even when their values contain commas. */
export function sortAndCombineHeaders(list: HeaderList): HeaderList {
  const headers: HeaderList = [];
  const names = convertHeaderNamesToSortedLowercaseSet(list.map((header) => header[0]));
  for (const name of names) {
    if (name === 'set-cookie') {
      for (const [headerName, value] of list) {
        if (headerName.toLowerCase() === name) headers.push([name, value]);
      }
    } else {
      headers.push([name, getHeader(name, list)!]);
    }
  }
  return headers;
}

export function isHeaderName(name: string): boolean {
  return isHTTPToken(name);
}

export function isHeaderValue(value: string): boolean {
  return !/^[ \t]|[ \t]$|[\0\r\n\u0100-\uffff]/.test(value);
}

export function normalizeHeaderValue(value: string): string {
  return value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
}

/** Fetch §2.2.2 — CORS-safelisted request-header, including the 128-byte limit. */
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
      return !/[^0-9A-Za-z *,\-.;=]/.test(value);
    case 'range': {
      const range = parseSingleRangeHeaderValue(value, false);
      return range !== null && range[0] !== undefined;
    }
    default:
      return false;
  }
}

export function isCORSUnsafeRequestHeaderByte(byte: number): boolean {
  return byte < 0x20 && byte !== 0x09 || byte === 0x7f ||
    '"():<>?@[\\]{}'.includes(String.fromCharCode(byte));
}

export function getCORSUnsafeRequestHeaderNames(headers: HeaderList): string[] {
  const unsafeNames: string[] = [];
  const potentiallyUnsafeNames: string[] = [];
  let safelistValueSize = 0;
  for (const header of headers) {
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

export function isCORSNonWildcardRequestHeaderName(name: string): boolean {
  return name.toLowerCase() === 'authorization';
}

export function isPrivilegedNoCORSRequestHeaderName(name: string): boolean {
  return name.toLowerCase() === 'range';
}

export function isCORSSafelistedResponseHeaderName(name: string, exposedNames: string[]): boolean {
  const lower = name.toLowerCase();
  return corsSafelistedResponseHeaderNames.has(lower) ||
    !isForbiddenResponseHeaderName(name) && exposedNames.some((exposed) => exposed.toLowerCase() === lower);
}

export function isNoCORSSafelistedRequestHeaderName(name: string): boolean {
  return ['accept', 'accept-language', 'content-language', 'content-type'].includes(name.toLowerCase());
}

export function isNoCORSSafelistedRequestHeader(header: Header): boolean {
  return isNoCORSSafelistedRequestHeaderName(header[0]) && isCORSSafelistedRequestHeader(header);
}

export function isForbiddenRequestHeader([name, value]: Header): boolean {
  const lower = name.toLowerCase();
  if (forbiddenRequestHeaderNames.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
    return true;
  }
  return ['x-http-method', 'x-http-method-override', 'x-method-override'].includes(lower) &&
    getDecodeAndSplitHeaderValue(value).some(isForbiddenMethod);
}

export function isForbiddenResponseHeaderName(name: string): boolean {
  return ['set-cookie', 'set-cookie2'].includes(name.toLowerCase());
}

export function isRequestBodyHeaderName(name: string): boolean {
  return ['content-encoding', 'content-language', 'content-location', 'content-type'].includes(name.toLowerCase());
}

/**
 * Fetch §2.2.2 — extract header list values. The extra parser and multiplicity
 * arguments supply the field's ABNF rules. Undefined means the field is absent;
 * null means extraction failed, including when the parser returns null.
 * https://fetch.spec.whatwg.org/#extract-header-list-values
 */
export function extractHeaderListValues<T>(
  name: string, list: HeaderList, parseValues: (value: string) => T[] | null, allowMultiple: boolean,
): T[] | null | undefined {
  const lower = name.toLowerCase();
  const headers = list.filter((header) => header[0].toLowerCase() === lower);
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

/**
 * Fetch §2.2.2 — environment default User-Agent. The host supplies the default
 * and BiDi emulation values instead of the environment settings object.
 */
// SPEC_MISMATCH: (environment: environment settings object) -> header value
export function getEnvironmentDefaultUserAgent(defaultValue: string, emulatedValue: string | null): string {
  return emulatedValue ?? defaultValue;
}

export const documentAcceptHeaderValue = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const corsSafelistedResponseHeaderNames = new Set([
  'cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma',
]);

const forbiddenRequestHeaderNames = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

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
  headerList: HeaderList;
  /** Restrictions applied to author mutations, without filtering reads. */
  guard: HeadersGuard;

  /** Retain a header list and its mutation guard. */
  constructor(headerList: HeaderList = [], guard: HeadersGuard = 'none') {
    this.headerList = headerList;
    this.guard = guard;
  }

  /** Append a normalized value if the guard permits it. */
  // https://fetch.spec.whatwg.org/#concept-headers-append
  append(name: string, value: string): void {
    value = normalizeHeaderValue(value);
    if (!this.#validate(name, value)) return;

    if (this.guard === 'request-no-cors') {
      const existingValue = getHeader(name, this.headerList);
      const temporaryValue = existingValue === null ? value : `${existingValue}, ${value}`;
      if (!isNoCORSSafelistedRequestHeader([name, temporaryValue])) return;
    }

    appendHeader([name, value], this.headerList);
    if (this.guard === 'request-no-cors') this.#removePrivilegedNoCORSRequestHeaders();
  }

  /** Delete all matching values if the guard permits it. */
  // https://fetch.spec.whatwg.org/#dom-headers-delete
  delete(name: string): void {
    if (!this.#validate(name, '')) return;
    if (this.guard === 'request-no-cors' && !isNoCORSSafelistedRequestHeaderName(name) &&
      !isPrivilegedNoCORSRequestHeaderName(name)) return;
    if (!containsHeader(name, this.headerList)) return;

    deleteHeader(name, this.headerList);
    if (this.guard === 'request-no-cors') this.#removePrivilegedNoCORSRequestHeaders();
  }

  /** Combine matching values, or return null when the name is absent. */
  // https://fetch.spec.whatwg.org/#dom-headers-get
  get(name: string): string | null {
    if (!isHeaderName(name)) throw new TypeError('Invalid header name');
    return getHeader(name, this.headerList);
  }

  /** Return separate Set-Cookie values in their original order. */
  // https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
  getSetCookie(): string[] {
    return this.headerList.filter(([name]) => name.toLowerCase() === 'set-cookie')
      .map(([, value]) => value);
  }

  /** Test whether the list contains the case-insensitive name. */
  // https://fetch.spec.whatwg.org/#dom-headers-has
  has(name: string): boolean {
    if (!isHeaderName(name)) throw new TypeError('Invalid header name');
    return containsHeader(name, this.headerList);
  }

  /** Replace matching values with one normalized value if the guard permits it. */
  // https://fetch.spec.whatwg.org/#dom-headers-set
  set(name: string, value: string): void {
    value = normalizeHeaderValue(value);
    if (!this.#validate(name, value)) return;
    if (this.guard === 'request-no-cors' && !isNoCORSSafelistedRequestHeader([name, value])) return;

    setHeader([name, value], this.headerList);
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
    return sortAndCombineHeaders(this.headerList);
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
    deleteHeader('Range', this.headerList);
  }
}

export type HeadersGuard = 'immutable' | 'request' | 'request-no-cors' | 'response' | 'none';

/** Binding converts HeadersInit's sequence/record branches to arrays/plain objects. */
export type HeadersInitValue = string[][] | Record<string, string>;

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
    ctor([arg('init', reference('HeadersInit'), { optional: true })], {
      // https://fetch.spec.whatwg.org/#dom-headers
      invoke(_ctx, init) {
        if (init !== undefined) (this as HeadersImpl).fill(init as HeadersInitValue);
      },
    }),
    op('append', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    op('delete', idlType.undefined, [arg('name', idlType.ByteString)]),
    op('get', nullable(idlType.ByteString), [arg('name', idlType.ByteString)]),
    op('getSetCookie', sequence(idlType.ByteString)),
    op('has', idlType.boolean, [arg('name', idlType.ByteString)]),
    op('set', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    iter(idlType.ByteString, { key: idlType.ByteString }),
  ],
});
