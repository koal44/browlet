import { describe, expect, it } from 'vitest';

import { isCORSSafelistedMethod, isForbiddenMethod, isMethod, normalizeMethod } from '../../../src/fetch/http/methods';
import { buildContentRange, parseSingleRangeHeaderValue } from '../../../src/fetch/http/ranges';
import { isNullBodyStatus, isOkStatus, isRangeStatus, isRedirectStatus, isStatus } from '../../../src/fetch/http/statuses';

describe('HTTP methods (Fetch §2.2.1)', () => {
  it.each(['GET', 'CHICKEN', 'Egg', 'eGg', 'patch', "!#$%&'*+-.^_`|~0123456789"])(
    'accepts the method %j', (method) => expect(isMethod(method)).toBe(true),
  );
  it.each(['', 'GET ', ' GET', 'GET\n', 'GET\r', 'GET\t', 'G:E:T', 'G\0ET', 'GÉT', 'ＧＥＴ'])(
    'rejects the method %j', (method) => expect(isMethod(method)).toBe(false),
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

describe('single ranges (Fetch §2.2.2)', () => {
  it.each([
    ['bytes=0-499', 0n, 499n], ['bytes=0-', 0n, null], ['bytes=-500', null, 500n],
    ['bytes=-0', null, 0n], ['bytes=0001-0002', 1n, 2n], ['bytes=3-3', 3n, 3n],
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
  it('preserves arbitrarily large range integers and serializes them without exponent notation', () => {
    const end = '9'.repeat(400);
    expect(parseSingleRangeHeaderValue(`bytes=0-${end}`, false)).toEqual([0n, BigInt(end)]);
    expect(buildContentRange(0, 499, 1000)).toBe('bytes 0-499/1000');
    expect(buildContentRange(0n, BigInt(end), BigInt(end) + 1n)).toBe(`bytes 0-${end}/1${'0'.repeat(400)}`);
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
