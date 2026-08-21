import { describe, expect, it } from 'vitest';

import {
  parseURL, serializeURL, setURLPassword, setURLUsername,
} from '../../../src/url/url';
import { urlAlgorithms, type URLSnapshot } from './contract';

type ParseCase = {
  input: string;
  base?: string;
  output: string | null;
};

const parsingExamples: ParseCase[] = [
  { input: 'https:example.org', output: 'https://example.org/' },
  { input: 'https://////example.com///', output: 'https://example.com///' },
  { input: 'https://example.com/././foo', output: 'https://example.com/foo' },
  { input: 'hello:world', base: 'https://example.com/', output: 'hello:world' },
  {
    input: 'https:example.org',
    base: 'https://example.com/',
    output: 'https://example.com/example.org',
  },
  {
    input: '\\example\\..\\demo/.\\',
    base: 'https://example.com/',
    output: 'https://example.com/demo/',
  },
  {
    input: 'example',
    base: 'https://example.com/demo',
    output: 'https://example.com/example',
  },
  { input: 'file:///C|/demo', output: 'file:///C:/demo' },
  { input: '..', base: 'file:///C:/demo', output: 'file:///C:/' },
  { input: 'file://localhost/', output: 'file:///' },
  { input: 'file://loc%61lhost/', output: 'file:///' },
  {
    input: 'https://user:password@example.org/',
    output: 'https://user:password@example.org/',
  },
  { input: 'https://example.org/foo bar', output: 'https://example.org/foo%20bar' },
  { input: 'https://EXAMPLE.com/../x', output: 'https://example.com/x' },
  { input: 'https://a b:p/a@example.org/', output: null },
  { input: 'https://ex ample.org/', output: null },
  { input: 'example', output: null },
  { input: 'https://example.com:demo', output: null },
  { input: 'http://[www.example.com]/', output: null },
  { input: 'https://example.org//', output: 'https://example.org//' },
  {
    input: 'https://example.com/[]?[]#[]',
    output: 'https://example.com/[]?[]#[]',
  },
  { input: 'https://example/%?%#%', output: 'https://example/%?%#%' },
  { input: 'https://example/%25?%25#%25', output: 'https://example/%25?%25#%25' },
];

describe('URL Standard section 4.4: URL parsing', () => {
  for (const test of parsingExamples) {
    it(`parses ${JSON.stringify(test.input)} against ${JSON.stringify(test.base)}`, () => {
      const result = urlAlgorithms().parseURL(test.input, test.base);

      expect(result.url === null ? null : urlAlgorithms().serializeURL(result.url))
        .toBe(test.output);
    });
  }

  for (const [input, output, error] of [
    [' https://example.org ', 'https://example.org/', 'invalid-URL-unit'],
    ['ht\ntps://example.org', 'https://example.org/', 'invalid-URL-unit'],
    ['https://example.org/%s', 'https://example.org/%s', 'invalid-URL-unit'],
    [
      'https://example.org\\path\\to\\file',
      'https://example.org/path/to/file',
      'invalid-reverse-solidus',
    ],
    [
      'https://user@example.org',
      'https://user@example.org/',
      'invalid-credentials',
    ],
    [
      'https:example.org',
      'https://example.org/',
      'special-scheme-missing-following-solidus',
    ],
    [
      'file:c:/my-secret-folder',
      'file:///c:/my-secret-folder',
      'special-scheme-missing-following-solidus',
    ],
    [
      'file://c:',
      'file:///c:',
      'file-invalid-Windows-drive-letter-host',
    ],
  ] as const) {
    it(`reports recoverable validation error ${error}`, () => {
      const result = urlAlgorithms().parseURL(input);

      expect(result.url === null ? null : urlAlgorithms().serializeURL(result.url))
        .toBe(output);
      expect(result.validationErrors).toContain(error);
    });
  }

  it('reports a relative Windows drive letter against a file base', () => {
    const result = urlAlgorithms().parseURL(
      'c|/path/to/file',
      'file:///c:/',
    );

    expect(result.url === null ? null : urlAlgorithms().serializeURL(result.url))
      .toBe('file:///c:/path/to/file');
    expect(result.validationErrors)
      .toContain('file-invalid-Windows-drive-letter');
  });

  it('accepts a normalized drive letter after a leading slash', () => {
    const result = urlAlgorithms().parseURL(
      '/c:/path/to/file',
      'file:///c:/',
    );

    expect(result.url === null ? null : urlAlgorithms().serializeURL(result.url))
      .toBe('file:///c:/path/to/file');
    expect(result.validationErrors)
      .not.toContain('file-invalid-Windows-drive-letter');
  });

  for (const [input, error] of [
    ['💩', 'missing-scheme-non-relative-URL'],
    ['https://#fragment', 'host-missing'],
    ['https://:443', 'host-missing'],
    ['https://user:pass@', 'host-missing'],
    ['https://example.org:70000', 'port-out-of-range'],
    ['https://example.org:7z', 'port-invalid'],
  ] as const) {
    it(`fails with validation error ${error}`, () => {
      const result = urlAlgorithms().parseURL(input);

      expect(result.url).toBeNull();
      expect(result.validationErrors).toContain(error);
    });
  }

  it('sets username and password with the userinfo percent-encode set', () => {
    const url = parseURL('https://example.org/').url!;

    setURLUsername(url, 'a b');
    setURLPassword(url, 'p/ss');

    expect(serializeURL(url)).toBe('https://a%20b:p%2Fss@example.org/');
  });
});

describe('URL Standard section 4.1: URL record components', () => {
  for (const [input, snapshot] of [
    [
      'https://example.com/',
      {
        scheme: 'https', username: '', password: '', host: 'example.com',
        port: null, path: [''], query: null, fragment: null,
      },
    ],
    [
      'https://localhost:8000/search?q=text#hello',
      {
        scheme: 'https', username: '', password: '', host: 'localhost',
        port: 8000, path: ['search'], query: 'q=text', fragment: 'hello',
      },
    ],
    [
      'urn:isbn:9780307476463',
      {
        scheme: 'urn', username: '', password: '', host: null,
        port: null, path: 'isbn:9780307476463', query: null, fragment: null,
      },
    ],
    [
      'file:///ada/Analytical%20Engine/README.md',
      {
        scheme: 'file', username: '', password: '', host: '', port: null,
        path: ['ada', 'Analytical%20Engine', 'README.md'],
        query: null, fragment: null,
      },
    ],
  ] as const satisfies readonly (readonly [string, URLSnapshot])[]) {
    it(`represents the components of ${input}`, () => {
      const result = urlAlgorithms().parseURL(input);

      expect(result.url).not.toBeNull();
      expect(urlAlgorithms().inspectURL(result.url!)).toEqual(snapshot);
    });
  }
});
