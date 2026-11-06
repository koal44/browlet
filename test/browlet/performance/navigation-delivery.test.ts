import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { NavigationParams, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../src/browlet/browsing/policy/index';
import type { PerformanceEntry, PerformanceNavigationTiming, PerformanceObserverCallback, Window } from '../../../src/browlet/platform';
import { FetchController, FetchRequest, FetchResponse } from '../../../src/fetch/index';
import { FetchTimingInfo } from '../../../src/fetch/timing';
import { Duration } from '../../../src/timing/index';
import { parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

describe('Navigation Timing delivery', () => {
  it('delivers a completed local-route entry through the running observer queue', async () => {
    const browser = new Browlet({ route: () => '<p>local response</p>' });
    await browser.navigate('https://destination.test/local');
    const result = await browser.evaluate(() => new Promise<{
      same: boolean; count: number; responseEnd: number; transferSize: number; loadFinished: boolean;
    }>((resolve) => {
      const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const observer = new PerformanceObserver((list) => {
        observer.disconnect();
        resolve({
          same: list.getEntries()[0] === entry,
          count: performance.getEntriesByType('navigation').length,
          responseEnd: entry.responseEnd, transferSize: entry.transferSize,
          loadFinished: document.readyState === 'complete' && entry.loadEventEnd >= entry.loadEventStart,
        });
      });
      observer.observe({ type: 'navigation', buffered: true });
    }));
    expect(result).toEqual({ same: true, count: 1, responseEnd: 0, transferSize: 0, loadFinished: true });
  });

  it('notifies observers after load completes using the retained entry', () => {
    const { document, window, performance, entry, runTask } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    const navigationId = entry.navigationId;
    performance.currentNavigationId++;
    new window.PerformanceObserver(callback).observe({ type: 'navigation' });
    window.addEventListener('load', () => {
      expect(entry.loadEventEnd).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    });
    document.finishLoading();
    expect(callback).not.toHaveBeenCalled();
    expect(entry.loadEventEnd).toBeGreaterThan(0);
    runTask();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].getEntries()).toEqual([entry]);
    expect(window.performance.getEntriesByType('navigation')).toEqual([entry]);
    expect(entry.navigationId).toBe(navigationId);
    expect(callback.mock.calls[0]![2]).toMatchObject({ droppedEntriesCount: 0 });
  });

  it('does not insert a created navigation entry again when notifying observers', () => {
    const { document, performance, window, entry } = fixture();
    performance.queueEntry(document.navigationTimingEntry!);
    expect(window.performance.getEntriesByType('navigation')).toEqual([entry]);
    expect(performance.getEntryBuffer('navigation').droppedEntriesCount).toBe(0);
  });

  it('notifies an observer registered by the load listener after its microtasks', () => runInHostTask(() => {
    const { document, env, window, entry, runTask } = fixture();
    const order: string[] = [];
    window.addEventListener('load', () => {
      order.push('load');
      new window.PerformanceObserver((list) => {
        order.push('observer');
        expect(list.getEntries()).toEqual([entry]);
        expect(entry.loadEventEnd).toBeGreaterThan(0);
      }).observe({ entryTypes: ['navigation'] });
      window.queueMicrotask(() => { order.push('microtask'); });
    });
    // HTML runs load completion in a DOM-manipulation task; its ending checkpoint precedes observer delivery.
    env.queueTask('dom-manipulation', () => { document.finishLoading(); });
    runTask();
    expect(order).not.toContain('observer');
    runTask();
    expect(order).toEqual(['load', 'microtask', 'observer']);
  }));

  it('replays the early live entry, then completion, and permits a later buffered replay', () => {
    const { document, window, entry, runTask } = fixture();
    const deliveries: { entries: PerformanceEntry[]; complete: boolean; }[] = [];
    const observer = new window.PerformanceObserver((list) => {
      deliveries.push({ entries: list.getEntries(), complete: entry.loadEventEnd > 0 });
    });
    observer.observe({ type: 'navigation', buffered: true });
    runTask();
    expect(deliveries).toEqual([{ entries: [entry], complete: false }]);
    document.finishLoading();
    runTask();
    expect(deliveries).toEqual([
      { entries: [entry], complete: false }, { entries: [entry], complete: true },
    ]);
    observer.observe({ type: 'navigation', buffered: true });
    runTask();
    expect(deliveries).toHaveLength(3);
    expect(deliveries[2]).toEqual({ entries: [entry], complete: true });
    expect(window.performance.getEntriesByType('navigation')).toEqual([entry]);
  });

  it('keeps early replay and completion in the same batch when no delivery task has run', () => {
    const { document, window, entry, runTask } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(callback).observe({ type: 'navigation', buffered: true });
    document.finishLoading();
    runTask();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].getEntries()).toEqual([entry, entry]);
    expect(window.performance.getEntriesByType('navigation')).toEqual([entry]);
  });

  it('requires buffered observation to retrieve a navigation whose completion was already queued', () => {
    const { document, window, entry, runTask } = fixture();
    document.finishLoading();
    const plain = vi.fn<PerformanceObserverCallback>();
    const buffered = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(plain).observe({ type: 'navigation' });
    new window.PerformanceObserver(buffered).observe({ type: 'navigation', buffered: true });
    runTask();
    expect(plain).not.toHaveBeenCalled();
    expect(buffered).toHaveBeenCalledOnce();
    expect(buffered.mock.calls[0]![0].getEntries()).toEqual([entry]);
  });

  it('lets takeRecords drain completion without removing the retained timeline entry', () => {
    const { document, window, entry, runTask } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    const observer = new window.PerformanceObserver(callback);
    observer.observe({ type: 'navigation' });
    document.finishLoading();
    expect(observer.takeRecords()).toEqual([entry]);
    runTask();
    expect(callback).not.toHaveBeenCalled();
    expect(window.performance.getEntriesByType('navigation')).toEqual([entry]);
  });

  it('honors disconnect during load and permits a later buffered subscription', () => {
    const { document, window, entry, runTask } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    const observer = new window.PerformanceObserver(callback);
    observer.observe({ type: 'navigation' });
    window.addEventListener('load', () => { observer.disconnect(); });
    document.finishLoading();
    runTask();
    expect(callback).not.toHaveBeenCalled();
    observer.observe({ type: 'navigation', buffered: true });
    runTask();
    expect(callback.mock.calls[0]![0].getEntries()).toEqual([entry]);
  });
});

/** Create a controller-backed Document and activate it without running the unrelated navigation coordinator. */
function fixture() {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://destination.test/page').url!);
  const params = new NavigationParams(response, new SandboxingFlagSet(), 0);
  params.request = new FetchRequest(params.url, top.activeDocument!.env);
  params.request.referrer = null;
  params.fetchController = new FetchController();
  params.fetchController.fullTimingInfo = new FetchTimingInfo();
  params.coopEnforcementResult = {
    url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
    needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    currentContextIsNavigationSource: false,
  };
  const document = top.createAndInitializeDocument('html', 'text/html', params);
  const env = document.env;
  let now = 1;
  vi.spyOn(env, 'currentHighResolutionTime').mockImplementation(() => new Duration(now++));
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry =
    env.createSessionHistoryEntry(document.url, DocumentState.create(document));
  document.makeActive();
  const window = env.realm.globalObject as Window & typeof globalThis;
  const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
  const entry = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  return { document, env, window, performance, entry, runTask: () => env.responsibleEventLoop.runTaskTurn() };
}
