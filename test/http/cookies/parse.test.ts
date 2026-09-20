import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPCookie } from '../../../src/http/cookies/cookie';

const now = Date.UTC(2026, 8, 20);
const day = 86_400_000;

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('parse a cookie (§5.4.2)', () => {
  it.each<[string, string, string]>([
    ['name=value', 'name', 'value'],
    ['name=', 'name', ''],
    ['value', '', 'value'],
    ['=value', '', 'value'],
    ['  name\t = \tvalue  ', 'name', 'value'],
    ['name=a=b=c', 'name', 'a=b=c'],
    ['name="quoted value"', 'name', '"quoted value"'],
    ['na\tme=va\tlue', 'na\tme', 'va\tlue'],
    ['\x80=\xff', '\x80', '\xff'],
    ['\xa0name\xa0=\xa0value\xa0', '\xa0name\xa0', '\xa0value\xa0'],
    ['name=value, other=cookie', 'name', 'value, other=cookie'],
    ['name=value;;;; Unknown=a=b; =ignored', 'name', 'value'],
  ])('parses %j without normalizing or unquoting the byte strings', (input, name, value) => {
    const cookie = HTTPCookie.parse(input, ['directory', 'page'], 400);

    expect(cookie).toMatchObject({
      name, value, path: ['directory'], host: undefined, hostOnly: false,
      secure: false, httpOnly: false, sameSite: 'unset', hasPathAttribute: false,
      creationTime: now, lastAccessTime: now, expiryTime: null,
    });
  });

  it('recognizes attribute names case-insensitively and flags independently of their values', () => {
    const cookie = HTTPCookie.parse('name=value; sEcUrE=false;\tHTTPONLY = no; SameSite = lAx', [''], 400);

    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax' });
  });

  it.each([
    ['Strict', 'strict'], ['lAx', 'lax'], ['NONE', 'none'],
    ['', 'unset'], ['unknown', 'unset'], ['"Strict"', 'unset'],
  ])('recognizes SameSite=%s as %s', (attribute, expected) => {
    expect(HTTPCookie.parse(`n=v; SameSite=${attribute}`, [''], 400)?.sameSite).toBe(expected);
  });

  it('keeps the last recognized SameSite value when a later attribute is invalid', () => {
    expect(HTTPCookie.parse('n=v; SameSite=Lax; SameSite=Strict; SameSite=bad', [''], 400)?.sameSite).toBe('strict');
  });

  it.each(['', ' ', '\t', '=', ' = ', '; Secure', '=; Path=/'])('rejects the empty name/value pair %j', (input) => {
    expect(HTTPCookie.parse(input, [''], 400)).toBeNull();
  });

  it('limits name plus value to 4096 bytes after trimming, excluding the separator and attributes', () => {
    expect(HTTPCookie.parse('a'.repeat(2048) + '=' + 'b'.repeat(2048), [''], 400)).not.toBeNull();
    expect(HTTPCookie.parse('name=' + 'x'.repeat(4093), [''], 400)).toBeNull();
    expect(HTTPCookie.parse(' \tname=' + 'x'.repeat(4092) + ' \t; Unknown=' + 'x'.repeat(2000), [''], 400)).not.toBeNull();
    expect(HTTPCookie.parse('\xff'.repeat(4096), [''], 400)?.value.length).toBe(4096);
    expect(HTTPCookie.parse('\xff'.repeat(4097), [''], 400)).toBeNull();
  });

  it('ignores attribute values over 1024 bytes after trimming, without discarding the cookie', () => {
    expect(HTTPCookie.parse('n=v; Secure=' + 'x'.repeat(1024), [''], 400)?.secure).toBe(true);
    expect(HTTPCookie.parse('n=v; Secure=' + 'x'.repeat(1025), [''], 400)?.secure).toBe(false);
    expect(HTTPCookie.parse('n=v; HttpOnly=' + 'x'.repeat(1025) + '; Secure', [''], 400))
      .toMatchObject({ httpOnly: false, secure: true });
    expect(HTTPCookie.parse('n=v; Path=/' + 'x'.repeat(1023) + ' \t', [''], 400)?.hasPathAttribute).toBe(true);
    expect(HTTPCookie.parse('n=v; Path=/' + 'x'.repeat(1024), [''], 400)?.hasPathAttribute).toBe(false);
    expect(HTTPCookie.parse('n=v; Domain=' + 'x'.repeat(1025), [''], 400)?.host).toBeUndefined();
  });

  it('rejects every prohibited control byte, including in ignored attributes, but accepts all other bytes', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const character = String.fromCharCode(byte);
      const rejected = byte <= 0x08 || byte >= 0x0a && byte <= 0x1f || byte === 0x7f;
      for (const input of [`name=x${character}x`, `name=x; Unknown=x${character}x`]) {
        expect(HTTPCookie.parse(input, [''], 400) === null, `byte ${byte} in ${JSON.stringify(input)}`).toBe(rejected);
      }
    }
  });
});

