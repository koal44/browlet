import { describe, expect, it, vi } from 'vitest';

import {
  appendHeader, combineHeader, containsHeader, convertHeaderNamesToSortedLowercaseSet,
  deleteHeader, documentAcceptHeaderValue, extractHeaderListValues, getCORSUnsafeRequestHeaderNames,
  getDecodeAndSplitHeader, getDecodeAndSplitHeaderValue, getEnvironmentDefaultUserAgent, getHeader,
  getStructuredFieldValue, isCORSNonWildcardRequestHeaderName, isCORSSafelistedRequestHeader,
  isCORSSafelistedResponseHeaderName, isCORSUnsafeRequestHeaderByte, isForbiddenRequestHeader,
  isForbiddenResponseHeaderName, isHeaderName, isHeaderValue, isNoCORSSafelistedRequestHeader,
  isNoCORSSafelistedRequestHeaderName, isPrivilegedNoCORSRequestHeaderName, isRequestBodyHeaderName,
  normalizeHeaderValue, setHeader, setStructuredFieldValue, sortAndCombineHeaders, type HeaderList,
} from '../../../src/fetch/headers';
import { parseDeltaSeconds, parseVary } from '../../../src/http/cache/fields';
import type { StructuredBareItem, StructuredField, StructuredItem } from '../../../src/http/struct-fields/index';
import { createRequestRecord } from '../record-fixture';

