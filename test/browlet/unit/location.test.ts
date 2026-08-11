import { describe, expect, it } from 'vitest';

import { LocationImpl } from '../../../src/browlet/location';

describe('Location', () => {
  it('exposes URL components and stringification', () => {
    const location = new LocationImpl(
      new URL('https://example.test:8443/path?query#fragment'),
    );

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

  it('rejects navigation', () => {
    const location = new LocationImpl(new URL('https://example.test/'));

    expect(() => {
      location.href = 'https://example.test/next';
    }).toThrow('Browlet navigation is not implemented');
    expect(() => location.assign('/next'))
      .toThrow('Browlet navigation is not implemented');
  });
});