describe('cookie expiry attributes (§5.4.2)', () => {
  it('parses Expires as an absolute time and keeps the last valid date', () => {
    const cookie = HTTPCookie.parse(
      'n=v; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Expires=Sun, 20 Sep 2026 00:01:00 GMT; Expires=bad', [''], 400,
    );

    expect(cookie?.expiryTime).toBe(now + 60_000);
  });

  it('leaves invalid Expires as a session cookie', () => {
    expect(HTTPCookie.parse('n=v; Expires=bad', [''], 400)?.expiryTime).toBeNull();
  });

  it.each([1, 30, 400])('caps Expires at now plus the supplied limit of %i days', (limit) => {
    const cookie = HTTPCookie.parse('n=v; Expires=Fri, 31 Dec 9999 23:59:59 GMT', [''], limit);

    expect(cookie?.expiryTime).toBe(now + limit * day);
    expect(cookie?.isExpired).toBe(false);
  });

  it('does not move an earlier expiry forward to the cap', () => {
    expect(HTTPCookie.parse('n=v; Expires=Thu, 01 Jan 1970 00:00:00 GMT', [''], 400)?.expiryTime).toBe(0);
  });

  it.each(['60', '00060', ' 60\t'])('interprets Max-Age=%j in seconds', (attribute) => {
    expect(HTTPCookie.parse(`n=v; Max-Age=${attribute}`, [''], 400)?.expiryTime).toBe(now + 60_000);
  });

  it.each(['0', '-0', '-1', '-99999999999999999999999999999999999999'])('expires Max-Age=%s immediately', (attribute) => {
    const cookie = HTTPCookie.parse(`n=v; Max-Age=${attribute}`, [''], 400);
    expect(cookie?.isExpired).toBe(true);
    expect(new Date(cookie!.expiryTime!).getTime()).not.toBeNaN();
  });

  it.each(['', '-', '+60', '1.5', '1e3', '1x', '1 2', '--1', 'Infinity', '0x10', '\xff'])('ignores invalid Max-Age=%j', (attribute) => {
    expect(HTTPCookie.parse(`n=v; Max-Age=${attribute}`, [''], 400)?.expiryTime).toBeNull();
  });

  it('caps an overflowing positive Max-Age before calculating the absolute timestamp', () => {
    expect(HTTPCookie.parse('n=v; Max-Age=' + '9'.repeat(1024), [''], 7)?.expiryTime).toBe(now + 7 * day);
    expect(HTTPCookie.parse('n=v; Max-Age=' + '9'.repeat(1025), [''], 7)?.expiryTime).toBeNull();
  });

  it.each([
    'Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60',
    'Max-Age=60; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=60; Max-Age=bad; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=10; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60',
  ])('gives valid Max-Age precedence across the whole attribute list: %s', (attributes) => {
    expect(HTTPCookie.parse(`n=v; ${attributes}`, [''], 400)?.expiryTime).toBe(now + 60_000);
  });

  it('allows Expires after an invalid Max-Age', () => {
    expect(HTTPCookie.parse('n=v; Max-Age=bad; Expires=Thu, 01 Jan 1970 00:00:00 GMT', [''], 400)?.expiryTime).toBe(0);
  });
});

describe('cookie Domain and Path attributes (§5.4.2)', () => {
  it.each([
    ['EXAMPLE.COM', { kind: 'domain', value: 'example.com' }],
    ['.Example.com', { kind: 'domain', value: 'example.com' }],
    ['xn--bcher-kva.example', { kind: 'domain', value: 'xn--bcher-kva.example' }],
    ['127.1', { kind: 'ipv4', value: 0x7f000001 }],
    ['[::1]', { kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] }],
  ])('uses URL host parsing for Domain=%s', (attribute, host) => {
    expect(HTTPCookie.parse(`n=v; Domain=${attribute}`, [''], 400)?.host).toEqual(host);
  });

  it.each(['', '.', 'bad host', 'example.com:443', '[::1', '\xfc.example'])('retains a failed Domain=%j parse for storage to reject', (attribute) => {
    const cookie = HTTPCookie.parse(`n=v; Domain=${attribute}`, [''], 400);
    expect(cookie).not.toBeNull();
    expect(cookie?.host).toBeNull();
  });

  it('distinguishes an absent host, a failed final host, and a later recovered host', () => {
    expect(HTTPCookie.parse('n=v', [''], 400)?.host).toBeUndefined();
    expect(HTTPCookie.parse('n=v; Domain=example.com; Domain=', [''], 400)?.host).toBeNull();
    expect(HTTPCookie.parse('n=v; Domain=; Domain=example.com', [''], 400)?.host).toEqual({ kind: 'domain', value: 'example.com' });
  });

  it('copies the default path instead of retaining the supplied array', () => {
    const path = ['directory', 'page'];
    const cookie = HTTPCookie.parse('n=v', path, 400);
    path[0] = 'changed';

    expect(cookie?.path).toEqual(['directory']);
    expect(cookie?.hasPathAttribute).toBe(false);
  });

  it.each<[string, string[]]>([
    ['/', ['']], ['/account', ['account']], ['/account/', ['account', '']],
    ['//account//', ['', 'account', '', '']], ['/a/../b', ['a', '..', 'b']],
    ['/a%2Fb', ['a%2Fb']], ['/a?b#c', ['a?b#c']], ['/a\\b', ['a\\b']],
  ])('retains the literal Path=%s segments', (attribute, path) => {
    expect(HTTPCookie.parse(`n=v; Path=${attribute}`, ['directory', 'page'], 400))
      .toMatchObject({ path, hasPathAttribute: true });
  });

  it.each(['', 'relative', '"/quoted"'])('ignores Path=%j and retains the default', (attribute) => {
    expect(HTTPCookie.parse(`n=v; Path=${attribute}`, ['directory', 'page'], 400))
      .toMatchObject({ path: ['directory'], hasPathAttribute: false });
  });

  it('keeps the last slash-prefixed Path and only then checks whether it is ASCII', () => {
    expect(HTTPCookie.parse('n=v; Path=/first; Path=/last; Path=relative', [''], 400)?.path).toEqual(['last']);
    expect(HTTPCookie.parse('n=v; Path=/\xff; Path=/valid', [''], 400)?.path).toEqual(['valid']);
    expect(HTTPCookie.parse('n=v; Path=/valid; Path=/\xff', [''], 400)).toBeNull();
    expect(HTTPCookie.parse('n=v; Path=/\xff; Path=relative', [''], 400)).toBeNull();
  });
});
