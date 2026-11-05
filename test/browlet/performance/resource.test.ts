import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { PerformanceEntryImpl, PerformanceResourceTimingImpl } from '../../../src/browlet/performance/index';
import type { PerformanceResourceTiming, Window } from '../../../src/browlet/platform';
import { Moment, monotonicClock } from '../../../src/timing/index';
import type { CacheUsage } from '../../../src/fetch/index';
import { ConnectionTimingInfo, FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('Resource Timing entries', () => {
  it('projects the derived interface without permitting author construction', () => {
    const { window, env, implementation, entry } = fixture();
    expect(entry).toBeInstanceOf(window.PerformanceResourceTiming);
    expect(entry).toBeInstanceOf(window.PerformanceEntry);
    expect(Object.prototype.toString.call(entry)).toBe('[object PerformanceResourceTiming]');
    expect(() => Reflect.construct(window.PerformanceResourceTiming, [])).toThrow(window.TypeError);
    expect(Reflect.set(entry, 'initiatorType', 'script')).toBe(false);
    expect(getBindingContext(env.realm).project(PerformanceEntryImpl, implementation)).toBe(entry);
    expect(getRelevantRealm(entry)).toBe(env.realm);
  });

  it('exposes prepared records and relative timestamps through inherited default JSON', () => {
    const { entry } = fixture();
    expect(entry.toJSON()).toEqual({
      name: 'https://example.test/resource', entryType: 'resource', startTime: 1, duration: 19, navigationId: 0,
      initiatorType: 'fetch', deliveryType: '', nextHopProtocol: 'h2', workerStart: 4,
      redirectStart: 1, redirectEnd: 2, fetchStart: 3,
      domainLookupStart: 5, domainLookupEnd: 6, connectStart: 6, connectEnd: 8, secureConnectionStart: 7,
      requestStart: 9, finalResponseHeadersStart: 12, firstInterimResponseStart: 10,
      responseStart: 10, responseEnd: 20,
      workerRouterEvaluationStart: 3, workerCacheLookupStart: 4,
      workerMatchedRouterSource: 'cache', workerFinalRouterSource: 'network',
      transferSize: 320, encodedBodySize: 20, decodedBodySize: 40, responseStatus: 201,
      renderBlockingStatus: 'blocking', contentType: 'text/plain', contentEncoding: 'gzip',
      serverTiming: [],
    });
    expect('id' in entry).toBe(false);
    expect('workerMatchedSourceType' in entry).toBe(false);
    expect('workerFinalSourceType' in entry).toBe(false);
  });

  it('uses final headers when no informational response was recorded', () => {
    const { entry, timing } = fixture();
    timing.firstInterimNetworkResponseStartTime = 0;
    expect(entry.firstInterimResponseStart).toBe(0);
    expect(entry.responseStart).toBe(12);
    timing.finalNetworkResponseStartTime = 0;
    expect(entry.responseStart).toBe(0);
  });

  it('retains live body and timing records while initializing base entry timestamps once', () => {
    const { entry, timing, body } = fixture();
    body.encodedSize = 25;
    body.decodedSize = 50;
    body.contentType = 'application/json';
    body.contentEncoding = 'br';
    timing.endTime = 125;
    timing.renderBlocking = false;
    expect(entry.encodedBodySize).toBe(25);
    expect(entry.decodedBodySize).toBe(50);
    expect(entry.transferSize).toBe(325);
    expect(entry.contentType).toBe('application/json');
    expect(entry.contentEncoding).toBe('br');
    expect(entry.responseEnd).toBe(25);
    expect(entry.duration).toBe(19);
    expect(entry.renderBlockingStatus).toBe('non-blocking');
  });

  it.each([
    ['', '', 320], ['local', 'cache', 0], ['validated', 'cache', 300],
  ] as const)('reports cache mode %j without duplicating body-size accounting', (cacheMode, deliveryType, transferSize) => {
    const { entry } = fixture({ cacheMode });
    expect(entry.transferSize).toBe(transferSize);
    expect(entry.deliveryType).toBe(deliveryType);
    expect(entry.encodedBodySize).toBe(20);
    expect(entry.decodedBodySize).toBe(40);
  });

  it('preserves an explicitly supplied delivery type', () => {
    const { entry } = fixture({ cacheMode: 'local', deliveryType: 'navigational-prefetch' });
    expect(entry.deliveryType).toBe('navigational-prefetch');
  });

  it('distinguishes a permitted empty response from a hidden transfer', () => {
    const visible = fixture();
    visible.body.encodedSize = 0;
    visible.body.decodedSize = 0;
    expect(visible.entry.transferSize).toBe(300);
    const hidden = fixture({ allowTransferSize: false });
    expect(hidden.entry.transferSize).toBe(0);
    // TAO and CORS are independent: failure to expose timing need not hide a CORS-readable body.
    expect(hidden.entry.encodedBodySize).toBe(20);
  });

  it('preserves opaque duration while unavailable details are zero or empty', () => {
    const { env, timing } = fixture();
    const implementation = new PerformanceResourceTimingImpl(
      'fetch', 'https://foreign.test/resource', timing.createOpaque(), '', new ResponseBodyInfo(), 0, '', false, env,
    );
    const entry = getBindingContext(env.realm).project(PerformanceResourceTimingImpl, implementation) as PerformanceResourceTiming;
    expect(entry.startTime).toBe(1);
    expect(entry.fetchStart).toBe(1);
    expect(entry.responseEnd).toBe(20);
    expect(entry.duration).toBe(19);
    expect(entry.renderBlockingStatus).toBe('blocking');
    for (const name of [
      'redirectStart', 'redirectEnd', 'domainLookupStart', 'domainLookupEnd', 'connectStart', 'connectEnd',
      'secureConnectionStart', 'requestStart', 'firstInterimResponseStart', 'finalResponseHeadersStart',
      'responseStart', 'workerStart', 'workerRouterEvaluationStart', 'workerCacheLookupStart',
      'transferSize', 'encodedBodySize', 'decodedBodySize', 'responseStatus',
    ] as const) expect(entry[name], name).toBe(0);
    for (const name of [
      'nextHopProtocol', 'workerMatchedRouterSource', 'workerFinalRouterSource', 'contentType', 'contentEncoding',
    ] as const) expect(entry[name], name).toBe('');
  });

  it('decodes supplied protocol bytes isomorphically', () => {
    const { entry, timing } = fixture();
    timing.finalConnectionTimingInfo!.alpnNegotiatedProtocol = Uint8Array.of(0, 127, 128, 255);
    expect(entry.nextHopProtocol).toBe('\u0000\u007f\u0080\u00ff');
    timing.finalConnectionTimingInfo = null;
    expect(entry.nextHopProtocol).toBe('');
  });

  it('converts once in the receiver realm when getters are borrowed', () => {
    const first = fixture();
    const second = fixture({ timeOrigin: 50 });
    const prototype = second.window.PerformanceResourceTiming.prototype;
    expect(Reflect.get(prototype, 'responseEnd', first.entry)).toBe(20);
    expect(Reflect.get(prototype, 'responseEnd', second.entry)).toBe(70);
    expect(() => { Reflect.get(prototype, 'responseEnd', {}); }).toThrow(second.window.TypeError);
    const json = prototype.toJSON.call(first.entry) as object;
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(json).toMatchObject({ startTime: 1, responseEnd: 20, duration: 19 });
  });

  it('preserves the zero sentinel and does not coarsen or clamp an already prepared timestamp again', () => {
    const { env } = fixture();
    expect(PerformanceResourceTimingImpl.convertFetchTimestamp(0, env)).toBe(0);
    expect(PerformanceResourceTimingImpl.convertFetchTimestamp(100.125, env)).toBe(0.125);
    expect(PerformanceResourceTimingImpl.convertFetchTimestamp(99.5, env)).toBe(-0.5);
  });

  it('does not queue the entry or advertise the unfinished Resource Timing producer', () => {
    const { env, window } = fixture();
    expect(window.performance.getEntriesByType('resource')).toEqual([]);
    expect(window.PerformanceObserver.supportedEntryTypes).toContain('resource');
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
  });
});

/** Model completed Fetch observations while exercising real Browlet projection and time conversion. */
function fixture({
  timeOrigin = 100, cacheMode = '', deliveryType = '', allowTransferSize = true,
}: { timeOrigin?: number; cacheMode?: CacheUsage | ''; deliveryType?: string; allowTransferSize?: boolean; } = {}) {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const env = navigable.activeDocument!.env;
  vi.spyOn(env, 'timeOrigin', 'get').mockReturnValue(new Moment(monotonicClock, timeOrigin));
  const window = env.realm.globalObject as Window & typeof globalThis;
  const connection = Object.assign(new ConnectionTimingInfo(), {
    domainLookupStartTime: 105, domainLookupEndTime: 106, connectionStartTime: 106,
    connectionEndTime: 108, secureConnectionStartTime: 107, alpnNegotiatedProtocol: Uint8Array.of(104, 50),
  });
  const timing: FetchTimingInfo = Object.assign(new FetchTimingInfo(), {
    startTime: 101, redirectStartTime: 101, redirectEndTime: 102, postRedirectStartTime: 103,
    finalServiceWorkerStartTime: 104, finalNetworkRequestStartTime: 109,
    firstInterimNetworkResponseStartTime: 110, finalNetworkResponseStartTime: 112, endTime: 120,
    finalConnectionTimingInfo: connection, renderBlocking: true,
    serviceWorkerTimingInfo: {
      startTime: 103, fetchEventDispatchTime: 104, workerRouterEvaluationStart: 103, workerCacheLookupStart: 104,
      workerMatchedRouterSource: 'cache', workerFinalRouterSource: 'network',
    },
  });
  const body = Object.assign(new ResponseBodyInfo(), {
    encodedSize: 20, decodedSize: 40, contentType: 'text/plain', contentEncoding: 'gzip',
  });
  const implementation = new PerformanceResourceTimingImpl(
    'fetch', 'https://example.test/resource', timing, cacheMode, body, 201, deliveryType, allowTransferSize, env,
  );
  const entry = getBindingContext(env.realm).project(PerformanceResourceTimingImpl, implementation) as PerformanceResourceTiming;
  return { window, env, timing, body, implementation, entry };
}
