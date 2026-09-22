import { describe, expect, it } from 'vitest';
import { parseURL, serializeURL, stripURLForReporting } from '../../src/url/url';

describe('URL stripping for reports', () => {
  it.each(['http', 'https'])('preserves the %s host, port, path, and query without credentials or fragments', (scheme) => {
    const input = `${scheme}://user:password@example.test:8443/path?q=1#fragment`;
    const url = parseURL(input).url!;
    expect(stripURLForReporting(url)).toBe(`${scheme}://example.test:8443/path?q=1`);
    expect(serializeURL(url)).toBe(input);
  });

  it.each(['', '#', '#secret'])('omits a fragment delimiter for a URL ending in %s', (fragment) => {
    const input = `https://example.test/path${fragment}`;
    const url = parseURL(input).url!;
    expect(stripURLForReporting(url)).toBe('https://example.test/path');
    expect(serializeURL(url)).toBe(input);
  });

  it.each([
    ['about:blank', 'about'], ['data:,private', 'data'], ['blob:https://example.test/id', 'blob'],
    ['file:///private/path', 'file'], ['wss://user:password@example.test/socket#secret', 'wss'],
    ['custom:private#secret', 'custom'],
  ])('discloses only the scheme of %s', (input, expected) => {
    const url = parseURL(input).url!;
    expect(stripURLForReporting(url)).toBe(expected);
    expect(serializeURL(url)).toBe(input);
  });
});
