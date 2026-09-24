import { describe, expect, it } from 'vitest';
import type { FetchEnvironment } from '../../src/fetch/environment';
import {
  isScriptLikeDestination, translatePotentialDestination, type Destination,
  type PotentialDestination, type FetchRequest,
} from '../../src/fetch/request';
import { createOpaqueOrigin } from '../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../src/url/url';
import { createBodyFixture, readBodyBytes } from './body-fixture';
import { createFetchRequest } from './fetch-fixture';
import { createClientEnvironment } from './client-fixture';

describe('Fetch request cloning', () => {
  it('copies owned data, retains owner references, and gives the clone a fresh WebDriver ID', () => {
    const client = createClientEnvironment();
    const request = createFetchRequest('https://[::1]/start', client);
    request.method = 'POST';
    request.credentialsMode = 'include';
    request.allowServiceWorkerInterception = false;
    request.initiator = 'prefetch';
    request.origin = obtainURLOrigin(request.url);
    request.policyContainer = client.policyContainer;
    request.reservedClient = {
      userAgent: client.userAgent, creationURL: request.url,
      topLevelOrigin: createOpaqueOrigin(), topLevelCreationURL: null,
    };
    request.referrer = parseURL('https://example.test/referrer').url!;
    request.headerList.list.push(['X-Test', 'first'], ['X-Test', 'second']);
    request.urlList.push(parseURL('https://example.test/end').url!);
    request.webTransportHashList.push({ algorithm: 'sha-256', value: Uint8Array.of(1) });
    request.navigationTimingAllowValuesList.push(['https://example.test']);
    const clone = request.clone();

    expect(clone).toEqual({ ...request, webDriverId: clone.webDriverId });
    expect(clone.webDriverId).not.toBe(request.webDriverId);
    expect(clone.body).toBeNull();
    expect(clone.client).toBe(request.client);
    expect(clone.userAgent).toBe(client.userAgent);
    expect(clone.origin).toBe(request.origin);
    expect(clone.policyContainer).toBe(request.policyContainer);
    expect(clone.reservedClient).toBe(request.reservedClient);
    expect(clone.referrer).not.toBe(request.referrer);

    clone.headerList.list[0]![1] = 'changed';
    clone.headerList.list.push(['X-New', 'new']);
    expect(request.headerList.list).toEqual([['X-Test', 'first'], ['X-Test', 'second']]);
    clone.currentURL.fragment = 'changed';
    if (!Array.isArray(clone.url.path) || clone.url.host?.kind !== 'ipv6') throw new Error('Expected IPv6 URL');
    clone.url.path.push('changed');
    clone.url.host.pieces[7] = 2;
    expect(request.url.path).toEqual(['start']);
    expect(request.url.host).toMatchObject({ pieces: [0, 0, 0, 0, 0, 0, 0, 1] });
    expect(request.currentURL.fragment).toBeNull();
    clone.webTransportHashList[0]!.value[0] = 2;
    clone.navigationTimingAllowValuesList[0]!.push('*');
    expect(request.webTransportHashList[0]!.value).toEqual(Uint8Array.of(1));
    expect(request.navigationTimingAllowValuesList).toEqual([['https://example.test']]);
  });

  it.each([undefined, null])('preserves the referrer state %s when cloning', (referrer) => {
    const request = createFetchRequest();
    request.referrer = referrer;
    expect(request.clone().referrer).toBe(referrer);
  });

  it('preserves the identity of a blob URL entry', () => {
    const request = createFetchRequest('blob:https://example.test/id');
    request.url.blobURLEntry = { env: { origin: createOpaqueOrigin() } };
    expect(request.clone().url.blobURLEntry).toBe(request.url.blobURLEntry);
  });

  it('copies a byte-sequence body before extraction', () => {
    const request = createFetchRequest();
    request.body = Uint8Array.of(9, 1, 2, 9).subarray(1, 3);
    const clone = request.clone();
    expect(clone.body).toEqual(Uint8Array.of(1, 2));
    request.body[0] = 8;
    expect(clone.body).toEqual(Uint8Array.of(1, 2));
  });

  it('copies bytes even when a Node buffer supplies the byte sequence', () => {
    const request = createFetchRequest();
    request.body = Buffer.from([1, 2]);
    request.webTransportHashList.push({ algorithm: 'sha-256', value: Buffer.from([3, 4]) });
    const clone = request.clone();
    request.body[0] = 8;
    request.webTransportHashList[0]!.value[0] = 9;
    expect(Array.from(clone.body as Uint8Array)).toEqual([1, 2]);
    expect(Array.from(clone.webTransportHashList[0]!.value)).toEqual([3, 4]);
  });

  it('tees an extracted body so both requests can consume it independently', async () => {
    const { createBody } = createBodyFixture();
    const request = createFetchRequest();
    request.body = createBody([Uint8Array.of(1, 2)]);
    request.body.stream.close();
    const originalStream = request.body.stream;
    const clone = request.clone();
    if (clone.body === null || clone.body instanceof Uint8Array) throw new Error('Expected extracted body');

    expect(clone.body).not.toBe(request.body);
    expect(request.body.stream).not.toBe(originalStream);
    expect(clone.body.stream).not.toBe(request.body.stream);
    const [originalBytes, clonedBytes] = await Promise.all([readBodyBytes(request.body), readBodyBytes(clone.body)]);
    expect(originalBytes).toEqual(Uint8Array.of(1, 2));
    expect(clonedBytes).toEqual(originalBytes);
    originalBytes[0] = 9;
    expect(clonedBytes).toEqual(Uint8Array.of(1, 2));
  });
});

