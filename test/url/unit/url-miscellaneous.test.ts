import { describe, expect, it } from 'vitest';

import { urlAlgorithms } from './contract';

function serialize(input: string, base?: string): string | null {
  const result = urlAlgorithms().parseURL(input, base);
  return result.url === null ? null : urlAlgorithms().serializeURL(result.url);
}

describe('URL Standard sections 4.2 and 4.3: URL miscellaneous and writing', () => {
  for (const [input, output] of [
    ['ftp://example.org:21/', 'ftp://example.org/'],
    ['http://example.org:80/', 'http://example.org/'],
    ['https://example.org:443/', 'https://example.org/'],
    ['ws://example.org:80/', 'ws://example.org/'],
    ['wss://example.org:443/', 'wss://example.org/'],
    ['https://example.org:444/', 'https://example.org:444/'],
  ] as const) {
    it(`applies the default port for ${input}`, () => {
      expect(serialize(input)).toBe(output);
    });
  }

  for (const [input, output] of [
    ['https://example.org/a/./b', 'https://example.org/a/b'],
    ['https://example.org/a/%2e/b', 'https://example.org/a/b'],
    ['https://example.org/a/b/../c', 'https://example.org/a/c'],
    ['https://example.org/a/b/.%2e/c', 'https://example.org/a/c'],
    ['https://example.org/a/b/%2e./c', 'https://example.org/a/c'],
    ['https://example.org/a/b/%2e%2e/c', 'https://example.org/a/c'],
  ] as const) {
    it(`normalizes dot path segments in ${input}`, () => {
      expect(serialize(input)).toBe(output);
    });
  }

  for (const [input, output] of [
    ['https://user@example.org/', 'https://user@example.org/'],
    ['https://user:@example.org/', 'https://user@example.org/'],
    ['https://user:p@ss@example.org/', 'https://user:p%40ss@example.org/'],
    // A slash would end the authority before the later @. U+005B remains in
    // userinfo and therefore exercises the userinfo percent-encode set.
    ['https://a b:p[a@example.org/', 'https://a%20b:p%5Ba@example.org/'],
  ] as const) {
    it(`writes credentials from ${input}`, () => {
      expect(serialize(input)).toBe(output);
    });
  }

  it('normalizes a Windows drive letter separator', () => {
    expect(serialize('file:///C|/demo')).toBe('file:///C:/demo');
  });

  it('does not shorten a file URL past its drive letter', () => {
    expect(serialize('..', 'file:///C:/')).toBe('file:///C:/');
  });

  it('distinguishes opaque paths from hierarchical paths', () => {
    expect(serialize('urn:isbn:9780307476463'))
      .toBe('urn:isbn:9780307476463');
    expect(serialize('urn:/isbn:9780307476463'))
      .toBe('urn:/isbn:9780307476463');
  });

  it('encodes the path, query, and fragment with their respective sets', () => {
    expect(serialize('https://example.org/a b?q=a b#f g'))
      .toBe('https://example.org/a%20b?q=a%20b#f%20g');
  });

  it('uses the special query encode set only for special URLs', () => {
    expect(serialize("https://example.org/?q='"))
      .toBe('https://example.org/?q=%27');
    expect(serialize("custom:?q='"))
      .toBe("custom:?q='");
  });
});
