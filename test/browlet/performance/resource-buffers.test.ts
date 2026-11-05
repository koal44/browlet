import { describe, expect, it, vi } from 'vitest';

import { FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createSandboxEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { PerformanceImpl, PerformanceEntryImpl, PerformanceResourceTimingImpl } from '../../../src/browlet/performance/index';
import type { Event, Performance, PerformanceObserverCallback, Window } from '../../../src/browlet/platform';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext } from '../../support/browlet-binding';

describe('Resource Timing buffer controls', () => {
  it('exposes the partial on Performance with the specified defaults and method lengths', () => {
    const { window, performance, platform } = fixture();
    expect(platform).toBeInstanceOf(window.EventTarget);
    expect(platform.clearResourceTimings.length).toBe(0);
    expect(platform.setResourceTimingBufferSize.length).toBe(1);
    expect(platform.onresourcetimingbufferfull).toBeNull();
    expect(Object.hasOwn(window.Performance.prototype, 'onresourcetimingbufferfull')).toBe(true);
    expect(performance.getEntryBuffer('resource').maxBufferSize).toBe(250);
    expect(performance.canAddResourceTimingEntry()).toBe(true);
    expect(platform.clearResourceTimings()).toBeUndefined();
    expect(platform.setResourceTimingBufferSize(10)).toBeUndefined();
    expect(window.PerformanceObserver.supportedEntryTypes).toContain('resource');
  });

  it('shrinks without evicting entries, then permits additions after growing beyond the retained size', () => {
    const { performance, platform, retain } = fixture();
    retain('first');
    retain('second');
    const entries = platform.getEntriesByType('resource');
    platform.setResourceTimingBufferSize(1);
    expect(platform.getEntriesByType('resource')).toEqual(entries);
    expect(performance.canAddResourceTimingEntry()).toBe(false);
    platform.setResourceTimingBufferSize(2);
    expect(performance.canAddResourceTimingEntry()).toBe(false);
    platform.setResourceTimingBufferSize(3);
    expect(performance.canAddResourceTimingEntry()).toBe(true);
    expect(platform.getEntriesByType('resource')[0]).toBe(entries[0]);
  });

  it('clears only resource entries, preserving the capacity, drop count, and retained entry objects', () => {
    const { env, performance, platform, retain } = fixture();
    retain('resource');
    const retained = platform.getEntriesByType('resource')[0]!;
    // Populate other families internally; their author-facing producers are separate work.
    performance.getEntryBuffer('mark').entries.push(new PerformanceEntryImpl(1, 'mark', 'mark', 0, env));
    performance.getEntryBuffer('navigation').entries.push(new PerformanceEntryImpl(2, 'navigation', 'navigation', 0, env));
    const buffer = performance.getEntryBuffer('resource');
    buffer.droppedEntriesCount = 3;
    platform.setResourceTimingBufferSize(1);
    platform.clearResourceTimings();
    expect(platform.getEntries().map((entry) => entry.entryType)).toEqual(['mark', 'navigation']);
    expect(buffer.entries).toHaveLength(0);
    expect(buffer.maxBufferSize).toBe(1);
    expect(buffer.droppedEntriesCount).toBe(3);
    expect(performance.canAddResourceTimingEntry()).toBe(true);
    expect(retained.name).toBe('https://example.test/resource');
    platform.clearResourceTimings();
    expect(performance.getEntryBuffer('resource')).toBe(buffer);
  });

  it('leaves already queued observer records deliverable and excludes cleared entries from buffered replay', () => {
    const { window, performance, platform, entry, runTask } = fixture();
    performance.supportedEntryTypes = ['resource'];
    const callback = vi.fn<PerformanceObserverCallback>();
    new window.PerformanceObserver(callback).observe({ type: 'resource' });
    // Exercise queueing and resource admission for a prepared entry, before clearing retained storage.
    const resource = entry('observed');
    performance.queueEntry(resource);
    performance.addResourceTimingEntry(resource);
    expect(platform.getEntriesByType('resource')).toHaveLength(1);
    platform.clearResourceTimings();
    expect(platform.getEntriesByType('resource')).toEqual([]);
    const replay = new window.PerformanceObserver(() => {});
    replay.observe({ type: 'resource', buffered: true });
    expect(replay.takeRecords()).toEqual([]);
    expect(runTask()).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].getEntries().map((value) => value.name)).toEqual(['https://example.test/observed']);
    expect(runTask()).toBe(false);
  });

  it('checks capacity without mutating drop accounting', () => {
    const { performance, platform, retain } = fixture();
    platform.setResourceTimingBufferSize(0);
    expect(performance.canAddResourceTimingEntry()).toBe(false);
    platform.setResourceTimingBufferSize(1);
    retain('full');
    expect(performance.canAddResourceTimingEntry()).toBe(false);
    expect(performance.canAddResourceTimingEntry()).toBe(false);
    expect(performance.getEntryBuffer('resource').droppedEntriesCount).toBe(0);
  });

  it.each([
    ['zero', 0, 0], ['fraction', 1.9, 1], ['string', '3', 3], ['null', null, 0],
    ['undefined', undefined, 0], ['NaN', NaN, 0], ['infinity', Infinity, 0],
    ['negative', -1, 2 ** 32 - 1], ['wrap', 2 ** 32, 0], ['wrapped fraction', 2 ** 32 + 2.9, 2],
  ])('converts %s through Web IDL before updating the capacity', (_label, value, expected) => {
    const { performance, platform } = fixture();
    Reflect.apply(platform.setResourceTimingBufferSize, platform, [value]);
    expect(performance.getEntryBuffer('resource').maxBufferSize).toBe(expected);
  });

  it('rejects missing and unconvertible arguments before changing the limit', () => {
    const { window, performance, platform } = fixture();
    platform.setResourceTimingBufferSize(7);
    expect(() => { Reflect.apply(platform.setResourceTimingBufferSize, platform, []); }).toThrow(window.TypeError);
    for (const value of [Symbol('invalid'), 1n]) {
      expect(() => { Reflect.apply(platform.setResourceTimingBufferSize, platform, [value]); }).toThrow(window.TypeError);
    }
    expect(performance.getEntryBuffer('resource').maxBufferSize).toBe(7);
  });

  it('uses the receiver global when methods are borrowed, and rejects incompatible receivers', () => {
    const first = fixture();
    const second = fixture();
    first.retain('first');
    second.retain('second');
    const prototype = second.window.Performance.prototype;
    prototype.setResourceTimingBufferSize.call(first.platform, 0);
    expect(first.performance.canAddResourceTimingEntry()).toBe(false);
    expect(second.performance.getEntryBuffer('resource').maxBufferSize).toBe(250);
    prototype.clearResourceTimings.call(first.platform);
    expect(first.platform.getEntriesByType('resource')).toEqual([]);
    expect(second.platform.getEntriesByType('resource')).toHaveLength(1);
    expect(() => { Reflect.apply(prototype.clearResourceTimings, {}, []); }).toThrow(second.window.TypeError);
    expect(() => { Reflect.apply(prototype.setResourceTimingBufferSize, {}, [1]); }).toThrow(second.window.TypeError);
  });

  it('uses the shared HTML handler machinery for callback identity, target, replacement, and removal', () => {
    const { window, platform } = fixture();
    const calls: string[] = [];
    const first = function(this: unknown, event: Event) {
      expect(this).toBe(platform);
      expect(event.target).toBe(platform);
      expect(event.currentTarget).toBe(platform);
      expect(event.isTrusted).toBe(false);
      calls.push('first');
    };
    platform.onresourcetimingbufferfull = first;
    platform.addEventListener('resourcetimingbufferfull', () => { calls.push('listener'); });
    expect(platform.onresourcetimingbufferfull).toBe(first);
    platform.dispatchEvent(new window.Event('resourcetimingbufferfull'));
    platform.onresourcetimingbufferfull = () => { calls.push('replacement'); };
    platform.dispatchEvent(new window.Event('resourcetimingbufferfull'));
    platform.onresourcetimingbufferfull = null;
    platform.dispatchEvent(new window.Event('resourcetimingbufferfull'));
    expect(calls).toEqual(['first', 'listener', 'replacement', 'listener', 'listener']);
  });

  it('does not fire the full event merely because the limit is lowered or the buffer is cleared', () => {
    const { platform, retain, runTask } = fixture();
    retain('existing');
    const callback = vi.fn();
    platform.onresourcetimingbufferfull = callback;
    platform.setResourceTimingBufferSize(0);
    platform.clearResourceTimings();
    expect(runTask()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('keeps buffer controls usable without a Window owner', () => {
    const { window } = fixture();
    const env = createSandboxEnvironment();
    const performance = new PerformanceImpl(env);
    const platform = getBindingContext(env.realm).project(PerformanceImpl, performance) as Performance;
    // A sandbox has no exposed Performance constructor; borrow operations through the real binding.
    // Worker loading remains owned by the Worker implementation, not this fixture.
    window.Performance.prototype.setResourceTimingBufferSize.call(platform, 0);
    window.Performance.prototype.clearResourceTimings.call(platform);
    expect(performance.getEntryBuffer('resource').maxBufferSize).toBe(0);
    expect(performance.canAddResourceTimingEntry()).toBe(false);
  });
});

/** Seed completed primary-buffer entries without substituting for Fetch or overflow processing. */
function fixture() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const env = navigable.activeDocument!.env;
  const window = env.realm.globalObject as Window & typeof globalThis;
  const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
  function entry(name: string) {
    return new PerformanceResourceTimingImpl(
      'fetch', `https://example.test/${name}`, new FetchTimingInfo(), '', new ResponseBodyInfo(), 200, '', true, env,
    );
  }
  function retain(name: string) { performance.getEntryBuffer('resource').entries.push(entry(name)); }
  return { window, env, performance, platform: window.performance, entry, retain, runTask: () => env.responsibleEventLoop.runTaskTurn() };
}
