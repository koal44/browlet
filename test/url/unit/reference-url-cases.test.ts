import { describe, expect, it } from 'vitest';

import { urlConstructors } from './contract';

/*
 * These black-box cases come from the URL WPT corpus carried by jsdom and
 * independently authored Firefox URL regressions. They preserve useful edges
 * without adopting either implementation's internal structure.
 */
describe('URL reference implementation cases', () => {
  describe('URL WPT cases carried by jsdom', () => {
    it.fails('applies component-specific control-character handling', () => {
      const { URL } = urlConstructors();
      const url = new URL(
        'https://user:password@example.com:8000/path?query#fragment',
      );

      url.username = '\0te\nst';
      url.pathname = 'a\nb\0c';
      url.search = 'a\rb\0c';
      url.hash = 'a\tb\0c';

      expect(url.username).toBe('%00te%0Ast');
      expect(url.pathname).toBe('/ab%00c');
      expect(url.search).toBe('?ab%00c');
      expect(url.hash).toBe('#ab%00c');
    });

    it.fails('leaves the previous host after an invalid host setter', () => {
      const { URL } = urlConstructors();
      const url = new URL('https://example.com:8443/');

      url.hostname = 'not a host';

      expect(url.hostname).toBe('example.com');
      expect(url.port).toBe('8443');
    });
  });

  describe('Firefox URL regression cases', () => {
    it.fails('terminates hostname setters at URL delimiters', () => {
      const { URL } = urlConstructors();

      for (const [input, hostname] of [
        ['what?', 'what'],
        ['aa#bb', 'aa'],
        ['a/b', 'a'],
        ['a\\b', 'a'],
      ] as const) {
        const url = new URL('http://www.example.com:8080/');
        url.hostname = input;

        expect(url.hostname).toBe(hostname);
        expect(url.port).toBe('8080');
      }
    });

    it.fails('requires brackets around an IPv6 hostname setter', () => {
      const { URL } = urlConstructors();
      const url = new URL('http://example.com/');

      url.hostname = '[::192.9.5.5]';
      expect(url.hostname).toBe('[::c009:505]');

      url.hostname = '2001::1';
      expect(url.hostname).toBe('[::c009:505]');

      url.host = '[2001::1]:30';
      expect(url.host).toBe('[2001::1]:30');
    });

    it.fails('treats reverse solidus as a separator for special URLs', () => {
      const { URL } = urlConstructors();
      const base = 'http:\\test.com\\path/to\\file?query\\backslash#hash\\';

      expect(new URL('..\\', base).href).toBe('http://test.com/path/');
      expect(new URL('\\test', base).href).toBe('http://test.com/test');
      expect(new URL('\\test\\', base).href).toBe('http://test.com/test/');
      expect(new URL('ftp:\\tmp\\test', base).href).toBe('ftp://tmp/test');
    });

    it.fails('distinguishes incomplete special URLs from file URLs', () => {
      const { URL } = urlConstructors();

      expect(() => new URL('http:')).toThrow(TypeError);
      expect(() => new URL('http:///')).toThrow(TypeError);
      expect(new URL('file:').href).toBe('file:///');
      expect(new URL('file:///').href).toBe('file:///');
    });

    it.fails('preserves nulls but strips ASCII newlines in opaque URLs', () => {
      const { URL } = urlConstructors();
      const url = new URL(
        'scheme:pa\0\nth/to/fi\0\nle?qu\0\nery#ha\0\nsh',
      );

      expect(url.href)
        .toBe('scheme:pa%00th/to/fi%00le?qu%00ery#ha%00sh');
    });

    it.fails('derives only one level of a blob URL origin', () => {
      const { URL } = urlConstructors();

      expect(new URL('blob:http://foo.com/bar').origin)
        .toBe('http://foo.com');
      expect(new URL('blob:blob:http://foo.com/bar').origin).toBe('null');
    });

    it.fails('keeps a question mark after the fragment delimiter in the hash', () => {
      const { URL } = urlConstructors();
      const url = new URL('https://example.com/#ahash?asearch');

      expect(url.search).toBe('');
      expect(url.hash).toBe('#ahash?asearch');
    });

    it.fails('applies IDNA processing to non-ASCII hostnames', () => {
      const { URL } = urlConstructors();
      const url = new URL('http://sub2.ält.mochi.test:8888/foo');

      expect(url.hostname).toBe('sub2.xn--lt-uia.mochi.test');
    });

    it.fails('ignores an empty special hostname and supports port zero', () => {
      const { URL } = urlConstructors();
      const url = new URL('http://localhost:8080/');

      url.hostname = '';
      expect(url.hostname).toBe('localhost');

      url.port = '';
      expect(url.port).toBe('');
      url.port = '0';
      expect(url.port).toBe('0');
    });
  });
});
