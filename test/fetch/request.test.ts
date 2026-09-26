import { describe, expect, it } from 'vitest';
import { FetchHeaders } from '../../src/fetch/headers';
import {
  isScriptLikeDestination, translatePotentialDestination, type Destination,
  type PotentialDestination, FetchRequest,
} from '../../src/fetch/request';
import { createOpaqueOrigin } from '../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../src/url/url';
import { createBodyFixture, readBodyBytes } from './body-fixture';
import { createFetchFixture, createFetchRequest } from './fetch-fixture';
import { createClientEnvironment, createFetchUserAgent } from './client-fixture';

describe('Fetch request state', () => {
  it('starts a request with the §2.2.5 defaults and retains its supplied client', () => {
    const client = createClientEnvironment();
    const request = createFetchRequest(undefined, client);
    expect(request).toMatchObject({
      method: 'GET', localURLsOnly: false, headerList: new FetchHeaders(), unsafeRequest: false, body: null,
      client, reservedClient: null, replacesClientId: '', traversableForUserPrompts: undefined,
      keepalive: false, initiatorType: null, allowServiceWorkerInterception: true, initiator: '', destination: '',
      priority: 'auto', internalPriority: null, origin: undefined, topLevelNavigationInitiatorOrigin: null,
      policyContainer: undefined, referrer: undefined, referrerPolicy: '', mode: 'no-cors',
      useCORSPreflight: false, credentialsMode: 'same-origin', useURLCredentials: false,
      cacheMode: 'default', redirectMode: 'follow', integrityMetadata: '', cryptographicNonceMetadata: '',
      parserInserted: undefined, reloadNavigation: false, historyNavigation: false, userActivation: false,
      webDriverNavigationId: null, renderBlocking: false, webTransportHashList: [], redirectCount: 0,
      responseTainting: 'basic', preventNoCacheCacheControlHeaderModification: false, done: false,
      timingAllowFailed: false, navigationTimingAllowValuesList: [],
    });
    expect(request.client).toBe(client);
    expect(request.userAgent).toBe(client.userAgent);
    expect(request.urlList).toHaveLength(1);
    expect(request.url).toBe(request.currentURL);
    expect(request.webDriverId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });

  it('keeps URL/current URL as live pointers and copies the initial URL components', () => {
    const url = parseURL('https://[::1]/start#fragment').url!;
    const userAgent = createFetchUserAgent();
    const request = new FetchRequest(url, null, userAgent);
    expect(request.userAgent).toBe(userAgent);
    expect(request.url).toEqual(url);
    expect(request.url).not.toBe(url);
    expect(request.url.path).not.toBe(url.path);
    expect(request.url.host).not.toBe(url.host);
    if (url.host?.kind !== 'ipv6' || request.url.host?.kind !== 'ipv6') throw new Error('Expected IPv6');
    expect(request.url.host.pieces).not.toBe(url.host.pieces);

    const redirect = parseURL('https://example.test/redirect').url!;
    request.urlList.push(redirect);
    expect(request.url).toBe(request.urlList[0]);
    expect(request.currentURL).toBe(redirect);
    expect(request.url.fragment).toBe('fragment');
    expect(request.webDriverId).not.toBe(createFetchRequest().webDriverId);
  });

  it('does not share mutable defaults between independent requests', () => {
    const request = createFetchRequest();
    request.headerList.list.push(['X-Example', 'one']);
    request.webTransportHashList.push({ algorithm: 'sha-256', value: Uint8Array.of(1) });
    request.navigationTimingAllowValuesList.push(['*']);
    expect(createFetchRequest()).toMatchObject({ headerList: new FetchHeaders(), webTransportHashList: [], navigationTimingAllowValuesList: [] });
  });
});

describe('Request implementation state', () => {
  it('retains the same request, signal, and duplicate-preserving Headers list', () => {
    const fixture = createFetchFixture();
    const record = createFetchRequest();
    const signal = fixture.env.exec.createAbortController().signal;
    const request = fixture.createRequest(record, signal);
    expect(request.getRequest()).toBe(record);
    expect(request.signal).toBe(signal);
    expect(request.headers).toBe(request.headers);
    expect(request.headers.headerList).toBe(record.headerList);
    expect(request.headers.guard).toBe('request');
    record.headerList.list.push(['X-Example', 'first'], ['X-Example', 'second']);
    expect(request.headers.headerList.list).toEqual([['X-Example', 'first'], ['X-Example', 'second']]);
    record.method = 'POST';
    expect(request.method).toBe('POST');
    expect(request.referrer).toBe('about:client');
    record.referrer = null;
    expect(request.referrer).toBe('');
    expect(request.body).toBeNull();
    expect(request.bodyUsed).toBe(false);
    record.body = fixture.createBody();
    expect(request.body).toBe(record.body.stream);
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
    const reservedOrigin = createOpaqueOrigin();
    request.reservedClient = {
      userAgent: client.userAgent, creationURL: request.url,
      topLevelOrigin: reservedOrigin, topLevelCreationURL: null,
      determineNetworkPartitionKey: () => [reservedOrigin, null],
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