describe('Fetch request User-Agent headers', () => {
  it('uses the client\'s effective value when inserting a missing header', () => {
    const client = createClientEnvironment();
    client.userAgent.webDriverBiDiEmulatedUserAgent = () => 'Emulated/1.0';
    const request = createFetchRequest(undefined, client);
    expect(request.headerList.has('User-Agent')).toBe(false);
    request.appendUserAgentHeader();
    expect(request.headerList.get('User-Agent')).toBe('Emulated/1.0');
    request.appendUserAgentHeader();
    expect(request.headerList.list).toEqual([['User-Agent', 'Emulated/1.0']]);
  });

  it('uses the owning user agent for a request without a client', () => {
    const request = createFetchRequest();
    request.userAgent.defaultUserAgentValue = 'BrowserInitiated/1.0';
    request.appendUserAgentHeader();
    expect(request.headerList.get('User-Agent')).toBe('BrowserInitiated/1.0');
  });

  it.each(['Explicit/1.0', ''])('preserves an existing header with value %j', (value) => {
    const request = createFetchRequest();
    request.headerList.append('user-agent', value);
    request.appendUserAgentHeader();
    expect(request.headerList.list).toEqual([['user-agent', value]]);
  });
});

describe('Fetch request Range headers', () => {
  it.each<[number | bigint, number | bigint | undefined, string]>([
    [0, undefined, 'bytes=0-'], [0, 0, 'bytes=0-0'], [1, 500, 'bytes=1-500'],
    [9007199254740993n, 9007199254740995n, 'bytes=9007199254740993-9007199254740995'],
  ])('adds the inclusive range %s through %s', (first, last, value) => {
    const request = createFetchRequest();
    request.addRangeHeader(first, last);
    expect(request.headerList.list).toEqual([['Range', value]]);
  });

  it('appends using header-list rules instead of replacing a previous range', () => {
    const request = createFetchRequest();
    request.headerList.list.push(['range', 'bytes=0-1']);
    request.addRangeHeader(2);
    expect(request.headerList.list).toEqual([['range', 'bytes=0-1'], ['range', 'bytes=2-']]);
  });

  it('rejects a reversed range before changing headers', () => {
    const request = createFetchRequest();
    expect(() => request.addRangeHeader(2, 1)).toThrow('Range start exceeds its end');
    expect(request.headerList.list).toEqual([]);
  });
});

