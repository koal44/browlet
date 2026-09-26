import { describe, expect, it } from 'vitest';
import { FetchHeaders } from '../../src/fetch/headers';
import { createOpaqueOrigin } from '../../src/url/origin';
import { FetchResponse } from '../../src/fetch/response';
import { createClientEnvironment } from './client-fixture';
import { createFetchRequest } from './fetch-fixture';

const received = Date.UTC(2026, 8, 24, 12);

describe('HTTP cache partition identity', () => {
  it('shares a partition for equal sites and separates schemes, sites, and browser owners', () => {
    const client = createClientEnvironment('https://a.example.com/');
    const request = createFetchRequest(undefined, client);
    const partitions = client.userAgent.httpCache;
    const first = partitions.determine(request);
    request.client = createClientEnvironment('https://b.example.com/');

    expect(partitions.determine(request)).toBe(first);
    expect(request.client.userAgent.httpCache.determine(request)).not.toBe(first);
    request.client = createClientEnvironment('http://a.example.com/');
    expect(partitions.determine(request)).not.toBe(first);
    request.client = createClientEnvironment('https://other.test/');
    expect(partitions.determine(request)).not.toBe(first);
    expect(partitions.partitions).toHaveLength(3);
  });

  it('keeps two opaque top-level origins in different partitions', () => {
    const client = createClientEnvironment();
    const partitions = client.userAgent.httpCache;
    const request = createFetchRequest(undefined, client);
    client.topLevelOrigin = createOpaqueOrigin();
    const first = partitions.determine(request);

    expect(partitions.determine(request)).toBe(first);
    client.topLevelOrigin = createOpaqueOrigin();
    expect(partitions.determine(request)).not.toBe(first);
  });

  it('returns no partition for a request without a client or reserved client', () => {
    const { httpCache } = createClientEnvironment().userAgent;

    expect(httpCache.determine(createFetchRequest())).toBeNull();
    expect(httpCache.partitions).toEqual([]);
  });
});

describe('private HTTP cache storage and selection', () => {
  it('publishes only complete independent bytes and retains no body stream', async () => {
    const f = fixture();
    const response = f.response();
    const entry = f.cache.begin(f.request, response, received - 500, received)!;
    const bytes = Uint8Array.of(1, 2);
    entry.append(bytes);
    bytes.fill(9);
    expect(f.cache.select(f.request)).toBeUndefined();
    entry.finish(response.bodyInfo);
    expect(f.cache.select(f.request)).toBe(entry);
    expect(await entry.body!.read()).toEqual(Uint8Array.of(1, 2));
    expect(entry.response.body).toBeNull();
    expect(entry.response.discardBody).toBeNull();
    response.headerList.set('X-Metadata', 'changed');
    expect(entry.response.headerList.has('X-Metadata')).toBe(false);
  });

  it('keys complete representations by URL without fragments and by method', () => {
    const f = fixture();
    const entry = f.store();
    f.request.currentURL.fragment = 'different';
    expect(f.cache.select(f.request)).toBe(entry);
    f.request.method = 'HEAD';
    expect(f.cache.select(f.request)).toBe(entry);
    f.request.method = 'POST';
    expect(f.cache.select(f.request)).toBeUndefined();
    f.request.method = 'HEAD';
    f.cache.clear();
    f.store();
    f.request.method = 'GET';
    expect(f.cache.select(f.request)).toBeUndefined();
    f.request.currentURL.query = 'different';
    expect(f.cache.select(f.request)).toBeUndefined();
  });

  it('matches Vary names case-insensitively but preserves absent, empty, and different values', () => {
    const f = fixture();
    const absent = f.store({ Vary: 'X-Variant' });
    f.request.headerList.set('x-variant', '');
    const empty = f.store({ Vary: 'x-variant' });
    f.request.headerList.set('x-variant', 'A');
    const upper = f.store({ Vary: 'X-VARIANT' });
    f.request.headerList.set('x-variant', 'a');
    expect(f.cache.select(f.request)).toBeUndefined();
    f.request.headerList.set('x-variant', 'A');
    expect(f.cache.select(f.request)).toBe(upper);
    f.request.headerList.set('x-variant', '');
    expect(f.cache.select(f.request)).toBe(empty);
    f.request.headerList.delete('x-variant');
    expect(f.cache.select(f.request)).toBe(absent);
  });

  it('selects the newest Date among overlapping Vary matches, not insertion order', () => {
    const f = fixture();
    f.request.headerList.set('Accept', 'text/plain');
    f.request.headerList.set('Accept-Language', 'en');
    const newest = f.store({ Vary: 'Accept', Date: 'Thu, 24 Sep 2026 12:00:00 GMT' });
    f.store({ Vary: 'Accept-Language', Date: 'Thu, 24 Sep 2026 11:00:00 GMT' });
    // Prefer a valid Vary rule over a response lacking Vary (RFC 9111 §4.1).
    f.store({ Date: 'Thu, 24 Sep 2026 13:00:00 GMT' });
    expect(f.cache.select(f.request)).toBe(newest);
  });

  it('replaces the same variant without removing other selecting rules', () => {
    const f = fixture();
    f.request.headerList.set('Accept', 'text/plain');
    const old = f.store({ Vary: 'Accept' });
    const other = f.store({ Vary: 'Accept-Language' });
    const latest = f.store({ Vary: 'Accept' });
    expect(old.active).toBe(false);
    expect(f.cache.candidates(f.request)).toEqual([other, latest]);
  });

  it('retains unknown repeated fields, strips hop fields, and supplies a missing Date', () => {
    const f = fixture();
    const response = f.response({ Connection: 'X-Hop', 'X-Hop': 'private', 'Proxy-Authenticate': 'Basic', 'Transfer-Encoding': 'chunked' });
    response.headerList.append('X-Extension', 'first');
    response.headerList.append('X-Extension', 'second');
    const entry = f.cache.begin(f.request, response, received, received)!;
    const headers = entry.response.headerList;
    expect(headers.get('Date')).toBe('Thu, 24 Sep 2026 12:00:00 GMT');
    expect(headers.list.filter(([name]) => name === 'X-Extension')).toEqual([['X-Extension', 'first'], ['X-Extension', 'second']]);
    for (const name of ['Connection', 'X-Hop', 'Transfer-Encoding', 'Proxy-Authenticate']) expect(headers.has(name)).toBe(false);
    expect(response.headerList.has('Date')).toBe(false);
  });

  it.each<Record<string, string>>([
    { 'Cache-Control': 'no-store' }, { 'Cache-Control': 'must-understand, max-age=300' },
    { Vary: '*' }, { Vary: 'bad name' },
  ])('declines unstorable fields %j', (headers) => {
    const f = fixture();
    expect(f.cache.begin(f.request, f.response(headers), received, received)).toBeUndefined();
  });

  it('permits private authenticated entries but honors request no-store and unsupported ranges', () => {
    const f = fixture();
    f.request.headerList.set('Authorization', 'Basic abc');
    expect(f.store()).toBeDefined();
    f.request.headerList.set('Cache-Control', 'no-store');
    expect(f.cache.begin(f.request, f.response(), received, received)).toBeUndefined();
    f.request.headerList.delete('Cache-Control');
    f.request.headerList.set('Range', 'bytes=0-1');
    expect(f.cache.begin(f.request, f.response(), received, received)).toBeUndefined();
    f.request.headerList.delete('Range');
    const partial = f.response();
    partial.status = 206;
    expect(f.cache.begin(f.request, partial, received, received)).toBeUndefined();
  });
});

