import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '../../src/fetch/fetch';
import { FetchHeaders } from '../../src/fetch/headers';
import { ConnectionTimingInfo, FetchTimingInfo, ResponseBodyInfo } from '../../src/fetch/timing';
import { createFetchRequest } from './fetch-fixture';
import { mockHTTPTransport } from './transport-fixture';

afterEach(() => { vi.restoreAllMocks(); });

describe('navigation timing handoff', () => {
  it('keeps completion on the shared clock until the timing entry selects its time origin', async () => {
    const request = createFetchRequest();
    request.client = request.env;
    request.destination = 'document';
    request.mode = 'navigate';
    request.initiatorType = 'fetch';
    vi.spyOn(request.env.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(100.543);
    const report = vi.spyOn(request.env, 'markResourceTiming');
    mockHTTPTransport(request.env.userAgent, (_request, listener) => {
      listener.onHeaders(200, 'OK', new FetchHeaders(), true);
      listener.onEnd();
    });
    const completed = Promise.withResolvers<void>();
    const controller = fetch(request, {
      useParallelQueue: true, processResponseEndOfBody: () => completed.resolve(),
    }, request.env);
    await completed.promise;
    controller.reportTiming(request.env);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]![0].endTime).toBe(100.5);
  });

  it.each(['document', 'iframe', 'frame', 'object', 'embed'] as const)(
    'retains full timing for a %s navigation before handing over the response', async (destination) => {
      const request = createFetchRequest();
      request.client = request.env;
      request.destination = destination;
      request.mode = 'navigate';
      mockHTTPTransport(request.env.userAgent, (_request, listener) => {
        listener.onHeaders(200, 'OK', new FetchHeaders(), true);
        listener.onEnd();
      });
      const received = Promise.withResolvers<void>();
      const controller = fetch(request, { useParallelQueue: true, processResponse: () => received.resolve() }, request.env);
      await received.promise;
      const timing = controller.extractFullTimingInfo();
      expect(timing.startTime).toBeGreaterThan(0);
      expect(timing.postRedirectStartTime).toBe(timing.startTime);
    },
  );
});

describe('Fetch timing records', () => {
  it('keeps timing lists and protocol byte sequences independent between records', () => {
    const first = new FetchTimingInfo();
    const second = new FetchTimingInfo();
    first.serverTimingHeaders.push('db;dur=1');
    expect(second.serverTimingHeaders).toEqual([]);
    const connection = new ConnectionTimingInfo();
    expect(connection).toEqual({
      domainLookupStartTime: 0,
      domainLookupEndTime: 0,
      connectionStartTime: 0,
      connectionEndTime: 0,
      secureConnectionStartTime: 0,
      alpnNegotiatedProtocol: new Uint8Array(),
    });
    expect(connection.alpnNegotiatedProtocol)
      .not.toBe(new ConnectionTimingInfo().alpnNegotiatedProtocol);
    expect(new ResponseBodyInfo()).toEqual({
      encodedSize: 0, decodedSize: 0, contentType: '', contentEncoding: '',
    });
  });

  it('keeps start, completion, and render blocking when hiding timing details', () => {
    const timing = Object.assign(new FetchTimingInfo(), {
      startTime: 1,
      redirectStartTime: 2,
      redirectEndTime: 3,
      postRedirectStartTime: 4,
      finalServiceWorkerStartTime: 5,
      finalNetworkRequestStartTime: 6,
      firstInterimNetworkResponseStartTime: 7,
      finalNetworkResponseStartTime: 8,
      endTime: 9,
      finalConnectionTimingInfo: new ConnectionTimingInfo(),
      serverTimingHeaders: ['db;dur=4'],
      renderBlocking: true,
    });
    const opaque = timing.createOpaque();

    expect(opaque).toEqual({
      startTime: 1,
      redirectStartTime: 0,
      redirectEndTime: 0,
      postRedirectStartTime: 1,
      finalServiceWorkerStartTime: 0,
      finalNetworkRequestStartTime: 0,
      firstInterimNetworkResponseStartTime: 0,
      finalNetworkResponseStartTime: 0,
      endTime: 9,
      finalConnectionTimingInfo: null,
      serviceWorkerTimingInfo: null,
      serverTimingHeaders: [],
      renderBlocking: true,
    });
    expect(timing.postRedirectStartTime).toBe(4);
    expect(timing.serverTimingHeaders).toEqual(['db;dur=4']);
    expect(opaque.serverTimingHeaders).not.toBe(timing.serverTimingHeaders);
  });
});
