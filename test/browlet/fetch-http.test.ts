import { internalType } from '../../src/infra/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { utf8Decode, utf8Encode } from '../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../src/fetch/body';
import { fetch } from '../../src/fetch/fetch';
import { FetchHeaders } from '../../src/fetch/headers';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, isFilteredResponse, type FilteredResponseType } from '../../src/fetch/response';
import { type ServiceWorkerTimingInfo } from '../../src/fetch/timing';
import { BlobData, BlobImpl, FileImpl } from '../../src/file/index';
import { toScalarValueString } from '../../src/infra/strings';
import { coarsenTime } from '../../src/infra/time';
import { ReadableStreamImpl } from '../../src/streams/index';
import { copyURL, parseURL, serializeURL } from '../../src/url/url';
import { FormDataImpl } from '../../src/xhr/form-data';
import { readBodyBytes } from '../fetch/body-fixture';
import { mockHTTPTransport } from '../fetch/transport-fixture';
import { createPolicyEnvironment } from './browsing/policy/environment-fixture';
import { createFetchOperation } from './fetch-fixture';

afterEach(() => vi.restoreAllMocks());

describe('Fetch §4.4: HTTP response selection', () => {
  it('preserves the original upload stream when no worker requests a copy', async () => {
    const f = createFixture();
    f.request.body = FetchBody.fromBytes(utf8Encode('upload'), f.env);
    const stream = f.request.body.stream;
    expect(await f.operation.start()).toHaveProperty('internalResponse', f.receivedResponse);
    expect(f.userAgent.handleFetch.mock.calls[0]![0]).toBe(f.request);
    expect(f.request.body.stream).toBe(stream);
    expect(stream.locked).toBe(false);
  });

  it('prepares an independent request only when the Service Worker owner asks for it', async () => {
    const f = createFixture();
    f.request.headerList.append('X-Request', 'original');
    f.userAgent.handleFetch.mockImplementation((request, _controller, _isolated, prepareRequest) => {
      expect(request).toBe(f.request);
      return prepareRequest().then((copy) => {
        expect(copy).not.toBe(request);
        expect(copy.currentURL).not.toBe(request.currentURL);
        expect(copy.headerList.list).toEqual(request.headerList.list);
        copy.headerList.set('X-Request', 'worker');
        return null;
      }, undefined, internalType<FetchResponse | ServiceWorkerTimingInfo | null>('OptionalResult'));
    });
    const response = await f.operation.start();
    const [, controller, isolated] = f.userAgent.handleFetch.mock.calls[0]!;
    expect(f.request.headerList.get('X-Request')).toBe('original');
    expect(controller).toBe(f.operation.controller);
    expect(isolated).toBe(false);
    expect(response).toHaveProperty('internalResponse', f.receivedResponse);
    expect(f.network).toHaveBeenCalledExactlyOnceWith();
    expect(f.request.allowServiceWorkerInterception).toBe(false);
  });

  it('skips interception when disabled and retains it for a non-following network request', async () => {
    const f = createFixture();
    f.request.allowServiceWorkerInterception = false;
    await f.operation.start();
    expect(f.userAgent.handleFetch).not.toHaveBeenCalled();
    f.request.allowServiceWorkerInterception = true;
    f.request.redirectMode = 'manual';
    await f.operation.start();
    expect(f.request.allowServiceWorkerInterception).toBe(true);
  });

  it('waits for interception and keeps Service Worker responses out of network CORS and TAO checks', async () => {
    const f = createFixture();
    const pending = f.userAgent.HostPromise.withResolvers(internalType<FetchResponse | ServiceWorkerTimingInfo | null>('OptionalResult'));
    f.userAgent.handleFetch.mockReturnValue(pending.promise);
    f.request.responseTainting = 'cors';
    vi.spyOn(f.client, 'crossOriginIsolatedCapability', 'get').mockReturnValue(true);
    f.request.destination = 'document';
    vi.spyOn(f.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(12.34567);
    f.response.serviceWorkerTimingInfo = workerTiming();
    const result = f.operation.start();
    expect(f.network).not.toHaveBeenCalled();
    pending.resolve(f.response);
    expect(await result).toHaveProperty('internalResponse', f.receivedResponse);
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.cors).not.toHaveBeenCalled();
    expect(f.timing).not.toHaveBeenCalled();
    expect(f.operation.controller.extractFullTimingInfo().finalServiceWorkerStartTime).toBe(coarsenTime(12.34567, true));
    expect(f.operation.controller.extractFullTimingInfo().serviceWorkerTimingInfo).toBe(f.response.serviceWorkerTimingInfo);
    expect(f.userAgent.webDriverBiDiResponseStarted).toHaveBeenCalledExactlyOnceWith(f.request, f.response);
  });

  it('retains Service Worker timing even when the worker supplies no response', async () => {
    const f = createFixture();
    f.request.destination = 'document';
    const timing = workerTiming();
    f.userAgent.handleFetch.mockReturnValue(f.userAgent.HostPromise.try(() => timing, internalType<ServiceWorkerTimingInfo>('ServiceWorkerTimingInfo')));
    expect(await f.operation.start()).toHaveProperty('internalResponse', f.receivedResponse);
    expect(f.operation.controller.extractFullTimingInfo().serviceWorkerTimingInfo).toBe(timing);
    expect(f.operation.controller.extractFullTimingInfo().finalServiceWorkerStartTime).toBe(0);
  });

  it.each([
    ['cors', 'same-origin', 'follow', 1],
    ['opaque', 'cors', 'follow', 1],
    ['opaqueredirect', 'cors', 'follow', 1],
    ['basic', 'cors', 'manual', 2],
    ['basic', 'cors', 'error', 2],
  ] as [FilteredResponseType, RequestMode, RequestRedirect, number][])(
    'rejects a worker %s response for %s/%s with %i URLs', async (type, mode, redirectMode, count) => {
      const f = createFixture();
      f.request.mode = mode;
      f.request.redirectMode = redirectMode;
      if (count === 2) f.response.urlList.push(parseURL('https://example.test/second').url!);
      const worker = f.response.filter(type);
      f.userAgent.handleFetch.mockReturnValue(f.userAgent.HostPromise.try(() => worker, internalType<FetchResponse>('FetchResponse')));
      expect((await f.operation.start()).type).toBe('error');
      expect(f.network).not.toHaveBeenCalled();
    },
  );

  it('preserves a worker network error without network fallback or CORP processing', async () => {
    const f = createFixture();
    f.request.responseTainting = 'opaque';
    f.client.policyContainer.embedderPolicy.value = 'require-corp';
    const error = FetchResponse.networkError();
    f.userAgent.handleFetch.mockReturnValue(f.userAgent.HostPromise.try(() => error, internalType<FetchResponse>('FetchResponse')));
    expect((await f.operation.start()).type).toBe('error');
    expect(f.network).not.toHaveBeenCalled();
  });

  it('transforms worker upload chunks and cancels the original branch after interception', async () => {
    const f = createFixture();
    f.request.method = 'POST';
    f.request.body = FetchBody.fromBytes(utf8Encode('upload'), f.env);
    const body = f.request.body;
    const bytes = Promise.withResolvers<Uint8Array>();
    f.userAgent.handleFetch.mockImplementation((_request, _controller, _isolated, prepareRequest) =>
      prepareRequest().then((copy) => {
        expect(copy.body).toBeInstanceOf(FetchBody);
        (copy.body as FetchBody).readAll(bytes.resolve, bytes.reject);
        return f.response;
      }, undefined, internalType<FetchResponse | ServiceWorkerTimingInfo | null>('OptionalResult')));
    expect(await f.operation.start()).toHaveProperty('internalResponse', f.receivedResponse);
    expect(body.stream.isClosed).toBe(true);
    expect(utf8Decode(await bytes.promise)).toBe('upload');
  });

  it('terminates a worker upload that produces a non-byte chunk', async () => {
    const f = createFixture();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, f.env);
    stream.enqueueChunk('not bytes');
    stream.close();
    f.request.body = new FetchBody(stream, f.env);
    const terminated = Promise.withResolvers<void>();
    f.userAgent.handleFetch.mockImplementation((_request, _controller, _isolated, prepareRequest) =>
      prepareRequest().then((copy) => {
        (copy.body as FetchBody).readAll(() => {}, () => {});
        return f.response;
      }, undefined, internalType<FetchResponse | ServiceWorkerTimingInfo | null>('OptionalResult')));
    const pending = f.operation.start();
    const terminate = f.operation.controller.terminate.bind(f.operation.controller);
    vi.spyOn(f.operation.controller, 'terminate').mockImplementation(() => {
      terminate();
      terminated.resolve();
    });
    await pending;
    await terminated.promise;
    expect(f.operation.controller.state).toBe('terminated');
  });
});

