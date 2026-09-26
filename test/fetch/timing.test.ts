import { describe, expect, it } from 'vitest';
import { ConnectionTimingInfo, FetchTimingInfo, ResponseBodyInfo } from '../../src/fetch/timing';

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

  it('makes opaque timing retain only start time, including post-redirect start', () => {
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
      endTime: 0,
      finalConnectionTimingInfo: null,
      serviceWorkerTimingInfo: null,
      serverTimingHeaders: [],
      renderBlocking: false,
    });
    expect(timing.postRedirectStartTime).toBe(4);
    expect(timing.serverTimingHeaders).toEqual(['db;dur=4']);
    expect(opaque.serverTimingHeaders).not.toBe(timing.serverTimingHeaders);
  });
});
