import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchRequest, type Destination } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { getSerializedCookieDefaultPath } from '../../../src/fetch/url';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { createClientEnvironment } from '../client-fixture';

afterEach(() => { vi.restoreAllMocks(); });

describe('Fetch Cookie request headers', () => {
  it('sends all SameSite categories, including HttpOnly cookies, on a same-site request', () => {
    const { request } = createCookieRequest();
    request.method = 'PATCH';
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('strict=S; lax=L; default=D; none=N');
  });

  it('does not append an empty header', () => {
    const { request, userAgent } = createCookieRequest();
    userAgent.cookieStore.cookies.clear();
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBeNull();
  });

  it('preserves the store\'s path ordering and excludes expired or differently scoped cookies', () => {
    const { request, userAgent } = createCookieRequest();
    const { cookieStore } = userAgent;
    const host = { kind: 'domain' as const, value: 'shop.example.test' };
    cookieStore.parseAndStoreCookie('deep=1; Path=/account', true, host, [''], true, false, true);
    cookieStore.parseAndStoreCookie('away=1; Path=/away', true, host, [''], true, false, true);
    const expired = cookieStore.parseAndStoreCookie('expired=1', true, host, [''], true, false, true)!;
    expired.expiryTime = Date.now() - 1;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('deep=1; strict=S; lax=L; default=D; none=N');
  });

  it.each(['GET', 'HEAD', 'POST'])('keeps Strict cookies on same-site %s navigations', (method) => {
    const { request } = createCookieRequest();
    request.destination = 'document';
    request.method = method;
    request.topLevelNavigationInitiatorOrigin = request.client!.origin;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('strict=S; lax=L; default=D; none=N');
  });

  it.each(['GET', 'HEAD', 'OPTIONS', 'TRACE'])('allows Lax cookies on a cross-site top-level %s', (method) => {
    const { request } = createCookieRequest('https://other.test/');
    request.destination = 'document';
    request.method = method;
    request.topLevelNavigationInitiatorOrigin = request.client!.origin;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('lax=L; default=D; none=N');
  });

  it.each<Destination>(['', 'image', 'iframe'])('withholds Strict, Lax, and default cookies from cross-site %j', (destination) => {
    const { request } = createCookieRequest('https://other.test/');
    request.destination = destination;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('none=N');
  });

  it('compares sites schemefully and includes the entire client ancestor chain', () => {
    for (const clientURL of ['http://shop.example.test/', 'https://shop.example.test/']) {
      const { request, client } = createCookieRequest(clientURL);
      if (clientURL.startsWith('https:')) client.hasCrossSiteAncestor = true;
      request.appendCookieHeader();
      expect(request.headerList.get('Cookie')).toBe('none=N');
    }
  });

  it('uses the current host after redirects, including Chromium\'s A-to-B-to-A behavior', () => {
    const { request, userAgent } = createCookieRequest();
    const awayURL = parseURL('https://other.test/').url!;
    userAgent.cookieStore.parseAndStoreCookie(
      'away=1; SameSite=None; Secure', true, { kind: 'domain', value: 'other.test' }, [''], true, false, true,
    );
    request.urlList.push(awayURL);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('away=1');

    request.headerList.delete('Cookie');
    request.urlList.push(parseURL('https://shop.example.test/account/page').url!);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('strict=S; lax=L; default=D; none=N');

    request.headerList.delete('Cookie');
    request.destination = 'document';
    request.topLevelNavigationInitiatorOrigin = request.client!.origin;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('strict=S; lax=L; default=D; none=N');
  });

  it('distinguishes a browser-initiated navigation from a clientless subresource', () => {
    const { request, userAgent } = createCookieRequest();
    request.client = null;
    expect(request.clone().userAgent).toBe(userAgent);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('none=N');
    request.headerList.delete('Cookie');
    request.destination = 'document';
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('strict=S; lax=L; default=D; none=N');
  });

  it.each([119_999, 120_000, 120_001])('limits default cookies on cross-site POST to two minutes: age %i', (age) => {
    const now = Date.UTC(2026, 8, 21);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { request, userAgent } = createCookieRequest('https://other.test/');
    request.destination = 'document';
    request.method = 'POST';
    request.topLevelNavigationInitiatorOrigin = request.client!.origin;
    const cookie = [...userAgent.cookieStore.cookies].find((entry) => entry.name === 'default')!;
    cookie.creationTime = now - age;
    cookie.lastAccessTime = 1;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe(age <= 120_000 ? 'default=D; none=N' : 'none=N');
    expect(cookie.lastAccessTime).toBe(age <= 120_000 ? now : 1);
  });

  it('does not restart the grace period when a cookie is replaced', () => {
    const { request, userAgent } = createCookieRequest('https://other.test/');
    const cookie = [...userAgent.cookieStore.cookies].find((entry) => entry.name === 'default')!;
    cookie.creationTime = Date.now() - 120_001;
    request.destination = 'document';
    request.method = 'POST';
    request.topLevelNavigationInitiatorOrigin = request.client!.origin;
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'default=new; SameSite=unrecognized; Secure; Path=/');
    response.parseAndStoreCookies(request);
    expect([...userAgent.cookieStore.cookies].find((entry) => entry.name === 'default')?.creationTime).toBe(cookie.creationTime);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('none=N');
  });
});

