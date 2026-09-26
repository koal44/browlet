import { describe, expect, it, vi } from 'vitest';

import {
  convertHeaderNamesToSortedLowercaseSet, documentAcceptHeaderValue, FetchHeaders,
  getDecodeAndSplitHeaderValue, getEnvironmentDefaultUserAgent, headersIDL, headersInitIDL, HeadersImpl,
  isCORSNonWildcardRequestHeaderName, isCORSSafelistedRequestHeader,
  isCORSSafelistedResponseHeaderName, isCORSUnsafeRequestHeaderByte, isForbiddenRequestHeader,
  isForbiddenResponseHeaderName, isHeaderName, isHeaderValue, isNoCORSSafelistedRequestHeader,
  isNoCORSSafelistedRequestHeaderName, isPrivilegedNoCORSRequestHeaderName, isRequestBodyHeaderName,
  legacyExtractEncoding, normalizeHeaderValue, parseCORSTokenList, serializeInteger,
  isCORSSafelistedMethod, isForbiddenMethod, isValidMethod, normalizeMethod, parseSingleRangeHeaderValue,
  isNullBodyStatus, isOkStatus, isRangeStatus, isRedirectStatus, isStatus,
} from '../../src/fetch/headers';
import { RequestImpl } from '../../src/fetch/request';
import { ResponseImpl, FetchResponse } from '../../src/fetch/response';
import {
  parseDeltaSeconds, parseVary, type StructuredBareItem, type StructuredField, type StructuredItem,
} from '../../src/http/index';
import { parseMIMEType, serializeMIMEType } from '../../src/mime/index';
import { allocateIn, BindingWorld, type BindingContext } from '../../src/web-idl/index';
import { createEnvironment } from '../js-engine/execution-fixture';
import { TestRealm } from '../web-idl/test-realm';
import { createFetchFixture, createFetchRequest } from './fetch-fixture';
import { createClientEnvironment } from './client-fixture';

describe('header lists (Fetch §2.2.2)', () => {
  it('distinguishes absent and empty values and combines duplicate lines in order', () => {
    const list = new FetchHeaders([['A', 'one'], ['B', ''], ['a', 'two']]);
    expect(list.has('a')).toBe(true);
    expect(list.has('c')).toBe(false);
    expect(list.get('A')).toBe('one, two');
    expect(list.get('b')).toBe('');
    expect(list.get('c')).toBeNull();
    expect(list.getDecodeAndSplit('b')).toEqual(['']);
    expect(list.getDecodeAndSplit('c')).toBeNull();
  });

  it('mutates the actual request list, preserving the first spelling and existing entry', () => {
    const request = createFetchRequest();
    const list = request.headerList;
    list.append('X-First', 'one');
    const first = list.list[0];
    list.append('B', 'other');
    list.append('x-FIRST', 'two');
    expect(list.list).toEqual([['X-First', 'one'], ['B', 'other'], ['X-First', 'two']]);
    list.set('x-first', 'replacement');
    expect(request.headerList).toBe(list);
    expect(list.list[0]).toBe(first);
    expect(list.list).toEqual([['X-First', 'replacement'], ['B', 'other']]);
    list.set('C', 'new');
    list.delete('x-FIRST');
    expect(request.headerList.list).toEqual([['B', 'other'], ['C', 'new']]);
  });

  it('deletes all matches without skipping adjacent duplicates', () => {
    const list = new FetchHeaders([['A', '1'], ['a', '2'], ['B', '3'], ['A', '4']]);
    list.delete('a');
    list.delete('missing');
    expect(list.list).toEqual([['B', '3']]);
  });

  it('combine appends to the first matching value without deleting later entries', () => {
    const list = new FetchHeaders([['A', 'one'], ['B', 'other'], ['a', 'two']]);
    list.combine('a', 'three');
    list.combine('C', 'new');
    expect(list.list).toEqual([['A', 'one, three'], ['B', 'other'], ['a', 'two'], ['C', 'new']]);
  });

  it('sorts and combines regular fields while preserving separate Set-Cookie lines', () => {
    const list = new FetchHeaders([
      ['Z', 'first'], ['Set-Cookie', 'a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT'],
      ['A', 'value'], ['set-cookie', 'b=2; Path=/'], ['z', 'second'],
    ]);
    const before = list.list.map((header) => [...header]);
    const sorted = list.sortAndCombine();
    expect(sorted).toEqual([
      ['a', 'value'], ['set-cookie', 'a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT'],
      ['set-cookie', 'b=2; Path=/'], ['z', 'first, second'],
    ]);
    expect(list.list).toEqual(before);
    sorted[0]![1] = 'changed';
    expect(list.list).toEqual(before);
    // The general get operation still joins all values; sort-and-combine has the exception.
    expect(list.get('set-cookie')).toBe('a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT, b=2; Path=/');
  });

  it('sorts names by byte order after lowercasing and removing duplicates', () => {
    expect(convertHeaderNamesToSortedLowercaseSet(['Z', 'a', 'A', '_X', '9', 'x'])).toEqual(['9', '_x', 'a', 'x', 'z']);
    expect(new FetchHeaders().sortAndCombine()).toEqual([]);
  });

  it.each([
    ['nosniff,', ['nosniff', '']], ['', ['']], ['text/html;", x/x', ['text/html;", x/x']],
    ['x/x;test="hi",y/y', ['x/x;test="hi"', 'y/y']], ['x / x,,,1', ['x / x', '', '', '1']],
    ['"1,2", 3', ['"1,2"', '3']], [' a\t,\tb ', ['a', 'b']],
    ['"a\\",b",c', ['"a\\",b"', 'c']], ['a\r,\nb', ['a\r', '\nb']],
    ['a,\u00a0b\u00a0', ['a', '\u00a0b\u00a0']], ['"a"tail,b', ['"a"tail', 'b']],
    ['"\\', ['"\\']],
  ])('decodes/splits %j with the specified quote and whitespace rules', (value, expected) => {
    expect(getDecodeAndSplitHeaderValue(value)).toEqual(expected);
    expect(new FetchHeaders([['A', value]]).getDecodeAndSplit('A')).toEqual(expected);
  });

  it('combines field lines before quote-aware splitting', () => {
    expect(new FetchHeaders([['A', 'text/html;"'], ['B', 'ignored'], ['A', 'x/x']]).getDecodeAndSplit('A'))
      .toEqual(['text/html;", x/x']);
  });
});

