import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPCookie, type CookieHost, type StoredHTTPCookie } from '../../../src/http/cookies/cookie';
import { CookieStore, type CookieSameSiteMode } from '../../../src/http/cookies/store';

const now = Date.UTC(2026, 8, 20);
const host: CookieHost = { kind: 'domain', value: 'example.test' };

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('retrieve cookies (§5.4.5)', () => {
  it('returns an empty list for an empty store', () => {
    expect(new CookieStore().retrieveCookies(true, host, [''], true, 'strict-or-less')).toEqual([]);
  });

  it('returns original records and updates the access time only for selected cookies', () => {
    const store = new CookieStore();
    const selected = storedCookie('selected');
    const secure = storedCookie('secure');
    secure.secure = true;
    const otherHost = storedCookie('other-host', { kind: 'domain', value: 'other.test' });
    store.cookies = new Set([secure, selected, otherHost]);

    const result = store.retrieveCookies(false, host, [''], true, 'strict-or-less');

    expect(result).toEqual([selected]);
    expect(result[0]).toBe(selected);
    expect(selected.lastAccessTime).toBe(now);
    expect(secure.lastAccessTime).toBe(now - 1000);
    expect(otherHost.lastAccessTime).toBe(now - 1000);
    result.length = 0;
    expect(store.cookies.size).toBe(3);
  });

  it('matches host-only cookies exactly and domain cookies across subdomains', () => {
    const store = new CookieStore();
    const hostOnly = store.parseAndStoreCookie('host=value', true, host, [''], true, false, true)!;
    const domain = store.parseAndStoreCookie('domain=value; Domain=example.test', true, host, [''], true, false, true)!;

    expect(store.retrieveCookies(true, { ...host }, [''], true, 'strict-or-less')).toEqual([hostOnly, domain]);
    expect(store.retrieveCookies(true, { kind: 'domain', value: 'sub.example.test' }, [''], true, 'strict-or-less')).toEqual([domain]);
    expect(store.retrieveCookies(true, { kind: 'domain', value: 'badexample.test' }, [''], true, 'strict-or-less')).toEqual([]);
    expect(store.retrieveCookies(true, { kind: 'domain', value: 'other.test' }, [''], true, 'strict-or-less')).toEqual([]);
  });

  it('requires a path boundary and preserves literal escape spelling', () => {
    const store = new CookieStore();
    const account = store.parseAndStoreCookie('account=value; Path=/account', true, host, [''], true, false, true);
    const escaped = store.parseAndStoreCookie('escaped=value; Path=/a%2Fb', true, host, [''], true, false, true);

    expect(store.retrieveCookies(true, host, ['account', 'page'], true, 'strict-or-less')).toEqual([account]);
    expect(store.retrieveCookies(true, host, ['accounts'], true, 'strict-or-less')).toEqual([]);
    expect(store.retrieveCookies(true, host, ['a%2Fb', 'page'], true, 'strict-or-less')).toEqual([escaped]);
    expect(store.retrieveCookies(true, host, ['a', 'b'], true, 'strict-or-less')).toEqual([]);
    expect(store.retrieveCookies(true, host, ['a%2fb'], true, 'strict-or-less')).toEqual([]);
  });

  it.each([
    [true, true, ['ordinary', 'secure', 'http', 'both']],
    [true, false, ['ordinary', 'secure']],
    [false, true, ['ordinary', 'http']],
    [false, false, ['ordinary']],
  ])('filters Secure and HttpOnly for secure=%s, HTTP=%s', (isSecure, httpOnlyAllowed, expected) => {
    const store = new CookieStore();
    for (const input of ['ordinary=v', 'secure=v; Secure', 'http=v; HttpOnly', 'both=v; Secure; HttpOnly']) {
      store.parseAndStoreCookie(input, true, host, [''], true, false, true);
    }

    expect(store.retrieveCookies(isSecure, host, [''], httpOnlyAllowed, 'strict-or-less').map((cookie) => cookie.name)).toEqual(expected);
  });

  it.each<[CookieSameSiteMode, string[]]>([
    ['strict-or-less', ['strict', 'lax', 'unset', 'none']],
    ['lax-or-less', ['lax', 'unset', 'none']],
    ['unset-or-less', ['unset', 'none']],
    ['none', ['none']],
  ])('applies same-site mode %s', (sameSite, expected) => {
    const store = new CookieStore();
    for (const input of ['strict=v; SameSite=Strict', 'lax=v; SameSite=Lax', 'unset=v', 'none=v; SameSite=None; Secure']) {
      store.parseAndStoreCookie(input, true, host, [''], true, false, true);
    }

    expect(store.retrieveCookies(true, host, [''], true, sameSite).map((cookie) => cookie.name)).toEqual(expected);
  });

  it('excludes expired cookies even when garbage collection has not run, without discarding its removal report', () => {
    const store = new CookieStore();
    const expired = storedCookie('expired');
    expired.expiryTime = now - 1;
    const boundary = storedCookie('boundary');
    boundary.expiryTime = now;
    const session = storedCookie('session');
    store.cookies = new Set([expired, boundary, session]);

    expect(store.retrieveCookies(true, host, [''], true, 'strict-or-less')).toEqual([boundary, session]);
    expect(expired.lastAccessTime).toBe(now - 1000);
    vi.mocked(Date.now).mockReturnValue(now + 1);
    expect(store.retrieveCookies(true, host, [''], true, 'strict-or-less')).toEqual([session]);
    expect(store.garbageCollectCookies(host)).toEqual([expired, boundary]);
  });

  it('sorts by serialized path length rather than segment count, even when the root cookie is older', () => {
    const store = new CookieStore();
    const root = store.parseAndStoreCookie('root=first; Path=/', true, host, [''], true, false, true)!;
    vi.mocked(Date.now).mockReturnValue(now + 1);
    const scope = store.parseAndStoreCookie('scope=second; Path=/scope', true, host, [''], true, false, true)!;
    vi.mocked(Date.now).mockReturnValue(now + 2);
    const directory = store.parseAndStoreCookie('directory=third; Path=/scope/', true, host, [''], true, false, true)!;

    expect(store.retrieveCookies(true, host, ['scope', 'page'], true, 'strict-or-less')).toEqual([directory, scope, root]);
    expect([...store.cookies]).toEqual([root, scope, directory]);
  });

  it('sorts equal-length paths by creation time and preserves insertion order for exact ties', () => {
    const store = new CookieStore();
    const newest = storedCookie('newest');
    newest.creationTime = now;
    const firstOldest = storedCookie('first-oldest');
    firstOldest.creationTime = now - 2;
    const secondOldest = storedCookie('second-oldest');
    secondOldest.creationTime = now - 2;
    const older = storedCookie('older');
    older.creationTime = now - 1;
    store.cookies = new Set([newest, firstOldest, older, secondOldest]);

    expect(store.retrieveCookies(true, host, [''], true, 'strict-or-less')).toEqual([firstOldest, secondOldest, older, newest]);
    expect([...store.cookies]).toEqual([newest, firstOldest, older, secondOldest]);
  });

  it.each<CookieHost>([
    { kind: 'ipv4', value: 0x7f000001 },
    { kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] },
  ])('compares IP hosts by value: %j', (host) => {
    const store = new CookieStore();
    const cookie = store.parseAndStoreCookie('n=v', true, host, [''], true, false, true);

    expect(store.retrieveCookies(true, structuredClone(host), [''], true, 'strict-or-less')).toEqual([cookie]);
    expect(store.retrieveCookies(true, { kind: 'ipv4', value: 0x7f000002 }, [''], true, 'strict-or-less')).toEqual([]);
  });

  it('withholds non-host-only cookies whose host is a public suffix', () => {
    const store = new CookieStore();
    const publicSuffix: CookieHost = { kind: 'domain', value: 'com' };
    const domain = storedCookie('domain', publicSuffix);
    const hostOnly = storedCookie('host', publicSuffix);
    hostOnly.hostOnly = true;
    store.cookies = new Set([domain, hostOnly]);

    expect(store.retrieveCookies(true, publicSuffix, [''], true, 'strict-or-less')).toEqual([hostOnly]);
    expect(store.retrieveCookies(true, { kind: 'domain', value: 'site.com' }, [''], true, 'strict-or-less')).toEqual([]);
    expect(domain.lastAccessTime).toBe(now - 1000);
  });

  it('returns no cookies for an opaque path without updating access times', () => {
    const store = new CookieStore();
    const cookie = store.parseAndStoreCookie('n=v', true, host, [''], true, false, true)!;
    vi.mocked(Date.now).mockReturnValue(now + 1000);

    expect(store.retrieveCookies(true, host, '/account', true, 'strict-or-less')).toEqual([]);
    expect(store.cookies.has(cookie)).toBe(true);
    expect(cookie.lastAccessTime).toBe(now);
  });
});

function storedCookie(name: string, cookieHost = host): StoredHTTPCookie {
  return Object.assign(new HTTPCookie(name, 'value', ['']), { host: cookieHost, lastAccessTime: now - 1000 });
}