describe('HTTP preflight selection and response checks', () => {
  it('does not inspect the permission cache unless preflight was requested', async () => {
    const f = createFixture();
    f.request.method = 'PUT';
    f.request.headerList.append('X-Custom', 'value');
    await f.operation.start();
    expect(f.cache.matchesMethod).not.toHaveBeenCalled();
    expect(f.cache.matchesHeaderName).not.toHaveBeenCalled();
    expect(f.preflight).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', false, false, false, false, true],
    ['PUT', true, false, false, false, false],
    ['GET', false, false, false, false, false],
    ['GET', false, true, false, false, true],
    ['GET', true, true, false, false, false],
    ['GET', false, false, true, false, true],
    ['PUT', true, false, true, true, false],
  ] as [string, boolean, boolean, boolean, boolean, boolean][])(
    'selects preflight for method %s, cached=%s, forced=%s, header=%s, cached=%s',
    async (method, methodCached, forced, hasHeader, headerCached, expected) => {
      const f = createFixture('https://other.test/resource');
      f.request.method = method;
      f.request.unsafeRequest = true;
      f.request.useCORSPreflight = forced;
      f.cache.matchesMethod.mockReturnValue(methodCached);
      f.cache.matchesHeaderName.mockReturnValue(headerCached);
      if (hasHeader) f.request.headerList.append('X-Custom', 'value');
      await f.operation.start();
      expect(f.preflight).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(f.network).toHaveBeenCalledOnce();
    },
  );

  it('waits for a successful preflight and stops before transport on failure', async () => {
    const f = createFixture('https://other.test/resource');
    f.request.method = 'PUT';
    f.request.unsafeRequest = true;
    const pending = f.userAgent.HostPromise.withResolvers(internalType<FetchResponse>('FetchResponse'));
    f.preflight.mockReturnValue(pending.promise);
    const result = f.operation.start();
    expect(f.network).not.toHaveBeenCalled();
    const error = FetchResponse.abortedNetworkError();
    pending.resolve(error);
    expect((await result).type).toBe('error');
    expect(f.network).not.toHaveBeenCalled();
    expect(f.request.allowServiceWorkerInterception).toBe(true);
  });

  it('checks CORS only for a CORS-tainted network response, before TAO or redirect handling', async () => {
    const f = createFixture();
    f.request.responseTainting = 'cors';
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.cors.mockReturnValue(true);
    expect((await f.operation.start()).type).toBe('error');
    expect(f.cors).toHaveBeenCalledExactlyOnceWith(f.request);
    expect(f.timing).not.toHaveBeenCalled();
    expect(f.request.redirectCount).toBe(0);
  });

  it('records a TAO failure without blocking the response or clearing an earlier failure', async () => {
    const f = createFixture();
    f.timing.mockReturnValue(true);
    expect(await f.operation.start()).toHaveProperty('internalResponse', f.receivedResponse);
    expect(f.request.timingAllowFailed).toBe(true);
    f.timing.mockReturnValue(false);
    await f.operation.start();
    expect(f.request.timingAllowFailed).toBe(true);
    expect(f.cors).not.toHaveBeenCalled();
  });

  it.each(['network', 'worker'])('checks CORP against the internal %s response', async (source) => {
    const f = createFixture('https://other.test/resource');
    f.request.mode = 'no-cors';
    f.response.headerList.append('Cross-Origin-Resource-Policy', 'same-origin');
    if (source === 'worker') {
      f.userAgent.handleFetch.mockReturnValue(f.userAgent.HostPromise.try(() => f.response.filter('opaque'), internalType<FetchResponse>('FetchResponse')));
    } else {
      f.request.responseTainting = 'opaque';
    }
    expect((await f.operation.start()).type).toBe('error');
  });

  it.each([
    [null, 'opaque'],
    ['same-origin', 'error'],
  ])('checks CORP for a clientless request with response policy %s', async (policy, expectedType) => {
    const f = createFixture('https://other.test/resource');
    // Fetch permits background consumers to retain origin and policy state without a client.
    // The fixture has already populated those fields from the initiating environment.
    f.request.client = null;
    f.request.destination = 'report';
    f.request.mode = 'no-cors';
    f.request.referrer = null;
    f.request.allowServiceWorkerInterception = false;
    if (policy !== null) f.response.headerList.append('Cross-Origin-Resource-Policy', policy);
    const response = await f.operation.start();
    expect(f.request.responseTainting).toBe('opaque');
    expect(response.type).toBe(expectedType);
  });

  it.each([
    ['require-corp', 'error'],
    ['unsafe-none', 'opaque'],
  ] as const)('uses retained clientless COEP %s without reporting', async (value, expectedType) => {
    const f = createFixture('https://other.test/resource');
    f.client.policyContainer.embedderPolicy.value = value;
    f.client.policyContainer.embedderPolicy.reportOnlyValue = 'require-corp';
    f.request.policyContainer = f.client.policyContainer.clone();
    f.request.client = null;
    f.request.destination = 'report';
    f.request.mode = 'no-cors';
    f.request.referrer = null;
    f.request.allowServiceWorkerInterception = false;
    const queueReport = vi.spyOn(f.client, 'queueReport');
    expect((await f.operation.start()).type).toBe(expectedType);
    expect(queueReport).not.toHaveBeenCalled();
  });

  it('keeps the live client policy when the retained request policy differs', async () => {
    const f = createFixture('https://other.test/resource');
    f.request.mode = 'no-cors';
    f.client.policyContainer.embedderPolicy.value = 'require-corp';
    const queueReport = vi.spyOn(f.client, 'queueReport');
    expect(f.request.policyContainer!.embedderPolicy.value).toBe('unsafe-none');
    expect((await f.operation.start()).type).toBe('error');
    expect(queueReport).toHaveBeenCalledOnce();
  });
});

