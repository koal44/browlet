import { afterEach, describe, expect, it, vi } from 'vitest';
import { HSTSPolicy, HSTSStore } from '../../../../src/browlet/browsing/policy/hsts';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchResponse } from '../../../../src/fetch/response';
import { FetchHeaders } from '../../../../src/fetch/headers';
import { FetchRequest } from '../../../../src/fetch/request';
import { parseURL, serializeURL } from '../../../../src/url/url';

describe('HSTS header parsing', () => {
  it.each([
    'max-age=31536000; includeSubDomains',
    'includeSubDomains; max-age=31536000',
    'MAX-AGE=31536000; INCLUDESUBDOMAINS',
    ' \tmax-age \t= \t"31536000" \t; includeSubDomains \t',
    ';; max-age=31536000;; includeSubDomains;;',
  ])('parses the required lifetime and optional subdomain flag: %s', (value) => {
    expect(HSTSPolicy.parse(value)).toEqual({ maxAge: 31536000n, includeSubDomains: true });
  });

  it('defaults to the exact host and recognizes removal', () => {
    expect(HSTSPolicy.parse('max-age=0')).toEqual({ maxAge: 0n, includeSubDomains: false });
    expect(HSTSPolicy.parse('max-age="00060"')).toEqual({ maxAge: 60n, includeSubDomains: false });
  });

  it('ignores well-formed extensions while honoring quotes and quoted pairs', () => {
    expect(HSTSPolicy.parse('preload; future="a;b=c, d\\"e\\\\f"; max-age="\\6\\0"'))
      .toEqual({ maxAge: 60n, includeSubDomains: false });
    expect(HSTSPolicy.parse('future=""; max-age=60; another=token'))
      .toEqual({ maxAge: 60n, includeSubDomains: false });
  });

  it('preserves very large decimal lifetimes without rounding or overflow', () => {
    const seconds = '9'.repeat(100);
    expect(HSTSPolicy.parse(`max-age=${seconds}`)?.maxAge).toBe(BigInt(seconds));
  });

  it.each(['', ' \t', '; ;', 'includeSubDomains', 'preload; future=60'])('requires max-age: %s', (value) => {
    expect(HSTSPolicy.parse(value)).toBeNull();
  });

  it.each([
    'max-age', 'max-age=', 'max-age=""', 'max-age=-1', 'max-age=+1',
    'max-age=1.5', 'max-age=1e3', 'max-age=0x10', 'max-age=Infinity',
    'max-age=" 60"', 'max-age="60 "', 'max-age="６０"',
    'max-age=60; max-age=60', 'max-age=60; MAX-AGE=0',
    'max-age=60; includeSubDomains; INCLUDESUBDOMAINS',
    'max-age=60; includeSubDomains=', 'max-age=60; includeSubDomains=""',
    'max-age=60; includeSubDomains=true',
  ])('rejects invalid or repeated recognized directives: %s', (value) => {
    expect(HSTSPolicy.parse(value)).toBeNull();
  });

  it.each([
    'max-age=60; future; future',
    'max-age=60; future=one; FUTURE=two',
    'max-age=0; preload; PRELOAD',
  ])('rejects the whole policy when an unknown directive repeats: %s', (value) => {
    expect(HSTSPolicy.parse(value)).toBeNull();
  });

  it.each([
    'max-age="60', 'max-age="60"garbage', 'max-age=60 includeSubDomains',
    'max-age=60, includeSubDomains', 'max-age=60, max-age=120',
    'max-age=60; future=', 'max-age=60; future==token',
    'max-age=60; future="unterminated', 'max-age=60; future="trailing\\',
    'max-age=60; future="closed"garbage', 'max-age=60; future=two tokens',
    'max-age=60; =token', 'max-age=60; futüre=value',
    'max-age=60; future="\x00"', 'max-age=60; future="\x7f"',
    'max-age=60; future="\u0100"', 'max-age=60; future="\r\n"', 'max-age=60; future="\\é"',
  ])('rejects malformed syntax even in ignored extensions: %s', (value) => {
    expect(HSTSPolicy.parse(value)).toBeNull();
  });
});