describe('Fetch request classifications', () => {
  const classifications: Record<Destination, [boolean, boolean, boolean, boolean]> = {
    // Script-like destination, subresource, non-subresource, navigation.
    '': [false, true, false, false],
    audio: [false, true, false, false],
    audioworklet: [true, true, false, false],
    document: [false, false, true, true],
    embed: [false, false, true, true],
    font: [false, true, false, false],
    frame: [false, false, true, true],
    iframe: [false, false, true, true],
    image: [false, true, false, false],
    json: [false, true, false, false],
    manifest: [false, true, false, false],
    object: [false, false, true, true],
    paintworklet: [true, true, false, false],
    report: [false, false, true, false],
    script: [true, true, false, false],
    serviceworker: [true, false, true, false],
    sharedworker: [true, false, true, false],
    style: [false, true, false, false],
    text: [false, true, false, false],
    track: [false, true, false, false],
    video: [false, true, false, false],
    webidentity: [false, false, false, false],
    worker: [true, false, true, false],
    xslt: [false, true, false, false],
  };

  it.each(Object.keys(classifications) as Destination[])('classifies destination "%s"', (destination) => {
    const request = createFetchRequest();
    request.destination = destination;
    expect([
      isScriptLikeDestination(destination), request.isSubresource,
      request.isNonSubresource, request.isNavigation,
    ]).toEqual(classifications[destination]);
  });

  it('reads the current destination independently of request mode', () => {
    const request = createFetchRequest();
    request.mode = 'navigate';
    expect(request.isNavigation).toBe(false);
    request.destination = 'document';
    expect(request.isNavigation).toBe(true);
    expect(request.isSubresource).toBe(false);
    request.destination = '';
    expect(request.isNavigation).toBe(false);
    expect(request.isSubresource).toBe(true);
  });

  it.each(['fetch', ...Object.keys(classifications).filter((destination) => destination !== '')] as PotentialDestination[])(
    'translates the potential destination %s', (destination) => {
      expect(translatePotentialDestination(destination)).toBe(destination === 'fetch' ? '' : destination);
    },
  );
});

describe('Fetch request redirect-taint', () => {
  const a = 'https://a.example.test/';
  const b = 'https://b.example.test/';
  const outside = 'https://outside.test/';
  const elsewhere = 'https://elsewhere.test/';

  it.each<{ name: string; urls: [string, ...string[]]; taint: FetchRequest['redirectTaint']; }>([
    { name: 'a same-origin request without redirects', urls: [a], taint: 'same-origin' },
    { name: 'a cross-origin request without redirects', urls: [outside], taint: 'same-origin' },
    { name: 'a same-origin redirect', urls: [a, `${a}next`], taint: 'same-origin' },
    { name: 'the first redirect away from the request origin', urls: [a, outside], taint: 'same-origin' },
    { name: 'redirects within an initially foreign origin', urls: [outside, `${outside}next`], taint: 'same-origin' },
    { name: 'a return from a foreign site', urls: [a, outside, a], taint: 'cross-site' },
    { name: 'a redirect between foreign sites', urls: [outside, elsewhere], taint: 'cross-site' },
    { name: 'a return from a sibling subdomain', urls: [a, b, a], taint: 'same-site' },
    { name: 'same-site redirects foreign to the request', urls: [outside, 'https://sub.outside.test/'], taint: 'same-site' },
    { name: 'a port change and return', urls: [a, 'https://a.example.test:8443/', a], taint: 'same-site' },
    { name: 'a scheme change and return', urls: [a, 'http://a.example.test/', a], taint: 'cross-site' },
    { name: 'same-site taint retained after returning home', urls: [a, b, a, `${a}next`], taint: 'same-site' },
    { name: 'same-site taint escalating to cross-site', urls: [a, b, a, outside, a], taint: 'cross-site' },
    { name: 'origins obtained from blob URLs', urls: [a, 'blob:https://b.example.test/id', a], taint: 'same-site' },
  ])('$name', ({ urls, taint }) => {
    const request = createFetchRequest(urls[0]);
    request.origin = obtainURLOrigin(parseURL(a).url!);
    request.urlList.push(...urls.slice(1).map((url) => parseURL(url).url!));
    expect(request.redirectTaint).toBe(taint);
    expect(request.serializeOrigin()).toBe(taint === 'same-origin' ? 'https://a.example.test' : 'null');
  });

  it('uses the request origin, even when it differs from the first URL origin', () => {
    const request = createFetchRequest(outside);
    request.origin = obtainURLOrigin(parseURL(a).url!);
    request.urlList.push(parseURL(a).url!);
    expect(request.redirectTaint).toBe('cross-site');
  });

  it('recomputes from the URL list as redirects are appended', () => {
    const request = createFetchRequest(a);
    request.origin = obtainURLOrigin(request.url);
    expect(request.redirectTaint).toBe('same-origin');
    expect(request.serializeOrigin()).toBe('https://a.example.test');
    request.urlList.push(parseURL(b).url!);
    expect(request.redirectTaint).toBe('same-origin');
    request.urlList.push(parseURL(a).url!);
    expect(request.redirectTaint).toBe('same-site');
    expect(request.serializeOrigin()).toBe('null');
    request.urlList.push(parseURL(outside).url!, parseURL(a).url!);
    expect(request.redirectTaint).toBe('cross-site');
  });

  it('requires a concrete origin even without redirects', () => {
    const request = createFetchRequest(a);
    expect(() => request.redirectTaint).toThrow('Fetch request origin has not been resolved');
    expect(() => request.serializeOrigin()).toThrow('Fetch request origin has not been resolved');
    expect(() => request.byteSerializeOrigin()).toThrow('Fetch request origin has not been resolved');
  });
});

