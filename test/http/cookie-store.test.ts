import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HTTPCookie, type CookieHost, type StoredHTTPCookie } from '../../src/http/cookie';
import { CookieStore, type CookieSameSiteMode } from '../../src/http/cookie-store';

const now = Date.UTC(2026, 8, 20);
const host: CookieHost = { kind: 'domain', value: 'example.test' };

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('cookie store and limits (§5.1.1)', () => {
  it('starts empty with the recommended limits', () => {
    const store = new CookieStore();

    expect(store.cookies.size).toBe(0);
    expect(store.totalCookiesPerHostLimit).toBe(50);
    expect(store.totalCookiesLimit).toBe(3000);
    expect(store.cookieAgeLimit).toBe(400);
  });

  it('keeps each store independent', () => {
    const first = new CookieStore();
    const second = new CookieStore();
    first.cookies.add(storedCookie('first'));
    first.totalCookiesPerHostLimit = 10;

    expect(second.cookies.size).toBe(0);
    expect(second.totalCookiesPerHostLimit).toBe(50);
  });
});

describe('parse and store a cookie (§5.4.1)', () => {
  it('returns and stores the same parsed cookie with an established host', () => {
    const store = new CookieStore();
    const cookie = store.parseAndStoreCookie('name=value', true, host, ['account', 'page'], true, false, true);

    expect(cookie).toMatchObject({ name: 'name', value: 'value', host, hostOnly: true, path: ['account'] });
    expect([...store.cookies]).toEqual([cookie]);
    expect([...store.cookies][0]).toBe(cookie);
  });

  it('supplies its current age limit to the cookie parser', () => {
    const store = new CookieStore();
    store.cookieAgeLimit = 7;
    const expires = store.parseAndStoreCookie('expires=v; Expires=Fri, 31 Dec 9999 23:59:59 GMT', true, host, [''], true, false, true);
    store.cookieAgeLimit = 1;
    const maxAge = store.parseAndStoreCookie('max-age=v; Max-Age=99999999', true, host, [''], true, false, true);

    expect(expires?.expiryTime).toBe(now + 7 * 86_400_000);
    expect(maxAge?.expiryTime).toBe(now + 86_400_000);
  });

  it.each(['', 'name=\x00', 'name=value; Domain=other.test', 'name=value; Domain='])('rejects %j without adding to the store', (input) => {
    const store = new CookieStore();
    expect(store.parseAndStoreCookie(input, true, host, [''], true, false, true)).toBeNull();
    expect(store.cookies.size).toBe(0);
  });

  it('leaves expired-cookie removal to the subsequent garbage-collection step', () => {
    const store = new CookieStore();
    const cookie = store.parseAndStoreCookie('name=value; Max-Age=0', true, host, [''], true, false, true);

    expect(cookie?.isExpired).toBe(true);
    expect(store.cookies.has(cookie!)).toBe(true);
    expect(store.garbageCollectCookies(host)).toEqual([cookie]);
    expect(store.cookies.size).toBe(0);
  });
});

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

  function storedCookie(name: string, cookieHost = host): StoredHTTPCookie {
    return Object.assign(new HTTPCookie(name, 'value', ['']), { host: cookieHost, lastAccessTime: now - 1000 });
  }
});