describe('header lists (Fetch §2.2.2)', () => {
  it('distinguishes absent and empty values and combines duplicate lines in order', () => {
    const list: HeaderList = [['A', 'one'], ['B', ''], ['a', 'two']];
    expect(containsHeader('a', list)).toBe(true);
    expect(containsHeader('c', list)).toBe(false);
    expect(getHeader('A', list)).toBe('one, two');
    expect(getHeader('b', list)).toBe('');
    expect(getHeader('c', list)).toBeNull();
    expect(getDecodeAndSplitHeader('b', list)).toEqual(['']);
    expect(getDecodeAndSplitHeader('c', list)).toBeNull();
  });

  it('mutates the actual request list, preserving the first spelling and existing entry', () => {
    const request = createRequestRecord();
    const list = request.headerList;
    appendHeader(['X-First', 'one'], list);
    const first = list[0];
    appendHeader(['B', 'other'], list);
    appendHeader(['x-FIRST', 'two'], list);
    expect(list).toEqual([['X-First', 'one'], ['B', 'other'], ['X-First', 'two']]);
    setHeader(['x-first', 'replacement'], list);
    expect(request.headerList).toBe(list);
    expect(list[0]).toBe(first);
    expect(list).toEqual([['X-First', 'replacement'], ['B', 'other']]);
    setHeader(['C', 'new'], list);
    deleteHeader('x-FIRST', list);
    expect(request.headerList).toEqual([['B', 'other'], ['C', 'new']]);
  });

  it('deletes all matches without skipping adjacent duplicates', () => {
    const list: HeaderList = [['A', '1'], ['a', '2'], ['B', '3'], ['A', '4']];
    deleteHeader('a', list);
    deleteHeader('missing', list);
    expect(list).toEqual([['B', '3']]);
  });

  it('combine appends to the first matching value without deleting later entries', () => {
    const list: HeaderList = [['A', 'one'], ['B', 'other'], ['a', 'two']];
    combineHeader(['a', 'three'], list);
    combineHeader(['C', 'new'], list);
    expect(list).toEqual([['A', 'one, three'], ['B', 'other'], ['a', 'two'], ['C', 'new']]);
  });

  it('sorts and combines regular fields while preserving separate Set-Cookie lines', () => {
    const list: HeaderList = [
      ['Z', 'first'], ['Set-Cookie', 'a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT'],
      ['A', 'value'], ['set-cookie', 'b=2; Path=/'], ['z', 'second'],
    ];
    const before = list.map((header) => [...header]);
    const sorted = sortAndCombineHeaders(list);
    expect(sorted).toEqual([
      ['a', 'value'], ['set-cookie', 'a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT'],
      ['set-cookie', 'b=2; Path=/'], ['z', 'first, second'],
    ]);
    expect(list).toEqual(before);
    sorted[0]![1] = 'changed';
    expect(list).toEqual(before);
    // The general get operation still joins all values; sort-and-combine has the exception.
    expect(getHeader('set-cookie', list)).toBe('a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT, b=2; Path=/');
  });

  it('sorts names by byte order after lowercasing and removing duplicates', () => {
    expect(convertHeaderNamesToSortedLowercaseSet(['Z', 'a', 'A', '_X', '9', 'x'])).toEqual(['9', '_x', 'a', 'x', 'z']);
    expect(sortAndCombineHeaders([])).toEqual([]);
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
    expect(getDecodeAndSplitHeader('A', [['A', value]])).toEqual(expected);
  });

  it('combines field lines before quote-aware splitting', () => {
    expect(getDecodeAndSplitHeader('A', [['A', 'text/html;"'], ['B', 'ignored'], ['A', 'x/x']]))
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
    const list: HeaderList = Array.from({ length: 8 }, () => ['Accept', 'a'.repeat(128)]);
    list.push(['X-Unsafe', 'a'.repeat(2000)]);
    expect(getCORSUnsafeRequestHeaderNames(list)).toEqual(['x-unsafe']);
    list.push(['Content-Language', 'a']);
    expect(getCORSUnsafeRequestHeaderNames(list)).toEqual(['accept', 'content-language', 'x-unsafe']);
  });
  it('keeps per-line safelist checks separate from combined header checks', () => {
    const list: HeaderList = [['Content-Type', 'application/json'], ['content-type', 'text/plain']];
    expect(getCORSUnsafeRequestHeaderNames(list)).toEqual(['content-type']);
    expect(isCORSSafelistedRequestHeader(['content-type', getHeader('content-type', list)!])).toBe(false);
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
    expect(extractHeaderListValues('Vary', [], parseVary, true)).toBeNull();
    expect(extractHeaderListValues('Vary', [['Vary', '']], parseVary, true)).toEqual([]);
    expect(extractHeaderListValues('Vary', [['Vary', 'Accept'], ['VARY', 'X-Variant, Accept-Language']], parseVary, true))
      .toEqual(['accept', 'x-variant', 'accept-language']);
    expect(extractHeaderListValues('Vary', [['Vary', 'Accept'], ['Vary', 'bad name']], parseVary, true)).toBe('failure');
  });
  it('rejects duplicate singleton fields before parsing and discards all values on a parse failure', () => {
    const parser = vi.fn((value: string) => {
      const seconds = parseDeltaSeconds(value);
      return seconds === null ? null : [seconds];
    });
    expect(extractHeaderListValues('Access-Control-Max-Age', [
      ['Access-Control-Max-Age', '10'], ['access-control-max-age', '20'],
    ], parser, false)).toBe('failure');
    expect(parser).not.toHaveBeenCalled();
    expect(extractHeaderListValues('Access-Control-Max-Age', [['ACCESS-CONTROL-MAX-AGE', '10']], parser, false)).toEqual([10]);
    expect(extractHeaderListValues('Access-Control-Max-Age', [['Access-Control-Max-Age', 'ten']], parser, false)).toBe('failure');
  });
});

