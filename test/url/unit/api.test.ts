import { describe, expect, it } from 'vitest';

import { urlConstructors } from './contract';

describe('URL Standard section 6.1: URL class', () => {
  it.fails('constructs with and without a base URL', () => {
    const { URL } = urlConstructors();

    expect(new URL('https://example.org/path').href)
      .toBe('https://example.org/path');
    expect(new URL('child', 'https://example.org/base/').href)
      .toBe('https://example.org/base/child');
  });

  it.fails('throws TypeError when construction fails', () => {
    const { URL } = urlConstructors();

    expect(() => new URL('relative')).toThrow(TypeError);
    expect(() => new URL('relative', 'invalid base')).toThrow(TypeError);
  });

  it.fails('parse returns null where the constructor throws', () => {
    const { URL } = urlConstructors();

    expect(URL.parse('relative')).toBeNull();
    expect(URL.parse('child', 'https://example.org/base/')?.href)
      .toBe('https://example.org/base/child');
  });

  it.fails('canParse reports whether parsing succeeds', () => {
    const { URL } = urlConstructors();

    expect(URL.canParse('https://example.org/')).toBe(true);
    expect(URL.canParse('relative')).toBe(false);
    expect(URL.canParse('relative', 'https://example.org/')).toBe(true);
  });

  it.fails('exposes all URL component getters', () => {
    const { URL } = urlConstructors();
    const url = new URL(
      'https://user:password@example.org:8443/a?q=x#fragment',
    );

    expect({
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      username: url.username,
      password: url.password,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      json: url.toJSON(),
      string: String(url),
    }).toEqual({
      href: 'https://user:password@example.org:8443/a?q=x#fragment',
      origin: 'https://example.org:8443',
      protocol: 'https:',
      username: 'user',
      password: 'password',
      host: 'example.org:8443',
      hostname: 'example.org',
      port: '8443',
      pathname: '/a',
      search: '?q=x',
      hash: '#fragment',
      json: 'https://user:password@example.org:8443/a?q=x#fragment',
      string: 'https://user:password@example.org:8443/a?q=x#fragment',
    });
  });

  it.fails('setters parse and serialize component values', () => {
    const { URL } = urlConstructors();
    const url = new URL('https://example.org/base');

    url.protocol = 'http';
    url.username = 'a b';
    url.password = 'p@ss';
    url.hostname = 'EXAMPLE.COM';
    url.port = '80';
    url.pathname = '/a b';
    url.search = '?q=a b';
    url.hash = '#a b';

    expect(url.href).toBe(
      'http://a%20b:p%40ss@example.com/a%20b?q=a%20b#a%20b',
    );
  });

  it.fails('host setter preserves an existing port when none is supplied', () => {
    const { URL } = urlConstructors();
    const url = new URL('https://example.org:8443/');

    url.host = 'other.example';

    expect(url.host).toBe('other.example:8443');
  });

  it.fails('searchParams is the same object and updates its URL', () => {
    const { URL } = urlConstructors();
    const url = new URL('https://example.org/?a=1');

    expect(url.searchParams).toBe(url.searchParams);
    url.searchParams.append('b', '2');
    expect(url.search).toBe('?a=1&b=2');

    url.search = '?c=3';
    expect([...url.searchParams]).toEqual([['c', '3']]);
  });

  it.fails('uses different query and form-urlencoded encode sets', () => {
    const { URL } = urlConstructors();
    const url = new URL('https://example.com/?a=b ~');

    expect(url.href).toBe('https://example.com/?a=b%20~');
    url.searchParams.sort();
    expect(url.href).toBe('https://example.com/?a=b+%7E');
  });
});

describe('URL Standard section 6.2: URLSearchParams class', () => {
  it.fails('constructs from strings, records, and sequences', () => {
    const { URLSearchParams } = urlConstructors();

    expect(String(new URLSearchParams('?a=1&a=2'))).toBe('a=1&a=2');
    expect(String(new URLSearchParams({ key: '730d67' }))).toBe('key=730d67');
    expect(String(new URLSearchParams([['a', '1'], ['b', '2']]))).toBe('a=1&b=2');
  });

  it.fails('removes only one leading question mark from string input', () => {
    const { URLSearchParams } = urlConstructors();

    expect(String(new URLSearchParams('?a=1'))).toBe('a=1');
    expect(String(new URLSearchParams('??a=1'))).toBe('%3Fa=1');
  });

  it.fails('rejects sequence entries whose size is not two', () => {
    const { URLSearchParams } = urlConstructors();

    expect(() => new URLSearchParams([['a']] as string[][])).toThrow(TypeError);
    expect(() => new URLSearchParams([['a', 'b', 'c']] as string[][]))
      .toThrow(TypeError);
  });

  it.fails('implements append, size, get, getAll, has, and iteration', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('a=1&a=2');

    params.append('b', '3');

    expect(params.size).toBe(3);
    expect(params.get('a')).toBe('1');
    expect(params.get('missing')).toBeNull();
    expect(params.getAll('a')).toEqual(['1', '2']);
    expect(params.has('a')).toBe(true);
    expect(params.has('a', '2')).toBe(true);
    expect(params.has('a', '3')).toBe(false);
    expect([...params]).toEqual([['a', '1'], ['a', '2'], ['b', '3']]);
  });

  it.fails('deletes by name or by name and value', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('a=1&a=2&b=3');

    params.delete('a', '1');
    expect(String(params)).toBe('a=2&b=3');
    params.delete('a');
    expect(String(params)).toBe('b=3');
  });

  it.fails('set replaces the first matching tuple and removes the rest', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('a=1&b=2&a=3');

    params.set('a', '4');

    expect(String(params)).toBe('a=4&b=2');
  });

  it.fails('sorts stably by UTF-16 code units', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('z=1&a=first&a=second&b=2');

    params.sort();

    expect([...params]).toEqual([
      ['a', 'first'], ['a', 'second'], ['b', '2'], ['z', '1'],
    ]);
  });

  it.fails('provides keys, values, entries, and forEach in list order', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('a=1&a=2&b=3');
    const visited: [string, string][] = [];

    params.forEach((value, name) => visited.push([name, value]));

    expect([...params.keys()]).toEqual(['a', 'a', 'b']);
    expect([...params.values()]).toEqual(['1', '2', '3']);
    expect([...params.entries()]).toEqual([
      ['a', '1'], ['a', '2'], ['b', '3'],
    ]);
    expect(visited).toEqual([['a', '1'], ['a', '2'], ['b', '3']]);
  });

  it.fails('sort updates an associated URL', () => {
    const { URL } = urlConstructors();
    const url = new URL(
      'https://example.org/?q=🏳️‍🌈&key=e1f7bc78',
    );

    url.searchParams.sort();

    expect(url.search).toBe(
      '?key=e1f7bc78&q=%F0%9F%8F%B3%EF%B8%8F%E2%80%8D%F0%9F%8C%88',
    );
  });
});
