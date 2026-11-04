import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { KeyboardEventImpl } from '../../../../src/browlet/interaction/events/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('UI Events: KeyboardEvent', () => {
  it.each(['keydown', 'keyup', 'keypress'])('constructs %s with dictionary defaults rather than producer flags', async (type) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((type) => {
      const event = new KeyboardEvent(type);
      return {
        type: event.type, key: event.key, code: event.code, location: event.location,
        modifiers: [event.ctrlKey, event.shiftKey, event.altKey, event.metaKey, event.getModifierState('CapsLock')],
        repeat: event.repeat, isComposing: event.isComposing, codes: [event.charCode, event.keyCode, event.which],
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted], ui: [event.view, event.detail],
        inheritance: [event instanceof KeyboardEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(KeyboardEvent.prototype) === UIEvent.prototype],
        tag: Object.prototype.toString.call(event), length: KeyboardEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    }, type)).toEqual({
      type, key: '', code: '', location: 0, modifiers: [false, false, false, false, false],
      repeat: false, isComposing: false, codes: [0, 0, 0], flags: [false, false, false, false], ui: [null, 0],
      inheritance: [true, true, true, true], tag: '[object KeyboardEvent]', length: 1, timeStamp: true,
    });
  });

  it('exposes the four location constants on the constructor and prototype', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return ['DOM_KEY_LOCATION_STANDARD', 'DOM_KEY_LOCATION_LEFT', 'DOM_KEY_LOCATION_RIGHT',
        'DOM_KEY_LOCATION_NUMPAD'].map((name) => [
        Object.getOwnPropertyDescriptor(KeyboardEvent, name),
        Object.getOwnPropertyDescriptor(KeyboardEvent.prototype, name),
      ]);
    })).toEqual([0, 1, 2, 3].map((value) => {
      const descriptor = { value, enumerable: true, configurable: false, writable: false };
      return [descriptor, descriptor];
    }));
  });

  it('converts all dictionary levels in order and ignores which rather than reading it', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const init = new Proxy({ view: window, detail: 5, key: 'a', code: 'KeyA', location: 2 }, {
        get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver) as unknown; },
      });
      const event = new KeyboardEvent('keydown', init);
      return [reads, event.view === window, event.detail, event.key, event.code, event.location];
    })).toEqual([
      ['bubbles', 'cancelable', 'composed', 'detail', 'view', 'altKey', 'ctrlKey', 'metaKey',
        'modifierAltGraph', 'modifierCapsLock', 'modifierFn', 'modifierFnLock', 'modifierHyper',
        'modifierNumLock', 'modifierScrollLock', 'modifierSuper', 'modifierSymbol', 'modifierSymbolLock',
        'shiftKey', 'charCode', 'code', 'isComposing', 'key', 'keyCode', 'location', 'repeat'],
      true, 5, 'a', 'KeyA', 2,
    ]);
  });

  it('snapshots every specified modifier independently with exact key names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const entries = [
        ['ctrlKey', 'Control'], ['shiftKey', 'Shift'], ['altKey', 'Alt'], ['metaKey', 'Meta'],
        ['modifierAltGraph', 'AltGraph'], ['modifierCapsLock', 'CapsLock'], ['modifierFn', 'Fn'],
        ['modifierFnLock', 'FnLock'], ['modifierHyper', 'Hyper'], ['modifierNumLock', 'NumLock'],
        ['modifierScrollLock', 'ScrollLock'], ['modifierSuper', 'Super'], ['modifierSymbol', 'Symbol'],
        ['modifierSymbolLock', 'SymbolLock'],
      ] as const;
      return entries.map(([member, key]) => {
        const init = { [member]: true };
        const event = new KeyboardEvent('keydown', init);
        init[member] = false;
        const active = entries.filter(([, name]) => event.getModifierState(name)).map(([, name]) => name);
        const invalid = ['', 'Accel', 'OS', 'ShiftLock', key.toLowerCase(), 'toString', '__proto__']
          .map((name) => event.getModifierState(name));
        return [active, invalid, [event.ctrlKey, event.shiftKey, event.altKey, event.metaKey],
          new KeyboardEvent('keyup').getModifierState(key)];
      });
    })).toEqual(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'FnLock',
      'Hyper', 'NumLock', 'ScrollLock', 'Super', 'Symbol', 'SymbolLock'].map((key, index) => [
      [key], Array<boolean>(7).fill(false), [index === 0, index === 1, index === 2, index === 3], false,
    ]));
  });

  it('converts supplied strings and numbers without inferring physical keys, locations, or codes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = Reflect.construct(KeyboardEvent, ['keydown', {
        key: { toString: () => '\ud800' }, code: 'vendorFuture', location: -1,
        keyCode: 0x100000005, charCode: '97.9', repeat: {}, isComposing: 'yes',
        ctrlKey: 1, which: 9,
      }]) as KeyboardEvent;
      const letter = new KeyboardEvent('keypress', { key: 'a', code: 'KeyA' });
      const empty = Reflect.construct(KeyboardEvent, ['empty', null]) as KeyboardEvent;
      return [event.key, event.code, event.location, event.keyCode, event.charCode, event.which,
        event.repeat, event.isComposing, event.ctrlKey, letter.keyCode, letter.charCode, letter.which,
        empty.key, empty.code, empty.location];
    })).toEqual(['\ud800', 'vendorFuture', 0xffffffff, 5, 97, 5, true, true, true, 0, 0, 0, '', '', 0]);
  });

  it('checks constructor and method inputs in the invoked function realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const invalid = [[], [Symbol()], ['keydown', 1], ['keydown', { key: Symbol() }],
        ['keydown', { code: Symbol() }], ['keydown', { location: 1n }], ['keydown', { view: {} }]].map((args) => {
        try { Reflect.construct(KeyboardEvent, args); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      const event = new KeyboardEvent('keydown', { ctrlKey: true });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the original method with deliberate invalid arguments/receivers below.
      const getModifierState = event.getModifierState;
      for (const invoke of [
        () => { Reflect.apply(KeyboardEvent, null, ['keydown']); },
        () => { Reflect.apply(getModifierState, event, []); },
        () => { Reflect.apply(getModifierState, event, [Symbol()]); },
        () => { Reflect.apply(getModifierState, {}, ['Control']); },
      ]) {
        try { invoke(); invalid.push(false); }
        catch (error) { invalid.push(error instanceof TypeError); }
      }
      return [invalid, Reflect.apply(getModifierState, event, [{ toString: () => 'Control' }]) as boolean];
    })).toEqual([Array<boolean>(11).fill(true), true]);
  });

  it('propagates coercion failures before reading later keyboard members', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const error = new Error('key conversion');
      const reads: string[] = [];
      const init = {
        key: { toString() { reads.push('key'); throw error; } },
        get location() { reads.push('location'); return 1; },
      };
      try { Reflect.construct(KeyboardEvent, ['keydown', init]); return [false, reads]; }
      catch (caught) { return [caught === error, reads]; }
    })).toEqual([true, ['key']]);
  });

  it('enforces KeyboardEvent receiver brands on read-only attributes', () => {
    const browser = new Browlet({ route: () => '' });
    for (const name of ['key', 'code', 'location', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey',
      'repeat', 'isComposing', 'charCode', 'keyCode']) {
      const descriptor = Object.getOwnPropertyDescriptor(browser.window.KeyboardEvent.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      for (const receiver of [{}, new browser.window.Event('probe'), new browser.window.UIEvent('probe')]) {
        expect(() => { descriptor.get!.call(receiver); }).toThrow(getRelevantRealm(browser.window).TypeError);
      }
    }
  });

  it('preserves receiver ownership and Window view with borrowed getters and methods', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = new owner.window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, view: other.window });
    const key = Object.getOwnPropertyDescriptor(other.window.KeyboardEvent.prototype, 'key')!;
    const view = Object.getOwnPropertyDescriptor(other.window.UIEvent.prototype, 'view')!;
    expect(key.get!.call(event)).toBe('a');
    expect(view.get!.call(event)).toBe(other.window);
    expect(other.window.KeyboardEvent.prototype.getModifierState.call(event, 'Control')).toBe(true);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('supports author subclasses', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      class Derived extends KeyboardEvent {}
      const event = new Derived('keydown', { key: 'a', code: 'KeyA', shiftKey: true });
      return [event instanceof Derived, event instanceof KeyboardEvent, event instanceof UIEvent, event instanceof Event,
        Object.getPrototypeOf(event) === Derived.prototype, event.key, event.getModifierState('Shift')];
    })).toEqual([true, true, true, true, true, 'a', true]);
  });

  it('creates uninitialized KeyboardEvents through DOM\'s singular legacy entry', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('kEyBoArDeVeNt') as KeyboardEvent;
      let uninitialized = false;
      try { document.dispatchEvent(event); }
      catch (error) { uninitialized = error instanceof DOMException && error.name === 'InvalidStateError'; }
      const rejected = ['KeyEvents', 'KeyboardEvents'].map((name) => {
        try { document.createEvent(name); return false; }
        catch (error) { return error instanceof DOMException && error.name === 'NotSupportedError'; }
      });
      return [event instanceof KeyboardEvent, event.type, event.view, event.key, event.keyCode, event.which,
        event.isTrusted, uninitialized, rejected];
    })).toEqual([true, '', null, '', 0, 0, false, true, [true, true]]);
  });

  it('initializes only legacy fields, replacing modifiers and preserving unrelated keyboard data', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'a', code: 'KeyA', detail: 5, location: 3,
        repeat: true, isComposing: true, keyCode: 65, charCode: 97, modifierCapsLock: true,
        shiftKey: true, composed: true, cancelable: true,
      });
      const timeStamp = event.timeStamp;
      document.dispatchEvent(event);
      event.preventDefault();
      event.initKeyboardEvent('after', true, true, window, 'b', 2, true, false, false, true);
      const first = [event.type, event.bubbles, event.cancelable, event.composed, event.target, event.defaultPrevented,
        event.view === window, event.detail, event.key, event.code, event.location, event.repeat, event.isComposing,
        event.ctrlKey, event.altKey, event.shiftKey, event.metaKey, event.getModifierState('CapsLock'),
        event.keyCode, event.charCode, event.which, event.timeStamp === timeStamp];
      event.initKeyboardEvent('reset');
      return [first, [event.type, event.bubbles, event.cancelable, event.view, event.key, event.location,
        event.ctrlKey, event.metaKey, event.repeat, event.isComposing, event.code, event.which]];
    })).toEqual([
      ['after', true, true, true, null, false, true, 0, 'b', 'KeyA', 2, true, true,
        true, false, false, true, false, 65, 97, 65, true],
      ['reset', false, false, null, '', 0, false, false, true, true, 'KeyA', 65],
    ]);
  });

  it('converts initializer arguments but leaves a dispatching event unchanged', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
      const reads: string[] = [];
      document.addEventListener('keydown', () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise Web IDL conversion before the dispatch guard.
        Reflect.apply(event.initKeyboardEvent, event, [
          { toString() { reads.push('type'); return 'changed'; } }, true, true, window,
          { toString() { reads.push('key'); return 'b'; } }, -1, false, true, true, true,
        ]);
      }, { once: true });
      document.dispatchEvent(event);
      return [reads, event.type, event.key, event.location, event.view, event.ctrlKey, event.altKey,
        event.shiftKey, event.metaKey, event.bubbles, event.cancelable];
    })).toEqual([['type', 'key'], 'keydown', 'a', 0, null, true, false, false, false, false, false]);
  });

  it('keeps synthetic dispatch synchronous and independent of device ordering or editing', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('contenteditable', 'true');
      element.textContent = 'before';
      document.body.append(element);
      const order: string[] = [];
      element.onkeyup = (event) => { order.push(event.type); };
      element.onkeydown = (event) => { order.push(event.type); event.preventDefault(); };
      for (const type of ['beforeinput', 'input', 'click', 'compositionstart']) {
        element.addEventListener(type, () => { order.push(type); });
      }
      document.addEventListener('keydown', () => { order.push('bubble'); }, { once: true });
      const results = ['keyup', 'keydown'].map((type) => element.dispatchEvent(new KeyboardEvent(type, {
        key: 'a', code: 'KeyA', repeat: true, isComposing: true, ctrlKey: true,
        bubbles: true, cancelable: true,
      })));
      order.push('returned');
      return [results, order, element.textContent, new KeyboardEvent('keydown').isComposing];
    })).toEqual([[true, false], ['keyup', 'keydown', 'bubble', 'returned'], 'before', false]);
  });

  it('delivers a host-created keyboard notification using the existing factory', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      document.body.onkeydown = (event) => {
        Reflect.set(window, 'received', [event instanceof KeyboardEvent, event.key, event.view === window,
          event.isTrusted, event.target === document.body, event.bubbles, event.cancelable, event.composed]);
      };
    });
    const target = unwrap<ElementImpl>(browser.document.body!);
    expect(target.fireEvent('keydown', KeyboardEventImpl, (event) => {
      const keyboard = event as KeyboardEventImpl;
      keyboard.key = 'a';
      keyboard.view = getRelevantRealm(browser.window).env.window;
      keyboard.setFlags({ bubbles: true, cancelable: true, composed: true });
    })).toBe(true);
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown))
      .toEqual([true, 'a', true, true, true, true, true, true]);
  });
});
