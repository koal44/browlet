import { describe, expect, it } from 'vitest';
import { isFetchScheme, isHTTPScheme, isLocalScheme, isLocalURL } from '../../src/fetch/url';
import { parseURL } from '../../src/url/url';

describe('Fetch URL classifications', () => {
  it.each([
    ['about', true, false, true],
    ['blob', true, false, true],
    ['data', true, false, true],
    ['file', false, false, true],
    ['http', false, true, true],
    ['https', false, true, true],
    ['ftp', false, false, false],
    ['ws', false, false, false],
    ['wss', false, false, false],
    ['javascript', false, false, false],
    ['custom', false, false, false],
  ] as const)('classifies the %s scheme', (scheme, local, http, fetch) => {
    expect(isLocalScheme(scheme)).toBe(local);
    expect(isHTTPScheme(scheme)).toBe(http);
    expect(isFetchScheme(scheme)).toBe(fetch);
  });

  it.each([
    ['ABOUT:blank', true], ['data:text/plain,hello', true],
    ['blob:https://example.test/id', true], ['file:///hello.txt', false],
    ['https://example.test/', false],
  ] as const)('classifies a parsed URL %s', (input, local) => {
    expect(isLocalURL(parseURL(input).url!)).toBe(local);
  });
});
