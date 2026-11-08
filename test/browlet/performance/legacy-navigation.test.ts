import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { NavigationParams, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { SandboxingFlagSet } from '../../../src/browlet/browsing/policy/index';
import { PerformanceNavigationTimingImpl, type NavigationTimingType } from '../../../src/browlet/performance/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { DedicatedWorkerAgent } from '../../../src/browlet/scripting/index';
import type { Window } from '../../../src/browlet/platform';
import { FetchResponse } from '../../../src/fetch/index';
import { ConnectionTimingInfo, FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { Duration } from '../../../src/timing/index';
import { parseURL, serializeURL } from '../../../src/url/index';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => vi.restoreAllMocks());

describe('legacy PerformanceTiming', () => {
  it('exposes one read-only, realm-owned object without an author constructor', () => {
    const { window, timing } = fixture();
    expect(timing).toBe(window.performance.timing);
    expect(timing).toBeInstanceOf(window.PerformanceTiming);
    expect(Object.prototype.toString.call(timing)).toBe('[object PerformanceTiming]');
    expect(() => Reflect.construct(window.PerformanceTiming, [])).toThrow(window.TypeError);
    expect(Reflect.set(window.performance, 'timing', {})).toBe(false);
    expect(Reflect.set(timing, 'navigationStart', 0)).toBe(false);
    expect(Object.keys(timing.toJSON())).toEqual([
      'navigationStart', 'unloadEventStart', 'unloadEventEnd', 'redirectStart', 'redirectEnd',
      'fetchStart', 'domainLookupStart', 'domainLookupEnd', 'connectStart', 'connectEnd',
      'secureConnectionStart', 'requestStart', 'responseStart', 'responseEnd', 'domLoading',
      'domInteractive', 'domContentLoadedEventStart', 'domContentLoadedEventEnd', 'domComplete',
      'loadEventStart', 'loadEventEnd',
    ]);
    expect(JSON.parse(JSON.stringify(timing))).toEqual(timing.toJSON());
  });

  it('uses the receiver for borrowed getters and the called method realm for JSON', () => {
    const first = fixture();
    const second = fixture();
    expect(Reflect.get(second.window.Performance.prototype, 'timing', first.window.performance)).toBe(first.timing);
    const json: unknown = second.window.PerformanceTiming.prototype.toJSON.call(first.timing);
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(() => { Reflect.get(second.window.Performance.prototype, 'timing', {}); }).toThrow(second.window.TypeError);
    expect(() => { second.window.PerformanceTiming.prototype.toJSON.call({} as typeof first.timing); }).toThrow(second.window.TypeError);
  });

  it('converts shared Fetch clocks once and floors the combined epoch timestamp', () => {
    const { timing, document } = fixture();
    Object.assign(document.loadTimingInfo, {
      domInteractiveTime: 21.5, domContentLoadedEventStartTime: 22.5,
      domContentLoadedEventEndTime: 23.5, domCompleteTime: 24.5,
      loadEventStartTime: 25.5, loadEventEndTime: 26.5,
    });
    document.domLoadingTime = 1.5;
    Object.assign(document.previousDocumentUnloadTiming, { unloadEventStartTime: 2.5, unloadEventEndTime: 3.5 });
    expect(timing.toJSON()).toEqual({
      navigationStart: 1000, unloadEventStart: 1003, unloadEventEnd: 1004,
      redirectStart: 1001, redirectEnd: 1002, fetchStart: 1003,
      domainLookupStart: 1004, domainLookupEnd: 1005, connectStart: 1005, connectEnd: 1006,
      secureConnectionStart: 0, requestStart: 1007, responseStart: 1008, responseEnd: 1020,
      domLoading: 1002, domInteractive: 1022, domContentLoadedEventStart: 1023,
      domContentLoadedEventEnd: 1024, domComplete: 1025, loadEventStart: 1026, loadEventEnd: 1027,
    });
  });

  it('does not confuse a Fetch observation at the time origin with an absent timestamp', () => {
    const { timing, fetchTiming } = fixture();
    fetchTiming.postRedirectStartTime = 100;
    expect(timing.fetchStart).toBe(1000);
    fetchTiming.postRedirectStartTime = 0;
    expect(timing.fetchStart).toBe(0);
  });

  it('uses the legacy fallback chain when connection phases were not performed', () => {
    const { timing, fetchTiming } = fixture();
    fetchTiming.finalConnectionTimingInfo = null;
    fetchTiming.finalNetworkRequestStartTime = 0;
    fetchTiming.finalNetworkResponseStartTime = 0;
    fetchTiming.endTime = 0;
    expect(timing.toJSON()).toMatchObject({
      fetchStart: 1003, domainLookupStart: 1003, domainLookupEnd: 1003,
      connectStart: 1003, connectEnd: 1003, secureConnectionStart: 0,
      requestStart: 1003, responseStart: 1003, responseEnd: 0,
    });
  });

  it('reports TLS only when measured and includes the first interim response', () => {
    const { timing, fetchTiming } = fixture();
    fetchTiming.finalConnectionTimingInfo!.secureConnectionStartTime = 105.5;
    fetchTiming.firstInterimNetworkResponseStartTime = 107.5;
    expect(timing.secureConnectionStart).toBe(1006);
    expect(timing.responseStart).toBe(1008);
    fetchTiming.firstInterimNetworkResponseStartTime = 0;
    fetchTiming.finalNetworkResponseStartTime = 109;
    expect(timing.responseStart).toBe(1009);
  });

  it('hides foreign redirect and unload observations independently of modern TAO exposure', () => {
    const { document, timing, modern } = fixture();
    document.wasCreatedViaCrossOriginRedirects = true;
    Object.assign(document.previousDocumentUnloadTiming, { unloadEventStartTime: 2, unloadEventEndTime: 3 });
    expect(timing.redirectStart).toBe(0);
    expect(timing.redirectEnd).toBe(0);
    expect(timing.unloadEventStart).toBe(0);
    expect(timing.unloadEventEnd).toBe(0);
    expect(modern.redirectCount).toBe(1);
    expect(modern.redirectStart).toBe(1);
    expect(timing.responseEnd).toBe(1020);
  });

  it('retains live completion and unload records instead of caching early zero values', () => {
    const { timing, document, fetchTiming } = fixture();
    fetchTiming.endTime = 0;
    expect(timing.responseEnd).toBe(0);
    expect(timing.loadEventEnd).toBe(0);
    expect(timing.unloadEventEnd).toBe(0);
    fetchTiming.endTime = 130;
    document.loadTimingInfo.loadEventEndTime = 31;
    document.previousDocumentUnloadTiming = { unloadEventStartTime: 2, unloadEventEndTime: 3 };
    expect(timing.responseEnd).toBe(1030);
    expect(timing.loadEventEnd).toBe(1031);
    expect(timing.unloadEventEnd).toBe(1003);
  });

  it('retains measurements when the Document loses its browsing context', () => {
    const { document, timing } = fixture();
    const before = timing.toJSON();
    document.browsingContext = null;
    expect(timing.toJSON()).toEqual(before);
  });

  it('keeps initial about:blank without a modern entry or fabricated fetch measurements', () => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const window = top.activeDocument!.env.realm.globalObject as Window & typeof globalThis;
    expect(window.performance.getEntriesByType('navigation')).toEqual([]);
    expect(window.performance.timing.navigationStart).toBe(Math.trunc(window.performance.timeOrigin));
    expect(window.performance.timing.toJSON()).toMatchObject({
      fetchStart: 0, domainLookupStart: 0, domainLookupEnd: 0, connectStart: 0, connectEnd: 0,
      secureConnectionStart: 0, requestStart: 0, responseStart: 0, responseEnd: 0,
    });
  });

  it('follows the replacement Document when initialization reuses the initial Window', () => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const initial = top.activeDocument!;
    const window = initial.env.realm.globalObject as Window & typeof globalThis;
    const timing = window.performance.timing;
    const response = new FetchResponse();
    response.urlList.push(parseURL('about:blank?replacement').url!);
    const params = new NavigationParams(response, new SandboxingFlagSet(), 10);
    params.origin = initial.origin;
    params.coopEnforcementResult = {
      url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    };
    const document = top.createAndInitializeDocument('html', 'text/html', params);
    expect(document.env).toBe(initial.env);
    expect(window.performance.timing).toBe(timing);
    expect(document.domLoadingTime).toBeGreaterThan(0);
    expect(timing.domLoading).toBe(Math.trunc(window.performance.timeOrigin + document.domLoadingTime));
    expect(timing.navigationStart).toBe(Math.trunc(window.performance.timeOrigin));
    expect(timing.responseEnd).toBe(0);
  });

  it('keeps the first loading observation when readiness repeats', () => {
    const { document, timing, env } = fixture();
    const currentTime = vi.spyOn(env, 'currentHighResolutionTime').mockReturnValue(new Duration(1.5));
    document.updateCurrentDocumentReadiness('loading');
    expect(timing.domLoading).toBe(1002);
    currentTime.mockReturnValue(new Duration(10));
    document.updateCurrentDocumentReadiness('complete');
    document.updateCurrentDocumentReadiness('loading');
    expect(timing.domLoading).toBe(1002);
  });

  it('does not expose the legacy API in a real worker global', () => {
    const { env } = fixture();
    const agent = new DedicatedWorkerAgent(createManualEventLoop());
    env.realm.agent.agentCluster!.add(agent);
    const workerEnv = createWorkerEnvironment({
      agent, outsideEnv: env, url: parseURL('https://example.test/worker.js').url!,
      unsafeWorkerCreationTime: 0, type: 'classic', name: '', credentials: 'same-origin', extendedLifetime: false,
    });
    expect('PerformanceTiming' in workerEnv.global).toBe(false);
    expect('PerformanceNavigation' in workerEnv.global).toBe(false);
    // WorkerGlobalScope's WindowOrWorkerGlobalScope inclusion remains an explicit worker dependency.
    // Its exposed Performance interface still must not acquire this Window-only partial member.
    const performanceConstructor = Reflect.get(workerEnv.global, 'Performance') as { prototype: object; };
    expect('timing' in performanceConstructor.prototype).toBe(false);
    expect('navigation' in performanceConstructor.prototype).toBe(false);
  });

  it('exposes actual loading milestones through the local-route loader', async () => {
    const browser = new Browlet({ route: () => '<p>loaded</p>' });
    await browser.navigate('https://destination.test/page');
    const result = await browser.evaluate(() => {
      const timing = performance.timing;
      return {
        loading: timing.domLoading >= timing.navigationStart,
        interactive: timing.domInteractive >= timing.domLoading,
        contentLoaded: timing.domContentLoadedEventEnd >= timing.domContentLoadedEventStart,
        complete: timing.domComplete >= timing.domInteractive,
        load: timing.loadEventEnd >= timing.loadEventStart && timing.loadEventStart > 0,
        integers: Object.values(timing.toJSON() as Record<string, number>).every(Number.isInteger),
        responseEnd: timing.responseEnd,
      };
    });
    expect(result).toEqual({ loading: true, interactive: true, contentLoaded: true, complete: true, load: true, integers: true, responseEnd: 0 });
  });
});

