import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { CSPList } from '../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../src/browlet/browsing/policy/csp/policy';
import { FetchBody } from '../../src/fetch/body';
import { fetch } from '../../src/fetch/fetch';
import { FetchRequest, type Destination } from '../../src/fetch/request';
import { FetchResponse, isFilteredResponse } from '../../src/fetch/response';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { ReadableStreamImpl } from '../../src/streams/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../src/url/url';
import { mockHTTPTransport } from '../fetch/transport-fixture';

import { createFetchOperation } from './fetch-fixture';

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
    const queued = vi.spyOn(ParallelQueue.prototype, 'enqueue');
    const done = Promise.withResolvers<void>();
    fetch(request, { useParallelQueue: true, processResponseEndOfBody: () => done.resolve() }, env);
    expect(request.body).toBeInstanceOf(FetchBody);
    expect(request.body).toHaveProperty('stream.env', env);
    await done.promise;
    expect(queued).toHaveBeenCalled();
    expect(queued.mock.contexts.every((queue) => queue instanceof ParallelQueue)).toBe(true);
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
    const { operation, request, env, override } = await createFixture('http://example.test/image');
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
    await complete(operation);
    expect(urls).toEqual(['report:http://example.test/image', 'block:https://example.test/image']);
    expect(override).toHaveBeenCalledExactlyOnceWith(request, env);
  });

  it.each(['local', 'port', 'csp', 'same-origin', 'no-cors-redirect'] as const)(
    'returns a network error without dispatch for %s blocking', async (kind) => {
      const { operation, request, env, override } = await createFixture('https://other.test/resource');
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
      const { response } = await complete(operation);
      expect(response.type).toBe('error');
      expect(override).not.toHaveBeenCalled();
    },
  );

  it('selects a referrer before applying HSTS', async () => {
    const { operation, request, agent } = await createFixture('http://example.test/resource');
    request.client = null;
    request.origin = obtainURLOrigin(parseURL('http://example.test/').url!);
    request.destination = 'document';
    request.mode = 'navigate';
    operation.options.useParallelQueue = true;
    request.referrer = parseURL('https://example.test/page').url!;
    const referrer = vi.spyOn(agent, 'determineRequestReferrer');
    // Supply an already-known policy rather than a transport response in this orchestration test.
    vi.spyOn(agent.hstsStore, 'requiresHTTPS').mockReturnValue(true);
    request.populateFromClient();
    await complete(operation);
    expect(referrer).toHaveBeenCalledOnce();
    expect(request.referrer).toBeNull();
    expect(request.currentURL.scheme).toBe('https');
  });

  it('delivers only the final response after recursive redirect dispatch', async () => {
    const { operation, request, agent, override } = await createFixture();
    override.mockReturnValue(null);
    const reachedFinal = Promise.withResolvers<void>();
    let finish!: () => void;
    mockHTTPTransport(agent, (wire, listener) => {
      if (wire.url.path.at(-1) !== 'final') {
        const response = new FetchResponse();
        response.headerList.append('Location', '/final');
        listener.onHeaders(302, '', response.headerList, false);
        listener.onEnd();
      } else {
        finish = () => { listener.onHeaders(201, '', new FetchResponse().headerList, false); listener.onEnd(); };
        reachedFinal.resolve();
      }
    });
    const delivered = vi.fn();
    operation.options.processResponse = delivered;
    const pending = operation.start();
    await reachedFinal.promise;
    expect(delivered).not.toHaveBeenCalled();
    expect(request.done).toBe(false);
    finish();
    expect(await pending).toMatchObject({ type: 'basic', status: 201 });
    expect(delivered).toHaveBeenCalledOnce();
  });

  it('requests a CORS preflight for unsafe headers and clears failed preflight entries', async () => {
    const { operation, request, agent, override } = await createFixture('https://other.test/resource');
    request.mode = 'cors';
    request.unsafeRequest = true;
    request.headerList.append('X-Private', 'value');
    request.populateFromClient();
    override.mockReturnValue(null);
    const wire = mockHTTPTransport(agent, (_request, listener) => listener.onError(new Error('preflight failed')));
    await complete(operation);
    expect(wire.mock.calls.map(([request]) => request.method)).toEqual(['OPTIONS']);
    expect(agent.corsPreflightCache.clearEntries).toHaveBeenCalledExactlyOnceWith(request);
  });
});