describe('store a cookie: scope and caller policy (§5.4.3)', () => {
  it('establishes the host on the same record and timestamps it at storage', () => {
    const store = new CookieStore();
    const cookie = new HTTPCookie('name', 'value', ['']);
    cookie.creationTime = cookie.lastAccessTime = now - 1000;

    expect(store.storeCookie(cookie, true, host, true, false, true)).toBe(cookie);
    expect(cookie).toMatchObject({ host, hostOnly: true, creationTime: now, lastAccessTime: now });
  });

  it.each([
    ['example.test', 'example.test', true],
    ['sub.example.test', 'example.test', true],
    ['badexample.test', 'example.test', false],
    ['example.test', 'sub.example.test', false],
    ['other.test', 'example.test', false],
  ])('accepts host %s setting Domain=%s: %s', (requestHost, domain, accepted) => {
    const store = new CookieStore();
    const cookie = store.parseAndStoreCookie(
      `name=value; Domain=${domain}`, true, { kind: 'domain', value: requestHost }, [''], true, false, true,
    );

    expect(cookie !== null).toBe(accepted);
    if (cookie !== null) expect(cookie.hostOnly).toBe(false);
  });

  it('requires permission to store HttpOnly and a secure connection to store Secure', () => {
    const store = new CookieStore();
    expect(store.parseAndStoreCookie('n=v; HttpOnly', true, host, [''], false, false, true)).toBeNull();
    expect(store.parseAndStoreCookie('n=v; Secure', false, host, [''], true, false, true)).toBeNull();
    expect(store.parseAndStoreCookie('n=v; Secure; HttpOnly', true, host, [''], true, false, true))
      .toMatchObject({ secure: true, httpOnly: true });
  });

  it.each(['', '; SameSite=Strict', '; SameSite=Lax'])('requires same-site permission for %j', (attribute) => {
    const store = new CookieStore();
    expect(store.parseAndStoreCookie(`n=v${attribute}`, true, host, [''], true, false, false)).toBeNull();
    expect(store.parseAndStoreCookie(`n=v${attribute}`, true, host, [''], true, false, true)).not.toBeNull();
  });

  it('allows SameSite=None in a cross-site setting only when the cookie is Secure', () => {
    const store = new CookieStore();
    expect(store.parseAndStoreCookie('n=v; SameSite=None', true, host, [''], true, false, false)).toBeNull();
    expect(store.parseAndStoreCookie('n=v; SameSite=None; Secure', true, host, [''], true, false, false))
      .toMatchObject({ sameSite: 'none', secure: true });
  });

  it('rejects a failed host and an opaque cookie path', () => {
    const store = new CookieStore();
    const cookie = new HTTPCookie('name', 'value', ['']);
    cookie.host = null;
    expect(store.storeCookie(cookie, true, host, true, false, true)).toBeNull();
    expect(store.storeCookie(new HTTPCookie('name', 'value', '/opaque'), true, host, true, false, true)).toBeNull();
    expect(store.cookies.size).toBe(0);
  });

  it.each<[CookieHost, string]>([
    [{ kind: 'ipv4', value: 0x7f000001 }, '127.1'],
    [{ kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] }, '[0:0:0:0:0:0:0:1]'],
  ])('treats a matching IP Domain attribute as host-only: %j', (host, domain) => {
    expect(new CookieStore().parseAndStoreCookie(`n=v; Domain=${domain}`, true, host, [''], true, false, true))
      .toMatchObject({ host, hostOnly: true });
  });

  it.each(['com', 'co.uk', 'github.io'])('rejects Domain=%s from a subdomain unless caller policy permits it', (suffix) => {
    const store = new CookieStore();
    const requestHost: CookieHost = { kind: 'domain', value: `site.${suffix}` };

    expect(store.parseAndStoreCookie(`n=v; Domain=${suffix}`, true, requestHost, [''], true, false, true)).toBeNull();
    expect(store.parseAndStoreCookie(`n=v; Domain=${suffix}`, true, requestHost, [''], true, true, true))
      .toMatchObject({ host: { kind: 'domain', value: suffix }, hostOnly: false });
  });

  it('converts a public-suffix Domain attribute equal to the request host into host-only scope', () => {
    const publicSuffix: CookieHost = { kind: 'domain', value: 'co.uk' };
    const cookie = new CookieStore().parseAndStoreCookie('n=v; Domain=co.uk', true, publicSuffix, [''], true, false, true);

    expect(cookie).toMatchObject({ host: publicSuffix, hostOnly: true });
  });
});

