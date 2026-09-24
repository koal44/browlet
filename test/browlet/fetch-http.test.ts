import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { utf8Decode, utf8Encode } from '../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../src/fetch/body';
import { fetch } from '../../src/fetch/fetch';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, isFilteredResponse, type FilteredResponseType } from '../../src/fetch/response';
import { FetchTimingInfo, type ServiceWorkerTimingInfo } from '../../src/fetch/timing';
import { BlobData, BlobImpl, FileImpl } from '../../src/file/index';
import { toScalarValueString } from '../../src/infra/strings';
import { coarsenTime } from '../../src/infra/time';
import { ReadableStreamImpl } from '../../src/streams/index';
import { copyURL, parseURL, serializeURL } from '../../src/url/url';
import { FormDataImpl } from '../../src/xhr/form-data';
import { readBodyBytes } from '../fetch/body-fixture';
import { createPolicyEnvironment } from './browsing/policy/environment-fixture';
import { observe } from './streams/implementation-fixture';

afterEach(() => vi.restoreAllMocks());

describe('Fetch §4.4: HTTP response selection', () => {
  it('offers a clone to Service Workers and falls through to the network with the original request', async () => {
    const f = createFixture();
    f.request.headerList.append('X-Request', 'original');
    const response = await observe(f.params.httpFetch());
    const [copy, controller, isolated] = f.userAgent.handleFetch.mock.calls[0]!;
    expect(copy).not.toBe(f.request);
    expect(copy.currentURL).not.toBe(f.request.currentURL);
    expect(copy.headerList.list).toEqual(f.request.headerList.list);
    copy.headerList.set('X-Request', 'worker');
    expect(f.request.headerList.get('X-Request')).toBe('original');
    expect(controller).toBe(f.params.controller);
    expect(isolated).toBe(false);
    expect(response).toBe(f.response);
    expect(f.params.httpNetworkOrCacheFetch).toHaveBeenCalledExactlyOnceWith();
    expect(f.request.allowServiceWorkerInterception).toBe(false);
  });

  it('skips interception when disabled and retains it for a non-following network request', async () => {
    const f = createFixture();
    f.request.allowServiceWorkerInterception = false;
    await observe(f.params.httpFetch());
    expect(f.userAgent.handleFetch).not.toHaveBeenCalled();
    f.request.allowServiceWorkerInterception = true;
    f.request.redirectMode = 'manual';
    await observe(f.params.httpFetch());
    expect(f.request.allowServiceWorkerInterception).toBe(true);
  });

  it('waits for interception and keeps Service Worker responses out of network CORS and TAO checks', async () => {
    const f = createFixture();
    const pending = f.userAgent.hostPromises.withResolvers<FetchResponse | ServiceWorkerTimingInfo | null>();
    f.userAgent.handleFetch.mockReturnValue(pending.promise);
    f.request.responseTainting = 'cors';
    f.params.crossOriginIsolatedCapability = true;
    vi.spyOn(f.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(12.34567);
    f.response.serviceWorkerTimingInfo = workerTiming();
    const result = observe(f.params.httpFetch(true));
    expect(f.params.httpNetworkOrCacheFetch).not.toHaveBeenCalled();
    pending.resolve(f.response);
    expect(await result).toBe(f.response);
    expect(f.params.corsPreflightFetch).not.toHaveBeenCalled();
    expect(f.response.isBlockedByCORS).not.toHaveBeenCalled();
    expect(f.response.isTimingAllowed).not.toHaveBeenCalled();
    expect(f.params.timingInfo.finalServiceWorkerStartTime).toBe(coarsenTime(12.34567, true));
    expect(f.params.timingInfo.serviceWorkerTimingInfo).toBe(f.response.serviceWorkerTimingInfo);
    expect(f.userAgent.webDriverBiDiResponseStarted).toHaveBeenCalledExactlyOnceWith(f.request, f.response);
  });

  it('retains Service Worker timing even when the worker supplies no response', async () => {
    const f = createFixture();
    const timing = workerTiming();
    f.userAgent.handleFetch.mockReturnValue(f.userAgent.hostPromises.try(() => timing));
    expect(await observe(f.params.httpFetch())).toBe(f.response);
    expect(f.params.timingInfo.serviceWorkerTimingInfo).toBe(timing);
    expect(f.params.timingInfo.finalServiceWorkerStartTime).toBe(0);
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
      f.userAgent.handleFetch.mockReturnValue(f.userAgent.hostPromises.try(() => worker));
      expect((await observe(f.params.httpFetch())).type).toBe('error');
      expect(f.params.httpNetworkOrCacheFetch).not.toHaveBeenCalled();
    },
  );

  it('preserves a worker network error without network fallback or CORP processing', async () => {
    const f = createFixture();
    f.request.responseTainting = 'opaque';
    f.client.policyContainer.embedderPolicy.value = 'require-corp';
    const error = FetchResponse.networkError();
    f.userAgent.handleFetch.mockReturnValue(f.userAgent.hostPromises.try(() => error));
    expect((await observe(f.params.httpFetch())).type).toBe('error');
    expect(f.params.httpNetworkOrCacheFetch).not.toHaveBeenCalled();
  });

  it('transforms worker upload chunks and cancels the original branch after interception', async () => {
    const f = createFixture();
    f.request.method = 'POST';
    f.request.body = FetchBody.fromBytes(utf8Encode('upload'), f.env);
    const body = f.request.body;
    const bytes = Promise.withResolvers<Uint8Array>();
    f.userAgent.handleFetch.mockImplementation((copy) => {
      expect(copy.body).toBeInstanceOf(FetchBody);
      (copy.body as FetchBody).fullyRead(bytes.resolve, bytes.reject);
      return f.userAgent.hostPromises.try(() => f.response);
    });
    expect(await observe(f.params.httpFetch())).toBe(f.response);
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
    vi.spyOn(f.params.controller, 'terminate').mockImplementation(() => {
      f.params.controller.state = 'terminated';
      terminated.resolve();
    });
    f.userAgent.handleFetch.mockImplementation((copy) => {
      (copy.body as FetchBody).fullyRead(() => {}, () => {});
      return f.userAgent.hostPromises.try(() => f.response);
    });
    await observe(f.params.httpFetch());
    await terminated.promise;
    expect(f.params.controller.state).toBe('terminated');
  });
});

describe('HTTP preflight selection and response checks', () => {
  it('does not inspect the permission cache unless preflight was requested', async () => {
    const f = createFixture();
    f.request.method = 'PUT';
    f.request.headerList.append('X-Custom', 'value');
    await observe(f.params.httpFetch());
    expect(f.cache.matchesMethod).not.toHaveBeenCalled();
    expect(f.cache.matchesHeaderName).not.toHaveBeenCalled();
    expect(f.params.corsPreflightFetch).not.toHaveBeenCalled();
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
      const f = createFixture();
      f.request.method = method;
      f.request.useCORSPreflight = forced;
      f.cache.matchesMethod.mockReturnValue(methodCached);
      f.cache.matchesHeaderName.mockReturnValue(headerCached);
      if (hasHeader) f.request.headerList.append('X-Custom', 'value');
      await observe(f.params.httpFetch(true));
      expect(f.params.corsPreflightFetch).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(f.params.httpNetworkOrCacheFetch).toHaveBeenCalledOnce();
    },
  );

  it('waits for a successful preflight and stops before transport on failure', async () => {
    const f = createFixture();
    f.request.method = 'PUT';
    const pending = f.userAgent.hostPromises.withResolvers<FetchResponse>();
    f.params.corsPreflightFetch.mockReturnValue(pending.promise);
    const result = observe(f.params.httpFetch(true));
    expect(f.params.httpNetworkOrCacheFetch).not.toHaveBeenCalled();
    const error = FetchResponse.abortedNetworkError();
    pending.resolve(error);
    expect(await result).toBe(error);
    expect(f.params.httpNetworkOrCacheFetch).not.toHaveBeenCalled();
    expect(f.request.allowServiceWorkerInterception).toBe(true);
  });

  it('checks CORS only for a CORS-tainted network response, before TAO or redirect handling', async () => {
    const f = createFixture();
    f.request.responseTainting = 'cors';
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.response.isBlockedByCORS.mockReturnValue(true);
    expect((await observe(f.params.httpFetch())).type).toBe('error');
    expect(f.response.isBlockedByCORS).toHaveBeenCalledExactlyOnceWith(f.request);
    expect(f.response.isTimingAllowed).not.toHaveBeenCalled();
    expect(f.request.redirectCount).toBe(0);
  });

  it('records a TAO failure without blocking the response or clearing an earlier failure', async () => {
    const f = createFixture();
    f.response.isTimingAllowed.mockReturnValue(false);
    expect(await observe(f.params.httpFetch())).toBe(f.response);
    expect(f.request.timingAllowFailed).toBe(true);
    f.response.isTimingAllowed.mockReturnValue(true);
    await observe(f.params.httpFetch());
    expect(f.request.timingAllowFailed).toBe(true);
    expect(f.response.isBlockedByCORS).not.toHaveBeenCalled();
  });

  it.each(['network', 'worker'])('checks CORP against the internal %s response', async (source) => {
    const f = createFixture('https://other.test/resource');
    f.request.mode = 'no-cors';
    f.response.headerList.append('Cross-Origin-Resource-Policy', 'same-origin');
    if (source === 'worker') {
      f.userAgent.handleFetch.mockReturnValue(f.userAgent.hostPromises.try(() => f.response.filter('opaque')));
    } else {
      f.request.responseTainting = 'opaque';
    }
    expect((await observe(f.params.httpFetch())).type).toBe('error');
  });

  it.each([
    [null, 'default'],
    ['same-origin', 'error'],
  ])('checks CORP for a clientless request with response policy %s', async (policy, expectedType) => {
    const f = createFixture('https://other.test/resource');
    // Fetch permits background consumers to retain origin and policy state without a client.
    // The fixture has already populated those fields from the initiating environment.
    f.request.client = null;
    f.request.mode = 'no-cors';
    f.request.referrer = null;
    f.request.allowServiceWorkerInterception = false;
    if (policy !== null) f.response.headerList.append('Cross-Origin-Resource-Policy', policy);
    const response = await observe(f.params.mainFetch(true));
    expect(f.request.responseTainting).toBe('opaque');
    expect(response.type).toBe(expectedType);
  });

  it.each([
    ['require-corp', 'error'],
    ['unsafe-none', 'default'],
  ] as const)('uses retained clientless COEP %s without reporting', async (value, expectedType) => {
    const f = createFixture('https://other.test/resource');
    f.client.policyContainer.embedderPolicy.value = value;
    f.client.policyContainer.embedderPolicy.reportOnlyValue = 'require-corp';
    f.request.policyContainer = f.client.policyContainer.clone();
    f.request.client = null;
    f.request.mode = 'no-cors';
    f.request.referrer = null;
    f.request.allowServiceWorkerInterception = false;
    const queueReport = vi.spyOn(f.client, 'queueReport');
    expect((await observe(f.params.mainFetch(true))).type).toBe(expectedType);
    expect(queueReport).not.toHaveBeenCalled();
  });

  it('keeps the live client policy when the retained request policy differs', async () => {
    const f = createFixture('https://other.test/resource');
    f.request.mode = 'no-cors';
    f.client.policyContainer.embedderPolicy.value = 'require-corp';
    const queueReport = vi.spyOn(f.client, 'queueReport');
    expect(f.request.policyContainer!.embedderPolicy.value).toBe('unsafe-none');
    expect((await observe(f.params.mainFetch(true))).type).toBe('error');
    expect(queueReport).toHaveBeenCalledOnce();
  });
});

describe('HTTP redirect modes', () => {
  it('rejects redirects when redirect mode is error', async () => {
    const f = createFixture();
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.request.redirectMode = 'error';
    expect((await observe(f.params.httpFetch())).type).toBe('error');
    expect(f.request.redirectCount).toBe(0);
  });

  it('returns an opaque redirect for a non-navigation manual request', async () => {
    const f = createFixture();
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.request.redirectMode = 'manual';
    const response = await observe(f.params.httpFetch());
    expect(response.type).toBe('opaqueredirect');
    expect(response.status).toBe(0);
    expect(isFilteredResponse(response) && response.internalResponse).toBe(f.response);
    expect(f.params.controller.nextManualRedirectSteps).toBeNull();
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
    f.params.httpNetworkOrCacheFetch.mockReturnValueOnce(f.userAgent.hostPromises.try(() => f.response))
      .mockReturnValue(f.userAgent.hostPromises.try(() => next));
    const first = Promise.withResolvers<FetchResponse>();
    const second = Promise.withResolvers<FetchResponse>();
    f.params.processResponse = vi.fn().mockImplementationOnce(first.resolve).mockImplementation(second.resolve);
    f.params.mainFetch();
    const redirect = await first.promise;
    expect(redirect.status).toBe(302);
    expect(f.request.redirectCount).toBe(0);
    expect(f.request.navigationTimingAllowValuesList).toEqual([['*']]);
    f.params.controller.processNextManualRedirect();
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
    await observe(f.params.httpFetch());
    const delivered = Promise.withResolvers<FetchResponse>();
    f.params.processResponse = delivered.resolve;
    f.params.controller.processNextManualRedirect();
    expect((await delivered.promise).type).toBe('error');
  });
});

describe('Fetch §4.5: redirect target and request updates', () => {
  it('returns the same response when Location is absent, without another fetch', async () => {
    const f = createFixture();
    f.response.status = 302;
    const main = vi.spyOn(f.params, 'mainFetch');
    expect(await observe(f.params.httpRedirectFetch(f.response))).toBe(f.response);
    expect(main).not.toHaveBeenCalled();
    expect(f.request.redirectCount).toBe(0);
  });

  it.each(['http://[broken', 'data:text/plain,no', 'file:///no', 'blob:https://example.test/no'])(
    'rejects the redirect target %s', async (location) => {
      const f = createFixture();
      f.response.status = 302;
      f.response.headerList.append('Location', location);
      expect((await observe(f.params.httpRedirectFetch(f.response)))!.type).toBe('error');
      expect(f.request.redirectCount).toBe(0);
    },
  );

  it('allows the twentieth redirect and rejects the twenty-first', async () => {
    const f = createFixture();
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    const main = vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt('https://example.test/next')));
    f.request.redirectCount = 19;
    expect((await observe(f.params.httpRedirectFetch(f.response)))!.status).toBe(200);
    expect(f.request.redirectCount).toBe(20);
    expect((await observe(f.params.httpRedirectFetch(f.response)))!.type).toBe('error');
    expect(main).toHaveBeenCalledOnce();
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
      const main = vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt(location)));
      expect((await observe(f.params.httpRedirectFetch(f.response)))!.type === 'error').toBe(blocked);
      expect(main).toHaveBeenCalledTimes(blocked ? 0 : 1);
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
    vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt('https://example.test/next')));
    await observe(f.params.httpRedirectFetch(f.response));
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
    expect((await observe(f.params.httpRedirectFetch(f.response)))!.type).toBe('error');
    expect(f.request.method).toBe('POST');
  });

  it('drops a streamed body for a 303 without requiring it to be replayable', async () => {
    const f = createFixture();
    f.request.method = 'POST';
    f.request.body = new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, f.env), f.env);
    f.response.status = 303;
    f.response.headerList.append('Location', '/next');
    vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt('https://example.test/next')));
    expect((await observe(f.params.httpRedirectFetch(f.response)))!.status).toBe(200);
    expect(f.request.body).toBeNull();
    expect(f.request.method).toBe('GET');
  });

  it.each(['https://example.test/next', 'https://other.test/next'])('handles Authorization when redirecting to %s', async (location) => {
    const f = createFixture();
    f.request.headerList.append('AUTHORIZATION', 'Bearer secret');
    f.request.headerList.append('X-Keep', 'value');
    f.response.status = 302;
    f.response.headerList.append('Location', location);
    vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt(location)));
    await observe(f.params.httpRedirectFetch(f.response));
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
    vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt('https://example.test/next')));
    await observe(f.params.httpRedirectFetch(f.response));
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
    vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.userAgent.hostPromises.try(() => responseAt('https://example.test/next')));
    await observe(f.params.httpRedirectFetch(f.response));
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
    vi.spyOn(f.params, 'mainFetch').mockImplementation(() =>
      f.userAgent.hostPromises.try(() => responseAt(serializeURL(f.request.currentURL))));
    for (const status of [307, 308]) {
      const response = responseAt(serializeURL(f.request.currentURL));
      response.status = status;
      response.headerList.append('Location', `/next-${status}`);
      const previous = f.request.body;
      await observe(f.params.httpRedirectFetch(response));
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
    f.request.referrerPolicy = 'unsafe-url';
    f.response.status = 302;
    f.response.headerList.append('Location', '/next');
    f.response.headerList.append('Referrer-Policy', 'no-referrer');
    f.params.timingInfo.startTime = 1;
    f.params.crossOriginIsolatedCapability = true;
    vi.spyOn(f.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(123.45678);
    const main = vi.spyOn(f.params, 'mainFetch').mockImplementation(() => {
      expect(serializeURL(f.request.currentURL)).toBe('https://example.test/next#kept');
      expect(f.request.referrerPolicy).toBe('no-referrer');
      return f.userAgent.hostPromises.try(() => responseAt('https://example.test/next'));
    });
    await observe(f.params.httpRedirectFetch(f.response.filter('basic')));
    expect(main).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.params.timingInfo.redirectStartTime).toBe(1);
    expect(f.params.timingInfo.redirectEndTime).toBe(coarsenTime(123.45678, true));
    expect(f.params.timingInfo.postRedirectStartTime).toBe(f.params.timingInfo.redirectEndTime);
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
    // Slice 9's network/cache operation supplies already-associated response URLs.
    vi.spyOn(FetchParams.prototype, 'httpNetworkOrCacheFetch').mockImplementation(
      function(this: FetchParams) {
        checks.push(serializeURL(this.request.currentURL));
        const response = responseAt(serializeURL(this.request.currentURL));
        if (checks.length === 1) {
          response.status = 302;
          response.headerList.append('Location', '/final');
          response.headerList.append('Referrer-Policy', 'no-referrer');
        } else {
          response.body = FetchBody.fromBytes(utf8Encode('final body'), env);
        }
        return env.userAgent.hostPromises.try(() => response);
      },
    );
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

// Control only the later Fetch algorithms and external Service Worker/BiDi boundaries.
// These tests exercise orchestration; they do not implement the provisional dependencies.
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
  const params = Object.assign(new FetchParams(request, new FetchTimingInfo(), env), {
    corsPreflightFetch: vi.fn<FetchParams['corsPreflightFetch']>(() => userAgent.hostPromises.try(() => new FetchResponse())),
    httpNetworkOrCacheFetch: vi.fn<FetchParams['httpNetworkOrCacheFetch']>(() => userAgent.hostPromises.try<FetchResponse>(() => response)),
  });
  params.taskDestination = env.exec.global;
  const cache = Object.assign(userAgent.corsPreflightCache, {
    matchesMethod: vi.spyOn(userAgent.corsPreflightCache, 'matchesMethod'),
    matchesHeaderName: vi.spyOn(userAgent.corsPreflightCache, 'matchesHeaderName'),
  });
  return { client, env, userAgent, request, response, params, cache };
}

function responseAt(url: string) {
  const response = Object.assign(new FetchResponse(), {
    isBlockedByCORS: vi.fn<FetchResponse['isBlockedByCORS']>(() => false),
    isTimingAllowed: vi.fn<FetchResponse['isTimingAllowed']>(() => true),
  });
  response.urlList = [copyURL(parseURL(url).url!)];
  return response;
}

function workerTiming(): ServiceWorkerTimingInfo {
  return {
    startTime: 1, fetchEventDispatchTime: 2, workerRouterEvaluationStart: 0, workerCacheLookupStart: 0,
    workerMatchedRouterSource: '', workerFinalRouterSource: '',
  };
}