describe('HTTP redirect modes', () => {
  it('rejects redirects when redirect mode is error', async () => {
    const f = createFixture();
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.request.redirectMode = 'error';
    expect((await f.operation.start()).type).toBe('error');
    expect(f.request.redirectCount).toBe(0);
  });

  it('returns an opaque redirect for a non-navigation manual request', async () => {
    const f = createFixture();
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.request.redirectMode = 'manual';
    const response = await f.operation.start();
    expect(response.type).toBe('opaqueredirect');
    expect(response.status).toBe(0);
    expect(isFilteredResponse(response) && response.internalResponse).toBe(f.receivedResponse);
    expect(f.operation.controller.nextManualRedirectSteps).toBeNull();
  });

  it('delivers a manual navigation redirect, then resumes through the controller', async () => {
    const f = createFixture();
    f.request.mode = 'navigate';
    f.request.destination = 'document';
    f.request.redirectMode = 'manual';
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.response.headerList.append('Timing-Allow-Origin', '*');
    const next = responseAt('https://example.test/next');
    f.network.mockReturnValueOnce(f.userAgent.HostPromise.try(() => f.response, internalType<FetchResponse>('FetchResponse')))
      .mockReturnValue(f.userAgent.HostPromise.try(() => next, internalType<FetchResponse>('FetchResponse')));
    const first = Promise.withResolvers<FetchResponse>();
    const second = Promise.withResolvers<FetchResponse>();
    f.operation.options.processResponse = vi.fn().mockImplementationOnce(first.resolve).mockImplementation(second.resolve);
    void f.operation.start();
    const redirect = await first.promise;
    expect(redirect.status).toBe(302);
    expect(f.request.redirectCount).toBe(0);
    expect(f.request.navigationTimingAllowValuesList).toEqual([['*']]);
    f.operation.controller.processNextManualRedirect();
    expect((await second.promise).status).toBe(200);
    expect(f.request.redirectCount).toBe(1);
    expect(f.userAgent.handleFetch).toHaveBeenCalledTimes(2);
  });

  it('delivers a network error when a manual navigation continues to an invalid target', async () => {
    const f = createFixture();
    f.request.mode = 'navigate';
    f.request.destination = 'document';
    f.request.redirectMode = 'manual';
    f.response.status = 302;
    f.response.headerList.append('Location', 'data:text/plain,blocked');
    const delivered = Promise.withResolvers<FetchResponse>();
    f.operation.options.processResponse = vi.fn().mockImplementationOnce(() => {}).mockImplementation(delivered.resolve);
    await f.operation.start();
    f.operation.controller.processNextManualRedirect();
    expect((await delivered.promise).type).toBe('error');
  });
});