describe('Fetch request origin serialization', () => {
  it.each([
    ['https://user:pass@EXAMPLE.test:443/path?q=1#fragment', 'https://example.test'],
    ['https://example.test:8443/', 'https://example.test:8443'],
    ['https://bücher.example/', 'https://xn--bcher-kva.example'],
    ['http://[2001:db8::1]:8080/', 'http://[2001:db8::1]:8080'],
  ])('serializes %s as an ASCII origin and bytes', (url, expected) => {
    const request = createFetchRequest(url);
    request.origin = obtainURLOrigin(request.url);
    expect(request.serializeOrigin()).toBe(expected);
    expect(request.byteSerializeOrigin()).toEqual(Uint8Array.from(expected, (c) => c.charCodeAt(0)));
  });

  it('serializes an opaque request origin as "null", whether or not redirects taint it', () => {
    const request = createFetchRequest('https://example.test/');
    request.origin = createOpaqueOrigin();
    expect(request.redirectTaint).toBe('same-origin');
    expect(request.serializeOrigin()).toBe('null');
    expect(request.byteSerializeOrigin()).toEqual(Uint8Array.of(0x6e, 0x75, 0x6c, 0x6c));
    request.urlList.push(parseURL('https://example.test/next').url!);
    expect(request.redirectTaint).toBe('same-origin');
    request.urlList.push(parseURL('https://elsewhere.test/').url!);
    expect(request.redirectTaint).toBe('cross-site');
    expect(request.serializeOrigin()).toBe('null');
  });

  it('byte-serializes a tainted tuple origin as "null"', () => {
    const request = createFetchRequest('https://a.example.test/');
    request.origin = obtainURLOrigin(request.url);
    request.urlList.push(parseURL('https://b.example.test/').url!, request.url);
    expect(request.redirectTaint).toBe('same-site');
    expect(request.byteSerializeOrigin()).toEqual(Uint8Array.of(0x6e, 0x75, 0x6c, 0x6c));
  });
});

