import { describe, expect, it } from 'vitest';

import { hostsEqual, parseHost } from '../../src/url/host';
import type { Domain, Host, TupleOrigin } from '../../src/url/core/index';
import {
  areSameOrigin, areSameOriginDomain, areSameSite,
  areSchemelesslySameSite, createOpaqueOrigin, effectiveDomain,
  isRegistrableDomainSuffixOfOrEqualTo, obtainSite, serializeOrigin, serializeSite,
  sitesAreSameSite,
} from '../../src/url/origin';

describe('origin comparisons', () => {
  it('compares opaque origins by identity', () => {
    const first = createOpaqueOrigin();
    const second = createOpaqueOrigin();
    const tuple = tupleOrigin('https', domain('example.com'));

    expect(areSameOrigin(first, first)).toBe(true);
    expect(areSameOrigin(first, second)).toBe(false);
    expect(areSameOriginDomain(first, first)).toBe(true);
    expect(areSameOriginDomain(first, second)).toBe(false);
    expect(areSameOrigin(first, tuple)).toBe(false);
    expect(areSameOrigin(tuple, first)).toBe(false);
    expect(areSameOriginDomain(first, tuple)).toBe(false);
    expect(areSameOriginDomain(tuple, first)).toBe(false);
    expect(effectiveDomain(first)).toBeNull();
  });

  it.each([
    ['equal tuples', tupleOrigin('https', domain('example.org')), true],
    ['different schemes', tupleOrigin('http', domain('example.org')), false],
    ['different hosts', tupleOrigin('https', domain('other.example.org')), false],
    ['different ports', tupleOrigin('https', domain('example.org'), 314), false],
  ] as const)('compares %s', (_case, other, same) => {
    const origin = tupleOrigin('https', domain('example.org'));

    expect(areSameOrigin(origin, other)).toBe(same);
    expect(areSameOriginDomain(origin, other)).toBe(same);
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

  it('requires matching schemes and domain overrides for relaxation', () => {
    const first = tupleOrigin('https', domain('www.example.com'), 314);
    const insecure = tupleOrigin('http', domain('www.example.com'), 314);
    const other = tupleOrigin('https', domain('www.example.com'), 314);
    first.domain = domain('example.com');
    insecure.domain = domain('example.com');
    other.domain = domain('www.example.com');

    expect(areSameOriginDomain(first, insecure)).toBe(false);
    expect(areSameOrigin(first, other)).toBe(true);
    expect(areSameOriginDomain(first, other)).toBe(false);
    other.domain = null;
    expect(areSameOriginDomain(first, other)).toBe(false);
    expect(areSameOriginDomain(other, first)).toBe(false);
  });

  for (const host of [
    { kind: 'ipv4', value: 0x7f000001 },
    { kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] },
  ] satisfies Host[]) {
    it(`accepts an ${host.kind} address as the domain override`, () => {
      const first = tupleOrigin('https', host, 314);
      const second = tupleOrigin('https', structuredClone(host), 420);
      first.domain = host;
      second.domain = structuredClone(host);

      expect(effectiveDomain(first)).toBe(host);
      expect(areSameOrigin(first, tupleOrigin('https', structuredClone(host), 314))).toBe(true);
      expect(areSameOrigin(first, second)).toBe(false);
      expect(areSameOriginDomain(first, second)).toBe(true);
    });
  }

  it('keeps opaque-origin trust separate from identity and serialization', () => {
    const untrusted = createOpaqueOrigin();
    const trusted = createOpaqueOrigin(true);

    expect(untrusted.potentiallyTrustworthy).toBe(false);
    expect(trusted.potentiallyTrustworthy).toBe(true);
    expect(areSameOrigin(trusted, createOpaqueOrigin(true))).toBe(false);
    expect(areSameOrigin(trusted, { ...trusted, potentiallyTrustworthy: false })).toBe(true);
    expect(areSameOriginDomain(trusted, untrusted)).toBe(false);
    expect(serializeOrigin(trusted)).toBe('null');
    expect(obtainSite(trusted)).toBe(trusted);
  });
});

describe('origin serialization', () => {
  for (const [host, port, expected] of [
    [domain('xn--maraa-rta.example'), null, 'https://xn--maraa-rta.example'],
    [domain('example.com.'), null, 'https://example.com.'],
    [domain('example.com'), 0, 'https://example.com:0'],
    [domain('example.com'), 443, 'https://example.com:443'],
    [{ kind: 'ipv4', value: 0x7f000001 }, 8443, 'https://127.0.0.1:8443'],
    [{ kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] }, null, 'https://[::1]'],
  ] satisfies [Host, number | null, string][]) {
    it(`serializes ${expected}`, () => {
      expect(serializeOrigin(tupleOrigin('https', host, port))).toBe(expected);
    });
  }

  it('serializes the host independently of the domain override', () => {
    const origin = tupleOrigin('https', domain('shop.example.com'), 314);
    origin.domain = domain('example.com');

    expect(serializeOrigin(origin)).toBe('https://shop.example.com:314');
  });
});