describe('HSTS remembered hosts', () => {
  it('learns on the receiving user agent and keeps agents independent', () => {
    const first = new UserAgent();
    const second = new UserAgent();
    first.hstsStore.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
    expect(first.hstsStore.hosts.get('example.test')).toEqual({ expiryTime: 61000n, includeSubDomains: true });
    expect(second.hstsStore.hosts.size).toBe(0);
  });

  it('refreshes expiry even when the directives are identical', () => {
    const store = new HSTSStore();
    const received = response('https://example.test/');
    store.processResponse(received, true, 1000);
    store.processResponse(received, true, 2000);
    expect(store.hosts.get('example.test')?.expiryTime).toBe(62000n);
  });

  it('replaces both lifetime and the subdomain flag', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
    store.processResponse(response('https://example.test/', ['max-age=120']), true, 2000);
    expect(store.hosts.get('example.test')).toEqual({ expiryTime: 122000n, includeSubDomains: false });
  });

  it('removes only the exact host on max-age=0, preserving parent and child entries', () => {
    const store = new HSTSStore();
    for (const host of ['example.test', 'sub.example.test', 'child.sub.example.test']) {
      store.processResponse(response(`https://${host}/`, ['max-age=60; includeSubDomains']), true, 1000);
    }
    store.processResponse(response('https://sub.example.test/', ['max-age=0; includeSubDomains']), true, 2000);
    expect([...store.hosts.keys()]).toEqual(['example.test', 'child.sub.example.test']);
    expect(store.hosts.get('example.test')).toEqual({ expiryTime: 61000n, includeSubDomains: true });
    store.processResponse(response('https://unknown.test/', ['max-age=0']), true, 2000);
    expect(store.hosts.size).toBe(2);
  });

  it('evicts all expired hosts while retaining policies whose expiry is not yet in the past', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://first.test/', ['max-age=1']), true, 1000);
    store.processResponse(response('https://second.test/', ['max-age=1']), true, 1000);
    store.processResponse(response('https://third.test/', ['max-age=2']), true, 1000);
    store.removeExpiredHosts(2000);
    expect(store.hosts.size).toBe(3);
    store.removeExpiredHosts(2001);
    expect([...store.hosts.keys()]).toEqual(['third.test']);
    store.removeExpiredHosts(3001);
    expect(store.hosts.size).toBe(0);
  });

  it('sweeps unrelated expired hosts at most once per minute while accepting policies', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://first.test/', ['max-age=1']), true, 1000);
    store.processResponse(response('https://second.test/', ['max-age=1']), true, 1000);
    const live = response('https://live.test/', ['max-age=120']);

    store.processResponse(live, true, 2001);
    expect([...store.hosts.keys()]).toEqual(['first.test', 'second.test', 'live.test']);
    store.processResponse(live, true, 60999);
    expect(store.hosts.size).toBe(3);
    store.processResponse(live, true, 61000);
    expect([...store.hosts.keys()]).toEqual(['live.test']);
    expect(store.hosts.get('live.test')?.expiryTime).toBe(181000n);
  });

  it('leaves due cleanup for the next valid policy when responses are ineligible', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://expired.test/', ['max-age=1']), true, 1000);

    store.processResponse(response('https://example.test/', []), true, 61000);
    store.processResponse(response('https://example.test/', ['max-age=invalid']), true, 61000);
    store.processResponse(response('http://example.test/'), true, 61000);
    store.processResponse(response('https://example.test/'), false, 61000);
    expect([...store.hosts.keys()]).toEqual(['expired.test']);

    store.processResponse(response('https://example.test/'), true, 61000);
    expect([...store.hosts.keys()]).toEqual(['example.test']);
  });

  it('ignores missing or malformed fields without clearing a remembered policy', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/'), true, 1000);
    store.processResponse(response('https://example.test/', []), true, 2000);
    store.processResponse(response('https://example.test/', ['max-age=invalid']), true, 3000);
    expect(store.hosts.get('example.test')).toEqual({ expiryTime: 61000n, includeSubDomains: false });
  });

  it('does not learn, refresh, or remove a policy containing duplicate extensions', () => {
    const store = new HSTSStore();
    const invalid = response('https://example.test/', ['max-age=120; future; FUTURE']);
    store.processResponse(invalid, true, 1000);
    expect(store.hosts.size).toBe(0);
    store.processResponse(response('https://example.test/'), true, 1000);
    store.processResponse(invalid, true, 2000);
    store.processResponse(response('https://example.test/', ['max-age=0; future; future']), true, 3000);
    expect(store.hosts.get('example.test')).toEqual({ expiryTime: 61000n, includeSubDomains: false });
  });

  it('uses only the first field, matching its name without regard to ASCII case', () => {
    const received = response('https://example.test/');
    received.headerList = new FetchHeaders([
      ['server', 'example'], ['Strict-Transport-Security', 'max-age=60'],
      ['strict-transport-security', 'max-age=0'],
    ]);
    const store = new HSTSStore();
    store.processResponse(received, true, 1000);
    expect(store.hosts.get('example.test')?.expiryTime).toBe(61000n);
  });

  it.each(['invalid', '', 'max-age=60, max-age=120'])(
    'does not fall back to a later valid field when the first is invalid: %s', (first) => {
      const store = new HSTSStore();
      store.processResponse(response('https://example.test/', [first, 'max-age=60']), true, 1000);
      expect(store.hosts.size).toBe(0);
    },
  );

  it.each([
    ['http://example.test/', false], ['http://localhost/', false],
    ['https://example.test/', false], ['https://localhost/', false],
    ['http://example.test/', true],
  ])('does not learn without HTTPS and verified TLS: %s, %s', (url, hasValidTLS) => {
    const store = new HSTSStore();
    store.processResponse(response(url), hasValidTLS, 1000);
    expect(store.hosts.size).toBe(0);
  });

  it('ignores attempts to remove a policy over insecure or unauthenticated transport', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/'), true, 1000);
    store.processResponse(response('http://example.test/', ['max-age=0']), false, 2000);
    store.processResponse(response('https://example.test/', ['max-age=0']), false, 2000);
    expect(store.hosts.get('example.test')?.expiryTime).toBe(61000n);
  });

  it.each(['https://127.0.0.1/', 'https://0x7f000001/', 'https://[::1]/', 'https://[::ffff:192.0.2.1]/'])(
    'does not remember an IP address: %s', (url) => {
      const store = new HSTSStore();
      store.processResponse(response(url), true, 1000);
      expect(store.hosts.size).toBe(0);
    },
  );

  it('ignores responses without a network URL', () => {
    const received = new FetchResponse();
    received.headerList.append('Strict-Transport-Security', 'max-age=60');
    const store = new HSTSStore();
    store.processResponse(received, true, 1000);
    expect(store.hosts.size).toBe(0);
  });

  it('uses URL canonicalization and shares state across ports, paths, and a trailing root dot', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://BÜCHER.example.:8443/first'), true, 1000);
    expect(store.hosts.get('xn--bcher-kva.example')?.expiryTime).toBe(61000n);
    store.processResponse(response('https://xn--bcher-kva.example/second', ['max-age=120']), true, 2000);
    expect(store.hosts.size).toBe(1);
    expect(store.hosts.get('xn--bcher-kva.example')?.expiryTime).toBe(122000n);
    store.processResponse(response('https://bücher.example.:9443/', ['max-age=0']), true, 3000);
    expect(store.hosts.size).toBe(0);
  });

  it('retains finite integer expiry even for lifetimes beyond numeric timestamp precision', () => {
    const store = new HSTSStore();
    const seconds = 10n ** 100n;
    store.processResponse(response('https://example.test/', [`max-age=${seconds}`]), true, 1000);
    expect(store.hosts.get('example.test')?.expiryTime).toBe(seconds * 1000n + 1000n);
    store.removeExpiredHosts(8.64e15);
    expect(store.hosts.size).toBe(1);
  });
});

