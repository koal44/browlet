/* eslint-disable @typescript-eslint/unbound-method -- These tests deliberately borrow methods and explicitly supply their receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/index';
import {
  PerformanceEntryImpl, PerformanceObserverEntryListImpl, type PerformanceEntryType,
  type PerformanceImpl, type PerformanceObserverImpl,
} from '../../../src/browlet/performance/index';
import type { PerformanceObserverEntryList } from '../../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('PerformanceObserver registration and records', () => {
  it('requires a callable constructor argument and exposes a nonconstructible entry-list interface', () => {
    const { browser, env } = fixture();
    const realm = browser.window;
    for (const value of [undefined, null, {}, 1]) {
      expect(() => { Reflect.construct(realm.PerformanceObserver, [value]); }).toThrow(env.realm.TypeError);
    }
    expect(() => { Reflect.apply(realm.PerformanceObserver, undefined, [() => {}]); }).toThrow(env.realm.TypeError);
    const entryListConstructor: unknown = realm.PerformanceObserverEntryList;
    if (typeof entryListConstructor !== 'function') throw new Error('Missing PerformanceObserverEntryList interface');
    expect(() => { Reflect.construct(entryListConstructor, []); }).toThrow(env.realm.TypeError);
    const observer = new realm.PerformanceObserver(() => {});
    expect(observer).toBeInstanceOf(realm.PerformanceObserver);
    expect(Object.prototype.toString.call(observer)).toBe('[object PerformanceObserver]');
  });

  it('advertises the implemented Window producers and retains a frozen array per global', () => {
    const first = fixture();
    const second = fixture();
    const types = first.browser.window.PerformanceObserver.supportedEntryTypes;
    expect(types).toEqual(['navigation', 'resource']);
    expect(Object.isFrozen(types)).toBe(true);
    expect(first.browser.window.PerformanceObserver.supportedEntryTypes).toBe(types);
    expect(second.browser.window.PerformanceObserver.supportedEntryTypes).not.toBe(types);
    expect(Object.getPrototypeOf(types)).toBe(first.env.realm.Array.prototype);
    expect(Reflect.set(types, '0', 'mark')).toBe(false);
  });

  it('uses the static getter realm regardless of its JavaScript receiver', () => {
    const first = fixture();
    const second = fixture();
    const constructor = first.browser.window.PerformanceObserver;
    const getter = Object.getOwnPropertyDescriptor(constructor, 'supportedEntryTypes')!.get!;
    const expected = constructor.supportedEntryTypes;
    expect(getter.call(second.browser.window.PerformanceObserver)).toBe(expected);
    expect(getter.call(null)).toBe(expected);
  });

  it('rejects absent selection and mixed options before choosing the lifetime mode', () => {
    const { browser, env, observer } = fixture();
    for (const options of [undefined, null, {}, { type: undefined },
      { entryTypes: [], type: 'mark' }, { entryTypes: [], buffered: false },
      { entryTypes: ['mark'], buffered: true }]) {
      expect(() => { Reflect.apply(observer.observe, observer, [options]); }).toThrow(env.realm.TypeError);
    }
    expect(() => observer.observe({ type: '__absent__' })).not.toThrow();
    expect(() => observer.observe({ entryTypes: [] })).toThrow(browser.window.DOMException);
    expect(() => observer.observe({ entryTypes: [] })).toThrow(expect.objectContaining({ name: 'InvalidModificationError' }));
  });

  it('reads dictionary members in Web IDL order and ignores undeclared properties', () => {
    const { observer } = fixture();
    const order: string[] = [];
    const options = {
      get buffered() { order.push('buffered'); return undefined; },
      get entryTypes() { order.push('entryTypes'); return undefined; },
      get type() { order.push('type'); return '__absent__'; },
      get undeclared() { throw new Error('Not a dictionary member'); },
    };
    observer.observe(options);
    expect(order).toEqual(['buffered', 'entryTypes', 'type']);
  });

  it('treats empty and unsupported multiple-type lists as nonregistering requests that choose the mode', () => {
    const { observer, performance, implementation } = fixture();
    observer.observe({ entryTypes: [] });
    observer.observe({ entryTypes: ['__absent__'] });
    expect(performance.registeredObservers.size).toBe(0);
    expect(implementation.requiresDroppedEntries).toBe(true);
    expect(() => observer.observe({ type: '__absent__' })).toThrow(/observation mode/);
  });

  it('retains single-type mode across unsupported buffered requests and disconnect', () => {
    const { observer, performance } = fixture();
    observer.observe({ type: '__absent__', buffered: true });
    expect(performance.registeredObservers.size).toBe(0);
    observer.disconnect();
    expect(() => observer.observe({ entryTypes: [] })).toThrow(/observation mode/);
    expect(() => observer.observe({ type: 'still-unsupported' })).not.toThrow();
  });

  it('filters converted multiple-type options without changing the author input and replaces its subscription', () => {
    const { observer, performance, implementation } = fixture(['mark', 'measure']);
    const types = ['mark', '__absent__', 'mark'];
    observer.observe({ entryTypes: types });
    expect(types).toEqual(['mark', '__absent__', 'mark']);
    expect([...performance.registeredObservers]).toEqual([implementation]);
    expect(implementation.optionsList).toEqual([{ entryTypes: ['mark', 'mark'] }]);
    observer.observe({ entryTypes: ['measure'] });
    expect([...performance.registeredObservers]).toEqual([implementation]);
    expect(implementation.optionsList).toEqual([{ entryTypes: ['measure'] }]);
  });

  it('does not replace an existing subscription when a later list contains no supported types', () => {
    const { observer, implementation } = fixture(['mark']);
    observer.observe({ entryTypes: ['mark'] });
    const options = implementation.optionsList;
    observer.observe({ entryTypes: [] });
    observer.observe({ entryTypes: ['__absent__'] });
    expect(implementation.optionsList).toBe(options);
    expect(options).toEqual([{ entryTypes: ['mark'] }]);
  });

  it('merges distinct single types, replaces repeated options, and preserves registration order', () => {
    const { browser, observer, implementation, performance } = fixture(['mark', 'measure']);
    const second = new browser.window.PerformanceObserver(() => {});
    observer.observe({ type: 'mark' });
    second.observe({ type: 'measure' });
    observer.observe({ type: 'measure' });
    observer.observe({ type: 'mark', buffered: false });
    expect([...performance.registeredObservers]).toEqual([
      implementation, unwrap<PerformanceObserverImpl>(second),
    ]);
    expect(implementation.optionsList).toEqual([
      { type: 'mark', buffered: false }, { type: 'measure' },
    ]);
  });

  it('disconnects, clears records/options, and allows reregistration in the same mode', () => {
    const { browser, observer, implementation, performance, entry } = fixture(['mark']);
    observer.observe({ type: 'mark' });
    const options = implementation.optionsList;
    implementation.observerBuffer.push(entry('mark', 'old', 1));
    observer.disconnect();
    expect(performance.registeredObservers.size).toBe(0);
    expect(options).toEqual([]);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    const second = new browser.window.PerformanceObserver(() => {});
    second.observe({ type: 'mark' });
    observer.observe({ type: 'mark' });
    expect([...performance.registeredObservers]).toEqual([
      unwrap<PerformanceObserverImpl>(second), implementation,
    ]);
    expect(implementation.optionsList).toEqual([{ type: 'mark' }]);
    expect(() => observer.observe({ entryTypes: ['mark'] })).toThrow(/observation mode/);
  });

  it('drains records in queueing order while retaining the registration and entry identity', () => {
    const { observer, implementation, performance, entry } = fixture(['mark']);
    observer.observe({ type: 'mark' });
    const later = entry('mark', 'later', 30);
    implementation.observerBuffer.push(later, entry('mark', 'earlier', 10), later);
    const records = observer.takeRecords();
    expect(records.map((item) => item.name)).toEqual(['later', 'earlier', 'later']);
    expect(records[0]).toBe(records[2]);
    expect(observer.takeRecords()).toEqual([]);
    expect(performance.registeredObservers.size).toBe(1);
    implementation.observerBuffer.push(later);
    expect(observer.takeRecords()[0]).toBe(records[0]);
    expect(records).toHaveLength(3);
  });

  it('projects borrowed takeRecords results and previously unexposed entries in the receiver realm', () => {
    const first = fixture();
    const second = fixture();
    first.implementation.observerBuffer.push(first.entry('mark', 'original', 1));
    const result = second.browser.window.PerformanceObserver.prototype.takeRecords.call(first.observer);
    expect(Object.getPrototypeOf(result)).toBe(first.env.realm.Array.prototype);
    expect(getRelevantRealm(result[0]!)).toBe(first.env.realm);
    expect(first.observer.takeRecords()).toEqual([]);
  });

  it('retains the internal Performance owner when the author replaces window.performance', () => {
    const { browser, performance } = fixture(['mark']);
    Object.defineProperty(browser.window, 'performance', { value: null, configurable: true });
    const observer = new browser.window.PerformanceObserver(() => {});
    observer.observe({ type: 'mark' });
    expect(performance.registeredObservers.has(unwrap<PerformanceObserverImpl>(observer))).toBe(true);
    observer.disconnect();
    expect(performance.registeredObservers.size).toBe(0);
  });

  it('checks receiver brands and required method arguments through Binding', () => {
    const { env, observer } = fixture();
    for (const method of [observer.observe, observer.disconnect, observer.takeRecords]) {
      expect(() => { Reflect.apply(method, {}, []); }).toThrow(env.realm.TypeError);
    }
    const foreign = fixture();
    expect(() => foreign.observer.observe.call(observer, {})).toThrow(foreign.env.realm.TypeError);
  });
});

describe('PerformanceObserverEntryList', () => {
  it('filters a batch chronologically without hiding observer-only entries or changing stored order', () => {
    const { entry, batch } = fixture();
    const repeated = entry('event', 'same', 20, 25);
    const entries = [repeated, entry('mark', 'same', 10), repeated, entry('measure', 'other', 15)];
    const list = batch(entries);
    expect(list.getEntries().map((item) => item.entryType)).toEqual(['mark', 'measure', 'event', 'event']);
    expect(list.getEntriesByName('same').map((item) => item.startTime)).toEqual([10, 20, 20]);
    expect(list.getEntriesByName('same', 'event')).toHaveLength(2);
    expect(list.getEntriesByType('event')[0]!.duration).toBe(5);
    expect(list.getEntriesByType('Event')).toEqual([]);
    expect(list.getEntriesByName('Same')).toEqual([]);
    expect(entries[0]).toBe(repeated);
    expect(entries[1]!.startTime).toBe(10);
  });

  it('returns fresh mutable arrays with retained entry identity and converted name/type filters', () => {
    const { entry, batch } = fixture();
    const list = batch([entry('mark', 'undefined', 1), entry('mark', 'null', 2)]);
    const first = list.getEntries();
    const second = list.getEntries();
    expect(first).not.toBe(second);
    expect(first[0]).toBe(second[0]);
    first.pop();
    expect(list.getEntries()).toHaveLength(2);
    expect(Reflect.apply(list.getEntriesByName, list, [undefined])).toHaveLength(1);
    expect(Reflect.apply(list.getEntriesByName, list, [null])).toHaveLength(1);
    expect(list.getEntriesByName('null', undefined)).toHaveLength(1);
    expect(Reflect.apply(list.getEntriesByName, list, ['null', null])).toEqual([]);
  });

  it('uses the retained batch realm for borrowed query arrays and entry projection', () => {
    const first = fixture();
    const second = fixture();
    const list = first.batch([first.entry('mark', 'original', 1)]);
    const result = second.browser.window.PerformanceObserverEntryList.prototype.getEntries.call(list);
    expect(Object.getPrototypeOf(result)).toBe(first.env.realm.Array.prototype);
    expect(getRelevantRealm(result[0]!)).toBe(first.env.realm);
  });

  it('validates entry-list receivers and required arguments', () => {
    const { env, batch } = fixture();
    const list = batch([]);
    expect(() => { Reflect.apply(list.getEntriesByType, list, []); }).toThrow(env.realm.TypeError);
    expect(() => { Reflect.apply(list.getEntriesByName, list, []); }).toThrow(env.realm.TypeError);
    for (const method of [list.getEntries, list.getEntriesByType, list.getEntriesByName]) {
      expect(() => { Reflect.apply(method, {}, []); }).toThrow(env.realm.TypeError);
    }
  });
});

/** Supply completed internal producer metadata/records; this does not simulate queueing or callback delivery. */
function fixture(supportedTypes?: PerformanceEntryType[]) {
  const browser = new Browlet({ route: () => '' });
  const env = unwrap<DocumentImpl>(browser.document).env;
  const performance = unwrap<PerformanceImpl>(browser.window.performance);
  if (supportedTypes !== undefined) performance.supportedEntryTypes = supportedTypes;
  const observer = new browser.window.PerformanceObserver(() => {});
  const implementation = unwrap<PerformanceObserverImpl>(observer);
  function entry(type: PerformanceEntryType, name: string, startTime: number, endTime?: number) {
    const result = new PerformanceEntryImpl(startTime, type, name, endTime, env);
    result.navigationId = 100;
    return result;
  }
  function batch(entries: PerformanceEntryImpl[]) {
    return getBindingContext(env.realm).project(
      PerformanceObserverEntryListImpl, new PerformanceObserverEntryListImpl(entries, env),
    ) as PerformanceObserverEntryList;
  }
  return { browser, env, performance, observer, implementation, entry, batch };
}
