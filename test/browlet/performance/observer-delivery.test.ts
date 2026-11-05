import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createWindowEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import {
  PerformanceEntryImpl, type PerformanceEntryType, type PerformanceObserverImpl,
} from '../../../src/browlet/performance/index';
import type {
  PerformanceObserverCallback, PerformanceObserverCallbackOptionsResult,
  PerformanceObserverEntryList, Window,
} from '../../../src/browlet/platform';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('PerformanceObserver buffered replay and delivery', () => {
  it('replays synchronously in retained order, including repeated requests, without changing the global buffer', () => {
    const { window, performance, addEntry, runTask } = fixture();
    const late = addEntry('mark', 'late', 30);
    const early = addEntry('mark', 'early', 10);
    const callback = vi.fn<PerformanceObserverCallback>();
    const observer = new window.PerformanceObserver(callback);
    observer.observe({ type: 'mark', buffered: true });
    observer.observe({ type: 'mark', buffered: true });
    const records = observer.takeRecords();
    expect(records.map((entry) => entry.name)).toEqual(['late', 'early', 'late', 'early']);
    expect(records[0]).toBe(records[2]);
    expect(records[1]).toBe(records[3]);
    expect(performance.getEntryBuffer('mark').entries).toEqual([late, early]);
    expect(callback).not.toHaveBeenCalled();
    expect(runTask()).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(runTask()).toBe(false);
  });

  it('coalesces notifications, supplies separate sorted batches, and preserves entry identity and callback receivers', () => {
    const { window, addEntry, runTask } = fixture();
    addEntry('mark', 'late', 30);
    addEntry('mark', 'early', 10);
    const firstCallback = vi.fn<PerformanceObserverCallback>();
    const secondCallback = vi.fn<PerformanceObserverCallback>();
    const first = new window.PerformanceObserver(firstCallback);
    const second = new window.PerformanceObserver(secondCallback);
    first.observe({ type: 'mark', buffered: true });
    second.observe({ type: 'mark', buffered: true });
    expect(firstCallback).not.toHaveBeenCalled();
    expect(runTask()).toBe(true);
    const [firstList, firstArgument, firstOptions] = firstCallback.mock.calls[0]!;
    const [secondList] = secondCallback.mock.calls[0]!;
    expect(firstList).toBeInstanceOf(window.PerformanceObserverEntryList);
    expect(firstList).not.toBe(secondList);
    expect(firstList.getEntries().map((entry) => entry.name)).toEqual(['early', 'late']);
    expect(firstList.getEntries()[0]).toBe(secondList.getEntries()[0]);
    expect(firstArgument).toBe(first);
    expect(firstCallback.mock.contexts[0]).toBe(first);
    expect(secondCallback.mock.contexts[0]).toBe(second);
    expect(firstOptions).toEqual({ droppedEntriesCount: 0 });
    expect(first.takeRecords()).toEqual([]);
    expect(runTask()).toBe(false);
  });

  it('skips empty observers without suppressing later batches or resetting their requested drop count', () => {
    const { window, addEntry, runTask } = fixture();
    addEntry('mark', 'present', 1);
    const emptyCallback = vi.fn<PerformanceObserverCallback>();
    const empty = new window.PerformanceObserver(emptyCallback);
    const laterCallback = vi.fn<PerformanceObserverCallback>();
    const later = new window.PerformanceObserver(laterCallback);
    empty.observe({ type: 'measure', buffered: true });
    later.observe({ type: 'mark', buffered: true });
    expect(runTask()).toBe(true);
    expect(emptyCallback).not.toHaveBeenCalled();
    expect(unwrap<PerformanceObserverImpl>(empty).requiresDroppedEntries).toBe(true);
    expect(laterCallback).toHaveBeenCalledOnce();
  });

  it('counts each observed type once and supplies cumulative counts again only after observe', () => {
    const { window, performance, addEntry, runTask } = fixture();
    const entry = addEntry('mark', 'present', 1);
    performance.getEntryBuffer('mark').droppedEntriesCount = 3;
    performance.getEntryBuffer('measure').droppedEntriesCount = 5;
    const callback = vi.fn<PerformanceObserverCallback>();
    const observer = new window.PerformanceObserver(callback);
    observer.observe({ entryTypes: ['mark', 'mark', 'measure', 'resource'] });
    const implementation = unwrap<PerformanceObserverImpl>(observer);
    implementation.observerBuffer.push(entry);
    performance.queueObserverTask();
    runTask();
    expect(callback.mock.calls[0]![2]).toEqual({ droppedEntriesCount: 8 });
    implementation.observerBuffer.push(entry);
    performance.queueObserverTask();
    runTask();
    expect(callback.mock.calls[1]![2]).toEqual({});
    observer.observe({ entryTypes: ['mark'] });
    performance.queueObserverTask();
    runTask();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(implementation.requiresDroppedEntries).toBe(true);
    implementation.observerBuffer.push(entry);
    performance.queueObserverTask();
    runTask();
    expect(callback.mock.calls[2]![2]).toEqual({ droppedEntriesCount: 3 });
    expect(performance.getEntryBuffer('mark').droppedEntriesCount).toBe(3);
  });

  it('snapshots observer membership while allowing a pending observer to disconnect and replay a fresh batch', () => {
    const { window, addEntry, runTask } = fixture();
    addEntry('mark', 'present', 1);
    const calls: string[] = [];
    const first = new window.PerformanceObserver(() => {
      calls.push('first');
      first.disconnect();
      second.disconnect();
      second.observe({ type: 'mark', buffered: true });
      third.observe({ type: 'mark', buffered: true });
    });
    const second = new window.PerformanceObserver((list) => calls.push(`second:${list.getEntries().length}`));
    const third = new window.PerformanceObserver(() => calls.push('third'));
    first.observe({ type: 'mark', buffered: true });
    second.observe({ type: 'mark', buffered: true });
    expect(runTask()).toBe(true);
    expect(calls).toEqual(['first', 'second:1']);
    expect(runTask()).toBe(true);
    expect(calls).toEqual(['first', 'second:1', 'third']);
    expect(runTask()).toBe(false);
  });

  it('drains before callbacks and retains a delivered batch when the observer queues another replay', () => {
    const { window, addEntry, runTask } = fixture();
    addEntry('mark', 'original', 1);
    const batches: PerformanceObserverEntryList[] = [];
    const observer = new window.PerformanceObserver((list) => {
      batches.push(list);
      expect(observer.takeRecords()).toEqual([]);
      if (batches.length === 1) {
        addEntry('mark', 'later', 2);
        observer.observe({ type: 'mark', buffered: true });
      }
    });
    observer.observe({ type: 'mark', buffered: true });
    runTask();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.getEntries().map((entry) => entry.name)).toEqual(['original']);
    runTask();
    expect(batches[1]!.getEntries().map((entry) => entry.name)).toEqual(['original', 'later']);
    expect(batches[0]!.getEntries().map((entry) => entry.name)).toEqual(['original']);
  });

  it('reports a thrown callback and still delivers to the next observer', () => {
    const { window, env, addEntry, runTask } = fixture();
    addEntry('mark', 'present', 1);
    const failure = new env.realm.Error('observer failed');
    const reported = vi.spyOn(env.realm, 'reportException').mockImplementation(() => {});
    const first = new window.PerformanceObserver(() => { throw failure; });
    const callback = vi.fn<PerformanceObserverCallback>();
    const second = new window.PerformanceObserver(callback);
    first.observe({ type: 'mark', buffered: true });
    second.observe({ type: 'mark', buffered: true });
    runTask();
    expect(reported).toHaveBeenCalledExactlyOnceWith(failure);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('releases the queued flag when document-associated work is discarded', () => {
    const { window, env, document, addEntry, runTask } = fixture();
    addEntry('mark', 'present', 1);
    const callback = vi.fn<PerformanceObserverCallback>();
    const observer = new window.PerformanceObserver(callback);
    observer.observe({ type: 'mark', buffered: true });
    env.responsibleEventLoop.removeTasksForDocument(document);
    expect(runTask()).toBe(false);
    observer.takeRecords();
    observer.observe({ type: 'mark', buffered: true });
    expect(runTask()).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('keeps queues independent across globals', () => {
    const first = fixture();
    const second = fixture();
    first.addEntry('mark', 'first', 1);
    second.addEntry('mark', 'second', 1);
    const firstCallback = vi.fn<PerformanceObserverCallback>();
    const secondCallback = vi.fn<PerformanceObserverCallback>();
    new first.window.PerformanceObserver(firstCallback).observe({ type: 'mark', buffered: true });
    new second.window.PerformanceObserver(secondCallback).observe({ type: 'mark', buffered: true });
    first.runTask();
    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).not.toHaveBeenCalled();
    second.runTask();
    expect(secondCallback).toHaveBeenCalledOnce();
  });

  it('keeps the batch and entries in the observer realm while callback metadata uses the callback realm', () => {
    const owner = fixture();
    const { agent } = owner.env.realm;
    if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
    const sibling = createWindowEnvironment({
      agent, userAgent: owner.env.userAgent, creationURL: owner.env.creationURL,
      origin: owner.env.origin, parent: null,
      topLevelCreationURL: owner.env.creationURL, topLevelOrigin: owner.env.origin,
    });
    const document = sibling.realm.env.createDocument();
    document.browsingContext = new BrowsingContext(sibling.realm.windowProxy);
    sibling.window.setAssociatedDocument(document);
    document.makeActive();
    const callback = sibling.realm.evaluate(`(function(list, observer, options) {
      globalThis.delivered = { list, observer, receiver: this, options };
    })`, 'performance-observer-callback.js') as PerformanceObserverCallback;
    const observer = new owner.window.PerformanceObserver(callback);
    owner.addEntry('mark', 'present', 1);
    observer.observe({ type: 'mark', buffered: true });
    owner.runTask();
    const delivered = Reflect.get(sibling.realm.globalObject, 'delivered') as {
      list: PerformanceObserverEntryList; observer: object; receiver: object;
      options: PerformanceObserverCallbackOptionsResult;
    };
    expect(getRelevantRealm(delivered.list)).toBe(owner.env.realm);
    expect(getRelevantRealm(delivered.list.getEntries()[0]!)).toBe(owner.env.realm);
    expect(Object.getPrototypeOf(delivered.list.getEntries())).toBe(owner.env.realm.Array.prototype);
    expect(Object.getPrototypeOf(delivered.options)).toBe(sibling.realm.Object.prototype);
    expect(delivered.observer).toBe(observer);
    expect(delivered.receiver).toBe(observer);
  });

  it('uses the running HTML loop and performs callback microtask checkpoints between deliveries', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
    performance.supportedEntryTypes = ['mark'];
    const entry = new PerformanceEntryImpl(1, 'mark', 'completed-producer-input', 0, env);
    performance.queueEntry(entry);
    const result = await browser.evaluate(() => new Promise<string[]>((resolve) => {
      const order = ['register'];
      const first = new PerformanceObserver(() => {
        order.push('first');
        queueMicrotask(() => order.push('microtask'));
      });
      const second = new PerformanceObserver(() => {
        order.push('second');
        first.disconnect(); second.disconnect();
        resolve(order);
      });
      first.observe({ type: 'mark', buffered: true });
      second.observe({ type: 'mark', buffered: true });
      order.push('registered');
    }));
    expect(result).toEqual(['register', 'registered', 'first', 'microtask', 'second']);
  });
});

/** Supply retained producer records to isolate replay/delivery from the separate queueing tests. */
function fixture() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigable.activeDocument!;
  const env = document.env;
  const window = env.realm.globalObject as Window & typeof globalThis;
  const performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
  performance.supportedEntryTypes = ['mark', 'measure', 'resource'];
  function addEntry(type: PerformanceEntryType, name: string, startTime: number) {
    const entry = new PerformanceEntryImpl(startTime, type, name, 0, env);
    entry.navigationId = 100;
    performance.getEntryBuffer(type).entries.push(entry);
    return entry;
  }
  return { window, env, document, performance, addEntry, runTask: () => env.responsibleEventLoop.runTaskTurn() };
}