describe('legacy PerformanceNavigation', () => {
  it('exposes one read-only, realm-owned view with the specified constants and JSON', () => {
    const { window } = fixture();
    const navigation = window.performance.navigation;
    expect(navigation).toBe(window.performance.navigation);
    expect(navigation).toBeInstanceOf(window.PerformanceNavigation);
    expect(Object.prototype.toString.call(navigation)).toBe('[object PerformanceNavigation]');
    expect(() => Reflect.construct(window.PerformanceNavigation, [])).toThrow(window.TypeError);
    expect(Reflect.set(window.performance, 'navigation', {})).toBe(false);
    expect(Reflect.set(navigation, 'type', 2)).toBe(false);
    expect(Reflect.set(navigation, 'redirectCount', 2)).toBe(false);
    const constants = { TYPE_NAVIGATE: 0, TYPE_RELOAD: 1, TYPE_BACK_FORWARD: 2, TYPE_RESERVED: 255 };
    for (const [name, value] of Object.entries(constants)) {
      expect(Reflect.get(window.PerformanceNavigation, name)).toBe(value);
      expect(Reflect.get(window.PerformanceNavigation.prototype, name)).toBe(value);
    }
    expect(navigation.toJSON()).toEqual({ type: 0, redirectCount: 1 });
    expect(Object.keys(navigation.toJSON())).toEqual(['type', 'redirectCount']);
    expect(JSON.parse(JSON.stringify(navigation))).toEqual(navigation.toJSON());
    expect(Reflect.get(window.performance.toJSON(), 'navigation')).toBe(navigation);
  });

  it('uses the receiver for borrowed getters and the called method realm for JSON', () => {
    const first = fixture('reload');
    const second = fixture();
    const navigation = first.window.performance.navigation;
    expect(Reflect.get(second.window.Performance.prototype, 'navigation', first.window.performance)).toBe(navigation);
    expect(Reflect.get(second.window.PerformanceNavigation.prototype, 'type', navigation)).toBe(1);
    expect(Reflect.get(second.window.PerformanceNavigation.prototype, 'redirectCount', navigation)).toBe(1);
    const json: unknown = second.window.PerformanceNavigation.prototype.toJSON.call(navigation);
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(json).toEqual({ type: 1, redirectCount: 1 });
    expect(() => { Reflect.get(second.window.Performance.prototype, 'navigation', {}); }).toThrow(second.window.TypeError);
    expect(() => { Reflect.get(second.window.PerformanceNavigation.prototype, 'type', {}); }).toThrow(second.window.TypeError);
  });

  it.each([
    ['navigate', 0], ['reload', 1], ['back_forward', 2],
  ] as const)('reads the Document classification for %s', (type, expected) => {
    expect(fixture(type).window.performance.navigation.type).toBe(expected);
  });

  it('retains the strict legacy redirect gate even when TAO exposes the modern count', () => {
    const { document, window, modern } = fixture();
    document.wasCreatedViaCrossOriginRedirects = true;
    expect(modern.redirectCount).toBe(1);
    expect(window.performance.navigation.redirectCount).toBe(0);
  });

  it('keeps same-origin redirect counts independent of referrer policy', () => {
    const { document, window } = fixture();
    document.policyContainer.referrerPolicy = 'no-referrer';
    expect(window.performance.navigation.redirectCount).toBe(1);
  });

  it('retains the Document classification and count after detachment', () => {
    const { document, window } = fixture('reload');
    const navigation = window.performance.navigation;
    document.browsingContext = null;
    expect(window.performance.navigation).toBe(navigation);
    expect(navigation.toJSON()).toEqual({ type: 1, redirectCount: 1 });
  });

  it('exposes initial about:blank without requiring a modern navigation entry', () => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const window = top.activeDocument!.env.realm.globalObject as Window & typeof globalThis;
    expect(window.performance.getEntriesByType('navigation')).toEqual([]);
    expect(window.performance.navigation.toJSON()).toEqual({ type: 0, redirectCount: 0 });
  });

  it.each([
    ['navigate', 0], ['reload', 1], ['back_forward', 2],
  ] as const)('initializes %s when Document creation reuses the initial Window', (type, expected) => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const initial = top.activeDocument!;
    const window = initial.env.realm.globalObject as Window & typeof globalThis;
    const navigation = window.performance.navigation;
    const response = new FetchResponse();
    response.urlList.push(parseURL('about:blank?replacement').url!);
    const params = new NavigationParams(response, new SandboxingFlagSet(), 10);
    params.origin = initial.origin;
    params.navigationTimingType = type;
    params.coopEnforcementResult = {
      url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    };
    const document = top.createAndInitializeDocument('html', 'text/html', params);
    expect(document.env).toBe(initial.env);
    expect(window.performance.navigation).toBe(navigation);
    expect(navigation.toJSON()).toEqual({ type: expected, redirectCount: 0 });
  });
});

