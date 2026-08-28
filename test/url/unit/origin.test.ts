import { describe, expect, it } from 'vitest';

import { hostsEqual, type Domain, type Host } from '../../../src/url/host';
import { OriginImpl } from '../../../src/url/origin-api';
import {
  areSameOrigin, areSameOriginDomain, areSameSite,
  areSchemelesslySameSite, createOpaqueOrigin, effectiveDomain,
  isRegistrableDomainSuffixOfOrEqualTo, obtainSite, serializeSite,
  sitesAreSameSite, type TupleOrigin,
} from '../../../src/url/origin';

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

describe('Origin implementation', () => {
  it('constructs and copies semantic origins without Web IDL', () => {
    const first = OriginImpl.from('https://www.example.com/path');
    const second = OriginImpl.from(first);

    expect(first.opaque).toBe(false);
    expect(first.isSameOrigin(second)).toBe(true);
    expect(() => OriginImpl.from({})).toThrow(TypeError);
  });
});

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