describe('HSTS host matching', () => {
  it('protects the exact host without requiring includeSubDomains', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/'), true, 1000);
    expect(store.requiresHTTPS(parseURL('http://example.test:8080/other').url!.host, 2000)).toBe(true);
    expect(store.requiresHTTPS(parseURL('http://sub.example.test/').url!.host, 2000)).toBe(false);
  });

  it.each([
    ['example.test', true], ['sub.example.test', true], ['deep.sub.example.test', true],
    ['notexample.test', false], ['example.test.other', false], ['sibling.test', false], ['test', false],
  ])('matches %s at DNS label boundaries: %s', (domain, expected) => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
    expect(store.requiresHTTPS(parseURL(`http://${domain}/`).url!.host, 2000)).toBe(expected);
  });

  it('continues past a nearer ancestor that does not cover subdomains', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
    store.processResponse(response('https://sub.example.test/'), true, 1000);
    expect(store.requiresHTTPS(parseURL('http://deep.sub.example.test/').url!.host, 2000)).toBe(true);
  });

  it('keeps inherited protection after removing a child policy', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
    store.processResponse(response('https://sub.example.test/'), true, 1000);
    store.processResponse(response('https://sub.example.test/', ['max-age=0']), true, 2000);
    expect(store.requiresHTTPS(parseURL('http://sub.example.test/').url!.host, 2000)).toBe(true);
    expect(store.requiresHTTPS(parseURL('http://deep.sub.example.test/').url!.host, 2000)).toBe(true);
  });

  it('keeps inherited protection after a child or nearer ancestor expires', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
    store.processResponse(response('https://sub.example.test/', ['max-age=1; includeSubDomains']), true, 1000);
    expect(store.requiresHTTPS(parseURL('http://deep.sub.example.test/').url!.host, 2001)).toBe(true);
    expect(store.requiresHTTPS(parseURL('http://sub.example.test/').url!.host, 2001)).toBe(true);
    expect(store.hosts.has('sub.example.test')).toBe(false);
  });

  it('stops protecting hosts when the exact or inherited policy expires', () => {
    const store = new HSTSStore();
    store.processResponse(response('https://example.test/', ['max-age=1; includeSubDomains']), true, 1000);
    const exact = parseURL('http://example.test/').url!.host;
    const child = parseURL('http://sub.example.test/').url!.host;
    expect(store.requiresHTTPS(exact, 2000)).toBe(true);
    expect(store.requiresHTTPS(child, 2000)).toBe(true);
    expect(store.requiresHTTPS(child, 2001)).toBe(false);
    expect(store.requiresHTTPS(exact, 2001)).toBe(false);
    expect(store.hosts.size).toBe(0);
  });

  it.each(['BÜCHER.example', 'xn--bcher-kva.example.', 'sub.BÜCHER.example.', 'sub.xn--bcher-kva.example'])(
    'uses the URL parser\'s canonical domain and ignores the root dot: %s', (domain) => {
      const store = new HSTSStore();
      store.processResponse(response('https://bücher.example.:8443/', ['max-age=60; includeSubDomains']), true, 1000);
      expect(store.requiresHTTPS(parseURL(`http://${domain}/`).url!.host, 2000)).toBe(true);
    },
  );

  it('does not impose public-suffix boundaries or Fetch\'s localhost exception on the store', () => {
    const store = new HSTSStore();
    for (const domain of ['co.uk', 'localhost']) {
      store.processResponse(response(`https://${domain}/`, ['max-age=60; includeSubDomains']), true, 1000);
      expect(store.requiresHTTPS(parseURL(`http://child.${domain}/`).url!.host, 2000)).toBe(true);
    }
  });

  it.each(['http://127.0.0.1/', 'http://0x7f000001/', 'http://[::1]/', 'data:text/plain,hello', 'file:///path', 'custom://example.test/'])(
    'does not match an IP address, absent host, empty host, or opaque host: %s', (url) => {
      const store = new HSTSStore();
      store.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true, 1000);
      expect(store.requiresHTTPS(parseURL(url).url!.host, 2000)).toBe(false);
    },
  );
});

