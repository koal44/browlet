import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

describe('Browlet URL bindings', () => {
  it('installs realm-specific URL initial objects and the legacy alias', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const URL_ = getConstructor(first, 'URL') as unknown as typeof URL;
    const URLSearchParams_ = getConstructor(
      first,
      'URLSearchParams',
    ) as unknown as typeof URLSearchParams;
    const url = new URL_('child', 'https://example.test/base/');

    expect(URL_).not.toBe(URL);
    expect(URL_).not.toBe(getConstructor(second, 'URL'));
    expect(Reflect.get(first.window, 'webkitURL')).toBe(URL_);
    expect(url).toBeInstanceOf(URL_);
    expect(url.searchParams).toBeInstanceOf(URLSearchParams_);
    expect(url.href).toBe('https://example.test/base/child');
  });

  it('projects URL operations through Web IDL conversion', () => {
    const browlet = new Browlet({ route: () => '' });
    const URL_ = getConstructor(browlet, 'URL') as unknown as typeof URL;
    const URLSearchParams_ = getConstructor(
      browlet,
      'URLSearchParams',
    ) as unknown as typeof URLSearchParams;
    const url = URL_.parse('path', 'https://example.test/root/');
    const params = new URLSearchParams_({ '\uD835x': 1, '\uD83Dx': 2 } as
      unknown as Record<string, string>);

    expect(url?.href).toBe('https://example.test/root/path');
    expect(URL_.canParse('/relative')).toBe(false);
    expect([...params]).toEqual([['�x', '2']]);
    expect(String(params)).toBe('%EF%BF%BDx=2');
  });

  it('keeps the same projected searchParams object while URLs mutate', () => {
    const browlet = new Browlet({ route: () => '' });
    const URL_ = getConstructor(browlet, 'URL') as unknown as typeof URL;
    const url = new URL_('https://example.test/?a=1');
    const params = url.searchParams;

    params.append('b', '2');
    url.search = '?c=3';

    expect(url.searchParams).toBe(params);
    expect([...params]).toEqual([['c', '3']]);
    expect(url.href).toBe('https://example.test/?c=3');
  });
});

function getConstructor(browlet: Browlet, name: string): CallableFunction {
  const constructor: unknown = Reflect.get(browlet.window, name);
  if (typeof constructor !== 'function') {
    throw new Error(`${name} was not exposed`);
  }
  return constructor;
}
