import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { PageSwapEventImpl } from '../../../src/browlet/browsing/navigation/events/index';
import { NavigationActivationImpl } from '../../../src/browlet/browsing/navigation/api/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { ViewTransitionImpl } from '../../../src/browlet/rendering/index';
import type { PageSwapEvent as PageSwapEventPlatform, ViewTransition as ViewTransitionPlatform } from '../../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §7.2.7.4: PageSwapEvent', () => {
  it('exposes the constructor with nullable payloads and ordinary Event defaults', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new PageSwapEvent('pageswap');
      return {
        type: event.type, activation: event.activation, transition: event.viewTransition,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        branded: event instanceof PageSwapEvent && event instanceof Event,
        parent: Object.getPrototypeOf(PageSwapEvent.prototype) === Event.prototype,
        tag: Object.prototype.toString.call(event), length: PageSwapEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'pageswap', activation: null, transition: null, flags: [false, false, false, false],
      branded: true, parent: true, tag: '[object PageSwapEvent]', length: 1, timeStamp: true,
    });
  });

  it('retains the supplied activation and transition without changing navigation state', async () => {
    const { browser, transition } = await fixture();
    const activation = browser.window.navigation.activation!;
    const event = new browser.window.PageSwapEvent('pageswap', {
      activation, viewTransition: transition, bubbles: true, cancelable: true, composed: true,
    });
    expect(event.activation).toBe(activation);
    expect(event.viewTransition).toBe(transition);
    expect(event.activation!.entry).toBe(browser.window.navigation.currentEntry);
    expect(browser.window.navigation.activation).toBe(activation);
    expect([event.bubbles, event.cancelable, event.composed, event.isTrusted]).toEqual([true, true, true, false]);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(browser.window));
  });

  it('defaults null and undefined dictionaries and nullable fields', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [null, undefined, {}, { activation: null, viewTransition: null },
        { activation: undefined, viewTransition: undefined }].map((init) => {
        const event = Reflect.construct(PageSwapEvent, ['pageswap', init]) as PageSwapEvent;
        return [event.activation, event.viewTransition];
      });
    })).toEqual(Array<null[]>(5).fill([null, null]));
  });

  it('reads inherited EventInit members before the payload members', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      new PageSwapEvent('pageswap', new Proxy({}, {
        get(_target, key) { reads.push(String(key)); return undefined; },
      }));
      return reads;
    })).toEqual(['bubbles', 'cancelable', 'composed', 'activation', 'viewTransition']);
  });

  it('preserves a dictionary getter failure and stops before the remaining payload', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const sentinel = new RangeError('activation getter');
      let transitionReads = 0;
      try {
        new PageSwapEvent('pageswap', {
          get activation(): NavigationActivation { throw sentinel; },
          get viewTransition() { transitionReads++; return null; },
        });
      } catch (error) { return [error === sentinel, transitionReads]; }
      return ['returned'];
    })).toEqual([true, 0]);
  });

  it('requires real interface objects, including for the unfinished ViewTransition dependency', async () => {
    const { browser, transition } = await fixture();
    Reflect.set(browser.window, 'transitionUnderTest', transition);
    expect(await browser.evaluate(() => {
      const transition = Reflect.get(globalThis, 'transitionUnderTest') as object;
      const args: unknown[][] = [[], [Symbol()], ['pageswap', 1]];
      for (const activation of [{}, new Event('probe'), Object.create(NavigationActivation.prototype) as unknown,
        navigation.currentEntry, new Proxy(navigation.activation!, {})]) {
        args.push(['pageswap', { activation }]);
      }
      for (const viewTransition of [{}, Object.create(ViewTransition.prototype) as unknown,
        navigation.activation, new Proxy(transition, {})]) {
        args.push(['pageswap', { viewTransition }]);
      }
      return args.map((args) => {
        try { Reflect.construct(PageSwapEvent, args); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
    })).toEqual(Array<boolean>(12).fill(true));
  });

  it('keeps payloads in their original realm when another Window constructs the event', async () => {
    const { browser: owner, transition } = await fixture();
    const receiver = new Browlet({ route: () => '' });
    const activation = owner.window.navigation.activation!;
    const event = new receiver.window.PageSwapEvent('pageswap', { activation, viewTransition: transition });
    expect(event.activation).toBe(activation);
    expect(event.viewTransition).toBe(transition);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(receiver.window));
    expect(getRelevantRealm(event.activation!)).toBe(getRelevantRealm(owner.window));
    expect(getRelevantRealm(event.viewTransition!)).toBe(getRelevantRealm(owner.window));
  });

  it('exposes readonly getters that can be borrowed with a valid receiver', async () => {
    const { browser: owner, transition } = await fixture();
    const other = new Browlet({ route: () => '' });
    const activation = owner.window.navigation.activation!;
    const event = new owner.window.PageSwapEvent('pageswap', { activation, viewTransition: transition });
    for (const [name, value] of [['activation', activation], ['viewTransition', transition]] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(other.window.PageSwapEvent.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(descriptor.get!.call(event)).toBe(value);
      expect(Reflect.set(event, name, null)).toBe(false);
      expect(() => { descriptor.get!.call(new owner.window.Event('probe')); }).toThrow(getRelevantRealm(other.window).TypeError);
    }
  });

  it('retains initialized payloads after its Window becomes inactive', async () => {
    const { browser, transition } = await fixture();
    const activation = browser.window.navigation.activation!;
    const event = new browser.window.PageSwapEvent('pageswap', { activation, viewTransition: transition });
    await browser.navigate('https://example.test/next');
    expect(event.activation).toBe(activation);
    expect(event.viewTransition).toBe(transition);
    expect(event.activation).not.toBe(browser.window.navigation.activation);
  });

  it('projects an internally supplied activation without replacing navigation.activation', async () => {
    const { browser, document, implementation } = await fixture();
    const targetWindow = document.getRelevantGlobalObject()!;
    const navigation = targetWindow.navigation;
    const current = navigation.currentEntry!;
    const activation = new NavigationActivationImpl(current, current, 'reload', document.env);
    const previousActivation = browser.window.navigation.activation;
    let received: PageSwapEventPlatform | undefined;
    browser.window.addEventListener('pageswap', (event) => { received = event as PageSwapEventPlatform; });
    targetWindow.fireEvent('pageswap', PageSwapEventImpl, (event) => {
      const swap = event as PageSwapEventImpl;
      swap.activation = activation;
      swap.viewTransition = implementation;
    });
    expect(received).toBeInstanceOf(browser.window.PageSwapEvent);
    expect(received!.isTrusted).toBe(true);
    expect(received!.target).toBe(browser.window);
    expect([received!.bubbles, received!.cancelable, received!.composed]).toEqual([false, false, false]);
    expect(unwrap(received!.activation!)).toBe(activation);
    expect(unwrap(received!.viewTransition!)).toBe(implementation);
    expect(browser.window.navigation.activation).toBe(previousActivation);
  });

  it('has no legacy event factory entry and keeps ViewTransition nonconstructible', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let legacy = false;
      let transitionConstructor = false;
      try { document.createEvent('PageSwapEvent'); }
      catch (error) { legacy = error instanceof DOMException && error.name === 'NotSupportedError'; }
      try { Reflect.construct(ViewTransition, []); }
      catch (error) { transitionConstructor = error instanceof TypeError; }
      return [legacy, transitionConstructor];
    })).toEqual([true, true]);
  });
});

/** Supply a real binding identity for the transition whose rendering producer does not exist yet. */
async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const implementation = new ViewTransitionImpl(document, document.env);
  const transition = getBindingContext(document.env.realm).project(ViewTransitionImpl, implementation) as ViewTransitionPlatform;
  return { browser, document, implementation, transition };
}
