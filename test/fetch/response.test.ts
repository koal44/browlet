import { describe, expect, it } from 'vitest';
import { FetchHeaders } from '../../src/fetch/headers';
import { FetchParams } from '../../src/fetch/params';
import { FetchResponse, type FilteredFetchResponse } from '../../src/fetch/response';
import { FetchTimingInfo, ResponseBodyInfo } from '../../src/fetch/timing';
import { parseURL, serializeURL } from '../../src/url/url';
import { createBodyFixture, readBodyBytes } from './body-fixture';
import { createFetchFixture, createFetchRequest } from './fetch-fixture';

describe('Fetch response reporting URLs', () => {
  it('reports the first URL without credentials or fragment, preserving the response URLs', () => {
    const response = new FetchResponse();
    response.urlList = [
      parseURL('https://user:pass@example.test/start?q=1#private').url!,
      parseURL('https://elsewhere.test/private-redirect-target').url!,
    ];
    expect(response.serializeURLForReporting()).toBe('https://example.test/start?q=1');
    expect(serializeURL(response.urlList[0]!)).toBe('https://user:pass@example.test/start?q=1#private');
    expect(serializeURL(response.url!)).toBe('https://elsewhere.test/private-redirect-target');
  });

  it('requires a nonempty URL list', () => {
    expect(() => new FetchResponse().serializeURLForReporting()).toThrow('Response URL list is empty');
  });
});

describe('Fetch network errors', () => {
  it('creates an empty error response with fresh body information', () => {
    const response = FetchResponse.networkError();
    expect(response).toMatchObject({
      type: 'error', status: 0, statusMessage: '', headerList: new FetchHeaders(), body: null,
      bodyInfo: new ResponseBodyInfo(), aborted: false,
    });
    const another = FetchResponse.networkError();
    expect(another.headerList).not.toBe(response.headerList);
    expect(another.bodyInfo).not.toBe(response.bodyInfo);
  });

  it('marks an aborted network error', () => {
    expect(FetchResponse.abortedNetworkError()).toMatchObject({ type: 'error', status: 0, aborted: true });
  });

  it.each(['aborted', 'terminated'] as const)('chooses the appropriate network error for %s Fetch params', (state) => {
    const params = new FetchParams(createFetchRequest(), new FetchTimingInfo());
    params.controller.state = state;
    expect(FetchResponse.appropriateNetworkError(params)).toMatchObject({
      type: 'error', status: 0, aborted: state === 'aborted',
    });
  });

  it('requires canceled Fetch params', () => {
    const params = new FetchParams(createFetchRequest(), new FetchTimingInfo());
    expect(() => FetchResponse.appropriateNetworkError(params)).toThrow('Fetch params are not canceled');
  });
});

