import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotRestoredReasonsImpl, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import {
  PerformanceEntryImpl, PerformanceNavigationTimingImpl, PerformanceResourceTimingImpl,
  type NavigationTimingInit, type NavigationTimingType,
} from '../../../src/browlet/performance/index';
import type { PerformanceNavigationTiming, Window } from '../../../src/browlet/platform';
import { Moment, monotonicClock } from '../../../src/timing/index';
import { FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('Navigation Timing entries', () => {
  it('projects one derived identity through both ancestor interfaces without an author constructor', () => {
    const { window, env, implementation, entry } = fixture();
    expect(entry).toBeInstanceOf(window.PerformanceNavigationTiming);
    expect(entry).toBeInstanceOf(window.PerformanceResourceTiming);
    expect(entry).toBeInstanceOf(window.PerformanceEntry);
    expect(Object.prototype.toString.call(entry)).toBe('[object PerformanceNavigationTiming]');
    expect(() => Reflect.construct(window.PerformanceNavigationTiming, [])).toThrow(window.TypeError);
    expect(Reflect.set(entry, 'type', 'reload')).toBe(false);
    expect(Reflect.set(entry, 'startTime', 9)).toBe(false);
    expect(getBindingContext(env.realm).project(PerformanceEntryImpl, implementation)).toBe(entry);
    expect(getBindingContext(env.realm).project(PerformanceResourceTimingImpl, implementation)).toBe(entry);
    expect(getRelevantRealm(entry)).toBe(env.realm);
  });

  it('reports live load milestones while duration waits for load-event completion', () => {
    const { entry, inputs } = fixture();
    expect(entry.name).toBe('https://example.test/page?query=1#fragment');
    expect(entry.entryType).toBe('navigation');
    expect(entry.initiatorType).toBe('navigation');
    expect(entry.startTime).toBe(0);
    expect(entry.responseEnd).toBe(20);
    expect(entry.duration).toBe(0);
    expect(entry.toJSON()).toMatchObject({
      domInteractive: 0, domContentLoadedEventStart: 0, domContentLoadedEventEnd: 0,
      domComplete: 0, loadEventStart: 0, loadEventEnd: 0, duration: 0,
    });
    // These are Document-relative observations, unlike the shared-clock Fetch endTime of 120.
    Object.assign(inputs.documentTimingInfo, {
      domInteractiveTime: 21.125, domContentLoadedEventStartTime: 22.25,
      domContentLoadedEventEndTime: 23.375, domCompleteTime: 24.5, loadEventStartTime: 25.625,
    });
    expect(entry.toJSON()).toMatchObject({
      domInteractive: 21.125, domContentLoadedEventStart: 22.25, domContentLoadedEventEnd: 23.375,
      domComplete: 24.5, loadEventStart: 25.625, loadEventEnd: 0, duration: 0,
    });
    inputs.documentTimingInfo.loadEventEndTime = 26.75;
    expect(entry.duration).toBe(26.75);
    expect(entry.loadEventEnd).toBe(26.75);
    inputs.fetchTimingInfo.endTime = 130;
    expect(entry.responseEnd).toBe(30);
    expect(entry.duration).toBe(26.75);
  });

  it('retains HTML-selected unload observations without a second time-origin conversion', () => {
    const { entry, inputs } = fixture();
    expect(entry.unloadEventStart).toBe(0);
    expect(entry.unloadEventEnd).toBe(0);
    inputs.previousDocumentUnloadTiming.unloadEventStartTime = 2.125;
    inputs.previousDocumentUnloadTiming.unloadEventEndTime = 3.25;
    expect(entry.unloadEventStart).toBe(2.125);
    expect(entry.unloadEventEnd).toBe(3.25);
    // HTML can leave both observations zero after its privacy checks; redirectCount does not select unload visibility.
    const hidden = fixture({ redirectCount: 2 });
    expect(hidden.entry.unloadEventStart).toBe(0);
    expect(hidden.entry.unloadEventEnd).toBe(0);
  });

  it.each<NavigationTimingType>(['navigate', 'reload', 'back_forward'])('preserves the producer-selected %s type', (type) => {
    expect(fixture({ type }).entry.type).toBe(type);
  });

  it('hides redirect timestamps when HTML selected a zero redirect count without erasing Fetch observations', () => {
    const { entry, inputs } = fixture();
    expect(entry.redirectCount).toBe(0);
    expect(entry.redirectStart).toBe(0);
    expect(entry.redirectEnd).toBe(0);
    expect(inputs.fetchTimingInfo.redirectStartTime).toBe(101);
    expect(inputs.fetchTimingInfo.redirectEndTime).toBe(102);
    expect(entry.fetchStart).toBe(3);
    expect(entry.responseEnd).toBe(20);
    const visible = fixture({ redirectCount: 2 });
    expect(visible.entry.redirectCount).toBe(2);
    expect(visible.entry.redirectStart).toBe(1);
    expect(visible.entry.redirectEnd).toBe(2);
  });

  it('uses Resource Timing worker/fetch getters when no navigation worker record was supplied', () => {
    const { entry } = fixture();
    expect(entry.workerStart).toBe(4);
    expect(entry.fetchStart).toBe(3);
  });

  it('converts the navigation worker record once, retaining its live values and zero sentinel', () => {
    const { entry, inputs } = fixture({ worker: true });
    expect(entry.workerStart).toBe(5.125);
    expect(entry.fetchStart).toBe(6.25);
    inputs.serviceWorkerTimingInfo!.startTime = 107.375;
    inputs.serviceWorkerTimingInfo!.fetchEventDispatchTime = 108.5;
    expect(entry.workerStart).toBe(7.375);
    expect(entry.fetchStart).toBe(8.5);
    inputs.serviceWorkerTimingInfo!.startTime = 0;
    inputs.serviceWorkerTimingInfo!.fetchEventDispatchTime = 0;
    expect(entry.workerStart).toBe(0);
    expect(entry.fetchStart).toBe(0);
  });

  it('uses the receiver clock and navigation overrides through borrowed ancestor getters', () => {
    const first = fixture({ worker: true });
    const second = fixture({ timeOrigin: 50, worker: true });
    first.inputs.documentTimingInfo.loadEventEndTime = 26.75;
    second.inputs.documentTimingInfo.loadEventEndTime = 76.75;
    const resource = second.window.PerformanceResourceTiming.prototype;
    expect(Reflect.get(resource, 'workerStart', first.entry)).toBe(5.125);
    expect(Reflect.get(resource, 'workerStart', second.entry)).toBe(55.125);
    expect(Reflect.get(resource, 'fetchStart', first.entry)).toBe(6.25);
    expect(Reflect.get(resource, 'redirectStart', first.entry)).toBe(0);
    expect(Reflect.get(second.window.PerformanceEntry.prototype, 'duration', first.entry)).toBe(26.75);
    const prototype = second.window.PerformanceNavigationTiming.prototype;
    expect(Reflect.get(prototype, 'loadEventEnd', first.entry)).toBe(26.75);
    expect(() => Reflect.get(prototype, 'loadEventEnd', {})).toThrow(second.window.TypeError);
    const json = prototype.toJSON.call(first.entry) as object;
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(json).toMatchObject({ startTime: 0, duration: 26.75, workerStart: 5.125, fetchStart: 6.25 });
  });

  it('inherits live body measurements and prepared Server Timing without duplicating metrics', () => {
    const { entry, inputs, env } = fixture();
    const list = entry.serverTiming;
    expect(list).toBe(entry.serverTiming);
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.map((metric) => metric.toJSON())).toEqual([{ name: 'server', duration: 2.5, description: '' }]);
    expect(getRelevantRealm(list[0]!)).toBe(env.realm);
    inputs.bodyInfo.encodedSize = 40;
    inputs.bodyInfo.decodedSize = 80;
    expect(entry.encodedBodySize).toBe(40);
    expect(entry.decodedBodySize).toBe(80);
    expect(entry.transferSize).toBe(340);
    expect(entry.responseStatus).toBe(200);
    expect(entry.toJSON()).toMatchObject({ serverTiming: list, encodedBodySize: 40, decodedBodySize: 80 });
  });

  it('retains prepared cache classification and transfer permission', () => {
    const cached = fixture({ cacheUsage: 'local' });
    expect(cached.entry.deliveryType).toBe('cache');
    expect(cached.entry.transferSize).toBe(0);
    const validated = fixture({ cacheUsage: 'validated' });
    expect(validated.entry.transferSize).toBe(300);
    const hidden = fixture({ allowTransferSize: false });
    expect(hidden.entry.transferSize).toBe(0);
    expect(hidden.entry.encodedBodySize).toBe(20);
  });

  it('retains supplied diagnostics in the entry realm, including through borrowed getters and JSON', () => {
    const first = fixture({ diagnostics: true });
    const second = fixture();
    const reasons = first.entry.notRestoredReasons!;
    expect(reasons).toBeInstanceOf(first.window.NotRestoredReasons);
    expect(reasons).toBe(first.entry.notRestoredReasons);
    expect(getRelevantRealm(reasons)).toBe(first.env.realm);
    expect(reasons.reasons![0]!.reason).toBe('masked');
    const prototype = second.window.PerformanceNavigationTiming.prototype;
    expect(Reflect.get(prototype, 'notRestoredReasons', first.entry)).toBe(reasons);
    const json = prototype.toJSON.call(first.entry) as { notRestoredReasons: unknown; };
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(json.notRestoredReasons).toBe(reasons);
    expect(JSON.parse(JSON.stringify(first.entry))).toMatchObject({
      notRestoredReasons: { reasons: [{ reason: 'masked' }], children: [] },
    });
    expect(second.entry.notRestoredReasons).toBeNull();
    expect(second.entry.toJSON()).toMatchObject({ notRestoredReasons: null });
  });

  it('preserves a prepared Document-relative Critical-CH observation', () => {
    expect(fixture().entry.criticalCHRestart).toBe(0);
    expect(fixture({ criticalCHRestart: 2.125 }).entry.criticalCHRestart).toBe(2.125);
  });

  it('captures the navigation association before later Timeline delivery', () => {
    const { entry, env } = fixture();
    const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
    const navigationId = performance.currentNavigationId;
    expect(entry.navigationId).toBe(navigationId);
    performance.currentNavigationId++;
    expect(entry.navigationId).toBe(navigationId);
  });

  it('serializes inherited fields and navigation attributes in the declared order', () => {
    const { entry } = fixture();
    const json = entry.toJSON();
    expect(Object.keys(json).slice(-13)).toEqual([
      'unloadEventStart', 'unloadEventEnd', 'domInteractive', 'domContentLoadedEventStart',
      'domContentLoadedEventEnd', 'domComplete', 'loadEventStart', 'loadEventEnd',
      'type', 'redirectCount', 'criticalCHRestart', 'notRestoredReasons', 'confidence',
    ]);
    expect(json).toMatchObject({
      name: entry.name, entryType: 'navigation', startTime: 0, duration: 0,
      navigationId: entry.navigationId, initiatorType: 'navigation', responseEnd: 20,
    });
  });

  it('keeps prepared construction separate from buffering and host confidence measurement', () => {
    const { entry, window, env } = fixture();
    expect(entry.confidence).toBeNull();
    expect(entry.toJSON()).toMatchObject({ confidence: null });
    expect(window.performance.getEntriesByType('navigation')).toEqual([]);
    expect(window.PerformanceObserver.supportedEntryTypes).toContain('navigation');
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
  });
});