/** Project real Window bindings over prepared, live Document and Fetch observations. */
function fixture(type: NavigationTimingType = 'navigate') {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = top.activeDocument!;
  const env = document.env;
  document.initializeLoadTimingInfo(100);
  document.legacyNavigationType = type;
  vi.spyOn(env, 'getTimeOriginTimestamp').mockReturnValue(new Duration(1000.75));
  const window = env.realm.globalObject as Window & typeof globalThis;
  const fetchTiming: FetchTimingInfo = Object.assign(new FetchTimingInfo(), {
    startTime: 101, redirectStartTime: 101, redirectEndTime: 102, postRedirectStartTime: 103,
    finalNetworkRequestStartTime: 107, finalNetworkResponseStartTime: 108, endTime: 120,
    finalConnectionTimingInfo: Object.assign(new ConnectionTimingInfo(), {
      domainLookupStartTime: 104, domainLookupEndTime: 105, connectionStartTime: 104, connectionEndTime: 106,
    }),
  });
  const modern = document.navigationTimingEntry = new PerformanceNavigationTimingImpl(serializeURL(document.url), {
    type, redirectCount: 1, fetchTimingInfo: fetchTiming, bodyInfo: new ResponseBodyInfo(),
    contentType: 'text/html', serverTimingHeaders: [], documentTimingInfo: document.loadTimingInfo,
    previousDocumentUnloadTiming: document.previousDocumentUnloadTiming, serviceWorkerTimingInfo: null,
    cacheUsage: undefined, responseStatus: 200,
  }, 0, null, true, env);
  return { document, env, window, timing: window.performance.timing, fetchTiming, modern };
}
