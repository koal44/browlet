import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createSandboxEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  PerformanceImpl, PerformanceEntryImpl, type PerformanceEntryType, type PerformanceObserverImpl,
} from '../../../src/browlet/performance/index';
import type { PerformanceEntry, PerformanceObserverCallback, Window } from '../../../src/browlet/platform';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Performance Timeline entry queueing', () => {
  it('omits the withdrawn per-entry id from the platform and JSON', () => {
    const { env, entry } = fixture();
    const implementation = entry('mark', 'entry');
    implementation.navigationId = 123;
    const platform = getBindingContext(env.realm).project(PerformanceEntryImpl, implementation) as PerformanceEntry;
    expect('id' in platform).toBe(false);
    expect(platform.toJSON()).toEqual({
      name: 'entry', entryType: 'mark', startTime: 1, duration: 0, navigationId: 123,
    });
  });

  it('stores entries synchronously and queues each interested observer only once', () => {
    const { window, performance, entry, runTask } = fixture();
    const singleCallback = vi.fn<PerformanceObserverCallback>();
    const multipleCallback = vi.fn<PerformanceObserverCallback>();
    const uninterestedCallback = vi.fn<PerformanceObserverCallback>();
    const single = new window.PerformanceObserver(singleCallback);
    single.observe({ type: 'mark' });
    single.observe({ type: 'mark' });
    new window.PerformanceObserver(multipleCallback).observe({ entryTypes: ['mark', 'mark', 'resource'] });
    new window.PerformanceObserver(uninterestedCallback).observe({ type: 'measure' });
    const late = entry('mark', 'late', 30);
    const early = entry('mark', 'early', 10);
    performance.queueEntry(late);
    performance.queueEntry(early);
    expect(performance.getEntryBuffer('mark').entries).toEqual([late, early]);
    expect(window.performance.getEntriesByType('mark').map((item) => item.name)).toEqual(['early', 'late']);
    expect(singleCallback).not.toHaveBeenCalled();
    expect(runTask()).toBe(true);
    for (const callback of [singleCallback, multipleCallback]) {
      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0]![0].getEntries().map((item) => item.name)).toEqual(['early', 'late']);
      expect(callback.mock.calls[0]![2]).toEqual({ droppedEntriesCount: 0 });
    }
    expect(uninterestedCallback).not.toHaveBeenCalled();
    expect(runTask()).toBe(false);
  });

  it('delivers entries refused by global capacity and replays only retained entries', () => {
    const { window, performance, entry, runTask } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(callback).observe({ type: 'mark' });
    const buffer = performance.getEntryBuffer('mark');
    buffer.maxBufferSize = 1;
    const retained = entry('mark', 'retained');
    const dropped = entry('mark', 'dropped');
    performance.queueEntry(retained);
    performance.queueEntry(dropped);
    expect(buffer.entries).toEqual([retained]);
    expect(buffer.droppedEntriesCount).toBe(1);
    runTask();
    expect(callback.mock.calls[0]![0].getEntries().map((item) => item.name)).toEqual(['retained', 'dropped']);
    expect(callback.mock.calls[0]![2]).toEqual({ droppedEntriesCount: 1 });
    const replay = new window.PerformanceObserver(() => {});
    replay.observe({ type: 'mark', buffered: true });
    expect(replay.takeRecords().map((item) => item.name)).toEqual(['retained']);
  });

  it('applies producer admission separately to observers and storage without counting excluded entries as drops', () => {
    const { window, performance, entry, runTask } = fixture();
    const acceptedCallback = vi.fn<PerformanceObserverCallback>();
    const rejectedCallback = vi.fn<PerformanceObserverCallback>();
    const accepted = new window.PerformanceObserver(acceptedCallback);
    accepted.observe({ type: 'event' });
    new window.PerformanceObserver(rejectedCallback).observe({ entryTypes: ['event'] });
    const acceptedOptions = unwrap<PerformanceObserverImpl>(accepted).optionsList[0];
    const buffer = performance.getEntryBuffer('event');
    buffer.maxBufferSize = 0;
    const candidate = entry('event', 'controlled-admission');
    // Supply only Event Timing's unfinished admission operation; queueing/bindings remain real.
    vi.spyOn(candidate, 'shouldAdd').mockImplementation((options) => options === acceptedOptions);
    performance.queueEntry(candidate);
    expect(buffer.entries).toEqual([]);
    expect(buffer.droppedEntriesCount).toBe(0);
    runTask();
    expect(acceptedCallback).toHaveBeenCalledOnce();
    expect(rejectedCallback).not.toHaveBeenCalled();
  });

  it('queues observer-only entries without making them visible to synchronous queries', () => {
    const { window, performance, entry, runTask } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(callback).observe({ type: 'longtask' });
    performance.queueEntry(entry('longtask', 'work'));
    expect(window.performance.getEntries()).toEqual([]);
    expect(window.performance.getEntriesByType('longtask')).toEqual([]);
    expect(performance.getEntryBuffer('longtask').entries).toHaveLength(1);
    runTask();
    expect(callback.mock.calls[0]![0].getEntries()[0]!.name).toBe('work');
  });

  it('stores entries and coalesces the specified task even when no observer is registered', () => {
    const { performance, entry, runTask } = fixture();
    performance.queueEntry(entry('mark', 'first'));
    performance.queueEntry(entry('measure', 'second'));
    expect(performance.getEntries()).toHaveLength(2);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
  });

  it('initializes a Window navigation ID independently of unfinished Navigation Timing production', () => {
    const { document, performance, entry } = fixture();
    expect(document.navigationTimingEntry).toBeUndefined();
    expect(Number.isInteger(performance.currentNavigationId)).toBe(true);
    expect(performance.currentNavigationId).toBeGreaterThanOrEqual(100);
    expect(performance.currentNavigationId).toBeLessThanOrEqual(10000);
    const first = entry('mark', 'first');
    const second = entry('resource', 'second');
    expect(first.navigationId).toBe(0);
    performance.queueEntry(first);
    performance.queueEntry(second);
    expect(first.navigationId).toBe(performance.currentNavigationId);
    expect(second.navigationId).toBe(first.navigationId);
  });

  it('preserves producer-captured IDs and does not retag retained entries when the current ID changes', () => {
    const { performance, entry } = fixture();
    performance.currentNavigationId = 321;
    const captured = entry('resource', 'captured');
    captured.navigationId = 123;
    performance.queueEntry(captured);
    const previous = entry('mark', 'previous');
    performance.queueEntry(previous);
    // A future soft-navigation producer owns this change; this slice does not detect navigations.
    performance.currentNavigationId = 456;
    const current = entry('mark', 'current');
    performance.queueEntry(current);
    expect(captured.navigationId).toBe(123);
    expect(previous.navigationId).toBe(321);
    expect(current.navigationId).toBe(456);
    performance.queueEntry(previous);
    expect(previous.navigationId).toBe(321);
  });

  it('uses zero for a non-Window global through the same queueing and projection machinery', () => {
    const env = createSandboxEnvironment();
    const performance = new PerformanceImpl(env.timing, env);
    const entry = new PerformanceEntryImpl(1, 'mark', 'non-window', 0, env);
    expect(performance.currentNavigationId).toBe(0);
    performance.queueEntry(entry);
    expect(entry.navigationId).toBe(0);
    const platform = getBindingContext(env.realm).project(PerformanceEntryImpl, entry) as PerformanceEntry;
    // The sandbox has no exposed interfaces. Borrow the real binding to check projection,
    // without claiming that this environment implements WorkerGlobalScope.
    const { window } = fixture();
    expect(window.PerformanceEntry.prototype.toJSON.call(platform)).toMatchObject({ navigationId: 0 });
    env.responsibleEventLoop.runTaskTurn();
  });

  it('rejects a mismatched global owner before changing the entry or buffers', () => {
    const first = fixture();
    const second = fixture();
    const entry = first.entry('mark', 'first-global');
    expect(() => second.performance.queueEntry(entry)).toThrow('another global');
    expect(entry.navigationId).toBe(0);
    expect(first.performance.getEntries()).toEqual([]);
    expect(second.performance.getEntries()).toEqual([]);
    expect(second.runTask()).toBe(false);
  });

  it('retains the old global owner and its ID after navigation replaces the Window', async () => {
    const browser = new Browlet({ route: () => '' });
    const oldPlatform = browser.window.performance;
    const oldPerformance = unwrap<PerformanceImpl>(oldPlatform);
    const oldEnv = oldPerformance.env;
    oldPerformance.currentNavigationId = 123;
    await browser.navigate('https://example.test/replacement');
    const currentPerformance = unwrap<PerformanceImpl>(browser.window.performance);
    currentPerformance.currentNavigationId = 456;
    const oldEntry = new PerformanceEntryImpl(1, 'mark', 'old-global', 0, oldEnv);
    oldPerformance.queueEntry(oldEntry);
    expect(oldPlatform.getEntriesByName('old-global')[0]!.navigationId).toBe(123);
    expect(getRelevantRealm(oldPlatform.getEntries()[0]!)).toBe(oldEnv.realm);
    expect(browser.window.performance.getEntries()).toEqual([]);
    expect(currentPerformance.currentNavigationId).toBe(456);
  });
});

/** Supply completed measurements, keeping producer creation separate from real queueing and delivery. */
function fixture() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigable.activeDocument!;
  const env = document.env;
  const window = env.realm.globalObject as Window & typeof globalThis;
  const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
  performance.supportedEntryTypes = ['mark', 'measure', 'resource', 'longtask', 'event'];
  function entry(type: PerformanceEntryType, name: string, startTime = 1) {
    return new PerformanceEntryImpl(startTime, type, name, 0, env);
  }
  return { window, env, document, performance, entry, runTask: () => env.responsibleEventLoop.runTaskTurn() };
}