/** Prepared Fetch and Document observations projected through the real Window bindings. */
function fixture({
  timeOrigin = 100, type = 'navigate', redirectCount = 0, worker = false,
  diagnostics = false, criticalCHRestart = 0, cacheUsage, allowTransferSize = true,
}: {
  timeOrigin?: number; type?: NavigationTimingType; redirectCount?: number; worker?: boolean;
  diagnostics?: boolean; criticalCHRestart?: number; cacheUsage?: NavigationTimingInit['cacheUsage']; allowTransferSize?: boolean;
} = {}) {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigable.activeDocument!;
  const env = document.env;
  vi.spyOn(env, 'timeOrigin', 'get').mockReturnValue(new Moment(monotonicClock, timeOrigin));
  const window = env.realm.globalObject as Window & typeof globalThis;
  const inputs: NavigationTimingInit = {
    type, redirectCount, cacheUsage, responseStatus: 200,
    contentType: 'text/html', serverTimingHeaders: ['server;dur=2.5'],
    fetchTimingInfo: Object.assign(new FetchTimingInfo(), {
      startTime: 101, redirectStartTime: 101, redirectEndTime: 102, postRedirectStartTime: 103,
      finalServiceWorkerStartTime: 104, endTime: 120, serverTimingHeaders: ['server;dur=2.5'],
    }),
    bodyInfo: Object.assign(new ResponseBodyInfo(), { encodedSize: 20, decodedSize: 40, contentType: 'text/html' }),
    documentTimingInfo: document.loadTimingInfo,
    previousDocumentUnloadTiming: document.previousDocumentUnloadTiming,
    serviceWorkerTimingInfo: worker ? {
      startTime: 105.125, fetchEventDispatchTime: 106.25, workerRouterEvaluationStart: 0, workerCacheLookupStart: 0,
      workerMatchedRouterSource: '', workerFinalRouterSource: '',
    } : null,
  };
  const reasons = diagnostics ? new NotRestoredReasonsImpl({
    src: null, id: null, name: null, url: document.url, reasons: [{ reason: 'masked' }], children: [],
  }, env) : null;
  const implementation = new PerformanceNavigationTimingImpl(
    'https://example.test/page?query=1#fragment', inputs, criticalCHRestart, reasons, allowTransferSize, env,
  );
  const entry = getBindingContext(env.realm).project(PerformanceNavigationTimingImpl, implementation) as PerformanceNavigationTiming;
  return { window, env, inputs, implementation, entry };
}
