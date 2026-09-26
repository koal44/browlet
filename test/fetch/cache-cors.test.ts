import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchRequest } from '../../src/fetch/request';
import { createOpaqueOrigin } from '../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../src/url/url';
import { createClientEnvironment } from './client-fixture';

afterEach(() => vi.restoreAllMocks());

describe('CORS preflight permission cache', () => {
  it('keeps methods case-sensitive and header names case-insensitive', () => {
    const { request, cache } = fixture();
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    cache.store(request, 10, 'PUT', null);
    cache.store(request, 10, null, 'X-Token');
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    expect(cache.matchesMethod('put', request)).toBe(false);
    expect(cache.matchesHeaderName('x-TOKEN', request)).toBe(true);
    expect(cache.matchesHeaderName('put', request)).toBe(false);
  });

  it('isolates permissions by partition, serialized origin, and complete target URL', () => {
    const { request, cache, env } = fixture();
    cache.store(request, 60, 'PUT', null);
    const other = request.clone();
    other.urlList = [parseURL('https://target.test/other').url!];
    expect(cache.matchesMethod('PUT', other)).toBe(false);
    other.urlList = [parseURL('https://target.test/resource?query').url!];
    expect(cache.matchesMethod('PUT', other)).toBe(false);
    other.urlList = [parseURL('https://target.test/resource#fragment').url!];
    expect(cache.matchesMethod('PUT', other)).toBe(false);
    other.urlList = request.urlList;
    other.origin = obtainURLOrigin(parseURL('https://another.test').url!);
    expect(cache.matchesMethod('PUT', other)).toBe(false);
    env.topLevelOrigin = obtainURLOrigin(parseURL('https://another.test').url!);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
  });

  it('compares partition values and preserves opaque top-level identity', () => {
    const { request, cache, env } = fixture();
    cache.store(request, 60, 'PUT', null);
    env.topLevelOrigin = obtainURLOrigin(parseURL('https://example.test').url!);
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    env.topLevelOrigin = createOpaqueOrigin();
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    cache.store(request, 60, 'PATCH', null);
    expect(cache.matchesMethod('PATCH', request)).toBe(true);
    env.topLevelOrigin = createOpaqueOrigin();
    expect(cache.matchesMethod('PATCH', request)).toBe(false);
  });

  it('allows credentialed grants to cover anonymous requests, but not the reverse', () => {
    const { request, cache } = fixture();
    cache.store(request, 60, 'PUT', null);
    request.credentialsMode = 'include';
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    cache.store(request, 60, 'PUT', null);
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    request.credentialsMode = 'omit';
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    cache.clearEntries(request);
    request.credentialsMode = 'include';
    expect(cache.matchesMethod('PUT', request)).toBe(false);
  });

  it('expires at the deadline, refreshes permissions, and caps server-supplied ages', () => {
    const { request, cache, clock } = fixture();
    cache.store(request, 5, 'PUT', null);
    clock.mockReturnValue(4999);
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    cache.store(request, 2, 'PUT', null);
    clock.mockReturnValue(6999);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    cache.store(request, Number.MAX_SAFE_INTEGER, 'PUT', null);
    clock.mockReturnValue(6999 + cache.maxAge * 1000);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    cache.store(request, 0, 'PATCH', null);
    expect(cache.matchesMethod('PATCH', request)).toBe(false);
  });

  it('does not extend a credentialed grant using an anonymous preflight response', () => {
    const { request, cache, clock } = fixture();
    request.credentialsMode = 'include';
    cache.store(request, 1, 'PUT', null);
    cache.store(request, 1, null, 'X-Token');
    request.credentialsMode = 'omit';
    clock.mockReturnValue(500);
    cache.store(request, 10, 'PUT', null);
    cache.store(request, 10, null, 'x-token');
    clock.mockReturnValue(1000);
    request.credentialsMode = 'include';
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    expect(cache.matchesHeaderName('X-Token', request)).toBe(false);
    request.credentialsMode = 'omit';
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    expect(cache.matchesHeaderName('X-Token', request)).toBe(true);
    clock.mockReturnValue(10500);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    expect(cache.matchesHeaderName('X-Token', request)).toBe(false);
  });

  it('keeps wildcard and explicit grants on independent expiry deadlines', () => {
    const { request, cache, clock } = fixture();
    cache.store(request, 1, '*', null);
    cache.store(request, 1, null, '*');
    clock.mockReturnValue(500);
    cache.store(request, 10, 'PUT', null);
    cache.store(request, 10, null, 'X-Token');
    clock.mockReturnValue(999);
    expect(cache.matchesMethod('DELETE', request)).toBe(true);
    expect(cache.matchesHeaderName('X-Other', request)).toBe(true);
    clock.mockReturnValue(1000);
    expect(cache.matchesMethod('PUT', request)).toBe(true);
    expect(cache.matchesHeaderName('X-Token', request)).toBe(true);
    expect(cache.matchesMethod('DELETE', request)).toBe(false);
    expect(cache.matchesHeaderName('X-Other', request)).toBe(false);
    clock.mockReturnValue(10500);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    expect(cache.matchesHeaderName('X-Token', request)).toBe(false);
  });

  it('clears only matching permissions and bounds retained entries', () => {
    const { request, cache } = fixture();
    cache.maxEntries = 2;
    cache.store(request, 60, 'PUT', null);
    cache.store(request, 60, 'PATCH', null);
    cache.store(request, 60, 'DELETE', null);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    expect(cache.matchesMethod('PATCH', request)).toBe(true);
    const other = request.clone();
    other.urlList = [parseURL('https://target.test/other').url!];
    cache.clearEntries(other);
    expect(cache.matchesMethod('PATCH', request)).toBe(true);
    cache.clearEntries(request);
    expect(cache.matchesMethod('DELETE', request)).toBe(false);
  });

  it('does not cache a clientless request without a reserved partition', () => {
    const { request, cache, env } = fixture();
    request.client = null;
    cache.store(request, 60, 'PUT', null);
    expect(cache.matchesMethod('PUT', request)).toBe(false);
    request.reservedClient = env;
    cache.store(request, 60, 'PUT', null);
    expect(cache.matchesMethod('PUT', request)).toBe(true);
  });

  it('reuses anonymous wildcards but always requires an explicit Authorization grant', () => {
    const { request, cache } = fixture();
    cache.store(request, 60, '*', null);
    cache.store(request, 60, null, '*');
    expect(cache.matchesMethod('PATCH', request)).toBe(true);
    expect(cache.matchesHeaderName('X-Token', request)).toBe(true);
    expect(cache.matchesHeaderName('Authorization', request)).toBe(false);
    cache.store(request, 60, null, 'Authorization');
    expect(cache.matchesHeaderName('AUTHORIZATION', request)).toBe(true);
    request.credentialsMode = 'include';
    expect(cache.matchesMethod('PATCH', request)).toBe(false);
  });

  it('does not broaden a literal credentialed method named * into every method', () => {
    const { request, cache } = fixture();
    request.credentialsMode = 'include';
    cache.store(request, 60, '*', null);
    expect(cache.matchesMethod('*', request)).toBe(true);
    expect(cache.matchesMethod('DELETE', request)).toBe(false);
  });

  it('does not broaden a literal credentialed header named * into every header', () => {
    const { request, cache } = fixture();
    request.credentialsMode = 'include';
    cache.store(request, 60, null, '*');
    expect(cache.matchesHeaderName('*', request)).toBe(true);
    expect(cache.matchesHeaderName('X-Private', request)).toBe(false);
  });
});

function fixture() {
  const env = createClientEnvironment();
  const request = new FetchRequest(parseURL('https://target.test/resource').url!, env, env.userAgent);
  request.populateFromClient();
  const clock = vi.spyOn(env.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
  return { env, request, cache: env.userAgent.corsPreflightCache, clock };
}