describe('header syntax and normalization', () => {
  it.each(['', 'has space', 'Name:', 'Name\n', 'Name\r', 'é', 'Name\0'])('rejects header name %j', (name) => {
    expect(isHeaderName(name)).toBe(false);
  });
  it('permits every token character in a header name', () => {
    expect(isHeaderName("!#$%&'*+-.^_`|~0123456789AZaz")).toBe(true);
  });
  it('validates header values using Fetch’s wider byte rules, not HTTP field-value grammar', () => {
    expect(isHeaderValue('')).toBe(true);
    for (let byte = 0; byte < 256; byte++) {
      const value = `a${String.fromCharCode(byte)}b`;
      expect(isHeaderValue(value), `value byte ${byte}`).toBe(![0, 10, 13].includes(byte));
    }
    for (const value of [' x', 'x ', '\tx', 'x\t', 'x\u0100', '😀']) expect(isHeaderValue(value)).toBe(false);
    expect(isHeaderValue('\u00a0x\u00a0')).toBe(true);
  });
  it('normalizes only leading/trailing HTTP whitespace, leaving validation separate', () => {
    expect(normalizeHeaderValue(' \t\r\nx\t y\r\n ')).toBe('x\t y');
    expect(normalizeHeaderValue('\r\n\t ')).toBe('');
    expect(normalizeHeaderValue('\fx\f')).toBe('\fx\f');
    expect(normalizeHeaderValue('\u00a0x\u00a0')).toBe('\u00a0x\u00a0');
    expect(isHeaderValue(normalizeHeaderValue('x\ry'))).toBe(false);
  });
});

describe('integer serialization (Fetch §2)', () => {
  it.each([
    [0, '0'], [-0, '0'], [42, '42'], [-42, '-42'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
    [1e21, '1000000000000000000000'],
    [12345678901234567890123456789n, '12345678901234567890123456789'],
  ] as const)('serializes %s without exponent notation or padding', (integer, expected) => {
    expect(serializeInteger(integer)).toBe(expected);
  });
});

describe('HTTP methods (Fetch §2.2.1)', () => {
  it.each(['GET', 'CHICKEN', 'Egg', 'eGg', 'patch', "!#$%&'*+-.^_`|~0123456789"])(
    'accepts the method %j', (method) => expect(isValidMethod(method)).toBe(true),
  );
  it.each(['', 'GET ', ' GET', 'GET\n', 'GET\r', 'GET\t', 'G:E:T', 'G\0ET', 'GÉT', 'ＧＥＴ'])(
    'rejects the method %j', (method) => expect(isValidMethod(method)).toBe(false),
  );
  it.each(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'])('normalizes %s', (method) => {
    expect(normalizeMethod(method.toLowerCase())).toBe(method);
    expect(normalizeMethod(method)).toBe(method);
  });
  it.each(['patch', 'Egg', 'eGg', 'trace'])('preserves %s', (method) => {
    expect(normalizeMethod(method)).toBe(method);
  });
  it('checks safelisting case-sensitively and forbidden methods case-insensitively', () => {
    for (const method of ['GET', 'HEAD', 'POST']) expect(isCORSSafelistedMethod(method)).toBe(true);
    for (const method of ['get', 'post', 'PUT', 'OPTIONS']) expect(isCORSSafelistedMethod(method)).toBe(false);
    for (const method of ['CONNECT', 'Connect', 'tRaCe', 'TRACK']) expect(isForbiddenMethod(method)).toBe(true);
    for (const method of ['GET', 'DELETE', 'CONNECTX']) expect(isForbiddenMethod(method)).toBe(false);
  });
});

describe('HTTP statuses (Fetch §2.2.3)', () => {
  it('classifies every status in Fetch’s domain', () => {
    for (let status = 0; status <= 999; status++) {
      expect(isStatus(status), `status ${status}`).toBe(true);
      expect(isNullBodyStatus(status), `null body ${status}`).toBe([101, 103, 204, 205, 304].includes(status));
      expect(isOkStatus(status), `ok ${status}`).toBe(Math.floor(status / 100) === 2);
      expect(isRangeStatus(status), `range ${status}`).toBe([206, 416].includes(status));
      expect(isRedirectStatus(status), `redirect ${status}`).toBe([301, 302, 303, 307, 308].includes(status));
    }
  });
  it.each([-1, 1000, 200.5, NaN, Infinity, -Infinity])('rejects non-status %j', (value) => {
    expect(isStatus(value)).toBe(false);
  });
});

