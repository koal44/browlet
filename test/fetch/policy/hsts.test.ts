import { describe, expect, it, vi } from 'vitest';
import { areSameOrigin } from '../../../src/url/origin';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../src/url/url';
import { createFetchRequest } from '../fetch-fixture';

describe('Fetch HSTS upgrading', () => {
  it.each([
    ['', ''], [':80', ''], [':443', ''], [':8080', ':8080'], [':8443', ':8443'], [':0', ':0'],
  ])('upgrades HTTP port %j to HTTPS port %j', (inputPort, outputPort) => {
    const request = createFetchRequest(`http://example.test${inputPort}/path?query#fragment`);
    request.userAgent.hstsStore.requiresHTTPS = () => true;
    request.upgradeForHSTS();
    const expected = `https://example.test${outputPort}/path?query#fragment`;
    expect(serializeURL(request.currentURL)).toBe(expected);
    expect(areSameOrigin(obtainURLOrigin(request.currentURL), obtainURLOrigin(parseURL(expected).url!))).toBe(true);
  });

  it('preserves credentials, path, query, and fragment when upgrading', () => {
    const request = createFetchRequest('http://name:secret@example.test/a%20b?x=1#section');
    request.userAgent.hstsStore.requiresHTTPS = () => true;
    request.upgradeForHSTS();
    expect(serializeURL(request.currentURL)).toBe('https://name:secret@example.test/a%20b?x=1#section');
  });

  it('leaves an unknown HTTP host unchanged', () => {
    const request = createFetchRequest('http://example.test/');
    const requiresHTTPS = vi.fn(() => false);
    request.userAgent.hstsStore.requiresHTTPS = requiresHTTPS;
    request.upgradeForHSTS();
    expect(requiresHTTPS).toHaveBeenCalledExactlyOnceWith(request.currentURL.host);
    expect(serializeURL(request.currentURL)).toBe('http://example.test/');
  });

  it('uses the current redirect URL without changing earlier history entries', () => {
    const request = createFetchRequest('http://first.test/start');
    request.urlList.push(parseURL('http://next.test/end').url!);
    const requiresHTTPS = vi.fn(() => true);
    request.userAgent.hstsStore.requiresHTTPS = requiresHTTPS;
    request.upgradeForHSTS();
    expect(requiresHTTPS).toHaveBeenCalledExactlyOnceWith(request.currentURL.host);
    expect(request.urlList.map((url) => serializeURL(url))).toEqual(['http://first.test/start', 'https://next.test/end']);
    request.upgradeForHSTS();
    expect(requiresHTTPS).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://example.test/', 'ftp://example.test/', 'ws://example.test/',
    'http://127.0.0.1/', 'http://[::1]/', 'data:text/plain,hello', 'blob:https://example.test/id',
    'http://localhost/', 'http://localhost./', 'http://sub.localhost/', 'http://sub.localhost./',
  ])('does not consult HSTS for a URL outside the Fetch upgrade step: %s', (url) => {
    const request = createFetchRequest(url);
    const requiresHTTPS = vi.fn(() => true);
    request.userAgent.hstsStore.requiresHTTPS = requiresHTTPS;
    request.upgradeForHSTS();
    expect(serializeURL(request.currentURL)).toBe(url);
    expect(requiresHTTPS).not.toHaveBeenCalled();
  });

  it.each(['http://notlocalhost/', 'http://localhost.example/', 'http://example.localhost.test/'])(
    'does not extend the localhost exception to other domains: %s', (url) => {
      const request = createFetchRequest(url);
      request.userAgent.hstsStore.requiresHTTPS = () => true;
      request.upgradeForHSTS();
      expect(request.currentURL.scheme).toBe('https');
    },
  );
});