describe('store a cookie: replacement (§5.4.3)', () => {
  it('replaces by name, host value, host-only flag, and path value while retaining creation time', () => {
    const store = new CookieStore();
    const first = store.parseAndStoreCookie('n=first; Path=/account', true, host, [''], true, false, true);
    vi.mocked(Date.now).mockReturnValue(now + 1000);
    const replacement = store.parseAndStoreCookie('n=second; Path=/account', true, { ...host }, [''], true, false, true);

    expect(replacement).not.toBe(first);
    expect(replacement).toMatchObject({ creationTime: now, lastAccessTime: now + 1000, value: 'second' });
    expect([...store.cookies]).toEqual([replacement]);
    expect(store.cookies.has(first!)).toBe(false);
  });

  it('keeps cookies with different keys, including host-only versus domain scope', () => {
    const store = new CookieStore();
    const first = store.parseAndStoreCookie('n=host', true, host, [''], true, false, true);
    const domain = store.parseAndStoreCookie('n=domain; Domain=example.test', true, host, [''], true, false, true);
    const path = store.parseAndStoreCookie('n=path; Path=/other', true, host, [''], true, false, true);
    const name = store.parseAndStoreCookie('N=name', true, host, [''], true, false, true);
    const otherHost = store.parseAndStoreCookie('n=other-host', true, { kind: 'domain', value: 'other.test' }, [''], true, false, true);

    expect([...store.cookies]).toEqual([first, domain, path, name, otherHost]);
  });

  it.each(['n=changed', 'n=v; Secure', 'n=v; HttpOnly', 'n=v; SameSite=Lax', 'n=v; Max-Age=60'])('reports a changed replacement for %s', (input) => {
    const store = new CookieStore();
    store.parseAndStoreCookie('n=v', true, host, [''], true, false, true);

    expect(store.parseAndStoreCookie(input, true, host, [''], true, false, true)).not.toBeNull();
    expect(store.cookies.size).toBe(1);
  });

  it('returns null for an unchanged replacement but still installs the new record and updates access time', () => {
    const store = new CookieStore();
    const first = store.parseAndStoreCookie('n=v', true, host, [''], true, false, true);
    vi.mocked(Date.now).mockReturnValue(now + 1000);
    const replacement = HTTPCookie.parse('n=v; Path=/', [''], store.cookieAgeLimit)!;

    expect(store.storeCookie(replacement, true, host, true, false, true)).toBeNull();
    expect([...store.cookies][0]).toBe(replacement);
    expect(replacement).toMatchObject({ creationTime: now, lastAccessTime: now + 1000, hasPathAttribute: true });
    expect(store.cookies.has(first!)).toBe(false);
  });

  it('protects an existing HttpOnly cookie even when the attempted replacement is not HttpOnly', () => {
    const store = new CookieStore();
    const first = store.parseAndStoreCookie('n=first; HttpOnly', true, host, [''], true, false, true);
    vi.mocked(Date.now).mockReturnValue(now + 1000);

    expect(store.parseAndStoreCookie('n=second', true, host, [''], false, false, true)).toBeNull();
    expect(store.parseAndStoreCookie('n=deleted; Max-Age=0', true, host, [''], false, false, true)).toBeNull();
    expect([...store.cookies]).toEqual([first]);
    expect(first?.lastAccessTime).toBe(now);
  });

  it('deletes an existing cookie by replacing it with an expired cookie and collecting it', () => {
    const store = new CookieStore();
    const first = store.parseAndStoreCookie('n=v', true, host, [''], true, false, true);
    const deletion = store.parseAndStoreCookie('n=gone; Max-Age=0', true, host, [''], true, false, true);

    expect(store.cookies.has(first!)).toBe(false);
    expect(store.garbageCollectCookies(host)).toEqual([deletion]);
    expect(store.cookies.size).toBe(0);
  });
});