describe('Fetch filtered responses', () => {
  it('filters forbidden headers for basic responses, preserving order, duplicates, and list identity', () => {
    const response = new FetchResponse();
    response.headerList.list.push(['Set-Cookie', 'secret'], ['X-Value', 'one'], ['SET-cookie2', 'secret'], ['X-Value', 'two']);
    const filtered = response.filter('basic');
    const implementation = createFetchFixture().createResponse(filtered, 'immutable');
    expect(filtered.internalResponse).toBe(response);
    expect(implementation.type).toBe('basic');
    expect(implementation.headers.headerList).toBe(filtered.headerList);
    expect(filtered.headerList.list).toEqual([['X-Value', 'one'], ['X-Value', 'two']]);
    expect(response.headerList.list).toHaveLength(4);
    filtered.headerList.list[0]![1] = 'changed';
    expect(response.headerList.list[1]![1]).toBe('one');
  });

  it('filters CORS headers using the already-computed exposed-name list', () => {
    const response = new FetchResponse();
    response.headerList.list.push(
      ['Content-Type', 'text/plain'], ['Cache-Control', 'max-age=30'], ['X-Exposed', 'one'],
      ['X-Hidden', 'secret'], ['Set-Cookie', 'secret'], ['SET-COOKIE2', 'secret'], ['X-Exposed', 'two'],
    );
    response.corsExposedHeaderNameList = ['x-exposed', 'set-cookie', 'set-cookie2'];
    expect(response.filter('cors').headerList.list).toEqual([
      ['Content-Type', 'text/plain'], ['Cache-Control', 'max-age=30'], ['X-Exposed', 'one'], ['X-Exposed', 'two'],
    ]);
  });

  it('leaves wildcard expansion to CORS header processing', () => {
    const response = new FetchResponse();
    response.headerList.list.push(['*', 'literal'], ['X-Hidden', 'secret']);
    response.corsExposedHeaderNameList = ['*'];
    expect(response.filter('cors').headerList.list).toEqual([['*', 'literal']]);
  });

  it.each(['basic', 'cors'] as const)('keeps unmasked %s fields live in both directions', (type) => {
    const response = new FetchResponse();
    const filtered = response.filter(type);
    const fixture = createFetchFixture();
    const implementation = fixture.createResponse(filtered, 'immutable');
    response.status = 206;
    response.statusMessage = 'Partial Content';
    response.urlList = [parseURL('https://example.test/end#fragment').url!];
    response.body = fixture.createBody();
    response.bodyInfo.encodedSize = 12;
    response.timingAllowPassed = true;

    expect(implementation.status).toBe(206);
    expect(implementation.statusText).toBe('Partial Content');
    expect(implementation.url).toBe('https://example.test/end');
    expect(implementation.body).toBe(response.body.stream);
    expect(filtered.bodyInfo).toBe(response.bodyInfo);
    expect(filtered.bodyInfo.encodedSize).toBe(12);
    expect(filtered.timingAllowPassed).toBe(true);
    filtered.aborted = true;
    expect(response.aborted).toBe(true);
    filtered.body = null;
    expect(response.body).toBeNull();
    expect(implementation.body).toBeNull();
  });

  it.each(['opaque', 'opaqueredirect'] as const)('masks %s fields without losing the internal response', (type) => {
    const response = new FetchResponse();
    const fixture = createFetchFixture();
    const filtered = response.filter(type);
    const implementation = fixture.createResponse(filtered, 'immutable');
    response.status = 302;
    response.statusMessage = 'Found';
    response.urlList = [parseURL('https://example.test/start#fragment').url!];
    response.headerList.list.push(['Location', 'https://elsewhere.test/']);
    response.body = fixture.createBody();
    response.bodyInfo.encodedSize = 42;
    response.aborted = true;

    expect(filtered.internalResponse).toBe(response);
    expect(implementation.type).toBe(type);
    expect(implementation.status).toBe(0);
    expect(implementation.statusText).toBe('');
    expect(implementation.body).toBeNull();
    expect(implementation.headers.headerList.list).toEqual([]);
    expect(filtered.bodyInfo).toEqual(new ResponseBodyInfo());
    expect(filtered.bodyInfo).not.toBe(response.bodyInfo);
    expect(filtered.aborted).toBe(true);
    expect(implementation.url).toBe(type === 'opaque' ? '' : 'https://example.test/start');
    expect(filtered.url).toBe(type === 'opaque' ? null : response.url);
  });

  it('rejects filtering a network error or filtering an existing filtered response', () => {
    expect(() => FetchResponse.networkError().filter('basic'))
      .toThrow('Cannot filter a network error or an already filtered response');
    const filtered = new FetchResponse().filter('basic');
    expect(() => filtered.filter('opaque'))
      .toThrow('Cannot filter a network error or an already filtered response');
  });
});

describe('Fetch response cloning', () => {
  it('copies owned metadata and headers independently', () => {
    const response = new FetchResponse();
    response.status = 206;
    response.statusMessage = 'Partial Content';
    response.headerList.list.push(['X-Value', 'one'], ['X-Value', 'two']);
    response.urlList.push(parseURL('https://[::1]/path').url!);
    response.corsExposedHeaderNameList.push('X-Value');
    response.navigationTimingAllowValuesList.push(['*']);
    response.bodyInfo.encodedSize = 12;
    response.serviceWorkerTimingInfo = {
      startTime: 1, fetchEventDispatchTime: 2, workerRouterEvaluationStart: 3, workerCacheLookupStart: 4,
      workerMatchedRouterSource: 'network', workerFinalRouterSource: 'network',
    };
    const clone = response.clone();
    expect(clone).toEqual(response);
    expect(clone.body).toBeNull();
    clone.headerList.list[0]![1] = 'changed';
    clone.url!.fragment = 'changed';
    clone.corsExposedHeaderNameList.push('X-New');
    clone.navigationTimingAllowValuesList[0]!.push('https://example.test');
    clone.bodyInfo.encodedSize = 24;
    clone.serviceWorkerTimingInfo!.startTime = 5;
    expect(response.headerList.list[0]![1]).toBe('one');
    expect(response.url!.fragment).toBeNull();
    expect(clone.url!.path).not.toBe(response.url!.path);
    expect(clone.url!.host).not.toBe(response.url!.host);
    expect(response.corsExposedHeaderNameList).toEqual(['X-Value']);
    expect(response.navigationTimingAllowValuesList).toEqual([['*']]);
    expect(response.bodyInfo.encodedSize).toBe(12);
    expect(response.serviceWorkerTimingInfo.startTime).toBe(1);
  });

  it.each(['default', 'basic', 'cors', 'opaque', 'opaqueredirect'] as const)('clones the underlying body of a %s response', async (type) => {
    const { createBody } = createBodyFixture();
    const response = new FetchResponse();
    response.body = createBody([Uint8Array.of(1, 2)]);
    response.body.stream.close();
    const originalStream = response.body.stream;
    const view = type === 'default' ? response : response.filter(type);
    const clone = view.clone();
    const internalClone = type === 'default' ? clone : (clone as FilteredFetchResponse).internalResponse;
    expect(clone.type).toBe(type);
    expect(internalClone).not.toBe(response);
    expect(response.body.stream).not.toBe(originalStream);
    expect(internalClone.body).not.toBe(response.body);
    expect(clone.body).toBe(type === 'opaque' || type === 'opaqueredirect' ? null : internalClone.body);
    const [original, copied] = await Promise.all([readBodyBytes(response.body), readBodyBytes(internalClone.body!)]);
    expect(original).toEqual(Uint8Array.of(1, 2));
    expect(copied).toEqual(original);
    original[0] = 8;
    expect(copied).toEqual(Uint8Array.of(1, 2));
  });

  it('preserves an aborted network error', () => {
    const response = FetchResponse.abortedNetworkError();
    expect(response.clone()).toEqual(response);
  });
});

