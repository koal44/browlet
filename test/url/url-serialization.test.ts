import { describe, expect, it } from 'vitest';

import { urlAlgorithms } from './contract';

function parse(input: string) {
  const result = urlAlgorithms().parseURL(input);
  expect(result.url).not.toBeNull();
  return result.url!;
}

describe('URL Standard sections 4.5 through 4.7', () => {
  it('serializes credentials, host, port, path, query, and fragment', () => {
    const url = parse('https://user:password@example.org:8443/a/b?q=x#fragment');

    expect(urlAlgorithms().serializeURL(url))
      .toBe('https://user:password@example.org:8443/a/b?q=x#fragment');
  });

  it('can exclude the fragment during serialization', () => {
    const url = parse('https://example.org/a?q=x#fragment');

    expect(urlAlgorithms().serializeURL(url, true))
      .toBe('https://example.org/a?q=x');
  });

  it('preserves empty query and fragment markers', () => {
    expect(urlAlgorithms().serializeURL(parse('https://example.org/?#')))
      .toBe('https://example.org/?#');
  });

  it('protects a hostless path beginning with an empty segment', () => {
    expect(urlAlgorithms().serializeURL(parse('web+demo:/.//not-a-host/')))
      .toBe('web+demo:/.//not-a-host/');
  });

  it('omits default ports established during parsing', () => {
    expect(urlAlgorithms().serializeURL(parse('http://example.org:80/')))
      .toBe('http://example.org/');
    expect(urlAlgorithms().serializeURL(parse('https://example.org:443/')))
      .toBe('https://example.org/');
  });

  it('compares URLs by serialization', () => {
    const first = parse('https://EXAMPLE.org:443/a/../b#one');
    const second = parse('https://example.org/b#one');

    expect(urlAlgorithms().urlsEqual(first, second)).toBe(true);
  });

  it('can exclude fragments from URL equality', () => {
    const first = parse('https://example.org/#one');
    const second = parse('https://example.org/#two');

    expect(urlAlgorithms().urlsEqual(first, second)).toBe(false);
    expect(urlAlgorithms().urlsEqual(first, second, true)).toBe(true);
  });

  for (const [input, origin] of [
    ['http://example.org/', 'http://example.org'],
    ['https://example.org:8443/', 'https://example.org:8443'],
    ['ws://example.org/', 'ws://example.org'],
    ['wss://example.org/', 'wss://example.org'],
    ['ftp://example.org/', 'ftp://example.org'],
    [
      'blob:https://whatwg.org/d0360e2f-caee-469f-9a2f-87d5b0456f6f',
      'https://whatwg.org',
    ],
    ['mailto:user@example.org', 'null'],
  ] as const) {
    it(`obtains and serializes the origin of ${input}`, () => {
      const url = parse(input);
      const value = urlAlgorithms().obtainOrigin(url);

      expect(urlAlgorithms().serializeOrigin(value)).toBe(origin);
    });
  }

  it('returns a fresh opaque origin for each non-tuple URL origin', () => {
    const first = urlAlgorithms().obtainOrigin(parse('mailto:first@example.org'));
    const second = urlAlgorithms().obtainOrigin(parse('mailto:second@example.org'));

    expect(first.kind).toBe('opaque');
    expect(second.kind).toBe('opaque');
    expect(first).not.toBe(second);
  });

  it('uses an opaque origin for file URLs', () => {
    const origin = urlAlgorithms().obtainOrigin(parse('file:///C:/example.txt'));

    expect(origin.kind).toBe('opaque');
    expect(urlAlgorithms().serializeOrigin(origin)).toBe('null');
  });

  it('does not recursively derive a tuple origin from a nested blob URL', () => {
    const origin = urlAlgorithms().obtainOrigin(
      parse('blob:blob:https://example.org/id'),
    );

    expect(origin.kind).toBe('opaque');
  });

  it('uses the environment origin cached by a blob URL entry', () => {
    const environmentOrigin = urlAlgorithms()
      .obtainOrigin(parse('https://example.org/'));
    const blobURL = parse('blob:https://discarded.example/id');
    blobURL.blobURLEntry = { environment: { origin: environmentOrigin } };

    expect(urlAlgorithms().obtainOrigin(blobURL)).toBe(environmentOrigin);
  });
});
