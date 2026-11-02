import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Navigation.updateCurrentEntry', () => {
  it('stores a snapshot and fires a synchronous trusted event without changing URL, entry, or History state', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const current = navigation.currentEntry!;
      const key = current.key;
      const id = current.id;
      const url = location.href;
      const length = history.length;
      const data = { items: [1] };
      const calls: unknown[] = [];
      navigation.oncurrententrychange = (change) => {
        calls.push({
          eventRealm: change instanceof NavigationCurrentEntryChangeEvent,
          entry: change.from === current, current: navigation.currentEntry === current,
          target: change.target === navigation, type: change.navigationType,
          trusted: change.isTrusted, flags: [change.bubbles, change.cancelable, change.composed],
          state: change.from.getState() as unknown,
        });
      };
      const result = navigation.updateCurrentEntry({ state: data });
      data.items.push(2);
      return {
        calls, result, state: current.getState() as unknown,
        stable: navigation.currentEntry === current && current.key === key && current.id === id,
        unchanged: location.href === url && history.length === length && history.state === null,
      };
    })).toEqual({
      calls: [{
        eventRealm: true, entry: true, current: true, target: true, type: null,
        trusted: true, flags: [false, false, false], state: { items: [1] },
      }],
      result: undefined, state: { items: [1] }, stable: true, unchanged: true,
    });
  });

  it('requires the options argument and a defined state member before invocation', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const results: string[] = [];
      for (const args of [[], [null], [undefined], [{}], [{ state: undefined }]]) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Test invalid argument lists with an explicit receiver.
        try { Reflect.apply(navigation.updateCurrentEntry, navigation, args); results.push('returned'); }
        catch (error) { results.push(error instanceof TypeError ? 'TypeError' : 'other'); }
      }
      navigation.updateCurrentEntry({ state: null });
      return { results, state: navigation.currentEntry!.getState() as unknown };
    })).toEqual({ results: Array<string>(5).fill('TypeError'), state: null });
  });

  it('leaves the previous state intact and sends no event when serialization fails', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      navigation.updateCurrentEntry({ state: { saved: true } });
      let calls = 0;
      navigation.oncurrententrychange = () => { calls++; };
      let dataCloneError = false;
      try { navigation.updateCurrentEntry({ state: () => {} }); }
      catch (error) { dataCloneError = error instanceof DOMException && error.name === 'DataCloneError'; }
      const sentinel = new RangeError('getter failed');
      let preserved = false;
      try { navigation.updateCurrentEntry({ state: { get value() { throw sentinel; } } }); }
      catch (error) { preserved = error === sentinel; }
      return { calls, dataCloneError, preserved, state: navigation.currentEntry!.getState() as unknown };
    })).toEqual({ calls: 0, dataCloneError: true, preserved: true, state: { saved: true } });
  });

  it('allows a nested update during serialization and then commits the outer snapshot', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const states: unknown[] = [];
      navigation.oncurrententrychange = () => { states.push(navigation.currentEntry!.getState()); };
      navigation.updateCurrentEntry({
        state: {
          get value() { navigation.updateCurrentEntry({ state: 'inner' }); return 'outer'; },
        },
      });
      return { states, final: navigation.currentEntry!.getState() as unknown };
    })).toEqual({ states: ['inner', { value: 'outer' }], final: { value: 'outer' } });
  });

  it('keeps listener microtasks after the synchronous notification and return', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(async () => {
      const order: string[] = [];
      navigation.addEventListener('currententrychange', () => {
        order.push('first');
        queueMicrotask(() => { order.push('microtask'); });
      });
      navigation.addEventListener('currententrychange', () => { order.push('second'); });
      navigation.updateCurrentEntry({ state: 1 });
      order.push('returned');
      await Promise.resolve();
      return order;
    })).toEqual(['first', 'second', 'returned', 'microtask']);
  });

  it.each(['about:blank', 'data:text/html,opaque'])('rejects disabled entries for %s before serializing', async (url) => {
    const browser = new Browlet({ route: () => '' });
    if (url !== 'about:blank') await browser.navigate(url);
    expect(await browser.evaluate(() => {
      let reads = 0;
      let name = '';
      try { navigation.updateCurrentEntry({ state: { get value() { reads++; return 1; } } }); }
      catch (error) { if (error instanceof DOMException) name = error.name; }
      return { name, reads };
    })).toEqual({ name: 'InvalidStateError', reads: 0 });
  });

  it('converts the dictionary before checking a retained inactive Navigation, without reading state data', async () => {
    const { browser } = await fixture();
    const navigation = browser.window.navigation;
    const DOMException = browser.window.DOMException;
    await browser.navigate('https://example.test/next');
    let options = 0;
    let data = 0;
    let error: unknown;
    try {
      navigation.updateCurrentEntry({
        get state() {
          options++;
          return { get value() { data++; return 1; } };
        },
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'InvalidStateError' });
    expect({ options, data }).toEqual({ options: 1, data: 0 });
  });

  it('uses the receiver state and event realm when another Window supplies the method', async () => {
    const first = await fixture();
    const second = await fixture();
    const navigation = first.browser.window.navigation;
    const entry = navigation.currentEntry;
    let from: unknown;
    let event: unknown;
    navigation.oncurrententrychange = (value) => {
      event = value;
      from = Reflect.get(value, 'from');
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Apply another realm's operation to explicit receivers.
    const update = second.browser.window.Navigation.prototype.updateCurrentEntry;
    Reflect.apply(update, navigation, [{ state: { value: 1 } }]);
    expect(event).toBeInstanceOf(first.browser.window.NavigationCurrentEntryChangeEvent);
    expect(from).toBe(entry);
    expect(second.browser.window.navigation.currentEntry!.getState()).toBeUndefined();
    first.document.browsingContext = null;
    expect(() => { Reflect.apply(update, navigation, [{ state: 2 }]); }).toThrow(second.browser.window.DOMException);
    expect(() => { Reflect.apply(update, {}, [{ state: 2 }]); }).toThrow(getRelevantRealm(second.browser.window).TypeError);
  });
});

