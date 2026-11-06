import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavigationParams, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { SandboxingFlagSet } from '../../../src/browlet/browsing/policy/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/index';
import { PerformanceImpl, PerformanceNavigationTimingImpl } from '../../../src/browlet/performance/index';
import type { PerformanceNavigationTiming, Window } from '../../../src/browlet/platform';
import { FetchController, FetchRequest, FetchResponse } from '../../../src/fetch/index';
import { FetchTimingInfo } from '../../../src/fetch/timing';
import { Moment, monotonicClock } from '../../../src/timing/index';
import { parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('Navigation Timing creation', () => {
  it('leaves the initial about:blank without an entry or buffered observer delivery', () => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const document = top.activeDocument!;
    const window = document.env.realm.globalObject as Window;
    expect(document.isInitialAboutBlank).toBe(true);
    expect(document.navigationTimingEntry).toBeUndefined();
    expect(window.performance.getEntriesByType('navigation')).toEqual([]);
    expect(window.performance.getEntriesByName('about:blank')).toEqual([]);
    const callback = vi.fn();
    const observer = new window.PerformanceObserver(callback);
    observer.observe({ type: 'navigation', buffered: true });
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('buffers the realm-owned entry before early hints commit without notifying observers', () => {
    const { params, create } = fixture();
    const queue = vi.spyOn(PerformanceImpl.prototype, 'queueEntry');
    const commit = vi.fn((document: DocumentImpl) => {
      const window = document.env.realm.globalObject as Window;
      const entry = window.performance.getEntriesByType('navigation')[0]!;
      expect(entry).toBeInstanceOf(window.PerformanceNavigationTiming);
      expect(entry).toBeInstanceOf(window.PerformanceResourceTiming);
      expect(entry.startTime).toBe(0);
      expect(entry.duration).toBe(0);
      expect(entry.name).toBe('https://destination.test/final?query=1#fragment');
    });
    params.commitEarlyHints = commit;
    const { document, env, window, entry } = create();
    expect(commit).toHaveBeenCalledOnce();
    expect(queue).not.toHaveBeenCalled();
    expect(window.performance.getEntries()).toEqual([entry]);
    expect(window.performance.getEntriesByName(document.URL, 'navigation')).toEqual([entry]);
    expect(window.performance.getEntriesByType('navigation')[0]).toBe(entry);
    expect(getRelevantRealm(entry)).toBe(env.realm);
    expect(getBindingContext(env.realm).project(PerformanceNavigationTimingImpl, document.navigationTimingEntry!)).toBe(entry);
    expect(entry.navigationId).toBe(env.getWindowOrWorkerGlobalScopeMixin().performance.currentNavigationId);
  });

  it('retains live completion, byte counts and load milestones on the already exposed entry', () => {
    const { timing, response, create } = fixture();
    const { entry, document, window } = create();
    expect(entry.responseEnd).toBe(0);
    expect(entry.encodedBodySize).toBe(0);
    expect(entry.transferSize).toBe(300);
    timing.endTime = 120;
    response.bodyInfo.encodedSize = 20;
    response.bodyInfo.decodedSize = 40;
    document.loadTimingInfo.domInteractiveTime = 21;
    document.loadTimingInfo.loadEventEndTime = 30;
    expect(window.performance.getEntries()[0]).toBe(entry);
    expect(entry.responseEnd).toBe(20);
    expect(entry.encodedBodySize).toBe(20);
    expect(entry.decodedBodySize).toBe(40);
    expect(entry.transferSize).toBe(320);
    expect(entry.domInteractive).toBe(21);
    expect(entry.duration).toBe(30);
  });

  it('creates an entry without a Fetch controller before loader callbacks', () => {
    const { params, create } = fixture();
    params.fetchController = null;
    params.request = null;
    params.commitEarlyHints = (document) => {
      const window = document.env.realm.globalObject as Window;
      expect(window.performance.getEntriesByType('navigation')).toHaveLength(1);
    };
    const { document, env, window, entry } = create();
    expect(document.navigationTimingEntry!.timingInfo.startTime).toBe(document.loadTimingInfo.navigationStartTime);
    expect(window.performance.getEntries()).toEqual([entry]);
    expect(getRelevantRealm(entry)).toBe(env.realm);
    expect(entry.toJSON()).toMatchObject({
      name: document.URL, startTime: 0, duration: 0, redirectCount: 0,
      fetchStart: 0, redirectStart: 0, redirectEnd: 0, requestStart: 0,
      responseStart: 0, responseEnd: 0, domainLookupStart: 0, domainLookupEnd: 0,
      connectStart: 0, connectEnd: 0, secureConnectionStart: 0, nextHopProtocol: '',
    });
  });

  it.each([undefined, 'local', 'validated'] as const)(
    'keeps unavailable transfer size at zero while retaining supplied %s response data', (cacheUsage) => {
      const { params, response, timing, create } = fixture();
      params.fetchController = null;
      params.request = null;
      params.navigationTimingType = 'back_forward';
      response.cacheUsage = cacheUsage;
      response.bodyInfo.encodedSize = 20;
      response.bodyInfo.decodedSize = 40;
      const { document, entry } = create();
      expect(entry).toBeDefined();
      expect(entry.transferSize).toBe(0);
      expect(document.navigationTimingEntry!.cacheMode).toBe(cacheUsage ?? '');
      expect(entry.type).toBe('back_forward');
      expect(entry.responseStatus).toBe(203);
      expect(entry.contentType).toBe('application/json');
      expect(entry.serverTiming.map((metric) => metric.name)).toEqual(['destination']);
      expect(entry.encodedBodySize).toBe(20);
      expect(entry.decodedBodySize).toBe(40);
      response.bodyInfo.encodedSize = 30;
      response.bodyInfo.decodedSize = 60;
      timing.endTime = 200;
      document.loadTimingInfo.loadEventEndTime = 35;
      expect(entry.encodedBodySize).toBe(30);
      expect(entry.decodedBodySize).toBe(60);
      expect(entry.transferSize).toBe(0);
      expect(entry.responseEnd).toBe(0);
      expect(entry.duration).toBe(35);
    },
  );

  it('exposes the destination response independently of the initiating client and redirect permission', () => {
    const { params, response, timing, create } = fixture();
    params.request!.redirectCount = 2;
    response.redirectTaint = 'cross-site';
    response.timingAllowPassed = false;
    response.bodyInfo.encodedSize = 20;
    response.bodyInfo.decodedSize = 40;
    const { entry } = create();
    expect(entry.redirectCount).toBe(0);
    expect(entry.redirectStart).toBe(0);
    expect(entry.redirectEnd).toBe(0);
    expect(entry.fetchStart).toBe(3);
    expect(entry.requestStart).toBe(8);
    expect(entry.responseStart).toBe(10);
    expect(entry.responseStatus).toBe(203);
    expect(entry.encodedBodySize).toBe(20);
    expect(entry.decodedBodySize).toBe(40);
    expect(entry.transferSize).toBe(320);
    expect(entry.contentType).toBe('application/json');
    expect(entry.serverTiming.map(({ name, duration }) => ({ name, duration })))
      .toEqual([{ name: 'destination', duration: 4 }]);
    expect(timing.redirectStartTime).toBe(101);
    expect(timing.redirectEndTime).toBe(102);
  });

  it.each(['https', 'http'])('selects Server-Timing for the %s destination without changing shared metadata', (scheme) => {
    const { params, response, timing, create } = fixture(`${scheme}://destination.test/final`);
    // The initiating client and its selected headers are distinct from this destination's permission.
    expect(params.request!.client!.isSecureContext).toBe(false);
    timing.serverTimingHeaders = ['initiator;dur=1'];
    const { entry, env } = create();
    expect(env.isSecureContext).toBe(scheme === 'https');
    expect(entry.serverTiming.map((metric) => metric.name)).toEqual(scheme === 'https' ? ['destination'] : []);
    expect(entry.serverTiming).toBe(entry.serverTiming);
    expect(Object.isFrozen(entry.serverTiming)).toBe(true);
    expect(timing.serverTimingHeaders).toEqual(['initiator;dur=1']);
    expect(response.bodyInfo.contentType).toBe('');
    // Later Resource Timing reporting may select different metadata for the initiating client.
    response.bodyInfo.contentType = 'text/plain';
    expect(entry.contentType).toBe('application/json');
  });

  it('captures available diagnostics in the entry realm and keeps their projected identity', () => {
    const { top, params } = fixture();
    const document = top.activeDocument!;
    params.notRestoredReasons = {
      src: null, id: null, name: null, url: document.url,
      reasons: [{ reason: 'masked' }], children: [],
    };
    document.createNavigationTimingEntry(params);
    const window = document.env.realm.globalObject as Window;
    const entry = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const reasons = entry.notRestoredReasons!;
    expect(reasons).toBeInstanceOf(window.NotRestoredReasons);
    expect(reasons.reasons![0]).toBeInstanceOf(window.NotRestoredReasonDetails);
    expect(getRelevantRealm(reasons)).toBe(document.env.realm);
    expect(reasons.reasons![0]!.reason).toBe('masked');
    expect(entry.notRestoredReasons).toBe(reasons);
    expect(entry.toJSON()).toMatchObject({ notRestoredReasons: reasons });
  });

  it('does not borrow the departing Document diagnostics before the incoming Document is active', () => {
    const { top, create } = fixture();
    top.activeSessionHistoryEntry.documentState.notRestoredReasons = {
      src: null, id: null, name: null, url: top.activeDocument!.url,
      reasons: [{ reason: 'departing-only' }], children: [],
    };
    const { document, entry } = create();
    expect(document.getNodeNavigable()).toBeNull();
    expect(entry.notRestoredReasons).toBeNull();
  });
});

/** Supply response-header inputs through the real Document factory; transport completion is tested separately. */
function fixture(url = 'https://destination.test/final?query=1#fragment') {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  response.status = 203;
  response.headerList.append('Content-Type', 'application/problem+json');
  response.headerList.append('Server-Timing', 'destination;dur=4');
  const params = new NavigationParams(response, new SandboxingFlagSet(), 100);
  params.request = new FetchRequest(params.url, top.activeDocument!.env);
  params.request.client = top.activeDocument!.env;
  params.request.referrer = null;
  params.coopEnforcementResult = {
    url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
    needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    currentContextIsNavigationSource: false,
  };
  const timing = Object.assign(new FetchTimingInfo(), {
    startTime: 101, redirectStartTime: 101, redirectEndTime: 102, postRedirectStartTime: 103,
    finalNetworkRequestStartTime: 108, finalNetworkResponseStartTime: 110,
  });
  params.fetchController = new FetchController();
  params.fetchController.fullTimingInfo = timing;
  function create() {
    const document = top.createAndInitializeDocument('html', 'text/html', params);
    const env = document.env;
    vi.spyOn(env, 'timeOrigin', 'get').mockReturnValue(new Moment(monotonicClock, 100));
    const window = env.realm.globalObject as Window & typeof globalThis;
    const entry = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { document, env, window, entry };
  }
  return { top, params, response, timing, create };
}
