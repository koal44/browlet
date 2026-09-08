import { isomorphicEncode } from '@exodus/bytes/encoding-lite.js';

import { getMIMETypeEssence, parseMIMEType } from '../mime/index';
import { collectHTTPQuotedString, isHTTPToken } from '../http/syntax';
import { TextCursor } from '../infra/text-cursor';
import { parseStructuredField, serializeStructuredField, type StructuredField } from '../http/struct-fields/index';
import {
  arg, ctor, defineInterface, defineTypedef, idlType, impl, iter, nullable, op,
  record, reference, sequence, union,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl/projection';

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

export function convertHeaderNamesToSortedLowercaseSet(names: readonly string[]): string[] {
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
      return range !== null && range[0] !== null;
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

export function isCORSSafelistedResponseHeaderName(name: string, exposedNames: readonly string[]): boolean {
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
 * arguments supply the field's ABNF rules. A parser returns
 * null on failure; an absent field and a failed extraction remain distinct.
 */
export function extractHeaderListValues<T>(
  name: string, list: HeaderList, parseValues: (value: string) => T[] | null, allowMultiple: boolean,
): T[] | null | 'failure' {
  const lower = name.toLowerCase();
  const headers = list.filter((header) => header[0].toLowerCase() === lower);
  if (headers.length === 0) return null;
  if (!allowMultiple && headers.length > 1) return 'failure';
  const values: T[] = [];
  for (const [, value] of headers) {
    const extracted = parseValues(value);
    if (extracted === null) return 'failure';
    values.push(...extracted);
  }
  return values;
}

/**
 * Fetch §2.2.2 — environment default User-Agent. The host supplies the default
 * and BiDi emulation values instead of the environment settings object.
 */
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
  readonly headerList: HeaderList;
  guard: HeadersGuard;

  // Internal allocation. The author constructor's fill algorithm is deferred.
  constructor(headerList: HeaderList = [], guard: HeadersGuard = 'none') {
    this.headerList = headerList;
    this.guard = guard;
  }

  append(_name: string, _value: string): void {
    throw new Error('Headers.append is not implemented');
  }

  delete(_name: string): void {
    throw new Error('Headers.delete is not implemented');
  }

  get(_name: string): string | null {
    throw new Error('Headers.get is not implemented');
  }

  getSetCookie(): string[] {
    throw new Error('Headers.getSetCookie is not implemented');
  }

  has(_name: string): boolean {
    throw new Error('Headers.has is not implemented');
  }

  set(_name: string, _value: string): void {
    throw new Error('Headers.set is not implemented');
  }

  entries(): IterableIterator<[string, string]> {
    throw new Error('Headers sorting and combining is not implemented');
  }
}

export type HeadersGuard = 'immutable' | 'request' | 'request-no-cors' | 'response' | 'none';

/** Binding converts HeadersInit's sequence/record branches to arrays/plain objects. */
export type HeadersInitValue = string[][] | Record<string, string>;

export const headersInitIDL = defineTypedef({
  name: 'HeadersInit',
  type: union(sequence(sequence(idlType.ByteString)), record(idlType.ByteString, idlType.ByteString)),
});

export const headersIDL = defineInterface({
  name: 'Headers',
  exposed: ['Window', 'Worker'],
  implementation: impl(HeadersImpl),
  members: [
    ctor([arg('init', reference('HeadersInit'), { optional: true })], bind({
      invoke() { throw new Error('Headers construction from HeadersInit is not implemented'); },
    })),
    op('append', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    op('delete', idlType.undefined, [arg('name', idlType.ByteString)]),
    op('get', nullable(idlType.ByteString), [arg('name', idlType.ByteString)]),
    op('getSetCookie', sequence(idlType.ByteString)),
    op('has', idlType.boolean, [arg('name', idlType.ByteString)]),
    op('set', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    iter(idlType.ByteString, { key: idlType.ByteString }),
  ],
});
