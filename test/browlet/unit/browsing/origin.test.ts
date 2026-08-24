import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import {
  areSameOrigin, areSameOriginDomain, areSameSite,
  areSchemelesslySameSite, effectiveDomain, obtainSite,
  isRegistrableDomainSuffixOfOrEqualTo, serializeSite, sitesAreSameSite,
} from '../../../../src/browlet/browsing/origin';
import {
  hostsEqual, type Domain, type Host,
} from '../../../../src/url/host';
import {
  createOpaqueOrigin, type TupleOrigin,
} from '../../../../src/url/origin';

describe('origin comparisons', () => {
  it('compares opaque origins by identity', () => {
    const first = createOpaqueOrigin();
    const second = createOpaqueOrigin();

    expect(areSameOrigin(first, first)).toBe(true);
    expect(areSameOrigin(first, second)).toBe(false);
    expect(areSameOriginDomain(first, first)).toBe(true);
    expect(areSameOriginDomain(first, second)).toBe(false);
    expect(effectiveDomain(first)).toBeNull();
  });

  it('compares tuple origins structurally while ignoring domain', () => {
    const first = tupleOrigin('https', domain('example.com'), 443);
    const second = tupleOrigin('https', domain('example.com'), 443);
    second.domain = domain('example.com');

    expect(areSameOrigin(first, second)).toBe(true);
    expect(areSameOriginDomain(first, second)).toBe(false);
    expect(effectiveDomain(first)).toBe(first.host);
    expect(effectiveDomain(second)).toBe(second.domain);
  });

  it('compares relaxed origin domains independently of hosts and ports', () => {
    const first = tupleOrigin('https', domain('www.example.com'), 80);
    const second = tupleOrigin('https', domain('shop.example.com'), 443);
    first.domain = domain('example.com');
    second.domain = domain('example.com');

    expect(areSameOrigin(first, second)).toBe(false);
    expect(areSameOriginDomain(first, second)).toBe(true);
  });
});

describe('sites', () => {
  it('obtains and serializes a scheme-and-host site', () => {
    const site = obtainSite(
      tupleOrigin('https', domain('www.example.com'), 443),
    );

    expect(Array.isArray(site)).toBe(true);
    if (!Array.isArray(site)) throw new Error('Expected scheme-and-host site');
    expect(site[0]).toBe('https');
    expect(hostsEqual(site[1], domain('example.com'))).toBe(true);
    expect(serializeSite(site)).toBe('https://example.com');
  });

  it('compares distinct site tuples by their values', () => {
    const first = obtainSite(
      tupleOrigin('https', domain('www.example.com')),
    );
    const second = obtainSite(
      tupleOrigin('https', domain('shop.example.com')),
    );

    expect(sitesAreSameSite(first, second)).toBe(true);
  });

  it('distinguishes schemeful and schemeless same-site origins', () => {
    const secure = tupleOrigin('https', domain('www.example.com'));
    const insecure = tupleOrigin('http', domain('shop.example.com'));

    expect(areSchemelesslySameSite(secure, insecure)).toBe(true);
    expect(areSameSite(secure, insecure)).toBe(false);
  });
});

describe('relaxing the same-origin restriction', () => {
  it('recognizes a registrable domain suffix or equal host', () => {
    expect(isRegistrableDomainSuffixOfOrEqualTo(
      'example.com', domain('www.example.com'),
    )).toBe(true);
    expect(isRegistrableDomainSuffixOfOrEqualTo(
      'example.com', domain('example.com'),
    )).toBe(true);
  });

  it('rejects public suffixes and significant trailing-dot differences', () => {
    expect(isRegistrableDomainSuffixOfOrEqualTo(
      'com', domain('example.com'),
    )).toBe(false);
    expect(isRegistrableDomainSuffixOfOrEqualTo(
      'example.com', domain('example.com.'),
    )).toBe(false);
  });
});

describe('Origin interface', () => {
  it('constructs unique opaque origins', () => {
    const browlet = new Browlet({ route: () => '' });
    const Origin = getOriginConstructor(browlet.window);
    const first = new Origin();
    const second = new Origin();

    expect(first).toBeInstanceOf(Origin);
    expect(first.opaque).toBe(true);
    expect(first.isSameOrigin(first)).toBe(true);
    expect(first.isSameOrigin(second)).toBe(false);
  });

  it('creates origins from strings and URL platform objects', () => {
    const browlet = new Browlet({ route: () => '' });
    const Origin = getOriginConstructor(browlet.window);
    const URL = Reflect.get(browlet.window, 'URL') as typeof globalThis.URL;
    const fromString = Origin.from('https://www.example.com/path');
    const fromURL = Origin.from(new URL('https://www.example.com/elsewhere'));
    const sameSite = Origin.from('https://shop.example.com/');

    expect(fromString.opaque).toBe(false);
    expect(fromString.isSameOrigin(fromURL)).toBe(true);
    expect(fromString.isSameSite(sameSite)).toBe(true);
    expect(() => Origin.from({})).toThrow(TypeError);
  });
});

type OriginObject = {
  readonly opaque: boolean;
  isSameOrigin(other: OriginObject): boolean;
  isSameSite(other: OriginObject): boolean;
};

type OriginConstructor = {
  new(): OriginObject;
  from(value: unknown): OriginObject;
};

function getOriginConstructor(window: object): OriginConstructor {
  return Reflect.get(window, 'Origin') as OriginConstructor;
}

function domain(value: string): Domain {
  return { kind: 'domain', value };
}

function tupleOrigin(
  scheme: string,
  host: Host,
  port: number | null = null,
): TupleOrigin {
  return { domain: null, host, port, scheme, kind: 'tuple' };
}