describe('store a cookie: insecure overlay protection (§5.4.3)', () => {
  it.each([
    ['/', true], ['/foo', true], ['/login', false], ['/login/en', false], ['/logins', true],
  ])('allows an insecure path %s beside an existing secure /login cookie: %s', (path, accepted) => {
    const store = new CookieStore();
    const secure = store.parseAndStoreCookie('n=secure; Path=/login; Secure', true, host, [''], true, false, true);
    const cookie = store.parseAndStoreCookie(`n=insecure; Path=${path}`, false, host, [''], true, false, true);

    expect(cookie !== null).toBe(accepted);
    expect(store.cookies.has(secure!)).toBe(true);
  });

  it.each([
    ['example.test', 'sub.example.test'],
    ['sub.example.test', 'example.test'],
  ])('checks overlapping domains in both directions: %s and %s', (secureDomain, newDomain) => {
    const store = new CookieStore();
    const requestHost: CookieHost = { kind: 'domain', value: 'sub.example.test' };
    store.parseAndStoreCookie(`n=secure; Domain=${secureDomain}; Secure`, true, requestHost, [''], true, false, true);

    expect(store.parseAndStoreCookie(`n=insecure; Domain=${newDomain}`, false, requestHost, [''], true, false, true)).toBeNull();
  });

  it('allows an unrelated host, a different name, and a replacement sent over a secure connection', () => {
    const store = new CookieStore();
    store.parseAndStoreCookie('n=secure; Secure', true, host, [''], true, false, true);

    expect(store.parseAndStoreCookie('n=other-host', false, { kind: 'domain', value: 'other.test' }, [''], true, false, true)).not.toBeNull();
    expect(store.parseAndStoreCookie('other=value', false, host, [''], true, false, true)).not.toBeNull();
    expect(store.parseAndStoreCookie('n=new', true, host, [''], true, false, true)).toMatchObject({ value: 'new', secure: false });
  });
});

describe('store a cookie: name prefixes (§5.4.3)', () => {
  it.each([
    ['__Secure-id=v', false],
    ['__Secure-id=v; Secure', true],
    ['__sEcUrE-id=v', false],
    ['__sEcUrE-id=v; Secure', true],
    ['__Host-id=v; Secure', false],
    ['__Host-id=v; Secure; Path=/', true],
    ['__Host-id=v; Secure; Path=/other', false],
    ['__Host-id=v; Secure; Path=/; Domain=example.test', false],
    ['__HOST-id=v; Secure; Path=/', true],
    ['__Http-id=v; Secure', false],
    ['__Http-id=v; HttpOnly', false],
    ['__Http-id=v; Secure; HttpOnly', true],
    ['__HTTP-id=v; Secure; HttpOnly', true],
    ['__Host-Http-id=v; Secure; HttpOnly', false],
    ['__Host-Http-id=v; Secure; Path=/', false],
    ['__Host-Http-id=v; HttpOnly; Path=/', false],
    ['__Host-Http-id=v; Secure; HttpOnly; Path=/', true],
    ['__HOST-HTTP-id=v; Secure; HttpOnly; Path=/; Domain=example.test', false],
    ['__HOST-HTTP-id=v; Secure; HttpOnly; Path=/', true],
    ['ordinary__Host-id=v', true],
  ])('accepts %s: %s', (input, accepted) => {
    expect(new CookieStore().parseAndStoreCookie(input, true, host, [''], true, false, true) !== null).toBe(accepted);
  });

  it.each(['__Secure-', '__Host-', '__Http-', '__Host-Http-', '__SECURE-', '__HOST-HTTP-'])('rejects an empty name hiding %s in its value', (prefix) => {
    const input = `=${prefix}value; Secure; HttpOnly; Path=/`;
    expect(new CookieStore().parseAndStoreCookie(input, true, host, [''], true, false, true)).toBeNull();
  });

  it('does not mistake an implicit default root path for an explicit Path attribute', () => {
    expect(new CookieStore().parseAndStoreCookie('__Host-id=v; Secure; Path=relative', true, host, [''], true, false, true)).toBeNull();
  });
});

describe('remove expired cookies (§5.2.1)', () => {
  it('returns the expired records in store order and preserves the surviving records', () => {
    const store = new CookieStore();
    const expired = storedCookie('expired');
    const older = storedCookie('older');
    const session = storedCookie('session');
    const boundary = storedCookie('boundary');
    const future = storedCookie('future');
    expired.expiryTime = now - 1;
    older.expiryTime = now - 2;
    boundary.expiryTime = now;
    future.expiryTime = now + 1;
    store.cookies = new Set([session, expired, boundary, older, future]);

    const removed = store.removeExpiredCookies();

    expect(removed).toEqual([expired, older]);
    expect(removed[0]).toBe(expired);
    expect(removed[1]).toBe(older);
    expect([...store.cookies]).toEqual([session, boundary, future]);
    expect([...store.cookies][0]).toBe(session);
    expect(store.removeExpiredCookies()).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(now + 1);
    expect(store.removeExpiredCookies()).toEqual([boundary]);
  });

  it('removes all expired cookies without skipping adjacent entries', () => {
    const store = new CookieStore();
    const cookies = [storedCookie('a'), storedCookie('b'), storedCookie('c')];
    for (const cookie of cookies) cookie.expiryTime = now - 1;
    store.cookies = new Set(cookies);

    expect(store.removeExpiredCookies()).toEqual(cookies);
    expect(store.cookies.size).toBe(0);
    expect(store.removeExpiredCookies()).toEqual([]);
  });
});