describe('HSTS browser and Fetch integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('upgrades clientless requests using their owning user agent\'s learned policy', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const owner = new UserAgent();
    const other = new UserAgent();
    owner.hstsStore.processResponse(response('https://example.test/', ['max-age=60; includeSubDomains']), true);
    const input = parseURL('http://sub.example.test:8080/path').url!;
    const request = new FetchRequest(input, null, owner);
    const independent = new FetchRequest(input, null, other);

    // Construction retains the original URL; main fetch must perform the upgrade.
    expect(request.currentURL.scheme).toBe('http');
    request.upgradeForHSTS();
    independent.upgradeForHSTS();
    expect(serializeURL(request.currentURL)).toBe('https://sub.example.test:8080/path');
    expect(serializeURL(independent.currentURL)).toBe('http://sub.example.test:8080/path');
    expect(input.scheme).toBe('http');
  });

  it('leaves HTTP requests unchanged after the learned policy expires', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const owner = new UserAgent();
    owner.hstsStore.processResponse(response('https://example.test/', ['max-age=1']), true);
    clock.mockReturnValue(2001);
    const request = new FetchRequest(parseURL('http://example.test/').url!, null, owner);
    request.upgradeForHSTS();
    expect(request.currentURL.scheme).toBe('http');
  });

  it('honors Fetch\'s localhost exception even when the store contains a matching policy', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const owner = new UserAgent();
    owner.hstsStore.processResponse(response('https://localhost/', ['max-age=60; includeSubDomains']), true);
    const request = new FetchRequest(parseURL('http://sub.localhost./').url!, null, owner);
    expect(owner.hstsStore.requiresHTTPS(request.currentURL.host)).toBe(true);
    request.upgradeForHSTS();
    expect(request.currentURL.scheme).toBe('http');
  });
});

function response(url: string, fields = ['max-age=60']): FetchResponse {
  const received = new FetchResponse();
  received.urlList = [parseURL(url).url!];
  for (const value of fields) received.headerList.append('strict-transport-security', value);
  return received;
}
