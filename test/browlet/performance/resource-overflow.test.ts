import { describe, expect, it, vi } from 'vitest';

import { FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { PerformanceResourceTimingImpl } from '../../../src/browlet/performance/index';
import type { Event, PerformanceObserverCallback, Window } from '../../../src/browlet/platform';
import { createManualUserAgent } from '../../support/browlet-agent';

describe('Resource Timing overflow', () => {
  it('queues resource observers without inserting into the primary buffer twice', () => {
    const { window, performance, platform, entry, names } = fixture();
    const observer = new window.PerformanceObserver(() => {});
    observer.observe({ type: 'resource' });
    const resource = entry('one');
    performance.queueEntry(resource);
    expect(names()).toEqual([]);
    expect(resource.navigationId).toBe(performance.currentNavigationId);
    const observed = observer.takeRecords();
    expect(observed).toHaveLength(1);
    performance.addResourceTimingEntry(resource);
    expect(names()).toEqual(['one']);
    expect(platform.getEntriesByType('resource')[0]).toBe(observed[0]);
  });

  it('does not notify merely upon reaching capacity', () => {
    const { performance, platform, record, runTask, names } = fixture();
    const full = vi.fn();
    platform.onresourcetimingbufferfull = full;
    platform.setResourceTimingBufferSize(1);
    record('one');
    expect(names()).toEqual(['one']);
    expect(runTask()).toBe(true); // Timeline notification, even without an observer.
    expect(runTask()).toBe(false);
    expect(full).not.toHaveBeenCalled();
    expect(performance.getEntryBuffer('resource').droppedEntriesCount).toBe(0);
  });

  it('coalesces overflow on the timeline task source and delivers observers before the trusted full event', () => {
    const { window, performance, platform, record, runTask, names } = fixture();
    const order: string[] = [];
    const callback = vi.fn<PerformanceObserverCallback>(() => { order.push('observer'); });
    const full = vi.fn<(receiver: unknown, event: Event, currentTarget: unknown, entries: string[]) => void>();
    new window.PerformanceObserver(callback).observe({ type: 'resource' });
    platform.setResourceTimingBufferSize(1);
    platform.onresourcetimingbufferfull = function(event) {
      order.push('full');
      full(this, event, event.currentTarget, names());
    };
    record('first'); record('second'); record('third');
    expect(order).toEqual([]);
    expect(names()).toEqual(['first']);
    expect(runTask()).toBe(true);
    expect(order).toEqual(['observer']);
    expect(callback.mock.calls[0]![0].getEntries().map((entry) => entry.name)).toEqual(['first', 'second', 'third']);
    expect(callback.mock.calls[0]![2]).toEqual({ droppedEntriesCount: 2 });
    expect(runTask()).toBe(true);
    expect(order).toEqual(['observer', 'full']);
    expect(full).toHaveBeenCalledOnce();
    const [receiver, event, currentTarget, entries] = full.mock.calls[0]!;
    expect(receiver).toBe(platform);
    expect(event.target).toBe(platform);
    expect(currentTarget).toBe(platform);
    expect(event.isTrusted).toBe(true);
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
    expect(entries).toEqual(['first']);
    expect(runTask()).toBe(false);
    expect(performance.getEntryBuffer('resource').droppedEntriesCount).toBe(2);
  });

  it('rescues secondary entries after the handler grows the buffer without notifying observers twice', () => {
    const { window, performance, platform, record, runTask, names } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(callback).observe({ type: 'resource' });
    const full = vi.fn(() => { platform.setResourceTimingBufferSize(3); });
    platform.onresourcetimingbufferfull = full;
    platform.setResourceTimingBufferSize(1);
    record('first'); record('second'); record('third');
    runTask();
    const delivered = callback.mock.calls[0]![0].getEntries();
    runTask();
    expect(full).toHaveBeenCalledOnce();
    expect(names()).toEqual(['first', 'second', 'third']);
    expect(platform.getEntriesByType('resource')).toEqual(delivered);
    expect(callback).toHaveBeenCalledOnce();
    expect(runTask()).toBe(false);
    expect(performance.getEntryBuffer('resource').droppedEntriesCount).toBe(2);
    const replay = new window.PerformanceObserver(callback);
    replay.observe({ type: 'resource', buffered: true });
    runTask();
    expect(callback.mock.calls[1]![0].getEntries()).toEqual(delivered);
    expect(callback.mock.calls[1]![2]).toEqual({ droppedEntriesCount: 2 });
  });

  it('lets each clearing handler make progress through the same secondary buffer', () => {
    const { platform, record, runTask, names } = fixture();
    const visible: string[][] = [];
    platform.setResourceTimingBufferSize(1);
    platform.onresourcetimingbufferfull = () => { visible.push(names()); platform.clearResourceTimings(); };
    record('first'); record('second'); record('third');
    runTask();
    runTask();
    expect(visible).toEqual([['first'], ['second']]);
    expect(names()).toEqual(['third']);
    expect(runTask()).toBe(false);
  });

  it('keeps later entries behind already pending entries even after capacity grows', () => {
    const { performance, platform, record, runTask, names } = fixture();
    platform.setResourceTimingBufferSize(0);
    record('first'); record('second');
    platform.setResourceTimingBufferSize(3);
    record('third');
    expect(names()).toEqual([]);
    const full = vi.fn();
    platform.onresourcetimingbufferfull = full;
    runTask();
    runTask();
    expect(names()).toEqual(['first', 'second', 'third']);
    expect(full).not.toHaveBeenCalled();
    expect(performance.getEntryBuffer('resource').droppedEntriesCount).toBe(3);
  });

  it('keeps the secondary buffer pending when author code clears the primary buffer before delivery', () => {
    const { platform, record, runTask, names } = fixture();
    platform.setResourceTimingBufferSize(1);
    record('cleared'); record('pending');
    platform.clearResourceTimings();
    platform.setResourceTimingBufferSize(2);
    record('later');
    expect(names()).toEqual([]);
    const full = vi.fn();
    platform.onresourcetimingbufferfull = full;
    runTask(); runTask();
    expect(names()).toEqual(['pending', 'later']);
    expect(full).not.toHaveBeenCalled();
  });

  it('discards excess entries on no progress and permits another notification without a control change', () => {
    const { platform, record, runTask, names } = fixture();
    const full = vi.fn();
    platform.onresourcetimingbufferfull = full;
    platform.setResourceTimingBufferSize(0);
    record('discarded-first');
    runTask(); runTask();
    expect(full).toHaveBeenCalledTimes(1);
    record('discarded-second');
    runTask(); runTask();
    expect(full).toHaveBeenCalledTimes(2);
    platform.setResourceTimingBufferSize(1);
    record('fresh');
    expect(names()).toEqual(['fresh']);
    runTask();
    expect(runTask()).toBe(false);
    expect(full).toHaveBeenCalledTimes(2);
  });

  it('allows a handler installed after a previous unhandled overflow to rescue a later entry', () => {
    const { platform, record, runTask, names } = fixture();
    platform.setResourceTimingBufferSize(0);
    record('unhandled');
    runTask(); runTask();
    platform.onresourcetimingbufferfull = () => { platform.setResourceTimingBufferSize(1); };
    record('handled');
    runTask(); runTask();
    expect(names()).toEqual(['handled']);
  });

  it('processes reentrant additions after older entries and stops if the handler creates no net space', () => {
    const { window, performance, platform, record, runTask, names } = fixture();
    const callback = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(callback).observe({ type: 'resource' });
    platform.setResourceTimingBufferSize(0);
    const full = vi.fn(() => {
      platform.setResourceTimingBufferSize(1);
      record('nested');
    });
    platform.onresourcetimingbufferfull = full;
    record('original');
    runTask(); runTask();
    expect(names()).toEqual(['original']);
    expect(full).toHaveBeenCalledOnce();
    expect(performance.getEntryBuffer('resource').droppedEntriesCount).toBe(2);
    expect(runTask()).toBe(true);
    expect(callback.mock.calls.map(([list]) => list.getEntries().map((entry) => entry.name)))
      .toEqual([['original'], ['nested']]);
    expect(runTask()).toBe(false);
    platform.setResourceTimingBufferSize(3);
    record('fresh');
    expect(names()).toEqual(['original', 'fresh']);
  });

  it('reports a throwing handler through the existing event machinery and still completes draining', () => {
    const { env, platform, record, runTask, names } = fixture();
    const failure = new Error('buffer handler failed');
    const report = vi.spyOn(env, 'reportException').mockImplementation(() => {});
    platform.setResourceTimingBufferSize(0);
    platform.onresourcetimingbufferfull = () => { platform.setResourceTimingBufferSize(2); throw failure; };
    record('rescued');
    runTask(); runTask();
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(names()).toEqual(['rescued']);
    record('later');
    expect(names()).toEqual(['rescued', 'later']);
  });

  it('releases pending secondary entries when their Document task is discarded', () => {
    const { env, document, platform, record, runTask, names } = fixture();
    platform.setResourceTimingBufferSize(0);
    record('discarded');
    env.responsibleEventLoop.removeTasksForDocument(document);
    expect(runTask()).toBe(false);
    platform.onresourcetimingbufferfull = () => { platform.setResourceTimingBufferSize(2); };
    record('later');
    runTask(); runTask();
    expect(names()).toEqual(['later']);
    expect(runTask()).toBe(false);
  });

  it('does not let another global take ownership of a resource entry', () => {
    const first = fixture();
    const second = fixture();
    const resource = first.entry('foreign');
    expect(() => second.performance.addResourceTimingEntry(resource)).toThrow('another global');
    expect(first.names()).toEqual([]);
    expect(second.names()).toEqual([]);
    expect(second.performance.getEntryBuffer('resource').droppedEntriesCount).toBe(0);
    expect(second.runTask()).toBe(false);
  });

  it('keeps pending tasks and resource queues independent across globals', () => {
    const first = fixture();
    const second = fixture();
    first.platform.setResourceTimingBufferSize(0);
    second.platform.setResourceTimingBufferSize(0);
    first.platform.onresourcetimingbufferfull = () => { first.platform.setResourceTimingBufferSize(1); };
    second.platform.onresourcetimingbufferfull = () => { second.platform.setResourceTimingBufferSize(1); };
    first.record('first'); second.record('second');
    first.runTask(); first.runTask();
    expect(first.names()).toEqual(['first']);
    expect(second.names()).toEqual([]);
    second.runTask(); second.runTask();
    expect(second.names()).toEqual(['second']);
  });
});

/** Supply prepared measurements, retaining real Timeline, Binding, event, and task delivery. */
function fixture() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigable.activeDocument!;
  const env = document.env;
  const window = env.realm.globalObject as Window & typeof globalThis;
  const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
  performance.supportedEntryTypes = ['resource'];
  let nextStart = env.timeOrigin.milliseconds + 1;
  function entry(name: string) {
    const timing = new FetchTimingInfo();
    timing.startTime = nextStart++;
    timing.endTime = timing.startTime + 1;
    return new PerformanceResourceTimingImpl('fetch', name, timing, '', new ResponseBodyInfo(), 200, '', true, [], env);
  }
  function record(name: string) {
    const resource = entry(name);
    // Resource Timing's mark-resource-timing steps 3 and 4; Fetch delivery remains separate.
    performance.queueEntry(resource);
    performance.addResourceTimingEntry(resource);
    return resource;
  }
  return {
    window, env, document, performance, platform: window.performance, entry, record,
    names: () => window.performance.getEntriesByType('resource').map((entry) => entry.name),
    runTask: () => env.responsibleEventLoop.runTaskTurn(),
  };
}
