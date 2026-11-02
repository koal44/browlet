import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { PageTransitionEvent as PageTransitionEventPlatform } from '../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §7.2.7.6: PageTransitionEvent', () => {
  it('exposes the constructor with false persisted and ordinary Event defaults', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new PageTransitionEvent('pageshow');
      return {
        type: event.type, persisted: event.persisted,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        branded: event instanceof PageTransitionEvent && event instanceof Event,
        parent: Object.getPrototypeOf(PageTransitionEvent.prototype) === Event.prototype,
        tag: Object.prototype.toString.call(event), length: PageTransitionEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'pageshow', persisted: false, flags: [false, false, false, false],
      branded: true, parent: true, tag: '[object PageTransitionEvent]', length: 1, timeStamp: true,
    });
  });

  it('defaults null/undefined dictionaries and converts persisted using Web IDL boolean rules', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const object = { valueOf() { throw new Error('must not coerce an object'); } };
      const inputs = [undefined, null, false, 0, -0, NaN, '', 0n, true, 1, 'false', 1n, Symbol(), object];
      return {
        dictionaries: [undefined, null, {}].map((init) =>
          (Reflect.construct(PageTransitionEvent, ['pageshow', init]) as PageTransitionEvent).persisted),
        booleans: inputs.map((persisted) =>
          (Reflect.construct(PageTransitionEvent, ['pagehide', { persisted }]) as PageTransitionEvent).persisted),
      };
    })).toEqual({
      dictionaries: [false, false, false],
      booleans: [false, false, false, false, false, false, false, false, true, true, true, true, true, true],
    });
  });

  it('reads the specified dictionary members in order and ignores Firefox’s extra member', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const type = { toString() { reads.push('type'); return 'pageshow'; } };
      Reflect.construct(PageTransitionEvent, [type, new Proxy({}, {
        get(_target, key) { reads.push(String(key)); return undefined; },
      })]);
      const event = Reflect.construct(PageTransitionEvent, ['pageshow', {
        get inFrameSwap() { throw new Error('nonstandard member'); }, persisted: true,
      }]) as PageTransitionEvent;
      return [reads, event.persisted];
    })).toEqual([['type', 'bubbles', 'cancelable', 'composed', 'persisted'], true]);
  });

  it('rejects invalid constructor arguments and preserves getter failures', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const invalid = [[], [Symbol()], ['pageshow', 1]].map((args) => {
        try { Reflect.construct(PageTransitionEvent, args); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      const sentinel = new RangeError('persisted getter');
      try { new PageTransitionEvent('pageshow', { get persisted(): boolean { throw sentinel; } }); }
      catch (error) { return [invalid, error === sentinel]; }
      return [invalid, false];
    })).toEqual([[true, true, true], true]);
  });

  it('keeps a readonly persisted value when its getter is borrowed from another Window', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = new owner.window.PageTransitionEvent('pagehide', {
      persisted: true, bubbles: true, cancelable: true, composed: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(other.window.PageTransitionEvent.prototype, 'persisted')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    expect(descriptor.get!.call(event)).toBe(true);
    expect(Reflect.set(event, 'persisted', false)).toBe(false);
    expect(() => { descriptor.get!.call(new owner.window.Event('probe')); }).toThrow(getRelevantRealm(other.window).TypeError);
    expect([event.bubbles, event.cancelable, event.composed, event.isTrusted]).toEqual([true, true, true, false]);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('does not apply the legacy Document target to author dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new PageTransitionEvent('pageshow', { persisted: true });
      let received: unknown;
      addEventListener('pageshow', (current) => {
        received = [current === event, current.target === window, current.currentTarget === window,
          current.bubbles, current.cancelable, current.isTrusted];
      });
      dispatchEvent(event);
      return received;
    })).toEqual([true, true, true, false, false, false]);
  });

  it.each([
    ['pageshow', false], ['pageshow', true], ['pagehide', false], ['pagehide', true],
  ] as const)('fires trusted %s with persisted=%s and the legacy Document target', (eventName, persisted) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const window = document.getRelevantGlobalObject()!;
    const calls: unknown[] = [];
    let received: PageTransitionEventPlatform | undefined;
    browser.document.addEventListener(eventName, () => { calls.push('document'); }, true);
    browser.window.addEventListener(eventName, (event) => { calls.push(['capture', event.eventPhase]); }, true);
    browser.window.addEventListener(eventName, function(this: object, event) {
      received = event as PageTransitionEventPlatform;
      event.preventDefault();
      calls.push({
        type: event.type, persisted: received.persisted,
        targetDocument: event.target === browser.document, currentWindow: event.currentTarget === browser.window,
        receiverWindow: this === browser.window, path: event.composedPath().map((target) => target === browser.window),
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted], phase: event.eventPhase,
        canceled: event.defaultPrevented,
      });
    });
    expect(window.firePageTransitionEvent(eventName, persisted)).toBeUndefined();
    expect(calls).toEqual([
      ['capture', 2],
      {
        type: eventName, persisted, targetDocument: true, currentWindow: true, receiverWindow: true, path: [true],
        flags: [true, true, false, true], phase: 2, canceled: true,
      },
    ]);
    expect(received).toBeInstanceOf(browser.window.PageTransitionEvent);
    expect(getRelevantRealm(received!)).toBe(getRelevantRealm(browser.window));
    expect(received!.target).toBe(browser.document);
    expect(received!.currentTarget).toBeNull();
    expect(received!.composedPath()).toEqual([]);
    expect(received!.eventPhase).toBe(0);
  });

  it('retains the persisted snapshot when the Document later becomes unsalvageable', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    let received: PageTransitionEventPlatform | undefined;
    browser.window.addEventListener('pagehide', (event) => { received = event as PageTransitionEventPlatform; });
    document.getRelevantGlobalObject()!.firePageTransitionEvent('pagehide', document.salvageable);
    document.makeUnsalvageable('test');
    expect(document.salvageable).toBe(false);
    expect(received!.persisted).toBe(true);
  });

  it('has no legacy event factory entry', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      try { document.createEvent('PageTransitionEvent'); }
      catch (error) { return error instanceof DOMException && error.name === 'NotSupportedError'; }
      return false;
    })).toBe(true);
  });
});