describe('single ranges (Fetch §2.2.2)', () => {
  it.each([
    ['bytes=0-499', 0n, 499n], ['bytes=0-', 0n, undefined], ['bytes=-500', undefined, 500n],
    ['bytes=-0', undefined, 0n], ['bytes=0001-0002', 1n, 2n], ['bytes=3-3', 3n, 3n],
    ['bytes=9007199254740992-9007199254740993', 9007199254740992n, 9007199254740993n],
  ])('parses %j', (value, start, end) => {
    expect(parseSingleRangeHeaderValue(value, false)).toEqual([start, end]);
    expect(parseSingleRangeHeaderValue(value, true)).toEqual([start, end]);
  });
  it.each(['bytes = 0 - 499', 'bytes\t=\t0\t-\t499', 'bytes= - 500', 'bytes=0 - '])(
    'allows specified whitespace only when requested: %j', (value) => {
      expect(parseSingleRangeHeaderValue(value, false)).toBeNull();
      expect(parseSingleRangeHeaderValue(value, true)).not.toBeNull();
    },
  );
  it.each([
    '', 'Bytes=0-1', 'bytes', 'bytes=', 'bytes=-', 'bytes=500-499', 'bytes=0-1,2-3',
    'bytes=0-1 ', 'bytes=0-1\t', ' bytes=0-1', 'bytes=+0-1', 'bytes=0-1.5',
    'bytes=0--1', 'bytes=1e2-200', 'bytes=０-１', 'bytes\n=0-1', 'bytes=0-1\n',
    'bytes=9007199254740993-9007199254740992',
  ])('rejects %j in both modes', (value) => {
    expect(parseSingleRangeHeaderValue(value, false)).toBeNull();
    expect(parseSingleRangeHeaderValue(value, true)).toBeNull();
  });
  it('preserves arbitrarily large range integers', () => {
    const end = '9'.repeat(400);
    expect(parseSingleRangeHeaderValue(`bytes=0-${end}`, false)).toEqual([0n, BigInt(end)]);
  });
});

