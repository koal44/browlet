import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { MouseEventImpl } from '../../../../src/browlet/interaction/events/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('Pointer Events: MouseEvent prerequisite', () => {
  it('inherits UIEvent and defaults data without inferring trusted event-type flags', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new MouseEvent('click');
      return {
        type: event.type, view: event.view, detail: event.detail, relatedTarget: event.relatedTarget,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        coords: [event.screenX, event.screenY, event.clientX, event.clientY],
        buttons: [event.button, event.buttons, event.which], movement: [event.movementX, event.movementY],
        modifiers: [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey],
        inheritance: [event instanceof MouseEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(MouseEvent.prototype) === UIEvent.prototype],
        tag: Object.prototype.toString.call(event), length: MouseEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'click', view: null, detail: 0, relatedTarget: null,
      flags: [false, false, false, false], coords: [0, 0, 0, 0], buttons: [0, 0, 1], movement: [0, 0],
      modifiers: [false, false, false, false], inheritance: [true, true, true, true],
      tag: '[object MouseEvent]', length: 1, timeStamp: true,
    });
  });

  it('converts coordinates, button widths, and inherited fields through the binding', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = Reflect.construct(MouseEvent, ['probe', {
        screenX: '5.9', screenY: -7.8, clientX: 3.25, clientY: -4.75,
        button: 65535, buttons: 65541, movementX: 2.75, movementY: -3.25,
        view: window, detail: '5.9', relatedTarget: document, bubbles: 1, cancelable: {}, composed: 'yes',
      }]) as MouseEvent;
      const empty = Reflect.construct(MouseEvent, ['empty', null]) as MouseEvent;
      return {
        coords: [event.screenX, event.screenY, event.clientX, event.clientY],
        buttons: [event.button, event.buttons, event.which], movement: [event.movementX, event.movementY],
        inherited: [event.view === window, event.detail, event.relatedTarget === document,
          event.bubbles, event.cancelable, event.composed, event.isTrusted],
        large: new MouseEvent('probe', { clientX: 2 ** 33 + 1 }).clientX,
        empty: [empty.view, empty.relatedTarget, empty.button, empty.buttons, empty.clientX],
      };
    })).toEqual({
      coords: [5, -8, 3, -5], buttons: [-1, 5, 0], movement: [2.75, -3.25],
      inherited: [true, 5, true, true, true, true, false], large: 2 ** 33 + 1,
      empty: [null, null, 0, 0, 0],
    });
  });

  it('rejects nonfinite coordinates and movement in the constructor realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return ['screenX', 'screenY', 'clientX', 'clientY', 'movementX', 'movementY'].flatMap((key) =>
        [NaN, Infinity, -Infinity].map((value) => {
          try { Reflect.construct(MouseEvent, ['probe', { [key]: value }]); return false; }
          catch (error) { return error instanceof TypeError; }
        }));
    })).toEqual(Array<boolean>(18).fill(true));
  });

  it('captures all fourteen modifiers independently of later changes to the dictionary', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const init = {
        ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
        modifierAltGraph: true, modifierCapsLock: true, modifierFn: true, modifierFnLock: true,
        modifierHyper: true, modifierNumLock: true, modifierScrollLock: true,
        modifierSuper: true, modifierSymbol: true, modifierSymbolLock: true,
      };
      const event = new MouseEvent('probe', init);
      init.ctrlKey = false;
      const keys = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'FnLock',
        'Hyper', 'NumLock', 'ScrollLock', 'Super', 'Symbol', 'SymbolLock'];
      return [keys.map((key) => event.getModifierState(key)),
        [event.ctrlKey, event.shiftKey, event.altKey, event.metaKey],
        ['', 'control', 'Accel', 'OS', 'other'].map((key) => event.getModifierState(key)),
        new MouseEvent('probe').getModifierState('Control')];
    })).toEqual([Array<boolean>(14).fill(true), [true, true, true, true], Array<boolean>(5).fill(false), false]);
  });

  it('derives which from the changed button without using buttons or the constructor which input', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => [-2, -1, 0, 1, 2, 3, 4, 32767].map((button) => {
      const event = Reflect.construct(MouseEvent, ['probe', { button, buttons: 31, which: 99 }]);
      return event.which;
    }))).toEqual([4294967295, 0, 1, 2, 3, 4, 5, 32768]);
  });

  it('preserves event, view, and related-target ownership across borrowed getters and initialization', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = new owner.window.MouseEvent('probe', { view: other.window, relatedTarget: other.document });
    const descriptor = Object.getOwnPropertyDescriptor(other.window.MouseEvent.prototype, 'relatedTarget')!;
    expect(descriptor.get!.call(event)).toBe(other.document);
    expect(event.view).toBe(other.window);
    other.window.MouseEvent.prototype.initMouseEvent.call(event, 'changed', true, true, owner.window,
      5, 10, 20, 30, 40, true, false, false, false, 2, other.window);
    expect([event.relatedTarget, event.view, event.clientX, event.button, event.ctrlKey])
      .toEqual([other.window, owner.window, 30, 2, true]);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('validates related targets and receivers without unwrapping arbitrary author proxies', () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    for (const relatedTarget of [{}, false, new Proxy(browser.document, {})]) {
      expect(() => { Reflect.construct(browser.window.MouseEvent, ['probe', { relatedTarget }]); }).toThrow(realm.TypeError);
    }
    const prototype = browser.window.MouseEvent.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'button')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    for (const receiver of [{}, new browser.window.Event('probe'), new browser.window.UIEvent('probe')]) {
      expect(() => { descriptor.get!.call(receiver); }).toThrow(realm.TypeError);
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately invalid receiver.
        Reflect.apply(prototype.initMouseEvent, receiver, ['probe']);
      }).toThrow(realm.TypeError);
    }
  });

  it('supports author subclasses', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      class Derived extends MouseEvent {}
      const event = new Derived('probe', { clientX: 5, relatedTarget: window });
      return [event instanceof Derived, event instanceof MouseEvent, event instanceof UIEvent,
        event instanceof Event, Object.getPrototypeOf(event) === Derived.prototype,
        event.clientX, event.relatedTarget === window];
    })).toEqual([true, true, true, true, true, 5, true]);
  });

  it.each(['MouseEvent', 'MouseEvents', 'mOuSeEvEnTs'])('creates an uninitialized %s in the Document realm', (name) => {
    const browser = new Browlet({ route: () => '' });
    const event = browser.document.createEvent(name);
    expect(event).toBeInstanceOf(browser.window.MouseEvent);
    const mouse = unwrap<MouseEventImpl>(event);
    expect([mouse.initialized, mouse.isTrusted, mouse.view, mouse.which, mouse.buttons]).toEqual([false, false, null, 1, 0]);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(browser.document));
    expect(() => browser.document.dispatchEvent(event)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('initializes every legacy argument, preserving buttons, movement, composed, and timestamp', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new MouseEvent('probe', {
        buttons: 5, movementX: 2.75, movementY: -3.25, cancelable: true, composed: true,
        modifierCapsLock: true, modifierFnLock: true,
      });
      const timeStamp = event.timeStamp;
      document.dispatchEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      event.initMouseEvent('changed', true, true, window, 4, 8.5, -9.5, 10.25, -11.25,
        false, true, false, true, 1, document);
      return {
        type: event.type, view: event.view === window, detail: event.detail, related: event.relatedTarget === document,
        coords: [event.screenX, event.screenY, event.clientX, event.clientY],
        modifiers: [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey,
          event.getModifierState('CapsLock'), event.getModifierState('FnLock')],
        buttons: [event.button, event.buttons, event.which], movement: [event.movementX, event.movementY],
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted, event.defaultPrevented, event.cancelBubble],
        target: event.target, timeStamp: event.timeStamp === timeStamp,
      };
    })).toEqual({
      type: 'changed', view: true, detail: 4, related: true, coords: [8, -9, 10, -11],
      modifiers: [false, true, false, true, false, false], buttons: [1, 5, 2], movement: [2.75, -3.25],
      flags: [true, true, true, false, false, false], target: null, timeStamp: true,
    });
  });

  it('uses legacy defaults, converts before the dispatch guard, and otherwise leaves an in-flight event alone', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new MouseEvent('probe', { clientX: 5, buttons: 3, altKey: true });
      let converted = false;
      let rejected = false;
      let during: unknown[] = [];
      document.addEventListener('probe', () => {
        const type = { toString() { converted = true; return 'changed'; } };
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise conversion with an explicit receiver.
        Reflect.apply(event.initMouseEvent, event, [type]);
        try {
          // eslint-disable-next-line @typescript-eslint/unbound-method -- Missing required type must still fail during dispatch.
          Reflect.apply(event.initMouseEvent, event, []);
        } catch (error) { rejected = error instanceof TypeError; }
        during = [event.type, event.clientX, event.altKey, event.buttons, event.target === document];
      }, { once: true });
      document.dispatchEvent(event);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- lib.dom still requires the optional legacy arguments.
      Reflect.apply(event.initMouseEvent, event, ['reset']);
      return [converted, rejected, during, [event.type, event.clientX, event.altKey, event.buttons,
        event.button, event.relatedTarget, event.view, event.detail, event.target]];
    })).toEqual([true, true, ['probe', 5, true, 3, true], ['reset', 0, false, 3, 0, null, null, 0, null]]);
  });

  it('retargets relatedTarget through the normal shadow-tree dispatch path', async () => {
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
        target.addEventListener('mouseout', (event) => records.push([label, event.target === inner,
          (event as MouseEvent).relatedTarget === other]));
      }
      const event = new MouseEvent('mouseout', { relatedTarget: other, bubbles: true, composed: true });
      inner.dispatchEvent(event);
      return [records, event.target, event.relatedTarget, event.composedPath()];
    })).toEqual([[['inner', true, true], ['shadow', true, true]], null, null, []]);
  });

  it('does not let author construction, dispatch, or legacy initialization change native movement history', async () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).env.window;
    window.setPointerLockAttributesForMousemove(new MouseEventImpl('mousemove', { screenX: 100, screenY: 400 }));
    expect(await browser.evaluate(() => {
      const event = new MouseEvent('mousemove', { screenX: 900, screenY: 800, movementX: 7, movementY: -9 });
      document.dispatchEvent(event);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- lib.dom still requires the optional legacy arguments.
      Reflect.apply(event.initMouseEvent, event, ['mousedown']);
      return [event.movementX, event.movementY, event.isTrusted];
    })).toEqual([7, -9, false]);
    expect(window.lastMouseMove).toEqual({ x: 100, y: 400 });
    const next = new MouseEventImpl('mousemove', { screenX: 106, screenY: 402 });
    window.setPointerLockAttributesForMousemove(next);
    expect([next.movementX, next.movementY]).toEqual([6, 2]);
  });
});
