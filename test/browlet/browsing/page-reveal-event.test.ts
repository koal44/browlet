import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { PageRevealEventImpl } from '../../../src/browlet/browsing/navigation/events/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { ViewTransitionImpl } from '../../../src/browlet/rendering/index';
import type { PageRevealEvent as PageRevealEventPlatform, ViewTransition as ViewTransitionPlatform } from '../../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §7.2.7.5: PageRevealEvent', () => {
  it('exposes the constructor with a null transition and ordinary Event defaults', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new PageRevealEvent('pagereveal');
      return {
        type: event.type, transition: event.viewTransition,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        branded: event instanceof PageRevealEvent && event instanceof Event,
        parent: Object.getPrototypeOf(PageRevealEvent.prototype) === Event.prototype,
        tag: Object.prototype.toString.call(event), length: PageRevealEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'pagereveal', transition: null, flags: [false, false, false, false],
      branded: true, parent: true, tag: '[object PageRevealEvent]', length: 1, timeStamp: true,
    });
  });

  it('defaults null and undefined dictionaries and nullable fields', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [null, undefined, {}, { viewTransition: null }, { viewTransition: undefined }].map((init) => {
        const event = Reflect.construct(PageRevealEvent, ['pagereveal', init]) as PageRevealEvent;
        return event.viewTransition;
      });
    })).toEqual([null, null, null, null, null]);
  });

  it('converts the event type before reading inherited EventInit members and the transition', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const type = { toString() { reads.push('type'); return 'pagereveal'; } };
      Reflect.construct(PageRevealEvent, [type, new Proxy({}, {
        get(_target, key) { reads.push(String(key)); return undefined; },
      })]);
      const sentinel = new RangeError('transition getter');
      let sameError = false;
      try {
        new PageRevealEvent('pagereveal', { get viewTransition(): ViewTransition { throw sentinel; } });
      } catch (error) { sameError = error === sentinel; }
      return [reads, sameError];
    })).toEqual([['type', 'bubbles', 'cancelable', 'composed', 'viewTransition'], true]);
  });

  it('requires a real ViewTransition instead of a lookalike or a Proxy', async () => {
    const { browser, transition } = await fixture();
    Reflect.set(browser.window, 'transitionUnderTest', transition);
    expect(await browser.evaluate(() => {
      const transition = Reflect.get(globalThis, 'transitionUnderTest') as object;
      const args: unknown[][] = [[], [Symbol()], ['pagereveal', 1]];
      for (const viewTransition of [{}, new Event('probe'), Object.create(ViewTransition.prototype) as unknown,
        new Proxy(transition, {})]) {
        args.push(['pagereveal', { viewTransition }]);
      }
      return args.map((args) => {
        try { Reflect.construct(PageRevealEvent, args); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
    })).toEqual(Array<boolean>(7).fill(true));
  });

  it('retains a supplied transition and flags, including when constructed in another Window', async () => {
    const { browser: owner, transition } = await fixture();
    const other = new Browlet({ route: () => '' });
    for (const browser of [owner, other]) {
      const event = new browser.window.PageRevealEvent('pagereveal', {
        viewTransition: transition, bubbles: true, cancelable: true, composed: true,
      });
      expect(event.viewTransition).toBe(transition);
      expect([event.bubbles, event.cancelable, event.composed, event.isTrusted]).toEqual([true, true, true, false]);
      expect(getRelevantRealm(event)).toBe(getRelevantRealm(browser.window));
      expect(getRelevantRealm(event.viewTransition!)).toBe(getRelevantRealm(owner.window));
    }
  });

  it('exposes a readonly getter that can be borrowed with a valid receiver', async () => {
    const { browser: owner, transition } = await fixture();
    const other = new Browlet({ route: () => '' });
    const event = new owner.window.PageRevealEvent('pagereveal', { viewTransition: transition });
    const descriptor = Object.getOwnPropertyDescriptor(other.window.PageRevealEvent.prototype, 'viewTransition')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    expect(descriptor.get!.call(event)).toBe(transition);
    expect(Reflect.set(event, 'viewTransition', null)).toBe(false);
    expect(() => { descriptor.get!.call(new owner.window.Event('probe')); }).toThrow(getRelevantRealm(other.window).TypeError);
  });

  it('retains its initialized transition after the owning Window becomes inactive', async () => {
    const { browser, transition } = await fixture();
    const event = new browser.window.PageRevealEvent('pagereveal', { viewTransition: transition });
    const realm = getRelevantRealm(transition);
    await browser.navigate('https://example.test/next');
    expect(event.viewTransition).toBe(transition);
    expect(getRelevantRealm(event.viewTransition!)).toBe(realm);
    expect(getRelevantRealm(browser.window)).not.toBe(realm);
  });

  it('projects internally supplied payloads through trusted event delivery', async () => {
    const { browser, document, implementation, transition } = await fixture();
    let received: PageRevealEventPlatform | undefined;
    browser.window.addEventListener('pagereveal', (event) => { received = event as PageRevealEventPlatform; });
    document.getRelevantGlobalObject()!.fireEvent('pagereveal', PageRevealEventImpl, (event) => {
      (event as PageRevealEventImpl).viewTransition = implementation;
    });
    expect(received).toBeInstanceOf(browser.window.PageRevealEvent);
    expect(received!.isTrusted).toBe(true);
    expect(received!.target).toBe(browser.window);
    expect([received!.bubbles, received!.cancelable, received!.composed]).toEqual([false, false, false]);
    expect(received!.viewTransition).toBe(transition);
    expect(unwrap(received!.viewTransition!)).toBe(implementation);
  });

  it('has no legacy event factory entry', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      try { document.createEvent('PageRevealEvent'); }
      catch (error) { return error instanceof DOMException && error.name === 'NotSupportedError'; }
      return false;
    })).toBe(true);
  });
});

/** Supply a real binding identity without claiming that a rendering transition occurred. */
async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const implementation = new ViewTransitionImpl(document, document.env);
  const transition = getBindingContext(document.env.realm).project(ViewTransitionImpl, implementation) as ViewTransitionPlatform;
  return { browser, document, implementation, transition };
}