describe('NavigationCurrentEntryChangeEvent', () => {
  it('defaults navigationType to null and retains its entry with ordinary Event flags', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const from = navigation.currentEntry!;
      const event = new NavigationCurrentEntryChangeEvent('probe', { from, bubbles: true, cancelable: true, composed: true });
      return {
        branded: event instanceof NavigationCurrentEntryChangeEvent && event instanceof Event,
        type: event.type, navigationType: event.navigationType, entry: event.from === from,
        trusted: event.isTrusted, flags: [event.bubbles, event.cancelable, event.composed],
        writable: Reflect.set(event, 'from', from), timestamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      branded: true, type: 'probe', navigationType: null, entry: true,
      trusted: false, flags: [true, true, true], writable: false, timestamp: true,
    });
  });

  it.each(['push', 'replace', 'reload', 'traverse'] as const)('accepts navigationType %s', async (navigationType) => {
    const { browser } = await fixture();
    expect(await browser.evaluate((type) => {
      return new NavigationCurrentEntryChangeEvent('probe', { from: navigation.currentEntry!, navigationType: type }).navigationType;
    }, navigationType)).toBe(navigationType);
  });

  it('requires a NavigationHistoryEntry and validates navigationType', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const cases = [[], ['probe'], ['probe', {}], ['probe', { from: null }],
        ['probe', { from: {} }], ['probe', { from: navigation.currentEntry, navigationType: 'invalid' }]];
      return cases.map((args) => {
        try { Reflect.construct(NavigationCurrentEntryChangeEvent, args); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    })).toEqual(Array<boolean>(6).fill(true));
  });

  it('retains another Window entry without reprojecting it into the event realm', async () => {
    const first = await fixture();
    const second = await fixture();
    const from = first.browser.window.navigation.currentEntry!;
    const event = new second.browser.window.NavigationCurrentEntryChangeEvent('probe', { from });
    expect(event.from).toBe(from);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(second.browser.window));
    expect(getRelevantRealm(event.from)).toBe(getRelevantRealm(first.browser.window));
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  return { browser, document: unwrap<DocumentImpl>(browser.document) };
}