describe('remove excess cookies for a host (§5.2.2)', () => {
  it.each([0, 1, 2])('does nothing with %i cookies under a limit of 2', (count) => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 2;
    const cookies = Array.from({ length: count }, (_, index) => storedCookie(String(index)));
    store.cookies = new Set(cookies);

    expect(store.removeExcessCookiesForHost(host)).toEqual([]);
    expect([...store.cookies]).toEqual(cookies);
  });

  it('evicts insecure cookies first, then secure cookies, oldest access first within each group', () => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 2;
    const secureOld = storedCookie('secure-old', host, 1, true);
    const secureNew = storedCookie('secure-new', host, 2, true);
    const secureNewest = storedCookie('secure-newest', host, 3, true);
    const insecureOld = storedCookie('insecure-old', host, 10);
    const insecureNew = storedCookie('insecure-new', host, 20);
    const sibling = storedCookie('sibling', { kind: 'domain', value: 'sub.example.test' }, 0);
    insecureOld.creationTime = now + 1;
    insecureNew.creationTime = now - 1;
    store.cookies = new Set([secureNewest, insecureNew, sibling, secureOld, insecureOld, secureNew]);

    const removed = store.removeExcessCookiesForHost({ kind: 'domain', value: 'example.test' });

    expect(removed).toEqual([insecureOld, insecureNew, secureOld]);
    expect(removed[0]).toBe(insecureOld);
    expect(removed[2]).toBe(secureOld);
    expect([...store.cookies]).toEqual([secureNewest, sibling, secureNew]);
    expect(secureNewest.lastAccessTime).toBe(3);
  });

  it('counts all paths and host-only settings toward the same host limit', () => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 1;
    const first = storedCookie('same-name', host, 1);
    const second = storedCookie('same-name', host, 2);
    second.path = ['account'];
    second.hostOnly = true;
    store.cookies = new Set([first, second]);

    expect(store.removeExcessCookiesForHost(host)).toEqual([first]);
    expect([...store.cookies][0]).toBe(second);
  });

  it('uses host equality rather than grouping a parent domain with its subdomains', () => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 1;
    const parent = storedCookie('parent');
    const child = storedCookie('child', { kind: 'domain', value: 'sub.example.test' });
    const sibling = storedCookie('sibling', { kind: 'domain', value: 'other.example.test' });
    store.cookies = new Set([parent, child, sibling]);

    expect(store.removeExcessCookiesForHost(host)).toEqual([]);
    expect([...store.cookies]).toEqual([parent, child, sibling]);
  });

  it('preserves insertion order when access times tie, regardless of creation time', () => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 1;
    const first = storedCookie('first');
    const second = storedCookie('second');
    const third = storedCookie('third');
    first.creationTime = now + 1;
    third.creationTime = now - 1;
    store.cookies = new Set([first, second, third]);

    expect(store.removeExcessCookiesForHost(host)).toEqual([first, second]);
    expect([...store.cookies][0]).toBe(third);
  });

  it.each<[CookieHost, CookieHost]>([
    [{ kind: 'domain', value: 'example.test' }, { kind: 'domain', value: 'example.test' }],
    [{ kind: 'ipv4', value: 0xc0000201 }, { kind: 'ipv4', value: 0xc0000201 }],
    [
      { kind: 'ipv6', pieces: [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1] },
      { kind: 'ipv6', pieces: [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1] },
    ],
  ])('compares %j hosts by value rather than object identity', (storedHost, equalHost) => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 0;
    const cookie = storedCookie('cookie', storedHost);
    const unrelated = storedCookie('unrelated', { kind: 'domain', value: 'other.test' });
    store.cookies = new Set([unrelated, cookie]);

    expect(store.removeExcessCookiesForHost(equalHost)).toEqual([cookie]);
    expect([...store.cookies]).toEqual([unrelated]);
  });

  it('leaves expiry removal to its separate algorithm', () => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 1;
    const expiredSecure = storedCookie('expired-secure', host, 1, true);
    expiredSecure.expiryTime = now - 1;
    const liveInsecure = storedCookie('live-insecure', host, 2);
    store.cookies = new Set([expiredSecure, liveInsecure]);

    expect(store.removeExcessCookiesForHost(host)).toEqual([liveInsecure]);
    expect(store.removeExpiredCookies()).toEqual([expiredSecure]);
  });
});