describe('Fetch §4.5: redirect target and request updates', () => {
  it('returns the same response when Location is absent, without another fetch', async () => {
    const f = createFixture();
    f.response.status = 302;
    const main = vi.spyOn(f.userAgent, 'potentiallyOverrideResponse');
    expect(await f.operation.start()).toHaveProperty('internalResponse', f.receivedResponse);
    expect(f.network).toHaveBeenCalledOnce();
    expect(main).toHaveBeenCalledOnce();
    expect(f.request.redirectCount).toBe(0);
  });

  it.each(['http://[broken', 'data:text/plain,no', 'file:///no', 'blob:https://example.test/no'])(
    'rejects the redirect target %s', async (location) => {
      const f = createFixture();
      f.response.status = 302;
      f.response.headerList.append('Location', location);
      expect((await f.operation.start()).type).toBe('error');
      expect(f.request.redirectCount).toBe(0);
    },
  );

  it('allows the twentieth redirect and rejects the twenty-first', async () => {
    const f = createFixture();
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    const main = vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt('https://example.test/next')).mockReturnValueOnce(null);
    f.request.redirectCount = 19;
    expect((await f.operation.start()).status).toBe(200);
    expect(f.request.redirectCount).toBe(20);
    main.mockReturnValueOnce(null);
    expect((await f.operation.start()).type).toBe('error');
    expect(main).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['https://user:pass@other.test/next', 'cors', 'basic', true],
    ['https://user:pass@example.test/next', 'cors', 'basic', false],
    ['https://user:pass@example.test/next', 'cors', 'cors', true],
    ['https://user:pass@other.test/next', 'no-cors', 'opaque', false],
  ] as [string, RequestMode, FetchRequest['responseTainting'], boolean][])(
    'checks URL credentials for %s with %s/%s', async (location, mode, taint, blocked) => {
      const f = createFixture();
      f.request.mode = mode;
      f.request.responseTainting = taint;
      f.response.status = 302;
      f.response.headerList.append('Location', location);
      const main = vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt(location)).mockReturnValueOnce(null);
      expect((await f.operation.start()).type === 'error').toBe(blocked);
      expect(main).toHaveBeenCalledTimes(blocked ? 1 : 2);
    },
  );

  it.each([
    [301, 'POST', 'GET'], [302, 'POST', 'GET'], [303, 'PUT', 'GET'],
    [303, 'GET', 'GET'], [303, 'HEAD', 'HEAD'], [301, 'PUT', 'PUT'],
    [302, 'PUT', 'PUT'], [307, 'POST', 'POST'], [308, 'POST', 'POST'],
  ])('rewrites %i %s to %s with the matching body and header treatment', async (status, method, expected) => {
    const f = createFixture();
    f.request.method = method;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    if (hasBody) f.request.body = FetchBody.fromBytes(utf8Encode('body'), f.env);
    for (const name of ['Content-Type', 'content-ENCODING', 'Content-Language', 'Content-Location']) {
      f.request.headerList.append(name, 'value');
    }
    f.request.headerList.append('X-Keep', 'value');
    f.response.status = status;
    f.response.headerList.append('Location', '/next');
    vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt('https://example.test/next')).mockReturnValueOnce(null);
    expect((await f.operation.start()).status).toBe(200);
    expect(f.request.redirectCount).toBe(1);
    const rewritten = method !== expected;
    expect(f.request.method).toBe(expected);
    expect(f.request.headerList.has('Content-Type')).toBe(!rewritten);
    expect(f.request.headerList.has('Content-Encoding')).toBe(!rewritten);
    expect(f.request.headerList.has('Content-Language')).toBe(!rewritten);
    expect(f.request.headerList.has('Content-Location')).toBe(!rewritten);
    expect(f.request.headerList.get('X-Keep')).toBe('value');
    if (rewritten || !hasBody) expect(f.request.body).toBeNull();
    else expect(utf8Decode(await readBodyBytes(f.request.body as FetchBody))).toBe('body');
  });

  it.each([301, 302, 307, 308])('rejects a streamed body without a replay source for %i', async (status) => {
    const f = createFixture();
    f.request.method = 'POST';
    f.request.body = new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, f.env), f.env);
    f.response.status = status;
    f.response.headerList.append('Location', '/next');
    expect((await f.operation.start()).type).toBe('error');
    expect(f.request.method).toBe('POST');
  });

  it('drops a streamed body for a 303 without requiring it to be replayable', async () => {
    const f = createFixture();
    f.request.method = 'POST';
    f.request.body = new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, f.env), f.env);
    f.response.status = 303;
    f.response.headerList.append('Location', '/next');
    vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt('https://example.test/next')).mockReturnValueOnce(null);
    expect((await f.operation.start()).status).toBe(200);
    expect(f.request.body).toBeNull();
    expect(f.request.method).toBe('GET');
  });

  it.each(['https://example.test/next', 'https://other.test/next'])('handles Authorization when redirecting to %s', async (location) => {
    const f = createFixture();
    f.request.headerList.append('AUTHORIZATION', 'Bearer secret');
    f.request.headerList.append('X-Keep', 'value');
    f.response.status = 302;
    f.response.headerList.append('Location', location);
    vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt(location)).mockReturnValueOnce(null);
    await f.operation.start();
    expect(f.request.headerList.has('Authorization')).toBe(location.includes('example.test'));
    expect(f.request.headerList.get('X-Keep')).toBe('value');
  });

  it('replays a consumed Blob on the fetching environment', async () => {
    const f = createFixture();
    f.request.method = 'PUT';
    const blob = new BlobImpl(['upload'], {}, f.env);
    f.request.body = FetchBody.extract(blob, false, f.env).body;
    const original = f.request.body;
    expect(utf8Decode(await readBodyBytes(original))).toBe('upload');
    f.response.status = 307;
    f.response.headerList.append('Location', '/next');
    vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt('https://example.test/next')).mockReturnValueOnce(null);
    await f.operation.start();
    expect(f.request.body).not.toBe(original);
    expect(f.request.body.stream.env).toBe(f.env);
    expect(utf8Decode(await readBodyBytes(f.request.body))).toBe('upload');
  });

  it.each([307, 308])('preserves the multipart boundary when replaying a FormData body after %i', async (status) => {
    const f = createFixture();
    const data = new FormDataImpl(undefined, null, f.env);
    data.append(toScalarValueString('field'), toScalarValueString('value'));
    const extracted = FetchBody.extract(data, false, f.env);
    f.request.method = 'POST';
    f.request.body = extracted.body;
    f.request.headerList.append('Content-Type', extracted.type!);
    const original = utf8Decode(await readBodyBytes(extracted.body));
    f.response.status = status;
    f.response.headerList.append('Location', '/next');
    vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockReturnValue(responseAt('https://example.test/next')).mockReturnValueOnce(null);
    await f.operation.start();
    expect(f.request.headerList.get('Content-Type')).toBe(extracted.type);
    expect(utf8Decode(await readBodyBytes(f.request.body))).toBe(original);
  });

  it('replays captured multipart fields and lazy File data across repeated redirects', async () => {
    const f = createFixture();
    const read = vi.fn(() => Promise.resolve(Uint8Array.of(0, 128, 255)));
    const file = new FileImpl([], 'original.bin', {}, f.env);
    file.setSerializationState({
      data: BlobData.fromSource({ size: 3, snapshotState: undefined, read }),
      type: 'application/octet-stream', snapshotState: undefined,
    });
    const data = new FormDataImpl(undefined, null, f.env);
    data.append(toScalarValueString('field'), toScalarValueString('original'));
    data.append(toScalarValueString('file'), file);
    const extracted = FetchBody.extract(data, false, f.env);
    f.request.method = 'POST';
    f.request.body = extracted.body;
    f.request.headerList.append('Content-Type', extracted.type!);
    expect(read).not.toHaveBeenCalled();
    const original = await readBodyBytes(extracted.body);
    expect(read).toHaveBeenCalledExactlyOnceWith(0, 3);

    data.set(toScalarValueString('field'), toScalarValueString('changed'));
    data.delete(toScalarValueString('file'));
    data.append(toScalarValueString('later'), toScalarValueString('ignored'));
    const main = vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockImplementation(() =>
      responseAt(serializeURL(f.request.currentURL)));
    for (const status of [307, 308]) {
      const response = responseAt(serializeURL(f.request.currentURL));
      response.status = status;
      response.headerList.append('Location', `/next-${status}`);
      const previous = f.request.body;
      f.network.mockReturnValueOnce(f.userAgent.HostPromise.fromValue(response, Promise, internalType<FetchResponse>('FetchResponse')));
      main.mockReturnValueOnce(null);
      await f.operation.start();
      expect(f.request.body).not.toBe(previous);
      expect(f.request.body.stream.env).toBe(f.env);
      expect(f.request.body.length).toBe(original.length);
      expect(f.request.headerList.get('Content-Type')).toBe(extracted.type);
      expect(await readBodyBytes(f.request.body)).toEqual(original);
    }
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('updates URL, referrer policy, and timing before recursive main fetch, including without a client', async () => {
    const f = createFixture('https://example.test/start#kept');
    f.request.client = null;
    f.request.destination = 'report';
    f.request.referrerPolicy = 'unsafe-url';
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.response.headerList.append('Referrer-Policy', 'no-referrer');
    f.request.mode = 'navigate';
    f.request.destination = 'document';
    f.request.referrer = null;
    vi.spyOn(f.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(123.45678).mockReturnValueOnce(1);
    const main = vi.spyOn(f.userAgent, 'potentiallyOverrideResponse').mockImplementation(() => {
      expect(serializeURL(f.request.currentURL)).toBe('https://example.test/next#kept');
      expect(f.request.referrerPolicy).toBe('no-referrer');
      return responseAt('https://example.test/next');
    }).mockReturnValueOnce(null);
    await f.operation.start();
    expect(main).toHaveBeenCalledTimes(2);
    expect(main).toHaveBeenLastCalledWith(f.request, f.env);
    expect(f.operation.controller.extractFullTimingInfo().redirectStartTime).toBe(1);
    expect(f.operation.controller.extractFullTimingInfo().redirectEndTime).toBe(coarsenTime(123.45678, false));
    expect(f.operation.controller.extractFullTimingInfo().postRedirectStartTime).toBe(f.operation.controller.extractFullTimingInfo().redirectEndTime);
    expect(f.request.urlList).toHaveLength(2);
    expect(serializeURL(f.request.url)).toBe('https://example.test/start#kept');
  });
});

describe('HTTP redirects through main fetch', () => {
  it('re-enters main policy and delivers the final body through the automatic Window loop', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate('https://example.test/page');
    const env = getRelevantRealm(browlet.window).env;
    const request = new FetchRequest(env.parseURL('https://example.test/start').url!, env, env.userAgent);
    request.allowServiceWorkerInterception = false;
    const started = vi.spyOn(env.userAgent, 'webDriverBiDiResponseCompleted');
    const reportCSP = vi.spyOn(request, 'reportCSPViolations');
    const checks: string[] = [];
    mockHTTPTransport(env.userAgent, (request, listener) => {
      checks.push(serializeURL(request.url));
      const headers = new FetchHeaders();
      if (checks.length === 1) {
        headers.append('Location', '/final');
        headers.append('Referrer-Policy', 'no-referrer');
        listener.onHeaders(302, '', headers, false);
      } else {
        listener.onHeaders(200, '', headers, false);
        listener.onData(utf8Encode('final body'));
      }
      listener.onEnd();
    });
    const result = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
    fetch(request, { processResponseConsumeBody: (response, body) => result.resolve({ response, body }) }, env);
    const { response, body } = await result.promise;
    expect(checks).toEqual(['https://example.test/start', 'https://example.test/final']);
    expect(response.type).toBe('basic');
    expect(utf8Decode(body as Uint8Array)).toBe('final body');
    expect(request.referrerPolicy).toBe('no-referrer');
    expect(request.referrer).toBeNull();
    expect(request.redirectCount).toBe(1);
    expect(reportCSP).toHaveBeenCalledTimes(2);
    expect(started).toHaveBeenCalledTimes(2);
  });
});