describe('Main fetch response processing', () => {
  it.each(['same-origin', 'include'] as const)('exposes wildcard CORS headers with credentials mode %s', async (credentials) => {
    const { operation, request, reply } = await createFixture('https://other.test/resource');
    request.mode = 'cors';
    request.credentialsMode = credentials;
    request.populateFromClient();
    reply.response.headerList.append('Access-Control-Expose-Headers', '*');
    reply.response.headerList.append('X-Private', 'value');
    reply.response.headerList.append('Set-Cookie', 'secret=1');
    const { response } = await complete(operation);
    expect(response.type).toBe('cors');
    expect(response.headerList.get('X-Private')).toBe(credentials === 'include' ? null : 'value');
    expect(response.headerList.get('Set-Cookie')).toBeNull();
  });

  it('rejects a malformed expose-headers field as a whole', async () => {
    const { operation, request, reply } = await createFixture('https://other.test/resource');
    request.mode = 'cors';
    request.populateFromClient();
    reply.response.headerList.append('Access-Control-Expose-Headers', 'X-Private, "bad"');
    reply.response.headerList.append('X-Private', 'value');
    const { response } = await complete(operation);
    expect(response.headerList.get('X-Private')).toBeNull();
  });

  it('fills URL history before CSP checks and preserves an existing filtered response', async () => {
    const { operation, request, env, reply } = await createFixture();
    const list = new CSPList(env.origin);
    request.policyContainer = env.policyContainer.clone();
    request.policyContainer.cspList = list;
    request.populateFromClient();
    const raw = reply.response;
    const check = vi.spyOn(list, 'isResponseBlocked').mockImplementation((response) => {
      expect(response.urlList).toEqual(request.urlList);
      return false;
    });
    reply.response = raw.filter('basic');
    const { response } = await complete(operation);
    expect(check).toHaveBeenCalledExactlyOnceWith(raw, request);
    expect(response).toBe(reply.response);
    expect(raw.urlList).not.toBe(request.urlList);
  });

  it.each(['mime', 'nosniff', 'unsolicited-range'] as const)('blocks a response for %s', async (kind) => {
    const { operation, request, reply } = await createFixture('https://other.test/resource');
    request.destination = 'script';
    request.populateFromClient();
    if (kind === 'mime') reply.response.headerList.append('Content-Type', 'image/png');
    if (kind === 'nosniff') reply.response.headerList.append('X-Content-Type-Options', 'nosniff');
    if (kind === 'unsolicited-range') { reply.response.status = 206; reply.response.rangeRequested = true; }
    expect((await complete(operation)).response.type).toBe('error');
  });

  it.each(['HEAD', 'CONNECT', '204'] as const)('discards the body for %s before consumption', async (kind) => {
    const { operation, request, env, reply } = await createFixture();
    if (kind === '204') reply.response.status = 204;
    else request.method = kind;
    request.populateFromClient();
    reply.response.body = FetchBody.fromBytes(Uint8Array.of(1), env);
    expect((await complete(operation)).body).toBeNull();
  });

  it.each([true, false])('checks SRI before delivering response bytes: matching = %s', async (matching) => {
    const { operation, request, env, reply } = await createFixture();
    const bytes = Uint8Array.of(1, 2, 3);
    request.integrityMetadata = `sha256-${createHash('sha256').update(matching ? bytes : Uint8Array.of(9)).digest('base64')}`;
    request.populateFromClient();
    reply.response.body = FetchBody.fromBytes(bytes, env);
    const result = await complete(operation);
    expect(result.response.type).toBe(matching ? 'basic' : 'error');
    expect(result.body).toEqual(matching ? bytes : null);
    expect(result.events).toEqual(['response', 'end', 'consume']);
  });

  it('rejects an opaque response with integrity metadata even when its internal bytes match', async () => {
    const { operation, request, env, reply } = await createFixture('https://other.test/resource');
    const bytes = Uint8Array.of(1, 2, 3);
    request.integrityMetadata = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
    request.populateFromClient();
    reply.response.body = FetchBody.fromBytes(bytes, env);
    const result = await complete(operation);
    expect(result.response.type).toBe('error');
    expect(result.body).toBeNull();
  });
});

describe('Fetch body completion', () => {
  it.each(['drain', 'empty', 'already-closed', 'cancel', 'error'] as const)('preserves the body stream and completes once for %s', async (mode) => {
    const { env, request, operation, reply } = await createFixture();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, env);
    reply.response.body = new FetchBody(stream, env);
    if (mode === 'already-closed') stream.close();
    const run = (steps: () => void) => new Promise<void>((resolve, reject) => env.queueNetworkingTask(() => {
      try { steps(); resolve(); }
      catch (error) { reject(new Error('Body task failed', { cause: error })); }
    }, env.exec.global));
    const events: string[] = [];
    operation.options.processResponse = () => { events.push('response'); };
    operation.options.processResponseEndOfBody = () => { events.push('end'); };
    const delivered = await operation.start();
    expect(delivered.body!.stream).toBe(stream);
    if (mode === 'drain') {
      await run(() => { stream.enqueueChunk(Uint8Array.of(1, 2, 3)); stream.close(); });
      expect(events).toEqual(['response']);
      expect(request.done).toBe(false);
      const bytes = await new Promise((resolve, reject) => env.queueNetworkingTask(() => {
        stream.getDefaultReader().readAllBytes(resolve, reject);
      }, env.exec.global));
      expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
    } else if (mode === 'cancel') {
      await run(() => { stream.cancelInternal('stop').observe(() => {}, () => {}); });
    } else if (mode === 'error') {
      await run(() => stream.error('failure'));
    } else if (mode === 'empty') {
      await run(() => stream.close());
    }
    await vi.waitFor(() => expect(events).toEqual(['response', 'end']));
    expect(request.done).toBe(true);
  });

  it('finishes the request while reporting body-read failure to the consume callback', async () => {
    const { operation, request, env, reply } = await createFixture();
    request.populateFromClient();
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    stream.error(new Error('body failed'));
    reply.response.body = new FetchBody(stream, env);
    const result = await complete(operation);
    expect(result.body).toBe('failure');
    // SPEC_CLASH(fetch-body-completion): Errors finish the operation without becoming successful reads.
    expect(result.events).toEqual(['response', 'end', 'consume']);
    expect(request.done).toBe(true);
  });
});