describe('remove global excess cookies (§5.2.3)', () => {
  it.each([0, 1, 2])('does nothing with %i cookies under a limit of 2', (count) => {
    const store = new CookieStore();
    store.totalCookiesLimit = 2;
    const cookies = Array.from({ length: count }, (_, index) => storedCookie(String(index)));
    store.cookies = new Set(cookies);

    expect(store.removeGlobalExcessCookies()).toEqual([]);
    expect([...store.cookies]).toEqual(cookies);
  });

  it('evicts globally by oldest access, ignoring host and security and retaining survivor order', () => {
    const store = new CookieStore();
    store.totalCookiesLimit = 2;
    const oldest = storedCookie('oldest', host, 1, true);
    const older = storedCookie('older', { kind: 'domain', value: 'other.test' }, 2);
    const newer = storedCookie('newer', host, 3);
    const newest = storedCookie('newest', host, 4);
    oldest.creationTime = now + 1;
    newest.creationTime = now - 1;
    store.cookies = new Set([newest, older, oldest, newer]);

    const removed = store.removeGlobalExcessCookies();

    expect(removed).toEqual([oldest, older]);
    expect(removed[0]).toBe(oldest);
    expect([...store.cookies]).toEqual([newest, newer]);
  });

  it('preserves store order when access times tie', () => {
    const store = new CookieStore();
    store.totalCookiesLimit = 1;
    const first = storedCookie('first');
    const second = storedCookie('second');
    const third = storedCookie('third');
    third.creationTime = now - 1;
    store.cookies = new Set([first, second, third]);

    expect(store.removeGlobalExcessCookies()).toEqual([first, second]);
    expect([...store.cookies][0]).toBe(third);
  });

  it('removes every cookie at a zero limit', () => {
    const store = new CookieStore();
    store.totalCookiesLimit = 0;
    const older = storedCookie('older', host, 1);
    const newer = storedCookie('newer', host, 2);
    store.cookies = new Set([newer, older]);

    expect(store.removeGlobalExcessCookies()).toEqual([older, newer]);
    expect(store.cookies.size).toBe(0);
  });
});

describe('garbage collect cookies (§5.4.4)', () => {
  it('removes expiry, host excess, then global excess and returns the original records in that order', () => {
    const store = new CookieStore();
    store.totalCookiesPerHostLimit = 1;
    store.totalCookiesLimit = 1;
    const expired = storedCookie('expired', { kind: 'domain', value: 'other.test' }, 99);
    expired.expiryTime = now - 1;
    const hostExcess = storedCookie('host-excess', host, 10);
    const globalExcess = storedCookie('global-excess', { kind: 'domain', value: 'other.test' }, 1);
    const survivor = storedCookie('survivor', host, 20);
    store.cookies = new Set([globalExcess, hostExcess, survivor, expired]);

    const removed = store.garbageCollectCookies(host);

    expect(removed).toEqual([expired, hostExcess, globalExcess]);
    expect(removed[0]).toBe(expired);
    expect(removed[1]).toBe(hostExcess);
    expect(removed[2]).toBe(globalExcess);
    expect([...store.cookies]).toEqual([survivor]);
    expect(store.garbageCollectCookies(host)).toEqual([]);
  });
});

function storedCookie(name: string, cookieHost = host, lastAccessTime = now, secure = false): StoredHTTPCookie {
  const cookie = new HTTPCookie(name, '', ['']);
  return Object.assign(cookie, { host: cookieHost, lastAccessTime, secure });
}
