/* eslint-disable @typescript-eslint/unbound-method -- These tests deliberately borrow methods and explicitly supply their receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/index';
import {
  PerformanceEntryImpl, type PerformanceEntryType, type PerformanceImpl,
} from '../../../src/browlet/performance/index';
import type { PerformanceEntry } from '../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Performance Timeline entry and query foundation', () => {
  it('exposes a realm-owned, nonconstructible PerformanceEntry interface', () => {
    const first = fixture();
    const second = fixture();
    const constructor: unknown = first.browser.window.PerformanceEntry;
    if (typeof constructor !== 'function') throw new Error('Missing PerformanceEntry interface');
    expect(() => { Reflect.construct(constructor, []); }).toThrow(first.env.realm.TypeError);
    expect(constructor).not.toBe(second.browser.window.PerformanceEntry);
    expect(Object.getPrototypeOf(first.browser.window.PerformanceEntry.prototype)).toBe(first.env.realm.Object.prototype);
  });

  it('returns fresh empty arrays for unknown types through the author API', async () => {
    const { browser } = fixture();
    expect(await browser.evaluate(() => {
      const first = performance.getEntriesByType('__absent__');
      const second = performance.getEntriesByType('__absent__');
      return {
        length: first.length, fresh: first !== second,
        array: Object.getPrototypeOf(first) === Array.prototype,
        mutable: !Object.isFrozen(first),
        byName: performance.getEntriesByName('anything', '__absent__').length,
      };
    })).toEqual({ length: 0, fresh: true, array: true, mutable: true, byName: 0 });
  });

  it('merges visible families in chronological order and filters by exact name and type', () => {
    const { performance, addEntry } = fixture();
    addEntry('mark', 'same', 30);
    addEntry('mark', 'same', 10);
    addEntry('measure', 'same', 12, 17);
    addEntry('resource', 'resource', 5, 9);
    addEntry('mark', 'other', 20);

    expect(describeEntries(performance.getEntries())).toEqual([
      ['resource', 'resource', 5], ['same', 'mark', 10], ['same', 'measure', 12],
      ['other', 'mark', 20], ['same', 'mark', 30],
    ]);
    expect(describeEntries(performance.getEntriesByName('same'))).toEqual([
      ['same', 'mark', 10], ['same', 'measure', 12], ['same', 'mark', 30],
    ]);
    expect(describeEntries(performance.getEntriesByName('same', 'mark'))).toEqual([
      ['same', 'mark', 10], ['same', 'mark', 30],
    ]);
    expect(performance.getEntriesByName('Same')).toEqual([]);
    expect(performance.getEntriesByType('Mark')).toEqual([]);
    expect(performance.getEntriesByType('resource')[0]!.duration).toBe(4);
  });

  it('excludes observer-only entries from every synchronous query', () => {
    const { performance, implementation, addEntry } = fixture();
    addEntry('event', 'shared', 1, 2);
    addEntry('longtask', 'shared', 3, 8);
    addEntry('mark', 'shared', 5);

    expect(performance.getEntries().map((entry) => entry.entryType)).toEqual(['mark']);
    expect(performance.getEntriesByName('shared').map((entry) => entry.entryType)).toEqual(['mark']);
    expect(performance.getEntriesByType('event')).toEqual([]);
    expect(performance.getEntriesByName('shared', 'longtask')).toEqual([]);
    expect(implementation.getEntryBuffer('event').entries).toHaveLength(1);
  });

  it('keeps duplicate names and equal timestamps without reordering the retained buffer', () => {
    const { performance, implementation, addEntry } = fixture();
    const late = addEntry('mark', 'late', 30);
    const first = addEntry('mark', 'duplicate', 10);
    const otherType = addEntry('measure', 'duplicate', 10);
    const second = addEntry('mark', 'duplicate', 10);
    expect(performance.getEntriesByType('mark').map((entry) => entry.name)).toEqual([
      'duplicate', 'duplicate', 'late',
    ]);
    expect(implementation.getEntryBuffer('mark').entries).toEqual([late, first, second]);
    const duplicates = performance.getEntriesByName('duplicate');
    expect(unwrap(duplicates[0]!)).toBe(first);
    expect(unwrap(duplicates[1]!)).toBe(second);
    expect(unwrap(duplicates[2]!)).toBe(otherType);
    expect(implementation.getEntryBuffer('measure').entries).toEqual([otherType]);
  });

  it('copies result lists while preserving projected entry identity', () => {
    const { browser, performance, env, addEntry } = fixture();
    addEntry('mark', 'retained', 10);
    const entries = performance.getEntriesByType('mark');
    const entry = entries[0]!;
    entries.length = 0;
    const next = performance.getEntriesByName('retained');
    expect(next).not.toBe(entries);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(entry);
    expect(entry).toBeInstanceOf(browser.window.PerformanceEntry);
    expect(Object.getPrototypeOf(next)).toBe(env.realm.Array.prototype);
    expect(getRelevantRealm(entry)).toBe(env.realm);
    expect(Reflect.set(entry, 'name', 'changed')).toBe(false);
    expect(Object.hasOwn(entry, 'endTime')).toBe(false);
  });

  it('uses DOMString conversion and distinguishes omitted, empty, and null type arguments', () => {
    const { performance, addEntry } = fixture();
    addEntry('mark', '', 1);
    addEntry('mark', 'null', 2);
    addEntry('mark', 'undefined', 3);
    addEntry('measure', 'null', 4, 8);
    const names = performance.getEntriesByName;
    expect(names.call(performance, 'null', undefined)).toHaveLength(2);
    expect(names.call(performance, 'null', '')).toEqual([]);
    expect(Reflect.apply(names, performance, ['null', null])).toEqual([]);
    expect(Reflect.apply(names, performance, [null])).toHaveLength(2);
    expect(Reflect.apply(names, performance, [undefined])).toHaveLength(1);
    expect(names.call(performance, '')[0]!.name).toBe('');
    const conversions: string[] = [];
    const result = Reflect.apply(names, performance, [
      { toString() { conversions.push('name'); return 'null'; } },
      { toString() { conversions.push('type'); return 'measure'; } },
    ]) as PerformanceEntry[];
    expect(conversions).toEqual(['name', 'type']);
    expect(result[0]!.entryType).toBe('measure');
  });

  it('leaves required arguments, receiver checks, and conversion failures to Binding', () => {
    const { performance, env } = fixture();
    for (const method of [performance.getEntriesByName, performance.getEntriesByType]) {
      expect(() => { Reflect.apply(method, performance, []); }).toThrow(env.realm.TypeError);
      expect(() => { Reflect.apply(method, performance, [Symbol('invalid')]); }).toThrow(env.realm.TypeError);
      expect(() => { Reflect.apply(method, {}, ['mark']); }).toThrow(env.realm.TypeError);
    }
    expect(() => { Reflect.apply(performance.getEntries, {}, []); }).toThrow(env.realm.TypeError);
  });

  it('keeps borrowed queries and first entry projection in the receiver realm', () => {
    const first = fixture();
    const second = fixture();
    first.addEntry('mark', 'first', 1);
    second.addEntry('mark', 'second', 2);
    for (const [method, args] of [
      [second.performance.getEntries, []],
      [second.performance.getEntriesByType, ['mark']],
      [second.performance.getEntriesByName, ['first']],
    ] as const) {
      const entries = Reflect.apply(method, first.performance, args) as PerformanceEntry[];
      expect(entries.map((entry) => entry.name)).toEqual(['first']);
      expect(Object.getPrototypeOf(entries)).toBe(first.env.realm.Array.prototype);
      expect(getRelevantRealm(entries[0]!)).toBe(first.env.realm);
      expect(entries[0]).toBeInstanceOf(first.browser.window.PerformanceEntry);
      expect(entries[0]).not.toBeInstanceOf(second.browser.window.PerformanceEntry);
    }
    expect(first.performance.getEntries()[0]).not.toBe(second.performance.getEntries()[0]);
  });

  it('serializes initialized fields and observes a producer updating the end time', () => {
    const { performance, env, addEntry } = fixture();
    const implementation = addEntry('measure', 'work', 10);
    const entry = performance.getEntriesByName('work')[0]!;
    expect(entry.duration).toBe(0);
    implementation.endTime = 25;
    expect(entry.duration).toBe(15);
    const json = entry.toJSON();
    expect(json).toEqual({
      name: 'work', entryType: 'measure', startTime: 10, duration: 15,
      navigationId: implementation.navigationId,
    });
    expect(Object.getPrototypeOf(json)).toBe(env.realm.Object.prototype);
    expect(Object.keys(json)).toEqual(['name', 'entryType', 'startTime', 'duration', 'navigationId']);
  });

  it('uses receiver fields for borrowed getters and toJSON, with method-realm brand errors', () => {
    const first = fixture();
    const second = fixture();
    first.addEntry('resource', 'asset', 7, 12);
    const entry = first.performance.getEntriesByType('resource')[0]!;
    const prototype = second.browser.window.PerformanceEntry.prototype;
    const getter = Object.getOwnPropertyDescriptor(prototype, 'duration')!.get!;
    expect(getter.call(entry)).toBe(5);
    expect(() => { getter.call(first.performance); }).toThrow(second.env.realm.TypeError);
    const json = prototype.toJSON.call(entry);
    // Web IDL's default toJSON creates its object in the method's realm; all three browsers agree.
    expect(Object.getPrototypeOf(json)).toBe(second.env.realm.Object.prototype);
    expect(Reflect.get(json, 'name')).toBe('asset');
  });

  it('keeps retained Performance buffers after navigation and isolates the replacement global', async () => {
    const { browser, performance, env, addEntry } = fixture();
    addEntry('mark', 'retired-entry', 2);
    const retained = performance.getEntriesByName('retired-entry')[0]!;
    await browser.navigate('https://example.test/replacement');
    const replacement = browser.window.performance;
    expect(replacement).not.toBe(performance);
    expect(replacement.getEntriesByName('retired-entry')).toEqual([]);
    const entries = replacement.getEntriesByName.call(performance, 'retired-entry');
    expect(entries[0]).toBe(retained);
    expect(Object.getPrototypeOf(entries)).toBe(env.realm.Array.prototype);
  });

  it('keeps the global-owned buffer when author code replaces window.performance', () => {
    const { browser, performance, implementation, addEntry } = fixture();
    const entry = addEntry('mark', 'original', 1);
    expect(Reflect.set(browser.window, 'performance', { replacement: true })).toBe(true);
    expect(implementation.getEntries()).toEqual([entry]);
    expect(performance.getEntriesByName('original')).toHaveLength(1);
  });

  it('retains per-global registry limits and counts each eligible entry refused by capacity', () => {
    const first = fixture();
    const second = fixture();
    const buffer = first.implementation.getEntryBuffer('paint');
    expect(buffer.maxBufferSize).toBe(2);
    expect(buffer.availableFromTimeline).toBe(true);
    expect(buffer.isFull()).toBe(false);
    first.addEntry('paint', 'first-paint', 1);
    expect(buffer.isFull()).toBe(false);
    first.addEntry('paint', 'first-contentful-paint', 2);
    expect(buffer.isFull()).toBe(true);
    expect(buffer.isFull()).toBe(true);
    expect(buffer.droppedEntriesCount).toBe(2);
    expect(second.implementation.getEntryBuffer('paint').droppedEntriesCount).toBe(0);
    expect(first.implementation.getEntryBuffer('mark').maxBufferSize).toBe(Infinity);
    expect(first.implementation.getEntryBuffer('resource').maxBufferSize).toBe(250);
    expect(first.implementation.getEntryBuffer('event').availableFromTimeline).toBe(false);
  });
});

/** Supply completed internal entries; real producers and queueing are separate slices. */
function fixture() {
  const browser = new Browlet({ route: () => '' });
  const env = unwrap<DocumentImpl>(browser.document).env;
  const performance = browser.window.performance;
  const implementation = unwrap<PerformanceImpl>(performance);
  function addEntry(type: PerformanceEntryType, name: string, startTime: number, endTime?: number) {
    const entry = new PerformanceEntryImpl(startTime, type, name, endTime, env);
    // The captured navigation association is completed producer state.
    entry.navigationId = 100;
    implementation.getEntryBuffer(type).entries.push(entry);
    return entry;
  }
  return { browser, env, performance, implementation, addEntry };
}

function describeEntries(entries: PerformanceEntry[]) {
  return entries.map((entry) => [entry.name, entry.entryType, entry.startTime]);
}