// The transport, worker interception, and policy checks are controlled independently.
function createFixture(url = 'https://example.test/resource') {
  const client = createPolicyEnvironment('https://example.test/page');
  const userAgent = Object.assign(client.userAgent, {
    handleFetch: vi.spyOn(client.userAgent, 'handleFetch'),
    webDriverBiDiResponseStarted: vi.spyOn(client.userAgent, 'webDriverBiDiResponseStarted'),
  });
  const env = userAgent.sandbox;
  const request = new FetchRequest(userAgent.parseURL(url).url!, client, userAgent);
  request.populateFromClient();
  request.mode = 'cors';
  const response = responseAt(url);
  const network = vi.fn(() => userAgent.HostPromise.fromValue(response, Promise, internalType<FetchResponse>('FetchResponse')));
  const preflight = vi.fn(() => {
    const allowed = new FetchResponse();
    allowed.headerList.append('Access-Control-Allow-Methods', 'PUT');
    allowed.headerList.append('Access-Control-Allow-Headers', 'X-Custom');
    return userAgent.HostPromise.fromValue(allowed, Promise, internalType<FetchResponse>('FetchResponse'));
  });
  const cors = vi.spyOn(FetchResponse.prototype, 'isBlockedByCORS').mockReturnValue(false);
  const timing = vi.spyOn(FetchResponse.prototype, 'isTimingBlocked').mockReturnValue(false);
  mockHTTPTransport(userAgent, (wire, listener) => {
    const result = wire.method === 'OPTIONS' ? preflight() : network();
    result.observe((response) => {
      if (response.type === 'error') { listener.onError(new Error('network failed')); return; }
      listener.onHeaders(response.status, response.statusMessage, response.headerList, false);
      listener.onEnd();
    }, (error) => listener.onError(error));
  });
  const operation = createFetchOperation(request, env);
  operation.options.useParallelQueue = true;
  const cache = Object.assign(userAgent.corsPreflightCache, {
    matchesMethod: vi.spyOn(userAgent.corsPreflightCache, 'matchesMethod'),
    matchesHeaderName: vi.spyOn(userAgent.corsPreflightCache, 'matchesHeaderName'),
  });
  return {
    client, env, userAgent, request, response, operation, cache, network, preflight, cors, timing,
    get receivedResponse() { return userAgent.webDriverBiDiResponseStarted.mock.lastCall?.[1]; },
  };
}

function responseAt(url: string) {
  const response = new FetchResponse();
  response.urlList = [copyURL(parseURL(url).url!)];
  return response;
}

function workerTiming(): ServiceWorkerTimingInfo {
  return {
    startTime: 1, fetchEventDispatchTime: 2, workerRouterEvaluationStart: 0, workerCacheLookupStart: 0,
    workerMatchedRouterSource: '', workerFinalRouterSource: '',
  };
}
