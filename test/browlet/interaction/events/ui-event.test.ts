import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { UIEventImpl } from '../../../../src/browlet/interaction/events/index';
import type { NodeImpl } from '../../../../src/browlet/dom/nodes/index';
import type { UIEvent as UIEventPlatform } from '../../../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('UI Events: UIEvent', () => {
  it('exposes the Event inheritance, constructor defaults, and legacy attributes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new UIEvent('probe');
      return {
        type: event.type, view: event.view, detail: event.detail, which: event.which,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        event: event instanceof Event, uiEvent: event instanceof UIEvent,
        parent: Object.getPrototypeOf(UIEvent.prototype) === Event.prototype,
        constants: [Reflect.get(UIEvent, 'AT_TARGET') as unknown, event.AT_TARGET],
        tag: Object.prototype.toString.call(event), length: UIEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'probe', view: null, detail: 0, which: 0, flags: [false, false, false, false],
      event: true, uiEvent: true, parent: true, constants: [2, 2], tag: '[object UIEvent]', length: 1, timeStamp: true,
    });
  });

  it('converts inherited dictionary members before detail/view and never reads which', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const values = { bubbles: 1, cancelable: 'yes', composed: {}, detail: '5.9', view: window };
      const init = new Proxy(values, {
        get(target, key, receiver) {
          reads.push(String(key));
          if (key === 'which') throw new Error('UIEventInit.which must not be read');
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      const event = Reflect.construct(UIEvent, ['probe', init]) as UIEvent;
      const empty = Reflect.construct(UIEvent, ['empty', null]) as UIEvent;
      return {
        reads, flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        data: [event.view === window, event.detail, event.which], empty: [empty.view, empty.detail, empty.which],
      };
    })).toEqual({
      reads: ['bubbles', 'cancelable', 'composed', 'detail', 'view'],
      flags: [true, true, true, false], data: [true, 5, 0], empty: [null, 0, 0],
    });
  });

  it('uses Web IDL long conversion for detail', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() =>
      [NaN, Infinity, -Infinity, 2 ** 32 + 5, 2 ** 31, -1.9, '6.2', null, undefined].map((detail) =>
        (Reflect.construct(UIEvent, ['probe', { detail }]) as UIEvent).detail),
    )).toEqual([0, 0, 0, 5, -(2 ** 31), -1, 6, 0, 0]);
  });

  it('rejects invalid constructor inputs in the constructor realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [[], [Symbol()], ['probe', 1], ['probe', { detail: Symbol() }], ['probe', { detail: 1n }],
        ['probe', { view: {} }], ['probe', { view: document }], ['probe', { view: new Proxy(window, {}) }]]
        .map((args) => {
          try { Reflect.construct(UIEvent, args); return false; }
          catch (error) { return error instanceof TypeError; }
        });
    })).toEqual(Array<boolean>(8).fill(true));
  });

  it('preserves supplied Window identity independently of the event and getter realms', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = new owner.window.UIEvent('probe', { view: other.window, detail: 8 });
    const descriptor = Object.getOwnPropertyDescriptor(other.window.UIEvent.prototype, 'view')!;
    expect(event.view).toBe(other.window);
    expect(descriptor.get!.call(event)).toBe(other.window);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    other.window.UIEvent.prototype.initUIEvent.call(event, 'after', false, true, owner.window, 3);
    expect(event.view).toBe(owner.window);
    expect(event.detail).toBe(3);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('checks accessor and initializer receivers before converting arguments', () => {
    const browser = new Browlet({ route: () => '' });
    const prototype = browser.window.UIEvent.prototype;
    const realm = getRelevantRealm(browser.window);
    for (const name of ['view', 'detail', 'which']) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(() => { descriptor.get!.call({}); }).toThrow(realm.TypeError);
    }
    const type = { toString() { throw new Error('must check receiver first'); } };
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Test receiver validation on the original method.
      Reflect.apply(prototype.initUIEvent, {}, [type]);
    }).toThrow(realm.TypeError);
  });

  it('supports author subclasses', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      class Derived extends UIEvent {}
      const event = new Derived('probe', { detail: 3, view: window });
      return [event instanceof Derived, event instanceof UIEvent, event instanceof Event,
        Object.getPrototypeOf(event) === Derived.prototype, event.detail, event.view === window];
    })).toEqual([true, true, true, true, 3, true]);
  });

  it.each(['UIEvent', 'UIEvents', 'uievent', 'uIeVeNtS'])('creates an uninitialized %s in the Document realm', (name) => {
    const browser = new Browlet({ route: () => '' });
    const event = browser.document.createEvent(name) as UIEventPlatform;
    expect(event).toBeInstanceOf(browser.window.UIEvent);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(browser.document));
    expect([event.type, event.view, event.detail, event.which, event.isTrusted]).toEqual(['', null, 0, 0, false]);
    expect(() => browser.document.dispatchEvent(event)).toThrow(browser.window.DOMException);
    event.initUIEvent('ready', true, false, browser.window, 2);
    expect(browser.document.dispatchEvent(event)).toBe(true);
    expect([event.type, event.view, event.detail]).toEqual(['ready', browser.window, 2]);
  });

  it('reinitializes payload and DOM state while retaining composed and timestamp', () => {
    const browser = new Browlet({ route: () => '' });
    const event = new browser.window.UIEvent('before', {
      bubbles: true, cancelable: true, composed: true, view: browser.window, detail: 9,
    });
    const timeStamp = event.timeStamp;
    browser.document.dispatchEvent(event);
    event.preventDefault();
    event.stopImmediatePropagation();
    unwrap<UIEventImpl>(event).isTrusted = true;
    event.initUIEvent('after');
    expect([event.type, event.bubbles, event.cancelable, event.view, event.detail, event.which])
      .toEqual(['after', false, false, null, 0, 0]);
    expect([event.target, event.defaultPrevented, event.cancelBubble, event.isTrusted, event.composed])
      .toEqual([null, false, false, false, true]);
    expect(event.timeStamp).toBe(timeStamp);
  });

  it('ignores reinitialization during dispatch after performing argument conversion', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new UIEvent('before', { cancelable: true, view: window, detail: 5 });
      let converted = false;
      document.addEventListener('before', () => {
        event.preventDefault();
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply coercible arguments through the author API.
        Reflect.apply(event.initUIEvent, event, [
          { toString() { converted = true; return 'after'; } }, true, false, null, 99,
        ]);
      }, { once: true });
      const result = document.dispatchEvent(event);
      return [converted, result, event.type, event.view === window, event.detail, event.defaultPrevented];
    })).toEqual([true, false, 'before', true, 5, true]);
  });

  it('leaves UIEvent data intact when only initEvent is called', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new UIEvent('before', { view: window, detail: 7 });
      event.initEvent('after');
      return [event.type, event.view === window, event.detail];
    })).toEqual(['after', true, 7]);
  });

  it.each(['node', 'window'] as const)('initializes a host event from its %s target instead of its allocation realm', (kind) => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const node = owner.document.createElement('div');
    other.document.adoptNode(node);
    const target = kind === 'node' ? unwrap<NodeImpl>(node) : getRelevantRealm(other.window).env.window;
    const realm = getRelevantRealm(owner.window);
    const event = realm.env.createEvent(UIEventImpl);
    const platform = getBindingContext(realm).project(UIEventImpl, event) as UIEventPlatform;
    expect(platform.isTrusted).toBe(true);
    expect(platform.view).toBeNull();
    event.detail = 9;
    event.preventDefault();
    event.stopPropagation();
    event.initializeUIEvent('probe', target, true, true);
    expect(platform.view).toBe(other.window);
    expect(platform.detail).toBe(0);
    expect(platform.which).toBe(0);
    expect(platform.target).toBe(kind === 'node' ? node : other.window);
    expect([platform.isTrusted, platform.defaultPrevented, platform.cancelBubble]).toEqual([false, false, false]);
    expect(getRelevantRealm(platform)).toBe(realm);
    // The producer establishes trust after DOM initialization; author redispatch removes it.
    event.isTrusted = true;
    target.dispatch(event);
    expect(platform.isTrusted).toBe(true);
    target.dispatchEvent(event);
    expect(platform.isTrusted).toBe(false);
  });

  it('delivers a host-created UIEvent through the projected listener and preserves cancellation', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      window.addEventListener('host', (event) => {
        const ui = event as UIEvent;
        ui.preventDefault();
        Reflect.set(window, 'received', [ui instanceof UIEvent, ui.view === window,
          ui.detail, ui.isTrusted, ui.target === window, ui.defaultPrevented]);
      }, { once: true });
    });
    const target = getRelevantRealm(browser.window).env.window;
    expect(target.fireEvent('host', UIEventImpl, (ui) => {
      ui.view = target;
      ui.detail = 5;
      ui.setFlags({ cancelable: true });
    })).toBe(false);
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown))
      .toEqual([true, true, 5, true, true, true]);
  });

  it.each([false, true])('returns null for a retired view (read before replacement: %s)', async (readBefore) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate('https://example.test/before');
    const event = new browser.window.UIEvent('retained', { view: browser.window });
    const savedView = readBefore ? event.view : null;
    await browser.navigate('https://example.test/after');
    expect(event.view).toBeNull();
    if (readBefore) expect(savedView).toBe(browser.window);
  });
});