describe('sites', () => {
  it('preserves opaque identity despite the shared null serialization', () => {
    const first = createOpaqueOrigin();
    const second = createOpaqueOrigin();
    const tuple = tupleOrigin('https', domain('example.com'));
    const site = obtainSite(tuple);

    expect(obtainSite(first)).toBe(first);
    expect(serializeSite(first)).toBe('null');
    expect(serializeSite(second)).toBe('null');
    expect(sitesAreSameSite(first, { ...first })).toBe(true);
    expect(sitesAreSameSite(first, second)).toBe(false);
    expect(sitesAreSameSite(first, site)).toBe(false);
    expect(sitesAreSameSite(site, first)).toBe(false);
    expect(areSameSite(first, first)).toBe(true);
    expect(areSchemelesslySameSite(first, first)).toBe(true);
    for (const other of [second, tuple]) {
      expect(areSameSite(first, other)).toBe(false);
      expect(areSameSite(other, first)).toBe(false);
      expect(areSchemelesslySameSite(first, other)).toBe(false);
      expect(areSchemelesslySameSite(other, first)).toBe(false);
    }
  });

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

  for (const [host, expected] of [
    [domain('com'), 'https://com'],
    [domain('localhost'), 'https://localhost'],
    [{ kind: 'ipv4', value: 0x7f000001 }, 'https://127.0.0.1'],
    [{ kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] }, 'https://[::1]'],
  ] satisfies [Host, string][]) {
    it(`retains the host without a registrable domain: ${expected}`, () => {
      const origin = tupleOrigin('https', host, 314);
      const equivalent = tupleOrigin('https', structuredClone(host), 420);
      const site = obtainSite(origin);

      expect(site).toEqual(['https', host]);
      expect(serializeSite(site)).toBe(expected);
      expect(sitesAreSameSite(site, obtainSite(equivalent))).toBe(true);
      expect(areSchemelesslySameSite(origin, equivalent)).toBe(true);
    });
  }

  it('distinguishes schemeful and schemeless same-site origins', () => {
    const secure = tupleOrigin('https', domain('www.example.com'));
    const insecure = tupleOrigin('http', domain('shop.example.com'));

    expect(areSchemelesslySameSite(secure, insecure)).toBe(true);
    expect(areSameSite(secure, insecure)).toBe(false);
  });

  // HTML's table assumes wildlife.museum is a public suffix; github.io supplies that premise in our PSL.
  it.each([
    ['example.com', 'https', 'sub.example.com', true, true],
    ['example.com', 'https', 'sub.other.example.com', true, true],
    ['example.com', 'http', 'non-secure.example.com', true, false],
    ['r.github.io', 'https', 'sub.r.github.io', true, true],
    ['r.github.io', 'https', 'sub.other.r.github.io', true, true],
    ['r.github.io', 'https', 'other.github.io', false, false],
    ['r.github.io', 'https', 'github.io', false, false],
    ['github.io', 'https', 'github.io', true, true],
    ['example.com', 'https', 'example.com.', false, false],
  ] as const)('compares https://%s with %s://%s', (firstHost, scheme, secondHost, schemeless, same) => {
    const first = tupleOrigin('https', domain(firstHost));
    const second = tupleOrigin(scheme, domain(secondHost));

    expect(areSchemelesslySameSite(first, second)).toBe(schemeless);
    expect(areSameSite(first, second)).toBe(same);
  });

  it('ignores ports and domain overrides when comparing sites', () => {
    const first = tupleOrigin('https', domain('www.example.com'), 314);
    const second = tupleOrigin('https', domain('shop.example.com'), 420);
    first.domain = domain('example.com');
    second.domain = domain('shop.example.com');

    expect(areSameSite(first, second)).toBe(true);
    expect(areSchemelesslySameSite(first, second)).toBe(true);
  });
});

describe('relaxing the same-origin restriction', () => {
  it.each([
    ['0.0.0.0', '0.0.0.0', true], ['0x10203', '0.1.2.3', true],
    ['[0::1]', '[::1]', true], ['example.com', 'example.com', true],
    ['example.com', 'example.com.', false], ['example.com.', 'example.com', false],
    ['example.com', 'www.example.com', true], ['com', 'example.com', false],
    ['example', 'example', true],
    ['compute.amazonaws.com', 'example.compute.amazonaws.com', false],
    ['example.compute.amazonaws.com', 'www.example.compute.amazonaws.com', false],
    ['amazonaws.com', 'www.example.compute.amazonaws.com', false],
    ['amazonaws.com', 'test.amazonaws.com', true],
    ['', 'example.com', false], ['bad host', 'example.com', false],
    ['127.0.0.2', '127.0.0.1', false], ['[::2]', '[::1]', false],
    ['example.com', 'notexample.com', false], ['EXAMPLE.com', 'www.example.com', true],
    ['github.io', 'project.github.io', false], ['example.com.', 'www.example.com.', true],
  ])('checks %j against %j', (suffix, original, expected) => {
    expect(isRegistrableDomainSuffixOfOrEqualTo(suffix, parseHost(original).host!)).toBe(expected);
  });

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
