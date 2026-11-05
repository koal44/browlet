import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { CompositionEventImpl } from '../../../../src/browlet/interaction/events/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('UI Events: CompositionEvent', () => {
  it.each(['compositionstart', 'compositionupdate', 'compositionend'])('constructs %s with dictionary defaults', async (type) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((type) => {
      const event = new CompositionEvent(type);
      return {
        type: event.type, data: event.data, view: event.view, detail: event.detail, which: event.which,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        inheritance: [event instanceof CompositionEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(CompositionEvent.prototype) === UIEvent.prototype],
        tag: Object.prototype.toString.call(event), length: CompositionEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    }, type)).toEqual({
      type, data: '', view: null, detail: 0, which: 0, flags: [false, false, false, false],
      inheritance: [true, true, true, true], tag: '[object CompositionEvent]', length: 1, timeStamp: true,
    });
  });

  it('converts inherited dictionary members before data', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const values = {
        bubbles: 1, cancelable: 'yes', composed: {}, view: window, detail: '5.9',
        data: { toString() { reads.push('data.toString'); return 'text'; } },
      };
      const init = new Proxy(values, {
        get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver) as unknown; },
      });
      const event = Reflect.construct(CompositionEvent, ['compositionupdate', init]) as CompositionEvent;
      const empty = Reflect.construct(CompositionEvent, ['empty', null]) as CompositionEvent;
      return [reads, event.data, event.view === window, event.detail,
        event.bubbles, event.cancelable, event.composed, event.isTrusted, empty.data];
    })).toEqual([
      ['bubbles', 'cancelable', 'composed', 'detail', 'view', 'data', 'data.toString'],
      'text', true, 5, true, true, true, false, '',
    ]);
  });

  it('preserves DOMString text without Unicode normalization or scalar-value replacement', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [undefined, null, '', 5, false, 'e\u0301', '\ud800', '\udc00', '\ud83d\ude42'].map((data) =>
        (Reflect.construct(CompositionEvent, ['compositionupdate', { data }]) as CompositionEvent).data);
    })).toEqual(['', 'null', '', '5', 'false', 'e\u0301', '\ud800', '\udc00', '\ud83d\ude42']);
  });

  it('propagates data conversion failures without replacing the exception', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const sentinel = new Error('data conversion');
      const data = { toString() { throw sentinel; } };
      try { Reflect.construct(CompositionEvent, ['compositionupdate', { data }]); return false; }
      catch (error) { return error === sentinel; }
    })).toBe(true);
  });

  it('checks constructor call shape and invalid dictionary inputs in the constructor realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const invalid = [[], [Symbol()], ['compositionstart', 1], ['compositionstart', { data: Symbol() }],
        ['compositionstart', { view: {} }]].map((args) => {
        try { Reflect.construct(CompositionEvent, args); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      let requiresNew = false;
      try { Reflect.apply(CompositionEvent, null, ['compositionstart']); }
      catch (error) { requiresNew = error instanceof TypeError; }
      return [invalid, requiresNew];
    })).toEqual([Array<boolean>(5).fill(true), true]);
  });

  it('checks getter and initializer receivers before converting arguments', () => {
    const browser = new Browlet({ route: () => '' });
    const prototype = browser.window.CompositionEvent.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'data')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    const realm = getRelevantRealm(browser.window);
    for (const receiver of [{}, new browser.window.Event('probe'), new browser.window.UIEvent('probe')]) {
      expect(() => { descriptor.get!.call(receiver); }).toThrow(realm.TypeError);
      const type = { toString() { throw new Error('must check receiver first'); } };
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the original method's receiver validation.
        Reflect.apply(prototype.initCompositionEvent, receiver, [type]);
      }).toThrow(realm.TypeError);
    }
  });

  it('preserves event ownership and supplied view across borrowed getters and initialization', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = new owner.window.CompositionEvent('compositionstart', { data: 'old', view: other.window });
    const data = Object.getOwnPropertyDescriptor(other.window.CompositionEvent.prototype, 'data')!;
    const view = Object.getOwnPropertyDescriptor(other.window.UIEvent.prototype, 'view')!;
    expect(data.get!.call(event)).toBe('old');
    expect(view.get!.call(event)).toBe(other.window);
    other.window.CompositionEvent.prototype.initCompositionEvent.call(event, 'after', false, true, owner.window, 'new');
    expect(event.data).toBe('new');
    expect(event.view).toBe(owner.window);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('supports author subclasses', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      class Derived extends CompositionEvent {}
      const event = new Derived('compositionupdate', { data: 'text' });
      return [event instanceof Derived, event instanceof CompositionEvent, event instanceof UIEvent,
        event instanceof Event, Object.getPrototypeOf(event) === Derived.prototype, event.data];
    })).toEqual([true, true, true, true, true, 'text']);
  });

  it('creates an uninitialized CompositionEvent using DOM\'s singular legacy name', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('cOmPoSiTiOnEvEnT') as CompositionEvent;
      let uninitialized = false;
      try { document.dispatchEvent(event); }
      catch (error) { uninitialized = error instanceof DOMException && error.name === 'InvalidStateError'; }
      let rejectsPlural = false;
      try { document.createEvent('CompositionEvents'); }
      catch (error) { rejectsPlural = error instanceof DOMException && error.name === 'NotSupportedError'; }
      const before = [event instanceof CompositionEvent, event.type, event.data, event.view, event.isTrusted];
      event.initCompositionEvent('compositionstart');
      return [before, uninitialized, rejectsPlural, document.dispatchEvent(event), event.data];
    })).toEqual([[true, '', '', null, false], true, true, true, '']);
  });

  it('uses the specified legacy DOMString default and preserves explicitly supplied text', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new CompositionEvent('compositionstart', { data: 'old' });
      return [[], [undefined], [null], [''], ['e\u0301'], ['\ud800'], [5]].map((args) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply deliberately unconverted arguments through Web IDL.
        Reflect.apply(event.initCompositionEvent, event, ['changed', true, true, window, ...args]);
        return [event.data, event.view === window];
      });
    })).toEqual(['', '', 'null', '', 'e\u0301', '\ud800', '5'].map((data) => [data, true]));
  });

  it('resets DOM/UI fields and data without changing the timestamp', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new CompositionEvent('compositionstart', {
        data: 'old', view: window, detail: 7, bubbles: true, cancelable: true, composed: true,
      });
      const timeStamp = event.timeStamp;
      document.dispatchEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      event.initCompositionEvent('changed', false, true, window, 'new');
      const first = [event.type, event.data, event.view === window, event.detail,
        event.bubbles, event.cancelable, event.composed, event.target, event.defaultPrevented,
        event.isTrusted, event.timeStamp === timeStamp];
      let calls = 0;
      document.addEventListener('changed', () => { calls++; }, { once: true });
      document.dispatchEvent(event);
      event.initCompositionEvent('reset');
      return [first, calls, event.type, event.data, event.view, event.detail, event.bubbles, event.cancelable];
    })).toEqual([
      ['changed', 'new', true, 0, false, true, true, null, false, false, true],
      1, 'reset', '', null, 0, false, false,
    ]);
  });

  it('converts initializer arguments before the dispatch guard without changing the active event', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const event = new CompositionEvent('compositionupdate', { data: 'old', detail: 5 });
      document.addEventListener('compositionupdate', () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Observe conversion before the initializer's dispatch guard.
        Reflect.apply(event.initCompositionEvent, event, [
          { toString() { reads.push('type'); return 'changed'; } }, true, true, window,
          { toString() { reads.push('data'); return 'new'; } },
        ]);
      }, { once: true });
      document.dispatchEvent(event);
      return [reads, event.type, event.data, event.view, event.detail, event.bubbles, event.cancelable];
    })).toEqual([['type', 'data'], 'compositionupdate', 'old', null, 5, false, false]);
  });

  it('retains composition text through inherited initializers', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new CompositionEvent('compositionupdate', { data: 'text' });
      event.initUIEvent('after', true, true, window, 5);
      event.initEvent('final');
      return [event.type, event.data, event.view === window, event.detail];
    })).toEqual(['final', 'text', true, 5]);
  });

  it('delivers synthetic listeners and cancellation without starting, ending, or editing a composition', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('contenteditable', 'true');
      element.textContent = 'before';
      document.body.append(element);
      const order: string[] = [];
      for (const type of ['beforeinput', 'input', 'compositionupdate']) {
        element.addEventListener(type, () => { order.push(type); });
      }
      element.addEventListener('compositionstart', (event) => { order.push(event.type); event.preventDefault(); });
      element.addEventListener('compositionend', (event) => { order.push(event.type); });
      document.addEventListener('compositionstart', () => { order.push('bubble'); }, { once: true });
      const results = ['compositionend', 'compositionstart'].map((type) => element.dispatchEvent(
        new CompositionEvent(type, { data: 'replacement', bubbles: true, cancelable: true }),
      ));
      order.push('returned');
      return [results, order, element.textContent, new KeyboardEvent('keydown').isComposing,
        new InputEvent('beforeinput').isComposing];
    })).toEqual([[true, false], ['compositionend', 'compositionstart', 'bubble', 'returned'], 'before', false, false]);
  });

  it('delivers host-created composition notifications through the existing factory', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      document.body.addEventListener('compositionupdate', (event) => {
        Reflect.set(window, 'received', [event instanceof CompositionEvent, event.data, event.view === window,
          event.isTrusted, event.target === document.body, event.bubbles, event.cancelable, event.composed]);
      }, { once: true });
    });
    const target = unwrap<ElementImpl>(browser.document.body!);
    expect(target.fireEvent('compositionupdate', CompositionEventImpl, (composition) => {
      composition.data = 'text';
      composition.view = getRelevantRealm(browser.window).env.window;
      composition.setFlags({ bubbles: true, composed: true });
    })).toBe(true);
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown))
      .toEqual([true, 'text', true, true, true, true, false, true]);
  });
});