describe('HTTP cache validation and invalidation', () => {
  it('updates all matching strong validators and leaves conflicting representations untouched', () => {
    const f = fixture();
    const first = f.store({ Vary: 'Accept', ETag: '"same"', 'Content-Length': '3', 'Content-Encoding': 'gzip' });
    const second = f.store({ Vary: 'Accept-Language', ETag: '"same"' });
    const other = f.store({ Vary: 'Accept-Encoding', ETag: '"other"' });
    const updated = f.response({ ETag: '"same"', 'X-Updated': 'yes', 'Content-Length': '0', 'Content-Encoding': 'br' });
    updated.status = 304;
    f.cache.revalidate(f.request, updated, received + 5000, received + 6000);
    expect(first.response.headerList.get('X-Updated')).toBe('yes');
    expect(second.response.headerList.get('X-Updated')).toBe('yes');
    expect(other.response.headerList.get('X-Updated')).toBeNull();
    expect(first.response.headerList.get('Content-Length')).toBe('3');
    expect(first.response.headerList.get('Content-Encoding')).toBe('gzip');
    expect(first.freshness(received + 8000).currentAge).toBe(3);
  });

  it('updates only the newest weak tag match', () => {
    const f = fixture();
    const old = f.store({ Vary: 'Accept', ETag: 'W/"weak"', Date: 'Thu, 24 Sep 2026 11:00:00 GMT' });
    const latest = f.store({ Vary: 'Accept-Language', ETag: 'W/"weak"' });
    const response = f.response({ ETag: 'W/"weak"', 'X-Updated': 'yes' });
    response.status = 304;
    f.cache.revalidate(f.request, response, received, received);
    expect(old.response.headerList.has('X-Updated')).toBe(false);
    expect(latest.response.headerList.has('X-Updated')).toBe(true);
  });

  it('treats date validators as weak without evidence about the origin clocks', () => {
    const f = fixture();
    const modified = 'Wed, 23 Sep 2026 12:00:00 GMT';
    const old = f.store({ Vary: 'Accept', 'Last-Modified': modified, Date: 'Thu, 24 Sep 2026 11:00:00 GMT' });
    const latest = f.store({ Vary: 'Accept-Language', 'Last-Modified': modified });
    const response = f.response({ 'Last-Modified': modified, 'X-Updated': 'yes' });
    response.status = 304;
    f.cache.revalidate(f.request, response, received, received);
    expect(old.response.headerList.has('X-Updated')).toBe(false);
    expect(latest.response.headerList.has('X-Updated')).toBe(true);
  });

  it('invalidates stored entries when a validation adds no-store or Vary: *', () => {
    const f = fixture();
    const updates: Record<string, string>[] = [{ 'Cache-Control': 'no-store' }, { Vary: '*' }];
    for (const fields of updates) {
      const entry = f.store({ ETag: '"one"' });
      const response = f.response({ ETag: '"one"', ...fields });
      response.status = 304;
      f.cache.revalidate(f.request, response, received, received);
      expect(entry.active).toBe(false);
      expect(f.cache.select(f.request)).toBeUndefined();
    }
  });

  it('does not merge an unrelated validator or an unqualified 304 into a validated representation', () => {
    const f = fixture();
    const entry = f.store({ ETag: '"original"' });
    for (const tag of ['"different"', undefined]) {
      const response = f.response({ 'X-Updated': 'yes', ...(tag === undefined ? {} : { ETag: tag }) });
      response.status = 304;
      f.cache.revalidate(f.request, response, received, received);
    }
    expect(entry.response.headerList.has('X-Updated')).toBe(false);
  });

  it('freshens HEAD matches and invalidates mismatched GET bodies', () => {
    const f = fixture();
    const entry = f.store({ ETag: '"one"', 'Content-Length': '3' });
    f.request.method = 'HEAD';
    f.cache.freshen(f.request, f.response({ ETag: '"one"', 'Content-Length': '3', 'X-Updated': 'yes' }), received, received);
    expect(entry.response.headerList.get('X-Updated')).toBe('yes');
    f.cache.freshen(f.request, f.response({ ETag: '"two"', 'Content-Length': '3' }), received, received);
    expect(entry.active).toBe(false);
    expect(f.cache.select(f.request)).toBeUndefined();
  });

  it('invalidates every variant and stops pending writes from restoring them', () => {
    const f = fixture();
    f.store({ Vary: 'Accept' });
    f.store({ Vary: 'Accept-Language' });
    const response = f.response();
    const pending = f.cache.begin(f.request, response, received, received)!;
    pending.append(Uint8Array.of(1));
    f.cache.invalidate(f.request);
    pending.append(Uint8Array.of(2));
    pending.finish(response.bodyInfo);
    expect(f.cache.select(f.request)).toBeUndefined();
    expect(pending.body).toBeUndefined();
  });
});