describe('Fetch response freshness', () => {
  const responseTime = Date.UTC(2026, 0, 1);

  it.each([
    [9_999, 'fresh'], [10_000, 'stale-while-revalidate'], [14_999, 'stale-while-revalidate'], [15_000, 'stale'],
  ])('classifies the response at %s ms of age as %s', (age, expected) => {
    const response = new FetchResponse();
    response.headerList.list.push(['Date', 'Thu, 01 Jan 2026 00:00:00 GMT'], ['Cache-Control', 'max-age=10, stale-while-revalidate=5']);
    expect(response.getFreshness({ requestTime: responseTime, responseTime, now: responseTime + age })).toBe(expected);
  });

  it('uses the received Age and response delay, instead of only elapsed local time', () => {
    const response = new FetchResponse();
    response.headerList.list.push(['Age', '9'], ['Cache-Control', 'max-age=10, stale-while-revalidate=5']);
    expect(response.getFreshness({ requestTime: responseTime - 2_000, responseTime, now: responseTime }))
      .toBe('stale-while-revalidate');
  });

  it.each(['no-cache', 'no-store', 'must-revalidate'])('does not allow stale reuse under %s', (directive) => {
    const response = new FetchResponse();
    response.headerList.list.push(['Cache-Control', `max-age=0, stale-while-revalidate=5, ${directive}`]);
    expect(response.getFreshness({ requestTime: responseTime, responseTime, now: responseTime })).toBe('stale');
  });

  it('uses the HTTP cache heuristic when explicit expiration is absent', () => {
    const response = new FetchResponse();
    response.headerList.list.push(['Date', 'Thu, 01 Jan 2026 00:00:00 GMT'], ['Last-Modified', 'Wed, 31 Dec 2025 23:58:20 GMT']);
    expect(response.getFreshness({ requestTime: responseTime, responseTime, now: responseTime + 9_999 })).toBe('fresh');
    expect(response.getFreshness({ requestTime: responseTime, responseTime, now: responseTime + 10_000 })).toBe('stale');
  });
});

describe('Fetch response Location URLs', () => {
  it.each([301, 302, 303, 307, 308])('resolves Location against the current URL for status %s', (status) => {
    const response = new FetchResponse();
    response.status = status;
    response.urlList.push(parseURL('https://first.test/').url!, parseURL('https://last.test/path/page').url!);
    response.headerList.list.push(['LOCATION', '../next?a,b']);
    const location = response.getLocationURL('inherited');
    expect(serializeURL(location!)).toBe('https://last.test/next?a,b#inherited');
    expect(response.url!.fragment).toBeNull();
  });

  it.each<[string, string | null, string]>([
    ['/next', null, 'https://example.test/next'],
    ['/next', '', 'https://example.test/next#'],
    ['/next#own', 'inherited', 'https://example.test/next#own'],
    ['/next#', 'inherited', 'https://example.test/next#'],
    ['', 'inherited', 'https://example.test/start#inherited'],
  ])('handles Location %s with request fragment %s', (value, fragment, expected) => {
    const response = new FetchResponse();
    response.status = 302;
    response.urlList.push(parseURL('https://example.test/start').url!);
    response.headerList.list.push(['Location', value]);
    expect(serializeURL(response.getLocationURL(fragment)!)).toBe(expected);
  });

  it('distinguishes absence from failure', () => {
    const response = new FetchResponse();
    response.status = 302;
    expect(response.getLocationURL(null)).toBeUndefined();
    response.headerList.list.push(['Location', '/relative-without-base']);
    expect(response.getLocationURL(null)).toBeNull();
    response.headerList.list[0]![1] = 'https://[invalid]/';
    expect(response.getLocationURL(null)).toBeNull();
  });

  it('parses an absolute Location for a synthetic response without a URL', () => {
    const response = new FetchResponse();
    response.status = 302;
    response.headerList.list.push(['Location', 'https://elsewhere.test/']);
    expect(serializeURL(response.getLocationURL('request')!)).toBe('https://elsewhere.test/#request');
  });

  it('rejects duplicate Location fields, even with the same value', () => {
    const response = new FetchResponse();
    response.status = 302;
    response.headerList.list.push(['Location', 'https://example.test/'], ['location', 'https://example.test/']);
    expect(response.getLocationURL(null)).toBeNull();
  });

  it.each([200, 300, 304, 305, 306, 404])('ignores Location on status %s', (status) => {
    const response = new FetchResponse();
    response.status = status;
    response.headerList.list.push(['Location', 'https://example.test/']);
    expect(response.getLocationURL(null)).toBeUndefined();
  });
});