describe('Fetch timing handover', () => {
  it('retains Server-Timing for secure clients and supplies the selected environment to Resource Timing', async () => {
    const { operation, request, env, reply } = await createFixture();
    const mark = vi.spyOn(env, 'markResourceTiming');
    request.initiatorType = 'fetch';
    request.populateFromClient();
    reply.response.headerList.append('Server-Timing', 'db;dur=4, app;dur=2');
    reply.response.headerList.append('Content-Type', 'application/problem+json; charset=utf-8');
    reply.response.cacheUsage = 'validated';
    await complete(operation);
    const timing = mark.mock.calls[0]![0];
    expect(timing.serverTimingHeaders).toEqual(['db;dur=4', 'app;dur=2']);
    expect(timing.endTime).toBeGreaterThanOrEqual(0);
    expect(mark).toHaveBeenCalledExactlyOnceWith(
      timing, request.url, 'fetch', 'validated', reply.response.bodyInfo, 200,
    );
    expect(reply.response.bodyInfo.contentType).toBe('application/json');
  });

  it('makes failed timing checks opaque and removes cache classification', async () => {
    const { operation, request, env, agent, override } = await createFixture();
    const mark = vi.spyOn(env, 'markResourceTiming');
    request.initiatorType = 'fetch';
    request.timingAllowFailed = true;
    request.populateFromClient();
    request.mode = 'navigate';
    request.destination = 'document';
    const clock = vi.spyOn(agent, 'unsafeSharedCurrentTime').mockReturnValue(23);
    override.mockReturnValue(null);
    mockHTTPTransport(agent, (_request, listener) => {
      clock.mockReturnValue(99);
      listener.onResponseStarted!();
      listener.onHeaders(200, '', new FetchResponse().headerList, false);
      listener.onEnd();
    });
    await complete(operation);
    expect(mark.mock.calls[0]![0]).toMatchObject({
      startTime: 23, postRedirectStartTime: 23, finalNetworkRequestStartTime: 0, endTime: 0,
    });
    expect(mark.mock.calls[0]![3]).toBeUndefined();
    expect(operation.controller.extractFullTimingInfo().finalNetworkResponseStartTime).toBe(99);
  });

  it('retains full document timing without automatically reporting a parallel-destination fetch', async () => {
    const { operation, request, env } = await createFixture();
    request.destination = 'document';
    request.mode = 'navigate';
    request.initiatorType = 'other';
    request.populateFromClient();
    const mark = vi.spyOn(env, 'markResourceTiming');
    operation.options.useParallelQueue = true;
    await complete(operation);
    expect(operation.controller.extractFullTimingInfo().startTime).toBeGreaterThan(0);
    expect(mark).not.toHaveBeenCalled();
    operation.controller.reportTiming(env);
    expect(mark).toHaveBeenCalledOnce();
  });
});

// The actual Window, bindings, stream machinery, clock, and event loop remain in use.
// Browser response overrides supply the response being processed.
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
    corsPreflightCache: Object.assign(env.userAgent.corsPreflightCache, {
      clearEntries: vi.spyOn(env.userAgent.corsPreflightCache, 'clearEntries'),
    }),
    supportsMIMEType: () => true,
  });
  const preload = vi.fn<(
    url: FetchRequest['url'], destination: Destination, mode: FetchRequest['mode'],
    credentials: FetchRequest['credentialsMode'], integrity: string, available: (response: FetchResponse) => void,
  ) => boolean>(() => false);
  Object.assign(env, { consumePreloadedResource: preload });
  const request = new FetchRequest(parseURL(url).url!, env, agent);
  const operation = createFetchOperation(request, env);
  const reply = { response: new FetchResponse() };
  const override = vi.spyOn(agent, 'potentiallyOverrideResponse').mockImplementation(() => reply.response);
  operation.options.useParallelQueue = false;
  return { env, agent, request, operation, preload, reply, override };
}

function complete(operation: ReturnType<typeof createFetchOperation>) {
  const result = Promise.withResolvers<{
    response: FetchResponse; body: Uint8Array | null | 'failure'; events: string[];
  }>();
  const events: string[] = [];
  operation.options.processResponse = (response) => {
    expect(response.type === 'error' || isFilteredResponse(response)).toBe(true);
    events.push('response');
  };
  operation.options.processResponseEndOfBody = () => {
    expect(operation.request.done).toBe(true);
    events.push('end');
  };
  operation.options.processResponseConsumeBody = (response, body) => {
    events.push('consume');
    result.resolve({ response, body, events });
  };
  void operation.start();
  return result.promise;
}
