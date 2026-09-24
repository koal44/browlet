import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { CSPList } from '../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../src/browlet/browsing/policy/csp/policy';
import { FetchBody } from '../../src/fetch/body';
import { fetch } from '../../src/fetch/fetch';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest, type Destination } from '../../src/fetch/request';
import { FetchResponse, isFilteredResponse } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { ReadableStreamImpl } from '../../src/streams/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../src/url/url';

afterEach(() => vi.restoreAllMocks());

describe('Fetch entry', () => {
  it('populates the request, tracks its controller, and delivers a preload on the running Window loop', async () => {
    const { env, request, preload, agent } = await createFixture();
    const raw = new FetchResponse();
    preload.mockImplementation((_url, _destination, _mode, _credentials, _integrity, available) => {
      available(raw);
      return true;
    });
    const end = Promise.withResolvers<void>();
    const response = vi.fn<(response: FetchResponse) => void>();
    const controller = fetch(request, {
      processResponse: response,
      processResponseEndOfBody: () => end.resolve(),
    }, env);
    expect(response).not.toHaveBeenCalled();
    expect(request.origin).toBe(env.origin);
    expect(request.policyContainer).not.toBe(env.policyContainer);
    expect(env.fetchGroup.fetchRecords).toContainEqual({ request, controller });
    expect(preload).toHaveBeenCalledOnce();
    expect(agent.webDriverBiDiCloneNetworkRequestBody).toHaveBeenCalledExactlyOnceWith(request);
    expect(request.headerList.get('Accept')).toBe('*/*');
    expect(request.headerList.get('Accept-Language')).toBe('en');
    await end.promise;
    const delivered = response.mock.calls[0]![0];
    expect(delivered.type).toBe('basic');
    expect(isFilteredResponse(delivered) && delivered.internalResponse).toBe(raw);
    expect(request.done).toBe(true);
  });

  it.each([
    ['document', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
    ['image', 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'],
    ['json', 'application/json,*/*;q=0.5'],
    ['style', 'text/css,*/*;q=0.1'],
    ['text', 'text/plain,*/*;q=0.5'],
  ] as [Destination, string][])('selects Accept for %s without dispatching a blocked request', async (destination, value) => {
    const { request, env } = await createFixture();
    request.destination = destination;
    request.localURLsOnly = true;
    const done = Promise.withResolvers<void>();
    fetch(request, { processResponseEndOfBody: () => done.resolve() }, env);
    expect(request.headerList.get('Accept')).toBe(value);
    await done.promise;
  });

  it.each([null, 'en-US,en;q=0.9'])('uses the browser owner hooks and configured language %s', async (language) => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate('https://example.test/page');
    const env = getRelevantRealm(browlet.window).env;
    env.userAgent.defaultAcceptLanguage = language;
    const request = new FetchRequest(parseURL('https://example.test/resource').url!, env, env.userAgent);
    request.localURLsOnly = true;
    request.initiatorType = 'fetch';
    const response = Promise.withResolvers<FetchResponse>();
    const done = Promise.withResolvers<void>();
    fetch(request, {
      processResponse: response.resolve,
      processResponseEndOfBody: () => done.resolve(),
    }, env);
    expect(request.headerList.get('Accept-Language')).toBe(language);
    expect((await response.promise).type).toBe('error');
    await done.promise;
    expect(request.done).toBe(true);
  });

  it('preserves supplied headers and priority, and selects the emulated language when absent', async () => {
    const { request, env, agent } = await createFixture();
    request.localURLsOnly = true;
    request.headerList.append('Accept', 'custom/type');
    request.internalPriority = { update: vi.fn() };
    agent.webDriverBiDiEmulatedLanguage.mockReturnValue('fr');
    const done = Promise.withResolvers<void>();
    fetch(request, { processResponseEndOfBody: () => done.resolve() }, env);
    expect(request.headerList.get('Accept')).toBe('custom/type');
    expect(request.headerList.get('Accept-Language')).toBe('fr');
    expect(agent.determineFetchPriority).not.toHaveBeenCalled();
    await done.promise;
  });

  it('waits for a pending preload instead of polling or dispatching another fetch', async () => {
    const { request, env, preload } = await createFixture();
    preload.mockReturnValue(true);
    const headers = Promise.withResolvers<FetchResponse>();
    const done = Promise.withResolvers<void>();
    fetch(request, {
      processResponse: headers.resolve,
      processResponseEndOfBody: () => done.resolve(),
    }, env);
    const raw = new FetchResponse();
    raw.status = 201;
    preload.mock.calls[0]![5](raw);
    expect((await headers.promise).status).toBe(201);
    await done.promise;
  });

  it('separates a clientless parallel callback destination from the supplied body owner', async () => {
    const { env, request } = await createFixture();
    request.client = null;
    request.origin = env.origin;
    request.referrer = null;
    request.destination = 'report';
    request.localURLsOnly = true;
    request.body = Uint8Array.of(3, 4);
    const entry = vi.spyOn(FetchParams.prototype, 'mainFetch');
    const done = Promise.withResolvers<void>();
    fetch(request, { useParallelQueue: true, processResponseEndOfBody: () => done.resolve() }, env);
    const params = entry.mock.contexts[0] as FetchParams;
    expect(params.env).toBe(env);
    expect(params.taskDestination).toBeInstanceOf(ParallelQueue);
    expect(params.crossOriginIsolatedCapability).toBe(false);
    expect(request.body).toBeInstanceOf(FetchBody);
    await done.promise;
  });

  it('rejects Early Hints callbacks outside navigation before changing the request', async () => {
    const { env, request } = await createFixture();
    expect(() => fetch(request, { processEarlyHintsResponse: vi.fn() }, env)).toThrow('Early Hints');
    expect(request.origin).toBeUndefined();
    expect(env.fetchGroup.fetchRecords).toEqual([]);
  });
});

describe('Main fetch policy and dispatch', () => {
  it('reports the original URL, enforces after upgrades, and dispatches the upgraded URL', async () => {
    const { params, request, env } = await createFixture('http://example.test/image');
    env.insecureRequestsPolicy.upgrade = true;
    const list = new CSPList(env.origin);
    list.policies.push(ContentSecurityPolicy.parse('img-src https:', 'header', 'enforce'));
    request.policyContainer = env.policyContainer.clone();
    request.policyContainer.cspList = list;
    request.destination = 'image';
    const urls: string[] = [];
    const report = list.reportRequestViolations.bind(list);
    const block = list.isRequestBlocked.bind(list);
    vi.spyOn(list, 'reportRequestViolations').mockImplementation((value) => {
      urls.push(`report:${serializeURL(value.currentURL)}`);
      report(value);
    });
    vi.spyOn(list, 'isRequestBlocked').mockImplementation((value) => {
      urls.push(`block:${serializeURL(value.currentURL)}`);
      return block(value);
    });
    request.populateFromClient();
    await complete(params);
    expect(urls).toEqual(['report:http://example.test/image', 'block:https://example.test/image']);
    expect(params.dispatches).toEqual([['scheme-fetch', false]]);
  });

  it.each(['local', 'port', 'csp', 'same-origin', 'no-cors-redirect'] as const)(
    'returns a network error without dispatch for %s blocking', async (kind) => {
      const { params, request, env } = await createFixture('https://other.test/resource');
      if (kind === 'local') request.localURLsOnly = true;
      if (kind === 'port') request.currentURL.port = 25;
      if (kind === 'csp') {
        const list = new CSPList(env.origin);
        list.policies.push(ContentSecurityPolicy.parse("default-src 'none'", 'header', 'enforce'));
        env.policyContainer.cspList = list;
      }
      if (kind === 'same-origin') request.mode = 'same-origin';
      if (kind === 'no-cors-redirect') request.redirectMode = 'error';
      request.populateFromClient();
      const { response } = await complete(params);
      expect(response.type).toBe('error');
      expect(params.dispatches).toEqual([]);
    },
  );

  it('selects a referrer before applying HSTS', async () => {
    const { params, request, agent } = await createFixture('http://example.test/resource');
    request.client = null;
    request.origin = obtainURLOrigin(parseURL('http://example.test/').url!);
    request.referrer = parseURL('https://example.test/page').url!;
    const referrer = vi.spyOn(agent, 'determineRequestReferrer');
    // Supply an already-known policy rather than a transport response in this orchestration test.
    vi.spyOn(agent.hstsStore, 'requiresHTTPS').mockReturnValue(true);
    request.populateFromClient();
    await complete(params);
    expect(referrer).toHaveBeenCalledOnce();
    expect(request.referrer).toBeNull();
    expect(request.currentURL.scheme).toBe('https');
  });

  it('returns recursive responses without filtering or running completion callbacks', async () => {
    const { params, request } = await createFixture();
    request.populateFromClient();
    params.processResponse = vi.fn();
    const response = await new Promise<FetchResponse>((resolve, reject) => params.mainFetch(true).observe(resolve, reject));
    expect(response).toBe(params.response);
    expect(response.type).toBe('default');
    expect(params.processResponse).not.toHaveBeenCalled();
    expect(request.done).toBe(false);
  });

  it('requests a CORS preflight for unsafe headers and clears failed preflight entries', async () => {
    const { params, request, agent } = await createFixture('https://other.test/resource');
    request.mode = 'cors';
    request.unsafeRequest = true;
    request.headerList.append('X-Private', 'value');
    request.populateFromClient();
    params.response = FetchResponse.networkError();
    await complete(params);
    expect(params.dispatches).toEqual([['http-fetch', true]]);
    expect(agent.corsPreflightCache.clearEntries).toHaveBeenCalledExactlyOnceWith(request);
  });
});

describe('Main fetch response processing', () => {
  it.each(['same-origin', 'include'] as const)('exposes wildcard CORS headers with credentials mode %s', async (credentials) => {
    const { params, request } = await createFixture('https://other.test/resource');
    request.mode = 'cors';
    request.credentialsMode = credentials;
    request.populateFromClient();
    params.response.headerList.append('Access-Control-Expose-Headers', '*');
    params.response.headerList.append('X-Private', 'value');
    params.response.headerList.append('Set-Cookie', 'secret=1');
    const { response } = await complete(params);
    expect(response.type).toBe('cors');
    expect(response.headerList.get('X-Private')).toBe(credentials === 'include' ? null : 'value');
    expect(response.headerList.get('Set-Cookie')).toBeNull();
  });

  it('rejects a malformed expose-headers field as a whole', async () => {
    const { params, request } = await createFixture('https://other.test/resource');
    request.mode = 'cors';
    request.populateFromClient();
    params.response.headerList.append('Access-Control-Expose-Headers', 'X-Private, "bad"');
    params.response.headerList.append('X-Private', 'value');
    const { response } = await complete(params);
    expect(response.headerList.get('X-Private')).toBeNull();
  });

  it('fills URL history before CSP checks and preserves an existing filtered response', async () => {
    const { params, request, env } = await createFixture();
    const list = new CSPList(env.origin);
    request.policyContainer = env.policyContainer.clone();
    request.policyContainer.cspList = list;
    request.populateFromClient();
    const raw = params.response;
    const check = vi.spyOn(list, 'isResponseBlocked').mockImplementation((response) => {
      expect(response.urlList).toEqual(request.urlList);
      return false;
    });
    params.response = raw.filter('basic');
    const { response } = await complete(params);
    expect(check).toHaveBeenCalledExactlyOnceWith(raw, request);
    expect(response).toBe(params.response);
    expect(raw.urlList).not.toBe(request.urlList);
  });

  it.each(['mime', 'nosniff', 'unsolicited-range'] as const)('blocks a response for %s', async (kind) => {
    const { params, request } = await createFixture('https://other.test/resource');
    request.destination = 'script';
    request.populateFromClient();
    if (kind === 'mime') params.response.headerList.append('Content-Type', 'image/png');
    if (kind === 'nosniff') params.response.headerList.append('X-Content-Type-Options', 'nosniff');
    if (kind === 'unsolicited-range') { params.response.status = 206; params.response.rangeRequested = true; }
    expect((await complete(params)).response.type).toBe('error');
  });

  it.each(['HEAD', 'CONNECT', '204'] as const)('discards the body for %s before consumption', async (kind) => {
    const { params, request, env } = await createFixture();
    if (kind === '204') params.response.status = 204;
    else request.method = kind;
    request.populateFromClient();
    params.response.body = FetchBody.fromBytes(Uint8Array.of(1), env);
    expect((await complete(params)).body).toBeNull();
  });

  it.each([true, false])('checks SRI before delivering response bytes: matching = %s', async (matching) => {
    const { params, request, env } = await createFixture();
    const bytes = Uint8Array.of(1, 2, 3);
    request.integrityMetadata = `sha256-${createHash('sha256').update(matching ? bytes : Uint8Array.of(9)).digest('base64')}`;
    request.populateFromClient();
    params.response.body = FetchBody.fromBytes(bytes, env);
    const result = await complete(params);
    expect(result.response.type).toBe(matching ? 'basic' : 'error');
    expect(result.body).toEqual(matching ? bytes : null);
    expect(result.events).toEqual(['response', 'end', 'consume']);
  });

  it('rejects an opaque response with integrity metadata even when its internal bytes match', async () => {
    const { params, request, env } = await createFixture('https://other.test/resource');
    const bytes = Uint8Array.of(1, 2, 3);
    request.integrityMetadata = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
    request.populateFromClient();
    params.response.body = FetchBody.fromBytes(bytes, env);
    const result = await complete(params);
    expect(result.response.type).toBe('error');
    expect(result.body).toBeNull();
  });

  it('reports body-read failure to the consume callback', async () => {
    const { params, request, env } = await createFixture();
    request.populateFromClient();
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    stream.error(new Error('body failed'));
    params.response.body = new FetchBody(stream, env);
    const result = await complete(params);
    expect(result.body).toBe('failure');
    expect(result.events).toEqual(['response', 'consume']);
  });
});

describe('Fetch timing handover', () => {
  it('retains Server-Timing for secure clients and supplies the selected environment to Resource Timing', async () => {
    const { params, request, env } = await createFixture();
    const mark = vi.fn();
    Object.assign(env, { markResourceTiming: mark });
    request.initiatorType = 'fetch';
    request.populateFromClient();
    params.response.headerList.append('Server-Timing', 'db;dur=4, app;dur=2');
    params.response.headerList.append('Content-Type', 'application/problem+json; charset=utf-8');
    params.response.cacheUsage = 'validated';
    await complete(params);
    expect(params.timingInfo.serverTimingHeaders).toEqual(['db;dur=4', 'app;dur=2']);
    expect(params.timingInfo.endTime).toBeGreaterThanOrEqual(0);
    expect(mark).toHaveBeenCalledExactlyOnceWith(
      params.timingInfo, request.url, 'fetch', 'validated', params.response.bodyInfo, 200,
    );
    expect(params.response.bodyInfo.contentType).toBe('application/json');
  });

  it('makes failed timing checks opaque and removes cache classification', async () => {
    const { params, request, env } = await createFixture();
    const mark = vi.fn();
    Object.assign(env, { markResourceTiming: mark });
    request.initiatorType = 'fetch';
    request.timingAllowFailed = true;
    request.populateFromClient();
    params.timingInfo.startTime = 23;
    params.timingInfo.finalNetworkRequestStartTime = 99;
    params.response.cacheUsage = 'local';
    await complete(params);
    expect(mark.mock.calls[0]![0]).toMatchObject({
      startTime: 23, postRedirectStartTime: 23, finalNetworkRequestStartTime: 0, endTime: 0,
    });
    expect(mark.mock.calls[0]![3]).toBeUndefined();
    expect(params.timingInfo.finalNetworkRequestStartTime).toBe(99);
  });

  it('retains full document timing without automatically reporting a parallel-destination fetch', async () => {
    const { params, request, env, agent } = await createFixture();
    request.destination = 'document';
    request.mode = 'navigate';
    request.initiatorType = 'other';
    request.populateFromClient();
    const mark = vi.fn();
    Object.assign(env, { markResourceTiming: mark });
    params.taskDestination = new ParallelQueue(agent.runInParallel);
    await complete(params);
    expect(params.controller.extractFullTimingInfo()).toBe(params.timingInfo);
    expect(mark).not.toHaveBeenCalled();
    params.controller.reportTiming(env);
    expect(mark).toHaveBeenCalledOnce();
  });
});

// The actual Window, bindings, stream machinery, clock, and event loop remain in use.
// Only provisional owner algorithms and the later scheme/HTTP stages are controlled.
async function createFixture(url = 'https://example.test/resource') {
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate('https://example.test/page');
  const env = getRelevantRealm(browlet.window).env;
  const agent = Object.assign(env.userAgent, {
    defaultAcceptLanguage: 'en',
    webDriverBiDiCloneNetworkRequestBody: vi.fn(),
    webDriverBiDiEmulatedLanguage: vi.fn<() => string | null>(() => null),
    webDriverBiDiFetchError: vi.fn(),
    webDriverBiDiResponseCompleted: vi.fn(),
    determineFetchPriority: vi.fn(() => ({ update: vi.fn() })),
    corsPreflightCache: { clearEntries: vi.fn() },
    supportsMIMEType: () => true,
  });
  const preload = vi.fn<(
    url: FetchRequest['url'], destination: Destination, mode: FetchRequest['mode'],
    credentials: FetchRequest['credentialsMode'], integrity: string, available: (response: FetchResponse) => void,
  ) => boolean>(() => false);
  Object.assign(env, { consumePreloadedResource: preload });
  const request = new FetchRequest(parseURL(url).url!, env, agent);
  const params = new ControlledFetchParams(request, new FetchTimingInfo(), env);
  params.taskDestination = env.exec.global;
  return { env, agent, request, params, preload };
}

class ControlledFetchParams extends FetchParams {
  response = new FetchResponse();
  dispatches: [string, boolean][] = [];

  override schemeFetch() {
    this.dispatches.push(['scheme-fetch', false]);
    return this.request.userAgent.hostPromises.resolve(this.response);
  }

  override httpFetch(preflight = false) {
    this.dispatches.push(['http-fetch', preflight]);
    return this.request.userAgent.hostPromises.resolve(this.response);
  }
}

function complete(params: FetchParams) {
  const result = Promise.withResolvers<{
    response: FetchResponse; body: Uint8Array | null | 'failure'; events: string[];
  }>();
  const events: string[] = [];
  params.processResponse = (response) => {
    expect(response.type === 'error' || isFilteredResponse(response)).toBe(true);
    events.push('response');
  };
  params.processResponseEndOfBody = () => {
    expect(params.request.done).toBe(true);
    events.push('end');
  };
  params.processResponseConsumeBody = (response, body) => {
    events.push('consume');
    result.resolve({ response, body, events });
  };
  params.mainFetch();
  return result.promise;
}