describe('HTTP cache capacity and privacy clearing', () => {
  it('evicts the least recently used complete entry across partitions', () => {
    const f = fixture();
    f.owner.maxBytes = 6;
    const first = f.store();
    const otherEnv = createClientEnvironment('https://other.test/');
    const other = createFetchRequest(undefined, otherEnv);
    const otherCache = f.owner.determine(other)!;
    const response = f.response();
    const second = otherCache.begin(other, response, received, received)!;
    second.append(Uint8Array.of(4, 5, 6));
    second.finish(response.bodyInfo);
    f.cache.select(f.request);
    f.request.currentURL.query = 'third';
    f.store();
    expect(first.active).toBe(true);
    expect(second.active).toBe(false);
  });

  it('abandons oversized and canceled writes and clears identifying validators', () => {
    const f = fixture();
    f.owner.maxEntryBytes = 2;
    const oversized = f.store({ ETag: '"tracking"' });
    expect(oversized.active).toBe(false);
    expect(f.cache.select(f.request)).toBeUndefined();
    f.owner.maxEntryBytes = 10;
    const entry = f.store({ ETag: '"tracking"' });
    f.owner.clear();
    expect(entry.active).toBe(false);
    expect(f.cache.select(f.request)).toBeUndefined();
    expect(f.cache.generation).toBeGreaterThan(0);
  });
});

function fixture() {
  const env = createClientEnvironment();
  const owner = env.userAgent.httpCache;
  const request = createFetchRequest(undefined, env);
  const cache = owner.determine(request)!;
  const response = (headers: Record<string, string> = {}) => {
    const result = new FetchResponse();
    result.headerList = new FetchHeaders(Object.entries({ 'Cache-Control': 'max-age=300', ...headers }));
    return result;
  };
  const store = (headers: Record<string, string> = {}) => {
    const value = response(headers);
    const entry = cache.begin(request, value, received, received)!;
    entry.append(Uint8Array.of(1, 2, 3));
    entry.finish(value.bodyInfo);
    return entry;
  };
  return { owner, request, cache, response, store };
}
