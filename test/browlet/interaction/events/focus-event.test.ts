import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { FocusEventImpl } from '../../../../src/browlet/interaction/events/index';
import type { FocusEvent as FocusEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('UI Events: FocusEvent', () => {
  it('inherits UIEvent and keeps constructor defaults independent of the event type', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new FocusEvent('focusin');
      return {
        type: event.type, view: event.view, detail: event.detail, relatedTarget: event.relatedTarget,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        inheritance: [event instanceof FocusEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(FocusEvent.prototype) === UIEvent.prototype],
        tag: Object.prototype.toString.call(event), length: FocusEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'focusin', view: null, detail: 0, relatedTarget: null,
      flags: [false, false, false, false], inheritance: [true, true, true, true],
      tag: '[object FocusEvent]', length: 1, timeStamp: true,
    });
  });

  it('converts inherited dictionary members before relatedTarget', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const values = { bubbles: 1, cancelable: 'yes', composed: {}, detail: '5.9', view: window, relatedTarget: document };
      const init = new Proxy(values, {
        get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver) as unknown; },
      });
      const event = Reflect.construct(FocusEvent, ['probe', init]) as FocusEvent;
      const empty = Reflect.construct(FocusEvent, ['empty', null]) as FocusEvent;
      return {
        reads, flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        data: [event.view === window, event.detail, event.relatedTarget === document],
        empty: [empty.view, empty.detail, empty.relatedTarget],
      };
    })).toEqual({
      reads: ['bubbles', 'cancelable', 'composed', 'detail', 'view', 'relatedTarget'],
      flags: [true, true, true, false], data: [true, 5, true], empty: [null, 0, null],
    });
  });

  it('accepts every EventTarget kind, including WindowProxy, without restricting author targets to focusable elements', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const shadow = element.attachShadow({ mode: 'closed' });
      return [window, document, element, shadow, new EventTarget(), null].map((relatedTarget) =>
        new FocusEvent('probe', { relatedTarget }).relatedTarget === relatedTarget);
    })).toEqual([true, true, true, true, true, true]);
  });

  it('rejects non-EventTargets and author proxies in the constructor realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [undefined, false, 1, 'target', {}, new Event('probe'),
        new Proxy(document, {}), new Proxy(window, {})].map((relatedTarget) => {
        try {
          const event = Reflect.construct(FocusEvent, ['probe', { relatedTarget }]) as FocusEvent;
          return relatedTarget === undefined && event.relatedTarget === null;
        } catch (error) { return relatedTarget !== undefined && error instanceof TypeError; }
      });
    })).toEqual(Array<boolean>(8).fill(true));
  });

  it('preserves related-target identity across constructor and borrowed getter realms', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const descriptor = Object.getOwnPropertyDescriptor(other.window.FocusEvent.prototype, 'relatedTarget')!;
    for (const relatedTarget of [other.window, other.document, other.document.createElement('span')]) {
      const event = new owner.window.FocusEvent('probe', { relatedTarget });
      expect(event.relatedTarget).toBe(relatedTarget);
      expect(descriptor.get!.call(event)).toBe(relatedTarget);
      expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    }
  });

  it('checks getter receivers and exposes a read-only Web IDL attribute', () => {
    const browser = new Browlet({ route: () => '' });
    const descriptor = Object.getOwnPropertyDescriptor(browser.window.FocusEvent.prototype, 'relatedTarget')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    for (const receiver of [{}, new browser.window.Event('probe'), new browser.window.UIEvent('probe')]) {
      expect(() => { descriptor.get!.call(receiver); }).toThrow(getRelevantRealm(browser.window).TypeError);
    }
  });

  it('supports author subclasses', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      class Derived extends FocusEvent {}
      const event = new Derived('probe', { relatedTarget: document, view: window, detail: 5 });
      return [event instanceof Derived, event instanceof FocusEvent, event instanceof UIEvent, event instanceof Event,
        Object.getPrototypeOf(event) === Derived.prototype, event.relatedTarget === document, event.view === window, event.detail];
    })).toEqual([true, true, true, true, true, true, true, 5]);
  });

  it.each(['FocusEvent', 'focusevent', 'fOcUsEvEnT'])('creates an uninitialized %s in the Document realm', (name) => {
    const browser = new Browlet({ route: () => '' });
    const event = browser.document.createEvent(name) as FocusEventPlatform;
    expect(event).toBeInstanceOf(browser.window.FocusEvent);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(browser.document));
    expect([event.type, event.view, event.detail, event.relatedTarget, event.isTrusted]).toEqual(['', null, 0, null, false]);
    expect(() => browser.document.dispatchEvent(event)).toThrow(browser.window.DOMException);
    event.initUIEvent('ready', true, false, browser.window, 5);
    expect(browser.document.dispatchEvent(event)).toBe(true);
    expect([event.type, event.view, event.detail, event.relatedTarget]).toEqual(['ready', browser.window, 5, null]);
  });

  it('retargets a related target hidden in a shadow tree for an outside listener', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'closed' });
      const inner = document.createElement('span');
      shadow.append(inner);
      const event = new FocusEvent('focusin', { relatedTarget: inner });
      const before = event.relatedTarget === inner;
      let during = false;
      document.body.addEventListener('focusin', (e) => { during = e.relatedTarget === host; }, { once: true });
      document.body.dispatchEvent(event);
      return [before, during, event.relatedTarget === host];
    })).toEqual([true, true, true]);
  });

  it('stops propagation when both targets retarget to one host and clears private targets after dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'closed' });
      const inner = document.createElement('span');
      const other = document.createElement('span');
      shadow.append(inner, other);
      const records: unknown[] = [];
      for (const [label, target] of [['inner', inner], ['shadow', shadow], ['host', host], ['document', document]] as const) {
        target.addEventListener('focusout', (event) => {
          records.push([label, event.target === inner, (event as FocusEvent).relatedTarget === other]);
        });
      }
      const event = new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: other });
      inner.dispatchEvent(event);
      return { records, cleared: [event.target, event.relatedTarget], path: event.composedPath() };
    })).toEqual({ records: [['inner', true, true], ['shadow', true, true]], cleared: [null, null], path: [] });
  });

  it('preserves constructor data when related-target retargeting suppresses the entire dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      document.body.append(host);
      const inner = document.createElement('span');
      host.attachShadow({ mode: 'closed' }).append(inner);
      let calls = 0;
      host.addEventListener('focusout', () => { calls++; });
      document.addEventListener('focusout', () => { calls++; });
      const event = new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: inner });
      const result = host.dispatchEvent(event);
      return [result, calls, event.target, event.relatedTarget === inner, event.composedPath().length];
    })).toEqual([true, 0, null, true, 0]);
  });

  it('delivers a host-created FocusEvent through the existing event factory', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      window.addEventListener('focus', (event) => {
        Reflect.set(window, 'received', [event instanceof FocusEvent, event.view === window,
          event.relatedTarget === document, event.isTrusted, event.target === window]);
      }, { once: true });
    });
    const target = getRelevantRealm(browser.window).env.window;
    expect(target.fireEvent('focus', FocusEventImpl, (focus) => {
      focus.view = target;
      focus.relatedTarget = target.getAssociatedDocument();
      focus.setFlags({ composed: true });
    })).toBe(true);
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown)).toEqual([true, true, true, true, true]);
  });
});
