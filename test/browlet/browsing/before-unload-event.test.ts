import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BeforeUnloadEventImpl } from '../../../src/browlet/browsing/navigation/events/index';
import type { EventImpl } from '../../../src/browlet/dom/events/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { BeforeUnloadEvent as BeforeUnloadEventPlatform } from '../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §7.2.7.7: BeforeUnloadEvent', () => {
  it('exposes a nonconstructible interface and creates uninitialized legacy events', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      const errors: string[] = [];
      try { Reflect.construct(BeforeUnloadEvent, []); }
      catch (error) { if (error instanceof TypeError) errors.push('constructor'); }
      try { dispatchEvent(event); }
      catch (error) { if (error instanceof DOMException) errors.push(error.name); }
      return {
        type: event.type, value: event.returnValue as unknown,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted, event.defaultPrevented],
        branded: event instanceof BeforeUnloadEvent && event instanceof Event,
        parent: Object.getPrototypeOf(BeforeUnloadEvent.prototype) === Event.prototype,
        tag: Object.prototype.toString.call(event), timeStamp: Number.isFinite(event.timeStamp), errors,
      };
    })).toEqual({
      type: '', value: '', flags: [false, false, false, false, false], branded: true, parent: true,
      tag: '[object BeforeUnloadEvent]', timeStamp: true, errors: ['constructor', 'InvalidStateError'],
    });
  });

  it('matches the legacy factory name ASCII-case-insensitively in the Document realm', () => {
    const browser = new Browlet({ route: () => '' });
    for (const name of ['BeforeUnloadEvent', 'beforeunloadevent', 'BEFOREunloadEVENT']) {
      const event = browser.document.createEvent(name);
      expect(event).toBeInstanceOf(browser.window.BeforeUnloadEvent);
      expect(getRelevantRealm(event)).toBe(getRelevantRealm(browser.document));
    }
  });

  it('stores the last DOMString value without canceling the event', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      return ['', 'prompt', false, null, undefined, 0, 1n, '\uD800', { toString() { return 'object'; } }].map((value) => {
        Reflect.set(event, 'returnValue', value);
        return [event.returnValue as unknown, event.defaultPrevented];
      });
    })).toEqual(['', 'prompt', 'false', 'null', 'undefined', '0', '1', '\uD800', 'object'].map((value) => [value, false]));
  });

  it('preserves the stored string when conversion fails and propagates the original exception', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.returnValue = 'retained';
      let symbolError = false;
      let sameError = false;
      try { Reflect.set(event, 'returnValue', Symbol()); }
      catch (error) { symbolError = error instanceof TypeError; }
      const sentinel = new RangeError('string conversion');
      try { Reflect.set(event, 'returnValue', { toString() { throw sentinel; } }); }
      catch (error) { sameError = error === sentinel; }
      return [symbolError, sameError, event.returnValue as unknown];
    })).toEqual([true, true, 'retained']);
  });

  it('keeps the string independent from borrowed Event cancellation accessors', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      event.returnValue = 'prompt';
      const base = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue')!;
      const initial = [event.returnValue, base.get!.call(event), event.defaultPrevented];
      base.set!.call(event, false);
      base.set!.call(event, true);
      const canceled = [event.returnValue, base.get!.call(event), event.defaultPrevented];
      event.returnValue = '';
      return [initial, canceled, [event.returnValue, event.defaultPrevented]];
    })).toEqual([['prompt', true, false], ['prompt', false, true], ['', true]]);
  });

  it('retains the string when initEvent resets ordinary Event state', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      event.returnValue = 'retained';
      event.preventDefault();
      const timeStamp = event.timeStamp;
      event.initEvent('other-event', true, false);
      event.preventDefault();
      return [event.returnValue as unknown, event.type, event.bubbles, event.cancelable, event.defaultPrevented,
        event.timeStamp === timeStamp];
    })).toEqual(['retained', 'other-event', true, false, false, true]);
  });

  it('does not treat a nonempty string as DOM dispatch cancellation', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      let received: unknown;
      addEventListener('beforeunload', (current) => {
        event.returnValue = 'prompt';
        received = [current === event, current.target === window, current.currentTarget === window, current.isTrusted];
      }, { once: true });
      const first = dispatchEvent(event);
      addEventListener('beforeunload', (current) => { current.preventDefault(); }, { once: true });
      const second = dispatchEvent(event);
      return [first, second, received, event.returnValue as unknown, event.defaultPrevented];
    })).toEqual([true, false, [true, true, true, false], 'prompt', true]);
  });

  it('borrows string accessors across realms and checks the receiver before conversion', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = owner.document.createEvent('BeforeUnloadEvent');
    const descriptor = Object.getOwnPropertyDescriptor(other.window.BeforeUnloadEvent.prototype, 'returnValue')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true });
    descriptor.set!.call(event, 'other realm');
    expect(descriptor.get!.call(event)).toBe('other realm');
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    let conversions = 0;
    const value = { toString() { conversions++; return 'invalid'; } };
    for (const receiver of [new owner.window.Event('beforeunload'), Object.create(owner.window.BeforeUnloadEvent.prototype),
      new Proxy(event, {})]) {
      expect(() => { descriptor.get!.call(receiver); }).toThrow(getRelevantRealm(other.window).TypeError);
      expect(() => { descriptor.set!.call(receiver, value); }).toThrow(getRelevantRealm(other.window).TypeError);
    }
    expect(conversions).toBe(0);
  });

  it('creates trusted internal events with the Window target and independent prompt text', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    let received: BeforeUnloadEventPlatform | undefined;
    browser.window.addEventListener('beforeunload', (event) => {
      received = event;
      received.returnValue = 'prompt';
    });
    const result = document.getRelevantGlobalObject()!.fireEvent('beforeunload', BeforeUnloadEventImpl, (event) => {
      expect(event.isBeforeUnloadEvent()).toBe(true);
      event.cancelable = true;
    });
    expect(result).toBe(true);
    expect(received).toBeInstanceOf(browser.window.BeforeUnloadEvent);
    expect(received!.returnValue).toBe('prompt');
    expect(received!.target).toBe(browser.window);
    expect([received!.bubbles, received!.cancelable, received!.composed, received!.isTrusted]).toEqual([false, true, false, true]);
    expect(getRelevantRealm(received!)).toBe(getRelevantRealm(browser.window));
    expect(unwrap<BeforeUnloadEventImpl>(received!).returnValue).toBe('prompt');
  });

  it('identifies the interface independently of the event name for handler processing', () => {
    const browser = new Browlet({ route: () => '' });
    const special = browser.document.createEvent('BeforeUnloadEvent');
    special.initEvent('other-event');
    const ordinary = new browser.window.Event('beforeunload');
    expect(unwrap<EventImpl>(special).isBeforeUnloadEvent()).toBe(true);
    expect(unwrap<EventImpl>(ordinary).isBeforeUnloadEvent()).toBe(false);
  });

  it('preserves ordinary Event returnValue behavior, including noncancelable and passive events', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const cancelable = new Event('probe', { cancelable: true });
      const fixed = new Event('probe');
      const passive = new Event('passive', { cancelable: true });
      const initial = [cancelable.returnValue, fixed.returnValue];
      cancelable.returnValue = false;
      cancelable.returnValue = true;
      fixed.returnValue = false;
      addEventListener('passive', (event) => { event.returnValue = false; }, { passive: true, once: true });
      dispatchEvent(passive);
      return [initial, [cancelable.returnValue, cancelable.defaultPrevented], [fixed.returnValue, fixed.defaultPrevented],
        [passive.returnValue, passive.defaultPrevented]];
    })).toEqual([[true, true], [false, true], [true, false], [true, false]]);
  });

  it('retains its string and realm after the owning Document becomes inactive', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/current');
    const event: BeforeUnloadEventPlatform = browser.document.createEvent('BeforeUnloadEvent');
    const realm = getRelevantRealm(event);
    event.returnValue = 'retained';
    await browser.navigate('https://example.test/next');
    expect(event.returnValue).toBe('retained');
    event.returnValue = 'updated';
    expect(event.returnValue).toBe('updated');
    expect(getRelevantRealm(event)).toBe(realm);
  });
});
