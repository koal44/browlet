import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';

describe('Location', () => {
  it('exposes URL components and stringification', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test:8443/path?query#fragment');
    const location = browser.window.location;

    expect(location.hash).toBe('#fragment');
    expect(location.host).toBe('example.test:8443');
    expect(location.hostname).toBe('example.test');
    expect(location.href).toBe(
      'https://example.test:8443/path?query#fragment',
    );
    expect(location.origin).toBe('https://example.test:8443');
    expect(location.pathname).toBe('/path');
    expect(location.port).toBe('8443');
    expect(location.protocol).toBe('https:');
    expect(location.search).toBe('?query');
    expect(String(location)).toBe(location.href);
  });

  it('leaves document-initiated navigation explicitly unfinished', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/current');
    const location = browser.window.location;

    expect(() => {
      location.href = 'https://example.test/next';
    }).toThrow('Document-initiated navigation is not implemented');
    expect(() => location.assign('/next'))
      .toThrow('Document-initiated navigation is not implemented');
  });
});