describe('structured fields over Fetch headers', () => {
  it('combines lines and uses the requested RFC 9651 type', () => {
    const list: HeaderList = [['Priority', 'u=1'], ['PRIORITY', 'i']];
    const field = getStructuredFieldValue('priority', 'dictionary', list);
    expect(field?.members.get('u')).toEqual(structuredItem({ type: 'integer', value: 1 }));
    expect(field?.members.get('i')).toEqual(structuredItem({ type: 'boolean', value: true }));
    expect(getStructuredFieldValue('priority', 'item', list)).toBeNull();
  });
  it('returns null for absence or invalid structured data, even if the bytes form a valid ordinary header', () => {
    expect(getStructuredFieldValue('X', 'list', [])).toBeNull();
    expect(getStructuredFieldValue('X', 'list', [['X', '\xff']])).toBeNull();
    expect(getStructuredFieldValue('X', 'list', [['X', 'token'], ['X', '"unterminated']])).toBeNull();
    expect(getStructuredFieldValue('X', 'list', [['X', '']])).toEqual({ type: 'list', members: [] });
  });

  it('sets the serialized value in place while retaining the first entry’s spelling and position', () => {
    const request = createRequestRecord();
    const list = request.headerList;
    appendHeader(['Priority', 'u=0'], list);
    appendHeader(['X-Other', 'untouched'], list);
    appendHeader(['priority', 'i'], list);
    const first = list[0];
    const field: StructuredField = {
      type: 'dictionary', members: new Map([
        ['u', structuredItem({ type: 'integer', value: 2 })],
        ['i', structuredItem({ type: 'boolean', value: true })],
      ]),
    };
    setStructuredFieldValue(['PRIORITY', field], list);
    expect(request.headerList).toBe(list);
    expect(list[0]).toBe(first);
    expect(list).toEqual([['Priority', 'u=2, i'], ['X-Other', 'untouched']]);
    expect(getStructuredFieldValue('priority', 'dictionary', list)).toEqual(field);
  });

  it.each([
    { type: 'list', members: [] }, { type: 'dictionary', members: new Map() },
  ] satisfies StructuredField[])('omits an empty $type by removing every named field line', (field) => {
    const list: HeaderList = [['X', 'old'], ['Y', 'keep'], ['x', 'older']];
    setStructuredFieldValue(['X', field], list);
    expect(list).toEqual([['Y', 'keep']]);
    setStructuredFieldValue(['X', field], list);
    expect(list).toEqual([['Y', 'keep']]);
    expect(getStructuredFieldValue('X', field.type, list)).toBeNull();
  });

  it.each([
    [structuredItem({ type: 'string', value: '' }), '""'],
    [structuredItem({ type: 'bytes', value: new Uint8Array() }), '::'],
    [{ type: 'list', members: [{ type: 'inner-list', items: [], parameters: new Map() }] }, '()'],
    [structuredItem({ type: 'display-string', value: 'café' }), '%"caf%c3%a9"'],
  ] satisfies [StructuredField, string][])('retains a serializable item/inner-list value %j', (field, expected) => {
    const list: HeaderList = [];
    setStructuredFieldValue(['X', field], list);
    expect(list).toEqual([['X', expected]]);
    expect(getStructuredFieldValue('X', field.type, list)).toEqual(field);
  });

  it('throws on serialization failure before changing existing fields or adding a new one', () => {
    const list: HeaderList = [['X', 'old'], ['Y', 'keep'], ['x', 'older']];
    const first = list[0];
    const field: StructuredField = {
      type: 'dictionary', members: new Map([
        ['valid', structuredItem({ type: 'integer', value: 1 })],
        ['INVALID', structuredItem({ type: 'integer', value: 2 })],
      ]),
    };
    expect(() => setStructuredFieldValue(['X', field], list)).toThrow(TypeError);
    expect(() => setStructuredFieldValue(['Z', field], list)).toThrow(TypeError);
    expect(list).toEqual([['X', 'old'], ['Y', 'keep'], ['x', 'older']]);
    expect(list[0]).toBe(first);
    expect([...field.members.keys()]).toEqual(['valid', 'INVALID']);
  });
});

describe('default request header values', () => {
  it('selects an explicit emulated User-Agent, including an empty one', () => {
    expect(getEnvironmentDefaultUserAgent('Browlet', null)).toBe('Browlet');
    expect(getEnvironmentDefaultUserAgent('Browlet', 'Emulated')).toBe('Emulated');
    expect(getEnvironmentDefaultUserAgent('Browlet', '')).toBe('');
    expect(documentAcceptHeaderValue).toBe('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  });
});

function structuredItem(value: StructuredBareItem): StructuredItem {
  return { type: 'item', value, parameters: new Map() };
}