describe('Fetch request COEP credentials', () => {
  const home = 'https://a.example.test/';
  const foreign = 'https://outside.test/';
  const client = createClientEnvironment();
  client.policyContainer.embedderPolicy.value = 'credentialless';

  it.each<{ name: string; urls: [string, ...string[]]; allowed: boolean; }>([
    { name: 'same-origin without redirects', urls: [home], allowed: true },
    { name: 'cross-origin without redirects', urls: [foreign], allowed: false },
    { name: 'same-origin redirects', urls: [home, `${home}next`], allowed: true },
    { name: 'a redirect away from home', urls: [home, foreign], allowed: false },
    { name: 'a redirect from a foreign origin to home', urls: [foreign, home], allowed: false },
    { name: 'a foreign redirect and return home', urls: [home, foreign, home], allowed: false },
    { name: 'a same-site redirect and return home', urls: [home, 'https://b.example.test/', home], allowed: false },
    { name: 'a port change and return home', urls: [home, 'https://a.example.test:8443/', home], allowed: false },
  ])('$name: credentials allowed = $allowed', ({ urls, allowed }) => {
    const request = createFetchRequest(urls[0], client);
    request.origin = obtainURLOrigin(parseURL(home).url!);
    request.urlList.push(...urls.slice(1).map((url) => parseURL(url).url!));
    expect(request.crossOriginEmbedderPolicyAllowsCredentials()).toBe(allowed);
  });

  it.each<FetchRequest['mode']>([
    'cors', 'same-origin', 'navigate', 'websocket', 'webtransport',
  ])('does not restrict credentials in %s mode', (mode) => {
    const request = createFetchRequest(foreign, client);
    request.origin = obtainURLOrigin(parseURL(home).url!);
    request.mode = mode;
    expect(request.crossOriginEmbedderPolicyAllowsCredentials()).toBe(true);
  });

  it.each<FetchEnvironment['policyContainer']['embedderPolicy']['value']>([
    'unsafe-none', 'require-corp',
  ])('does not restrict credentials under %s', (value) => {
    const request = createFetchRequest(foreign, {
      ...client, policyContainer: {
        ...client.policyContainer, embedderPolicy: { ...client.policyContainer.embedderPolicy, value },
      },
    });
    request.origin = obtainURLOrigin(parseURL(home).url!);
    expect(request.crossOriginEmbedderPolicyAllowsCredentials()).toBe(true);
  });

  it('does not restrict a clientless request', () => {
    const request = createFetchRequest(foreign);
    request.origin = obtainURLOrigin(parseURL(home).url!);
    expect(request.crossOriginEmbedderPolicyAllowsCredentials()).toBe(true);
  });

  it('does not treat an opaque request origin as same-origin with the URL', () => {
    const request = createFetchRequest(home, client);
    request.origin = createOpaqueOrigin();
    expect(request.crossOriginEmbedderPolicyAllowsCredentials()).toBe(false);
  });

  it('requires a concrete origin before checking policy', () => {
    const request = createFetchRequest(home);
    expect(() => request.crossOriginEmbedderPolicyAllowsCredentials()).toThrow(
      'Fetch request origin has not been resolved',
    );
  });
});

describe('Fetch client population', () => {
  it('retains explicitly supplied fields', () => {
    const client = createClientEnvironment();
    const request = createFetchRequest('https://example.test/', client);
    const origin = createOpaqueOrigin();
    const policy = createClientEnvironment().policyContainer;
    request.traversableForUserPrompts = null;
    request.origin = origin;
    request.policyContainer = policy;
    request.populateFromClient();
    expect(request.traversableForUserPrompts).toBeNull();
    expect(request.origin).toBe(origin);
    expect(request.policyContainer).toBe(policy);
  });

  it('resolves the origin once instead of following later client changes', () => {
    const client = createClientEnvironment();
    const request = createFetchRequest('https://example.test/', client);
    const origin = client.origin;
    request.traversableForUserPrompts = null;
    request.policyContainer = client.policyContainer;
    request.populateFromClient();
    expect(request.origin).toBe(origin);
    client.origin = createOpaqueOrigin();
    request.populateFromClient();
    expect(request.origin).toBe(origin);
  });

  it('requires an explicit origin for a clientless request', () => {
    const request = createFetchRequest();
    request.traversableForUserPrompts = null;
    expect(() => request.populateFromClient()).toThrow('An unresolved request origin requires a client');
  });
});
