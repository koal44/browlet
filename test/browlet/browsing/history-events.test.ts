import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { HashChangeEventImpl, PopStateEventImpl } from '../../../src/browlet/browsing/navigation/events/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('HTML §§7.2.7.2–3: history event interfaces', () => {
  it.each(['PopStateEvent', 'HashChangeEvent'] as const)('exposes %s with ordinary Event defaults', async (name) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((name) => {
      const Constructor = window[name];
      const event = new Constructor('probe');
      return {
        type: event.type, event: event instanceof Event, specialized: event instanceof Constructor,
        parent: Object.getPrototypeOf(Constructor.prototype) === Event.prototype,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        tag: Object.prototype.toString.call(event), length: Constructor.length,
        timeStamp: Number.isFinite(event.timeStamp),
        data: event instanceof PopStateEvent ? [event.state as unknown, event.hasUAVisualTransition] : [event.oldURL, event.newURL],
      };
    }, name)).toEqual({
      type: 'probe', event: true, specialized: true, parent: true, flags: [false, false, false, false],
      tag: `[object ${name}]`, length: 1, timeStamp: true,
      data: name === 'PopStateEvent' ? [null, false] : ['', ''],
    });
  });

  it('retains arbitrary PopStateEvent state without cloning or inspecting it', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const cyclic: { self?: unknown; value: number; } = { value: 1 };
      cyclic.self = cyclic;
      const callable = () => 1;
      const opaque = new Proxy({}, { get() { throw new Error('state must not be read'); } });
      const retained = [cyclic, callable, opaque, Symbol('state')]
        .map((state) => new PopStateEvent('probe', { state }).state === state);
      const event = new PopStateEvent('probe', { state: cyclic });
      cyclic.value = 2;
      return { retained, value: (event.state as typeof cyclic).value };
    })).toEqual({ retained: [true, true, true, true], value: 2 });
  });

  it('applies dictionary defaults without replacing falsy state and converts boolean flags', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const states = [null, undefined, false, 0, ''].map((state) => new PopStateEvent('probe', { state }).state as unknown);
      const event = Reflect.construct(PopStateEvent, ['probe', {
        hasUAVisualTransition: {}, bubbles: 'yes', cancelable: 1, composed: true,
      }]) as PopStateEvent;
      const empty = Reflect.construct(PopStateEvent, ['probe', null]) as PopStateEvent;
      return {
        states, flags: [event.hasUAVisualTransition, event.bubbles, event.cancelable, event.composed, event.isTrusted],
        empty: [empty.state as unknown, empty.hasUAVisualTransition],
      };
    })).toEqual({ states: [null, null, false, 0, ''], flags: [true, true, true, true, false], empty: [null, false] });
  });

  it('converts HashChangeEvent URLs to scalar strings without parsing them', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let conversions = 0;
      const init = {
        oldURL: { toString() { conversions++; return '../literal\ud800/\udc00/\ud83d\ude00'; } },
        newURL: null, bubbles: true, cancelable: true, composed: true,
      };
      const event = Reflect.construct(HashChangeEvent, ['probe', init]) as HashChangeEvent;
      const literal = new HashChangeEvent('probe', { oldURL: 'not a URL', newURL: '#fragment' });
      const empty = Reflect.construct(HashChangeEvent, ['probe', null]) as HashChangeEvent;
      return {
        urls: [event.oldURL, event.newURL], literal: [literal.oldURL, literal.newURL], conversions,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted], empty: [empty.oldURL, empty.newURL],
      };
    })).toEqual({
      urls: ['../literal\ufffd/\ufffd/\ud83d\ude00', 'null'], literal: ['not a URL', '#fragment'], conversions: 1,
      flags: [true, true, true, false], empty: ['', ''],
    });
  });

  it.each(['PopStateEvent', 'HashChangeEvent'] as const)('converts %s dictionary members in Web IDL order', async (name) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((name) => {
      const reads: string[] = [];
      const init = new Proxy({}, { get(_target, key) { reads.push(String(key)); return undefined; } });
      Reflect.construct(window[name], ['probe', init]);
      return reads;
    }, name)).toEqual(['bubbles', 'cancelable', 'composed', ...(name === 'PopStateEvent' ? ['hasUAVisualTransition', 'state'] : ['newURL', 'oldURL'])]);
  });

  it('rejects missing types, invalid dictionaries, and symbols in string members in the constructor realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const results: boolean[] = [];
      for (const Constructor of [PopStateEvent, HashChangeEvent]) {
        for (const args of [[], [Symbol()], ['probe', 1]]) {
          try { Reflect.construct(Constructor, args); results.push(false); }
          catch (error) { results.push(error instanceof TypeError); }
        }
      }
      for (const init of [{ oldURL: Symbol() }, { newURL: Symbol() }]) {
        try { Reflect.construct(HashChangeEvent, ['probe', init]); results.push(false); }
        catch (error) { results.push(error instanceof TypeError); }
      }
      return results;
    })).toEqual(Array<boolean>(8).fill(true));
  });

  it('exposes readonly data attributes and rejects incompatible getter receivers', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const events = [new PopStateEvent('probe'), new HashChangeEvent('probe')];
      return events.flatMap((event) => {
        const attributes = event instanceof PopStateEvent ? ['state', 'hasUAVisualTransition'] : ['oldURL', 'newURL'];
        return attributes.map((name) => {
          const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(event), name)!;
          let invalidReceiver = false;
          try { descriptor.get!.call(new Event('probe')); }
          catch (error) { invalidReceiver = error instanceof TypeError; }
          return [descriptor.enumerable, descriptor.configurable, descriptor.set === undefined,
            Reflect.set(event, name, 'replacement'), invalidReceiver];
        });
      });
    })).toEqual(Array<boolean[]>(4).fill([true, true, true, false, true]));
  });

  it('borrows getters across Windows while retaining the state identity and event realm', async () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    await owner.evaluate(() => { Reflect.set(globalThis, 'eventState', { value: 1 }); });
    const state = Reflect.get(owner.window, 'eventState') as object;
    const pop = new owner.window.PopStateEvent('probe', { state });
    const hash = new owner.window.HashChangeEvent('probe', { oldURL: 'before', newURL: 'after' });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Cross-realm getter borrowing is under test.
    const stateGetter = Object.getOwnPropertyDescriptor(other.window.PopStateEvent.prototype, 'state')!.get!;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Cross-realm getter borrowing is under test.
    const urlGetter = Object.getOwnPropertyDescriptor(other.window.HashChangeEvent.prototype, 'newURL')!.get!;
    expect(stateGetter.call(pop)).toBe(state);
    expect(urlGetter.call(hash)).toBe('after');
    expect(getRelevantRealm(pop)).toBe(getRelevantRealm(owner.window));
    expect(getRelevantRealm(hash)).toBe(getRelevantRealm(owner.window));
    expect(() => { stateGetter.call(hash); }).toThrow(getRelevantRealm(other.window).TypeError);
    expect(() => { urlGetter.call(pop); }).toThrow(getRelevantRealm(other.window).TypeError);
  });

  it('supports the legacy HashChangeEvent factory, requiring initEvent before dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('hAsHcHaNgEeVeNt') as HashChangeEvent;
      const defaults = [event.type, event.oldURL, event.newURL, event.isTrusted];
      const timeStamp = event.timeStamp;
      let rejected = false;
      try { document.dispatchEvent(event); }
      catch (error) { rejected = error instanceof DOMException && error.name === 'InvalidStateError'; }
      event.initEvent('hashchange', true, true);
      return {
        instance: event instanceof HashChangeEvent, defaults, rejected,
        initialized: [event.type, event.oldURL, event.newURL, event.bubbles, event.cancelable, event.isTrusted],
        timestamp: Number.isFinite(timeStamp) && timeStamp === event.timeStamp, dispatched: document.dispatchEvent(event),
      };
    })).toEqual({
      instance: true, defaults: ['', '', '', false], rejected: true,
      initialized: ['hashchange', '', '', true, true, false], timestamp: true, dispatched: true,
    });
  });

  it('does not invent a legacy PopStateEvent factory entry', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      try { document.createEvent('PopStateEvent'); }
      catch (error) { return error instanceof DOMException && error.name === 'NotSupportedError'; }
      return false;
    })).toBe(true);
  });

  it('projects trusted events initialized by an internal producer without implementing traversal', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      window.addEventListener('popstate', (event) => { Reflect.set(globalThis, 'receivedPopState', event); });
      window.addEventListener('hashchange', (event) => { Reflect.set(globalThis, 'receivedHashChange', event); });
      Reflect.set(globalThis, 'eventState', { restored: true });
    });
    const state = Reflect.get(browser.window, 'eventState') as object;
    const targetWindow = getRelevantRealm(browser.window).env.window;
    targetWindow.fireEvent('popstate', PopStateEventImpl, (pop) => {
      pop.state = state;
      pop.hasUAVisualTransition = true;
    });
    targetWindow.fireEvent('hashchange', HashChangeEventImpl, (hash) => {
      hash.oldURL = 'https://example.test/#before';
      hash.newURL = 'https://example.test/#after';
    });
    expect(await browser.evaluate(() => {
      const state = Reflect.get(globalThis, 'eventState') as object;
      const pop = Reflect.get(globalThis, 'receivedPopState') as PopStateEvent;
      const hash = Reflect.get(globalThis, 'receivedHashChange') as HashChangeEvent;
      return {
        pop: [pop instanceof PopStateEvent, pop.isTrusted, pop.state === state, pop.hasUAVisualTransition,
          pop.target === window, pop.bubbles, pop.cancelable, pop.composed],
        hash: [hash instanceof HashChangeEvent, hash.isTrusted, hash.oldURL, hash.newURL,
          hash.target === window, hash.bubbles, hash.cancelable, hash.composed],
      };
    })).toEqual({
      pop: [true, true, true, true, true, false, false, false],
      hash: [true, true, 'https://example.test/#before', 'https://example.test/#after', true, false, false, false],
    });
  });
});
