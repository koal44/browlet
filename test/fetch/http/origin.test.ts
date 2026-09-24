import { describe, expect, it } from 'vitest';

import { FetchRequest } from '../../../src/fetch/request';
import type { ReferrerPolicy } from '../../../src/fetch/environment';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { createFetchUserAgent } from '../client-fixture';

describe('Fetch Origin request headers', () => {
  it('appends the serialized origin for a POST without exposing URL credentials, path, or fragment', () => {
    const request = createRequest();
    request.origin = obtainURLOrigin(parseURL('https://user:password@example.test:8443/path?q=1#fragment').url!);
    request.appendOriginHeader();
    expect(request.headerList.list).toEqual([['Origin', 'https://example.test:8443']]);
  });

  it.each(['GET', 'HEAD'])('omits the header for a basic %s response', (method) => {
    const request = createRequest();
    request.method = method;
    request.appendOriginHeader();
    expect(request.headerList.has('Origin')).toBe(false);
  });

  it.each(['GET', 'HEAD', 'POST'])('includes the origin for a CORS-tainted %s despite no-referrer', (method) => {
    const request = createRequest('https://other.test/');
    request.method = method;
    request.responseTainting = 'cors';
    request.referrerPolicy = 'no-referrer';
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('https://example.test');
  });

  it.each(['websocket', 'webtransport'] as const)('includes the origin for %s despite no-referrer', (mode) => {
    const request = createRequest();
    request.method = 'GET';
    request.mode = mode;
    request.referrerPolicy = 'no-referrer';
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('https://example.test');
  });

  it('does not hide an explicitly shared CORS origin even when the response is basic', () => {
    const request = createRequest();
    request.mode = 'cors';
    request.referrerPolicy = 'no-referrer';
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('https://example.test');
  });

  it('does not treat CORS mode alone as a reason to include Origin on GET', () => {
    const request = createRequest();
    request.mode = 'cors';
    request.method = 'GET';
    request.appendOriginHeader();
    expect(request.headerList.has('Origin')).toBe(false);
  });

  it.each<[ReferrerPolicy, string, string, string]>([
    // Policy, same-origin target, cross-origin HTTPS target, HTTP downgrade target.
    ['', 'https://example.test', 'https://example.test', 'https://example.test'],
    ['no-referrer', 'null', 'null', 'null'],
    ['no-referrer-when-downgrade', 'https://example.test', 'https://example.test', 'null'],
    ['same-origin', 'https://example.test', 'null', 'null'],
    ['origin', 'https://example.test', 'https://example.test', 'https://example.test'],
    ['strict-origin', 'https://example.test', 'https://example.test', 'null'],
    ['origin-when-cross-origin', 'https://example.test', 'https://example.test', 'https://example.test'],
    ['strict-origin-when-cross-origin', 'https://example.test', 'https://example.test', 'null'],
    ['unsafe-url', 'https://example.test', 'https://example.test', 'https://example.test'],
  ])('applies %j to non-CORS POST origins', (policy, sameOrigin, crossOrigin, downgrade) => {
    const targets: [string, string][] = [
      ['https://example.test/next', sameOrigin], ['https://other.test/', crossOrigin], ['http://other.test/', downgrade],
    ];
    for (const [target, expected] of targets) {
      const request = createRequest(target);
      request.referrerPolicy = policy;
      request.appendOriginHeader();
      expect(request.headerList.get('Origin'), target).toBe(expected);
    }
  });

  it('uses HTTPS scheme checks for Origin even when the HTTP target is trustworthy loopback', () => {
    const request = createRequest('http://localhost/');
    request.referrerPolicy = 'strict-origin';
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('null');
  });

  it('does not suppress an HTTP source origin as a secure downgrade', () => {
    const request = createRequest('http://other.test/');
    request.origin = obtainURLOrigin(parseURL('http://example.test/').url!);
    request.referrerPolicy = 'strict-origin';
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('http://example.test');
  });

  it('compares ports as part of the same-origin policy', () => {
    const request = createRequest('https://example.test:8443/');
    request.referrerPolicy = 'same-origin';
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('null');
  });

  it('serializes an opaque origin as null', () => {
    const request = createRequest();
    request.origin = createOpaqueOrigin();
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('null');
  });

  it('retains redirect taint when returning to the original origin', () => {
    const request = createRequest();
    request.responseTainting = 'cors';
    request.referrerPolicy = 'unsafe-url';
    request.urlList.push(parseURL('https://other.test/').url!, parseURL('https://example.test/').url!);
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('null');
  });

  it('uses append semantics without replacing an existing header', () => {
    const request = createRequest();
    request.headerList.append('origin', 'null');
    request.appendOriginHeader();
    expect(request.headerList.list).toEqual([['origin', 'null'], ['origin', 'https://example.test']]);
  });

  it('requires client-origin resolution before doing any header work', () => {
    const request = createRequest();
    request.origin = undefined;
    expect(() => request.appendOriginHeader()).toThrow('Fetch request origin has not been resolved');
    expect(request.headerList.list).toEqual([]);
  });
});

function createRequest(target = 'https://example.test/'): FetchRequest {
  const request = new FetchRequest(parseURL(target).url!, null, createFetchUserAgent());
  request.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
  request.method = 'POST';
  return request;
}