describe('default request header values', () => {
  it('selects the owning user agent\'s default when there is no emulation', () => {
    const client = createClientEnvironment();
    client.userAgent.defaultUserAgentValue = 'Configured/1.0';
    expect(getEnvironmentDefaultUserAgent(client)).toBe('Configured/1.0');
  });

  it.each(['Emulated', '', 'Agent/\u00e9'])('preserves the emulated value %j as a byte string', (value) => {
    const client = createClientEnvironment();
    client.userAgent.webDriverBiDiEmulatedUserAgent = () => value;
    expect(getEnvironmentDefaultUserAgent(client)).toBe(value);
  });

  it('defines the document Accept header value', () => {
    expect(documentAcceptHeaderValue).toBe('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  });
});

describe('CORS header classifications', () => {
  it('recognizes the exact unsafe byte set', () => {
    const punctuation = [34, 40, 41, 58, 60, 62, 63, 64, 91, 92, 93, 123, 125, 127];
    for (let byte = 0; byte < 256; byte++) {
      expect(isCORSUnsafeRequestHeaderByte(byte), `unsafe byte ${byte}`)
        .toBe(byte <= 31 && byte !== 9 || punctuation.includes(byte));
    }
  });
  it.each([
    ['Accept', 'text/html,*/*;q=0.8', true], ['Accept', 'a'.repeat(128), true],
    ['Accept', 'a'.repeat(129), false], ['Accept', '\t\xff', true], ['Accept', 'text/html("x")', false],
    ['Accept-Language', 'en-US, *;q=0.5', true], ['Content-Language', 'en_US', false],
    ['Content-Language', 'en\t', false], ['Content-Language', 'é', false],
    ['Content-Type', 'text/plain;charset=UTF-8', true], ['CONTENT-TYPE', 'TEXT/PLAIN', true],
    ['Content-Type', 'multipart/form-data;boundary=abc', true],
    ['Content-Type', 'application/x-www-form-urlencoded', true], ['Content-Type', 'application/json', false],
    ['Content-Type', 'text/plain;charset="UTF-8"', false],
    ['Content-Type', 'application/json, text/plain', false], ['Content-Type', 'not-a-mime', false],
    ['Range', 'bytes=0-499', true], ['Range', 'bytes=0-', true], ['Range', 'bytes=-500', false],
    ['Range', 'bytes =0-499', false], ['Range', 'bytes=500-499', false],
    ['Range', 'bytes=0-499,1000-1499', false], ['X-Custom', 'value', false],
  ])('classifies %s: %j as safelisted=%s', (name, value, safelisted) => {
    expect(isCORSSafelistedRequestHeader([name, value])).toBe(safelisted);
  });
  it('promotes safelisted names only when their aggregate values exceed 1024 bytes', () => {
    const list = new FetchHeaders(Array.from({ length: 8 }, () => ['Accept', 'a'.repeat(128)]));
    list.list.push(['X-Unsafe', 'a'.repeat(2000)]);
    expect(list.getCORSUnsafeRequestHeaderNames()).toEqual(['x-unsafe']);
    list.list.push(['Content-Language', 'a']);
    expect(list.getCORSUnsafeRequestHeaderNames()).toEqual(['accept', 'content-language', 'x-unsafe']);
  });
  it('keeps per-line safelist checks separate from combined header checks', () => {
    const list = new FetchHeaders([['Content-Type', 'application/json'], ['content-type', 'text/plain']]);
    expect(list.getCORSUnsafeRequestHeaderNames()).toEqual(['content-type']);
    expect(isCORSSafelistedRequestHeader(['content-type', list.get('content-type')!])).toBe(false);
  });
  it('distinguishes no-CORS names, privileged Range, and Authorization’s non-wildcard status', () => {
    for (const name of ['Accept', 'Accept-Language', 'Content-Language', 'Content-Type']) {
      expect(isNoCORSSafelistedRequestHeaderName(name)).toBe(true);
    }
    expect(isNoCORSSafelistedRequestHeader(['Accept', '*/*'])).toBe(true);
    expect(isNoCORSSafelistedRequestHeader(['Accept', '"unsafe"'])).toBe(false);
    expect(isNoCORSSafelistedRequestHeader(['Range', 'bytes=0-1'])).toBe(false);
    expect(isNoCORSSafelistedRequestHeaderName('Range')).toBe(false);
    expect(isPrivilegedNoCORSRequestHeaderName('rAnGe')).toBe(true);
    expect(isPrivilegedNoCORSRequestHeaderName('Accept')).toBe(false);
    expect(isCORSNonWildcardRequestHeaderName('AUTHORIZATION')).toBe(true);
    expect(isCORSNonWildcardRequestHeaderName('X-Custom')).toBe(false);
  });
  it('exposes safelisted response names and explicit names, excluding forbidden ones', () => {
    for (const name of ['Cache-Control', 'Content-Language', 'Content-Length', 'Content-Type', 'Expires', 'Last-Modified', 'Pragma']) {
      expect(isCORSSafelistedResponseHeaderName(name, [])).toBe(true);
    }
    expect(isCORSSafelistedResponseHeaderName('X-Custom', ['x-custom'])).toBe(true);
    expect(isCORSSafelistedResponseHeaderName('X-Custom', [])).toBe(false);
    expect(isCORSSafelistedResponseHeaderName('Set-Cookie', ['Set-Cookie'])).toBe(false);
    expect(isCORSSafelistedResponseHeaderName('set-cookie2', ['SET-COOKIE2'])).toBe(false);
  });
});

describe('forbidden and request-body headers', () => {
  it.each([
    'Accept-Charset', 'Accept-Encoding', 'Access-Control-Request-Headers', 'Access-Control-Request-Method',
    'Connection', 'Content-Length', 'Cookie', 'Cookie2', 'Date', 'DNT', 'Expect', 'Host', 'Keep-Alive',
    'Origin', 'Referer', 'Set-Cookie', 'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade', 'Via', 'Proxy-X', 'Sec-X',
  ])('forbids %s regardless of casing or value', (name) => {
    expect(isForbiddenRequestHeader([name, ''])).toBe(true);
    expect(isForbiddenRequestHeader([name.toLowerCase(), 'anything'])).toBe(true);
  });
  it.each(['X-HTTP-Method', 'X-HTTP-Method-Override', 'X-Method-Override'])('checks method overrides in %s', (name) => {
    for (const value of ['CONNECT', 'GET, tRaCe', ', TRACK,']) expect(isForbiddenRequestHeader([name, value])).toBe(true);
    for (const value of ['GET, POST', '"TRACE"', '"GET,TRACE"', 'CONNECTX']) expect(isForbiddenRequestHeader([name, value])).toBe(false);
  });
  it('keeps ordinary request fields allowed and distinguishes response/body classifications', () => {
    for (const name of ['Authorization', 'User-Agent', 'X-Example', 'Content-Type', 'Set-Cookie2']) {
      expect(isForbiddenRequestHeader([name, 'value'])).toBe(false);
    }
    expect(isForbiddenResponseHeaderName('SET-COOKIE')).toBe(true);
    expect(isForbiddenResponseHeaderName('Set-Cookie2')).toBe(true);
    expect(isForbiddenResponseHeaderName('Cookie')).toBe(false);
    for (const name of ['Content-Encoding', 'Content-Language', 'Content-Location', 'Content-Type']) {
      expect(isRequestBodyHeaderName(name)).toBe(true);
    }
    expect(isRequestBodyHeaderName('Content-Length')).toBe(false);
  });
});

describe('header extraction with the field’s grammar', () => {
  it('distinguishes missing fields, empty lists, and invalid syntax using Vary’s real parser', () => {
    expect(new FetchHeaders().extractValues('Vary', parseVary, true)).toBeUndefined();
    expect(new FetchHeaders([['Vary', '']]).extractValues('Vary', parseVary, true)).toEqual([]);
    expect(new FetchHeaders([['Vary', 'Accept'], ['VARY', 'X-Variant, Accept-Language']]).extractValues('Vary', parseVary, true))
      .toEqual(['accept', 'x-variant', 'accept-language']);
    expect(new FetchHeaders([['Vary', 'Accept'], ['Vary', 'bad name']]).extractValues('Vary', parseVary, true)).toBeNull();
  });
  it('rejects duplicate singleton fields before parsing and discards all values on a parse failure', () => {
    const parser = vi.fn((value: string) => {
      const seconds = parseDeltaSeconds(value);
      return seconds === null ? null : [seconds];
    });
    expect(new FetchHeaders([
      ['Access-Control-Max-Age', '10'], ['access-control-max-age', '20'],
    ]).extractValues('Access-Control-Max-Age', parser, false)).toBeNull();
    expect(parser).not.toHaveBeenCalled();
    expect(new FetchHeaders([['ACCESS-CONTROL-MAX-AGE', '10']]).extractValues('Access-Control-Max-Age', parser, false)).toEqual([10]);
    expect(new FetchHeaders([['Access-Control-Max-Age', 'ten']]).extractValues('Access-Control-Max-Age', parser, false)).toBeNull();
  });
});

describe('structured fields over Fetch headers', () => {
  it('combines lines and uses the requested RFC 9651 type', () => {
    const list = new FetchHeaders([['Priority', 'u=1'], ['PRIORITY', 'i']]);
    const field = list.getStructuredFieldValue('priority', 'dictionary');
    expect(field?.members.get('u')).toEqual(structuredItem({ type: 'integer', value: 1 }));
    expect(field?.members.get('i')).toEqual(structuredItem({ type: 'boolean', value: true }));
    expect(list.getStructuredFieldValue('priority', 'item')).toBeNull();
  });
  it('returns null for absence or invalid structured data, even if the bytes form a valid ordinary header', () => {
    expect(new FetchHeaders().getStructuredFieldValue('X', 'list')).toBeNull();
    expect(new FetchHeaders([['X', '\xff']]).getStructuredFieldValue('X', 'list')).toBeNull();
    expect(new FetchHeaders([['X', 'token'], ['X', '"unterminated']]).getStructuredFieldValue('X', 'list')).toBeNull();
    expect(new FetchHeaders([['X', '']]).getStructuredFieldValue('X', 'list')).toEqual({ type: 'list', members: [] });
  });

  it('sets the serialized value in place while retaining the first entry’s spelling and position', () => {
    const request = createFetchRequest();
    const list = request.headerList;
    list.append('Priority', 'u=0');
    list.append('X-Other', 'untouched');
    list.append('priority', 'i');
    const first = list.list[0];
    const field: StructuredField = {
      type: 'dictionary', members: new Map([
        ['u', structuredItem({ type: 'integer', value: 2 })],
        ['i', structuredItem({ type: 'boolean', value: true })],
      ]),
    };
    list.setStructuredFieldValue('PRIORITY', field);
    expect(request.headerList).toBe(list);
    expect(list.list[0]).toBe(first);
    expect(list.list).toEqual([['Priority', 'u=2, i'], ['X-Other', 'untouched']]);
    expect(list.getStructuredFieldValue('priority', 'dictionary')).toEqual(field);
  });

  it.each([
    { type: 'list', members: [] }, { type: 'dictionary', members: new Map() },
  ] satisfies StructuredField[])('omits an empty $type by removing every named field line', (field) => {
    const list = new FetchHeaders([['X', 'old'], ['Y', 'keep'], ['x', 'older']]);
    list.setStructuredFieldValue('X', field);
    expect(list.list).toEqual([['Y', 'keep']]);
    list.setStructuredFieldValue('X', field);
    expect(list.list).toEqual([['Y', 'keep']]);
    expect(list.getStructuredFieldValue('X', field.type)).toBeNull();
  });

  it.each([
    [structuredItem({ type: 'string', value: '' }), '""'],
    [structuredItem({ type: 'bytes', value: new Uint8Array() }), '::'],
    [{ type: 'list', members: [{ type: 'inner-list', items: [], parameters: new Map() }] }, '()'],
    [structuredItem({ type: 'display-string', value: 'café' }), '%"caf%c3%a9"'],
  ] satisfies [StructuredField, string][])('retains a serializable item/inner-list value %j', (field, expected) => {
    const list = new FetchHeaders();
    list.setStructuredFieldValue('X', field);
    expect(list.list).toEqual([['X', expected]]);
    expect(list.getStructuredFieldValue('X', field.type)).toEqual(field);
  });

  it('throws on serialization failure before changing existing fields or adding a new one', () => {
    const list = new FetchHeaders([['X', 'old'], ['Y', 'keep'], ['x', 'older']]);
    const first = list.list[0];
    const field: StructuredField = {
      type: 'dictionary', members: new Map([
        ['valid', structuredItem({ type: 'integer', value: 1 })],
        ['INVALID', structuredItem({ type: 'integer', value: 2 })],
      ]),
    };
    expect(() => list.setStructuredFieldValue('X', field)).toThrow(TypeError);
    expect(() => list.setStructuredFieldValue('Z', field)).toThrow(TypeError);
    expect(list.list).toEqual([['X', 'old'], ['Y', 'keep'], ['x', 'older']]);
    expect(list.list[0]).toBe(first);
    expect([...field.members.keys()]).toEqual(['valid', 'INVALID']);
  });
});

describe('CORS response token lists (Fetch §3.3.4)', () => {
  it.each(['Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Access-Control-Expose-Headers'])(
    'extracts %s without changing case or assigning wildcard meaning', (name) => {
      const headers = new FetchHeaders([[name, 'GET, x-Custom'], [name.toLowerCase(), '\t*, GET ']]);
      expect(headers.extractValues(name, parseCORSTokenList, true)).toEqual(['GET', 'x-Custom', '*', 'GET']);
      expect(new FetchHeaders().extractValues(name, parseCORSTokenList, true)).toBeUndefined();
    },
  );

  it('accepts empty list elements and HTTP token punctuation', () => {
    expect(parseCORSTokenList('')).toEqual([]);
    expect(parseCORSTokenList(', \t,')).toEqual([]);
    expect(parseCORSTokenList(", GET ,, !#$%&'*+-.^_`|~09AZaz, ")).toEqual(['GET', "!#$%&'*+-.^_`|~09AZaz"]);
  });

  it.each(['bad name', '"GET"', 'name:value', 'name/value', 'é', 'X\r', 'X\n', '\vX', '\fX'])(
    'rejects the whole list containing %j', (invalid) => {
      const headers = new FetchHeaders([['Access-Control-Allow-Headers', 'X-Good'],
        ['Access-Control-Allow-Headers', `X-Other, ${invalid}`]]);
      expect(headers.extractValues('Access-Control-Allow-Headers', parseCORSTokenList, true)).toBeNull();
    },
  );
});

describe('Content-Length extraction (Fetch §3.4)', () => {
  it.each<[string, bigint]>([
    ['0', 0n], ['42', 42n], ['00042', 42n], [' \t42\t ', 42n], ['42, 42', 42n],
    ['9007199254740993', 9007199254740993n], ['18446744073709551616', 18446744073709551616n],
  ])('extracts %j without integer rounding', (value, expected) => {
    expect(new FetchHeaders([['Content-Length', value]]).extractLength()).toBe(expected);
  });

  it('compares repeated field values and preserves the list', () => {
    const headers = new FetchHeaders([['Content-Length', '42'], ['content-length', ' 42 ']]);
    expect(headers.extractLength()).toBe(42n);
    expect(headers.list).toEqual([['Content-Length', '42'], ['content-length', ' 42 ']]);
    headers.append('CONTENT-LENGTH', '43');
    expect(headers.extractLength()).toBeNull();
  });

  it('returns no usable length when the field is absent', () => {
    expect(new FetchHeaders().extractLength()).toBeUndefined();
  });

  it.each(['', ' ', 'ten', '-1', '+1', '1.0', '1e3', '0x10', '"42"', '4 2', '４２', '42\n', ','])(
    'returns no usable length for %j', (value) => {
      expect(new FetchHeaders([['Content-Length', value]]).extractLength()).toBeUndefined();
    },
  );

  it.each(['42,43', '042,42', ',42', '42,', 'bad,42', '42,bad', '"42,42",42'])(
    'fails conflicting values %j before numeric interpretation', (value) => {
      expect(new FetchHeaders([['Content-Length', value]]).extractLength()).toBeNull();
    },
  );
});

describe('Content-Type extraction (Fetch §3.5)', () => {
  it.each([
    ['text/plain;charset=gbk, text/html', 'text/html'],
    ['text/html;charset=gbk;a=b, text/html;x=y', 'text/html;x=y;charset=gbk'],
    ['text/html;charset=gbk, x/x, text/html;x=y', 'text/html;x=y'],
    ['text/html, cannot-parse', 'text/html'],
    ['text/html, */*', 'text/html'],
    ['text/html, ', 'text/html'],
    ['text/html;charset=gbk, text/html;charset=utf-8, text/html', 'text/html;charset=gbk'],
    ['text/html, text/html;charset=utf-8, text/html', 'text/html'],
    ['text/html;charset="", text/html', 'text/html;charset=""'],
    ['text/html;note="a,b"', 'text/html;note="a,b"'],
    ['cannot-parse, */*, ', null],
  ] as const)('extracts %s', (value, expected) => {
    const mimeType = new FetchHeaders([['Content-Type', value]]).extractMIMEType();

    expect(mimeType === null ? null : serializeMIMEType(mimeType)).toBe(expected);
  });

  it('uses repeated, case-insensitive field names without changing the header list', () => {
    const headers = new FetchHeaders([['Content-Type', 'text/html;charset=gbk;a=b'], ['content-type', 'text/html;x=y']]);
    const before = structuredClone(headers.list);
    const mimeType = headers.extractMIMEType()!;

    expect(serializeMIMEType(mimeType)).toBe('text/html;x=y;charset=gbk');
    expect(headers.list).toEqual(before);
    expect(new FetchHeaders().extractMIMEType()).toBeNull();
  });
});

describe('legacy encoding extraction (Fetch §3.5)', () => {
  it.each([
    ['utf8', 'UTF-8'], ['ISO-8859-1', 'windows-1252'], [' Shift_JIS ', 'Shift_JIS'],
    ['UTF-16', 'UTF-16LE'], ['replacement', 'replacement'],
  ])('resolves the charset label %j', (label, expected) => {
    const mimeType = parseMIMEType(`text/plain;charset="${label}"`);
    expect(legacyExtractEncoding(mimeType, 'UTF-8')).toBe(expected);
  });

  it.each([null, 'text/plain', 'text/plain;charset=""', 'text/plain;charset=unknown'])(
    'retains the caller fallback for %j', (value) => {
      const mimeType = value === null ? null : parseMIMEType(value);
      expect(legacyExtractEncoding(mimeType, 'windows-1252')).toBe('windows-1252');
    },
  );

  it('uses the charset selected across repeated Content-Type fields', () => {
    const headers = new FetchHeaders([['Content-Type', 'text/html;charset=gbk, text/html']]);
    expect(legacyExtractEncoding(headers.extractMIMEType(), 'UTF-8')).toBe('GBK');
  });
});

describe('nosniff detection (Fetch §3.6)', () => {
  it.each(['nosniff', 'NoSnIfF', '\tNOSNIFF ', 'nosniff, invalid'])(
    'recognizes the first value in %j', (value) => {
      expect(new FetchHeaders([['x-content-type-options', value]]).determineNosniff()).toBe(true);
    },
  );

  it.each(['', 'invalid, nosniff', ', nosniff', '"nosniff"', 'nosniff;other', 'nosniffx'])(
    'does not recognize %j', (value) => {
      expect(new FetchHeaders([['X-Content-Type-Options', value]]).determineNosniff()).toBe(false);
    },
  );

  it('uses field order, including an empty first value, and treats absence as false', () => {
    expect(new FetchHeaders().determineNosniff()).toBe(false);
    const headers = new FetchHeaders([['X-Content-Type-Options', ''], ['x-content-type-options', 'nosniff']]);
    expect(headers.determineNosniff()).toBe(false);
    headers.list.reverse();
    expect(headers.determineNosniff()).toBe(true);
  });
});

describe('Sec-Purpose (Fetch §3.8)', () => {
  it('uses a structured-field token for prefetch', () => {
    const headers = new FetchHeaders();
    const prefetch = structuredItem({ type: 'token', value: 'prefetch' });
    headers.setStructuredFieldValue('Sec-Purpose', prefetch);
    expect(headers.get('Sec-Purpose')).toBe('prefetch');
    expect(headers.getStructuredFieldValue('Sec-Purpose', 'item')).toEqual(prefetch);
  });
});

describe('Headers implementation (Fetch §5.1)', () => {
  it('mutates its shared list while supplying sorted copies for iteration', () => {
    const list = new FetchHeaders();
    const headers = new HeadersImpl(list);
    headers.append('Z', ' \t first\r\n');
    headers.append('a', '');
    headers.append('z', 'second');
    expect(headers.headerList).toBe(list);
    expect(list.list).toEqual([['Z', 'first'], ['a', ''], ['Z', 'second']]);
    expect(headers.get('z')).toBe('first, second');
    expect(headers.has('A')).toBe(true);
    expect(headers.get('missing')).toBeNull();

    const entries = headers.getEntryList();
    entries[0]![1] = 'copy';
    expect(headers.get('a')).toBe('');
    headers.set('Z', ' replacement ');
    expect(list.list).toEqual([['Z', 'replacement'], ['a', '']]);
    headers.delete('z');
    expect(headers.getEntryList()).toEqual([['a', '']]);
  });

  it('fills in order and retains earlier entries when a later pair is malformed', () => {
    const headers = new HeadersImpl();
    expect(() => headers.fill([['first', 'value'], ['malformed'], ['last', 'unreached']]))
      .toThrow(/exactly two/);
    expect(headers.headerList.list).toEqual([['first', 'value']]);
    headers.fill({ first: 'second', last: ' \t value ' });
    expect(headers.getEntryList()).toEqual([['first', 'value, second'], ['last', 'value']]);
  });

  it('keeps Set-Cookie values separate and returns an independent list', () => {
    const headers = new HeadersImpl();
    expect(headers.getSetCookie()).toEqual([]);
    headers.append('Set-Cookie', 'a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT');
    headers.append('set-cookie', 'b=2');
    const cookies = headers.getSetCookie();
    expect(headers.get('SET-COOKIE')).toBe(`${cookies[0]}, b=2`);
    cookies.push('not stored');
    expect(headers.getSetCookie()).toHaveLength(2);
    headers.set('set-cookie', 'c=3');
    expect(headers.getSetCookie()).toEqual(['c=3']);
  });

  it('shares internal mutations across APIs with independent guards', () => {
    const list = new FetchHeaders();
    const requestHeaders = new HeadersImpl(list, 'request');
    const immutableHeaders = new HeadersImpl(list, 'immutable');
    list.append('Cookie', 'internal=1');
    requestHeaders.set('Cookie', 'author=2');
    expect(immutableHeaders.get('Cookie')).toBe('internal=1');
    expect(() => immutableHeaders.set('Cookie', 'author=3')).toThrow('Headers are immutable');

    requestHeaders.append('X-Example', 'shared');
    expect(immutableHeaders.get('X-Example')).toBe('shared');
    list.set('Cookie', 'internal=4');
    expect(requestHeaders.get('Cookie')).toBe('internal=4');
    expect(immutableHeaders.get('Cookie')).toBe('internal=4');
  });

  it('validates syntax before immutable guards and keeps reads available', () => {
    const headers = new HeadersImpl(new FetchHeaders([['X', 'value']]), 'immutable');
    for (const method of ['append', 'set'] as const) {
      expect(() => headers[method]('bad name', 'value')).toThrow('Invalid header name');
      expect(() => headers[method]('X', 'bad\nvalue')).toThrow('Invalid header value');
      expect(() => headers[method]('X', 'value')).toThrow('Headers are immutable');
    }
    expect(() => headers.delete('bad name')).toThrow('Invalid header name');
    expect(() => headers.delete('missing')).toThrow('Headers are immutable');
    expect(headers.get('x')).toBe('value');
    expect(headers.has('x')).toBe(true);
  });

  it('applies request guards, including value-dependent forbidden methods', () => {
    const headers = new HeadersImpl(new FetchHeaders([['Cookie', 'existing']]), 'request');
    headers.fill({ Host: 'example.test', 'X-Custom': 'allowed', 'Sec-Fetch-Site': 'same-origin' });
    headers.append('Cookie', 'new');
    headers.set('Cookie', 'new');
    headers.delete('Cookie');
    headers.append('X-HTTP-Method-Override', 'GET');
    headers.append('X-HTTP-Method-Override', 'TRACE');
    headers.set('X-HTTP-Method-Override', 'TRACK');
    expect(headers.get('X-HTTP-Method-Override')).toBe('GET');
    headers.delete('X-HTTP-Method-Override');
    expect(headers.headerList.list).toEqual([['Cookie', 'existing'], ['X-Custom', 'allowed']]);
    expect(() => headers.append('Host', 'bad\nvalue')).toThrow('Invalid header value');
  });

  it('applies response guards without removing existing forbidden fields', () => {
    const headers = new HeadersImpl(new FetchHeaders([['Set-Cookie', 'existing=1']]), 'response');
    for (const name of ['Set-Cookie', 'Set-Cookie2']) {
      headers.append(name, 'new=2');
      headers.set(name, 'new=2');
      headers.delete(name);
    }
    headers.append('Content-Type', 'text/plain');
    expect(headers.getSetCookie()).toEqual(['existing=1']);
    expect(headers.get('Content-Type')).toBe('text/plain');
  });

  it('checks the combined no-CORS append value but only the new set value', () => {
    const headers = new HeadersImpl(new FetchHeaders([['Accept', 'a'.repeat(126)]]), 'request-no-cors');
    headers.append('Accept', 'b');
    expect(headers.get('Accept')).toBe('a'.repeat(126));
    headers.append('Accept', '');
    expect(headers.get('Accept')).toBe(`${'a'.repeat(126)}, `);
    headers.set('Accept', 'b');
    expect(headers.get('Accept')).toBe('b');
    headers.fill({ 'Content-Type': 'application/json', 'X-Custom': 'ignored' });
    headers.append('Content-Language', 'en_US');
    expect(headers.headerList.list).toEqual([['Accept', 'b']]);
  });

  it.each(['append', 'set', 'delete'] as const)(
    'removes privileged no-CORS headers after a successful %s', (method) => {
      const headers = new HeadersImpl(new FetchHeaders([['Range', 'bytes=0-9'], ['Accept', '*/*']]), 'request-no-cors');
      headers[method]('Accept', 'text/plain');
      expect(headers.has('Range')).toBe(false);
    },
  );

  it('preserves privileged no-CORS headers after ignored or absent mutations', () => {
    const headers = new HeadersImpl(new FetchHeaders([['Range', 'bytes=0-9'], ['X-Custom', 'existing']]), 'request-no-cors');
    headers.append('X-Custom', 'ignored');
    headers.set('Accept', '"unsafe"');
    headers.delete('X-Custom');
    headers.delete('Accept');
    expect(headers.headerList.list).toEqual([['Range', 'bytes=0-9'], ['X-Custom', 'existing']]);
    headers.delete('rAnGe');
    expect(headers.headerList.list).toEqual([['X-Custom', 'existing']]);
  });
});

describe('Headers realm allocation', () => {
  it.each(['Request', 'Response'])('projects %s Headers in the receiver realm through a borrowed getter', (name) => {
    const fixture = createFetchFixture();
    const foreignRealm = new TestRealm();
    const foreign = fixture.bindings.register(foreignRealm, () => createEnvironment(foreignRealm));
    const createObject = (context: BindingContext) => name === 'Request'
      ? context.project(RequestImpl, context.construct(
        RequestImpl, createFetchRequest(), 'request', context.getEnvironment().exec.createAbortController().signal,
      ))
      : context.project(ResponseImpl, context.construct(ResponseImpl, new FetchResponse(), 'response'));
    const receiver = createObject(fixture.context);
    const foreignReceiver = createObject(foreign);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrowing the getter is the behavior under test.
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(foreignReceiver), 'headers')?.get;
    if (!getter) throw new Error('Missing Headers getter');

    // The borrowed getter is the first path to expose the receiver's Headers.
    const headers = Reflect.apply(getter, receiver, []) as object;
    expect(fixture.bindings.getRealm(headers)).toBe(fixture.realm);
    expect(Reflect.get(receiver, 'headers')).toBe(headers);
    const foreignHeaders = Reflect.apply(getter, foreignReceiver, []) as object;
    expect(fixture.bindings.getRealm(foreignHeaders)).toBe(foreignRealm);
    expect(foreignHeaders).not.toBe(headers);
  });

  it('can opt getSetCookie into method-realm allocation with a declaration', () => {
    const definition = {
      ...headersIDL,
      members: headersIDL.members.map((member) =>
        member.kind === 'operation' && member.name === 'getSetCookie'
          ? { ...member, ...allocateIn('method') }
          : member),
    };
    const world = new BindingWorld([headersInitIDL, definition]);
    const receiverRealm = new TestRealm();
    const methodRealm = new TestRealm();
    const context = world.register(receiverRealm);
    context.install(receiverRealm.global);
    world.register(methodRealm).install(methodRealm.global);
    const Constructor = Reflect.get(methodRealm.global, 'Headers') as typeof Headers;
    const method = Reflect.get(Constructor.prototype, 'getSetCookie');
    const headers = context.project(HeadersImpl, new HeadersImpl(new FetchHeaders([['Set-Cookie', 'a=1']])));
    const cookies = Reflect.apply(method, headers, []);
    expect(cookies).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(cookies).not.toBeInstanceOf(receiverRealm.intrinsics.array);
    expect(cookies).toEqual(['a=1']);
  });
});

function structuredItem(bareItem: StructuredBareItem): StructuredItem {
  return { type: 'item', bareItem, parameters: new Map() };
}