describe('Fetch Set-Cookie response headers', () => {
  it('parses separate fields in order, including commas within a cookie value', () => {
    const { request, userAgent } = createCookieRequest();
    const response = new FetchResponse();
    response.headerList.append('sEt-CoOkIe', 'pair=a,b; HttpOnly');
    response.headerList.append('Content-Type', 'text/plain');
    response.headerList.append('Set-Cookie', 'next=first');
    response.headerList.append('Set-Cookie', 'next=second');
    response.parseAndStoreCookies(request);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('pair=a,b; next=second; strict=S; lax=L; default=D; none=N');
    expect([...userAgent.cookieStore.cookies].find((cookie) => cookie.name === 'pair')?.httpOnly).toBe(true);
  });

  it.each(['GET', 'POST'])('accepts all SameSite categories on cross-site top-level %s responses', (method) => {
    const { request, userAgent } = createCookieRequest('https://other.test/');
    userAgent.cookieStore.cookies.clear();
    request.destination = 'document';
    request.method = method;
    request.topLevelNavigationInitiatorOrigin = request.client!.origin;
    const response = sameSiteResponse();
    response.parseAndStoreCookies(request);
    expect([...userAgent.cookieStore.cookies].map((cookie) => cookie.name)).toEqual(['strict', 'lax', 'default', 'none']);
  });

  it.each<Destination>(['', 'iframe'])('accepts only None cookies on cross-site %j responses', (destination) => {
    const { request, userAgent } = createCookieRequest('https://other.test/');
    userAgent.cookieStore.cookies.clear();
    request.destination = destination;
    sameSiteResponse().parseAndStoreCookies(request);
    expect([...userAgent.cookieStore.cookies].map((cookie) => cookie.name)).toEqual(['none']);
  });

  it('retains Secure, public-suffix, default-path, and per-header eviction rules', () => {
    const { request, userAgent } = createCookieRequest('http://shop.example.test/');
    request.urlList = [parseURL('http://shop.example.test/account/page').url!];
    userAgent.cookieStore.cookies.clear();
    userAgent.cookieStore.totalCookiesPerHostLimit = 1;
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'secure=1; Secure');
    response.headerList.append('Set-Cookie', 'suffix=1; Domain=test');
    response.headerList.append('Set-Cookie', 'old=1');
    response.headerList.append('Set-Cookie', 'new=2; HttpOnly');
    response.parseAndStoreCookies(request);
    expect([...userAgent.cookieStore.cookies]).toMatchObject([{ name: 'new', path: ['account'], httpOnly: true }]);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('new=2');
  });

  it('disabling cookies suppresses both directions without deleting stored state', () => {
    const { request, userAgent } = createCookieRequest();
    userAgent.cookiesEnabled = false;
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'strict=changed; SameSite=Strict; Secure');
    response.parseAndStoreCookies(request);
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBeNull();
    userAgent.cookiesEnabled = true;
    request.appendCookieHeader();
    expect(request.headerList.get('Cookie')).toBe('strict=S; lax=L; default=D; none=N');
  });

  it('stores cookies against the final request URL rather than response metadata', () => {
    const { request, userAgent } = createCookieRequest();
    userAgent.cookieStore.cookies.clear();
    request.destination = 'document';
    request.urlList.push(parseURL('https://other.test/new/page').url!);
    const response = new FetchResponse();
    response.urlList = [parseURL('https://misleading.test/').url!];
    response.headerList.append('Set-Cookie', 'final=1');
    response.parseAndStoreCookies(request);
    expect([...userAgent.cookieStore.cookies]).toMatchObject([{
      host: { kind: 'domain', value: 'other.test' }, path: ['new'],
    }]);
  });
});

describe('Fetch serialized cookie default paths', () => {
  it.each([
    ['https://example.test/', '/'], ['https://example.test/page', '/'],
    ['https://example.test/one/two', '/one'], ['https://example.test/one/two/', '/one/two'],
    ['https://example.test/a%2Fb/page?query#fragment', '/a%2Fb'],
  ])('serializes the default path for %s without mutating the URL', (input, expected) => {
    const url = parseURL(input).url!;
    const originalPath = url.path;
    expect(getSerializedCookieDefaultPath(url)).toBe(expected);
    expect(url.path).toBe(originalPath);
    expect(url).toEqual(parseURL(input).url);
  });
});

function createCookieRequest(clientURL = 'https://shop.example.test/') {
  const client = createClientEnvironment(clientURL);
  const userAgent = client.userAgent;
  const request = new FetchRequest(parseURL('https://shop.example.test/account/page').url!, client, userAgent);
  const seed = new FetchRequest(request.url, null, userAgent);
  seed.destination = 'document';
  seed.topLevelNavigationInitiatorOrigin = obtainURLOrigin(seed.url);
  sameSiteResponse().parseAndStoreCookies(seed);
  return { request, client, userAgent };
}

function sameSiteResponse(): FetchResponse {
  const response = new FetchResponse();
  for (const value of [
    'strict=S; SameSite=Strict; Secure; HttpOnly; Path=/',
    'lax=L; SameSite=Lax; Secure; Path=/',
    'default=D; Secure; Path=/',
    'none=N; SameSite=None; Secure; Path=/',
  ]) response.headerList.append('Set-Cookie', value);
  return response;
}
