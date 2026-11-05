import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { TextEventImpl } from '../../../../src/browlet/interaction/events/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { TextEvent as TextEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('UI Events §8.4: TextEvent', () => {
  it('exposes a nonconstructible interface and creates uninitialized legacy events', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('TextEvent');
      const errors: string[] = [];
      try { Reflect.construct(TextEvent, []); }
      catch (error) { if (error instanceof TypeError) errors.push('constructor'); }
      try { Reflect.apply(TextEvent, null, []); }
      catch (error) { if (error instanceof TypeError) errors.push('call'); }
      try { document.dispatchEvent(event); }
      catch (error) { if (error instanceof DOMException) errors.push(error.name); }
      return {
        type: event.type, data: event.data, view: event.view, detail: event.detail, which: event.which,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        inheritance: [event instanceof TextEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(TextEvent.prototype) === UIEvent.prototype],
        tag: Object.prototype.toString.call(event), timeStamp: Number.isFinite(event.timeStamp),
        lengths: [TextEvent.length, TextEvent.prototype.initTextEvent.length], errors,
      };
    })).toEqual({
      type: '', data: '', view: null, detail: 0, which: 0, flags: [false, false, false, false],
      inheritance: [true, true, true, true], tag: '[object TextEvent]', timeStamp: true,
      lengths: [0, 1], errors: ['constructor', 'call', 'InvalidStateError'],
    });
  });

  it('matches only the singular factory name case-insensitively and retains the Document realm', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    for (const name of ['TextEvent', 'textevent', 'TEXTEVENT']) {
      const event = other.document.createEvent.call(owner.document, name);
      expect(event).toBeInstanceOf(owner.window.TextEvent);
      expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.document));
    }
    expect(() => owner.document.createEvent('TextEvents')).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
  });

  it('uses the literal undefined default and preserves DOMString text', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('TextEvent');
      return [[], [undefined], [null], [''], [5], [false], ['e\u0301'], ['\ud800'], ['\udc00'], ['\ud83d\ude42']]
        .map((args) => {
          // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise Web IDL conversion of author-supplied text.
          Reflect.apply(event.initTextEvent, event, ['textInput', true, true, window, ...args]);
          return [event.data, event.view === window, event.detail, event.bubbles, event.cancelable];
        });
    })).toEqual(['undefined', 'undefined', 'null', '', '5', 'false', 'e\u0301', '\ud800', '\udc00', '\ud83d\ude42']
      .map((data) => [data, true, 0, true, true]));
  });

  it('converts all arguments before mutating the event and propagates conversion failures', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('TextEvent');
      const reads: string[] = [];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Observe conversion order and failed initialization.
      const initialize = event.initTextEvent;
      Reflect.apply(initialize, event, [
        { toString() { reads.push('type'); return 'textInput'; } }, 1, 'yes', window,
        { toString() { reads.push('data'); return 'retained'; } },
      ]);
      const sentinel = new Error('data conversion');
      let sameError = false;
      try { Reflect.apply(initialize, event, ['changed', false, false, null, { toString() { throw sentinel; } }]); }
      catch (error) { sameError = error === sentinel; }
      const invalid = [[], [Symbol()], ['changed', false, false, {}], ['changed', false, false, null, Symbol()]]
        .map((args) => {
          try { Reflect.apply(initialize, event, args); return false; }
          catch (error) { return error instanceof TypeError; }
        });
      return [reads, sameError, invalid, event.type, event.data, event.view === window,
        event.bubbles, event.cancelable];
    })).toEqual([['type', 'data'], true, [true, true, true, true], 'textInput', 'retained', true, true, true]);
  });

  it('checks getter and initializer receivers before converting arguments', () => {
    const browser = new Browlet({ route: () => '' });
    const prototype = browser.window.TextEvent.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'data')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    const realm = getRelevantRealm(browser.window);
    for (const receiver of [{}, new browser.window.Event('probe'), new browser.window.UIEvent('probe'),
      new browser.window.CompositionEvent('probe')]) {
      expect(() => { descriptor.get!.call(receiver); }).toThrow(realm.TypeError);
      const type = { toString() { throw new Error('must check receiver first'); } };
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the original method's receiver validation.
        Reflect.apply(prototype.initTextEvent, receiver, [type]);
      }).toThrow(realm.TypeError);
    }
  });

  it('preserves event ownership and supplied view across borrowed getters and initialization', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const event = owner.document.createEvent('TextEvent') as TextEventPlatform;
    other.window.TextEvent.prototype.initTextEvent.call(event, 'textInput', true, true, other.window, 'text');
    const data = Object.getOwnPropertyDescriptor(other.window.TextEvent.prototype, 'data')!;
    const view = Object.getOwnPropertyDescriptor(other.window.UIEvent.prototype, 'view')!;
    expect(data.get!.call(event)).toBe('text');
    expect(view.get!.call(event)).toBe(other.window);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('resets event state and detail without replacing the timestamp', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('TextEvent');
      event.initTextEvent('textInput', true, true, window, 'old');
      event.initUIEvent('before', true, true, window, 9);
      document.dispatchEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      const timeStamp = event.timeStamp;
      event.initTextEvent('after');
      const reset = [event.type, event.data, event.view, event.detail, event.bubbles, event.cancelable,
        event.target, event.defaultPrevented, event.cancelBubble, event.isTrusted, event.timeStamp === timeStamp];
      let calls = 0;
      document.addEventListener('after', () => { calls++; }, { once: true });
      document.dispatchEvent(event);
      return [reset, calls];
    })).toEqual([['after', 'undefined', null, 0, false, false, null, false, false, false, true], 1]);
  });

  it('converts initializer arguments before the dispatch guard without changing the active event', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('TextEvent');
      event.initTextEvent('textInput', true, true, window, 'old');
      const reads: string[] = [];
      document.addEventListener('textInput', () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Observe conversion before the initializer's dispatch guard.
        Reflect.apply(event.initTextEvent, event, [
          { toString() { reads.push('type'); return 'changed'; } }, false, false, null,
          { toString() { reads.push('data'); return 'new'; } },
        ]);
        event.preventDefault();
      }, { once: true });
      const result = document.dispatchEvent(event);
      return [result, reads, event.type, event.data, event.view === window, event.bubbles, event.cancelable];
    })).toEqual([false, ['type', 'data'], 'textInput', 'old', true, true, true]);
  });

  it('retains text through inherited initializers', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('TextEvent');
      event.initTextEvent('textInput', false, false, null, 'retained');
      event.initUIEvent('after', true, true, window, 5);
      event.initEvent('final');
      return [event.type, event.data, event.view === window, event.detail];
    })).toEqual(['final', 'retained', true, 5]);
  });

  it('dispatches synthetic events synchronously without editing or producing other input events', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('contenteditable', 'true');
      element.textContent = 'before';
      document.body.append(element);
      const order: string[] = [];
      for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
        element.addEventListener(type, () => { order.push(type); });
      }
      element.addEventListener('textInput', (event) => {
        order.push(event.type);
        if (event.cancelable) event.preventDefault();
      });
      document.addEventListener('textInput', () => { order.push('bubble'); });
      const results = [false, true].map((cancelable) => {
        const event = document.createEvent('TextEvent');
        event.initTextEvent('textInput', true, cancelable, window, 'replacement');
        return [element.dispatchEvent(event), event.isTrusted];
      });
      order.push('returned');
      return [results, order, element.textContent];
    })).toEqual([[[true, false], [false, false]], ['textInput', 'bubble', 'textInput', 'bubble', 'returned'], 'before']);
  });

  it('projects internally created events and retains composed while reinitialization clears trust', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      document.body.addEventListener('textInput', (event) => {
        const text = event as TextEvent;
        const before = [text instanceof TextEvent, text.data, text.view === window,
          text.isTrusted, text.target === document.body, text.bubbles, text.cancelable, text.composed];
        text.preventDefault();
        Reflect.set(window, 'received', before);
        Reflect.set(window, 'receivedText', text);
      }, { once: true });
    });
    const target = unwrap<ElementImpl>(browser.document.body!);
    expect(target.fireEvent('textInput', TextEventImpl, (text) => {
      text.data = 'text';
      text.view = getRelevantRealm(browser.window).env.window;
      text.setFlags({ bubbles: true, cancelable: true, composed: true });
    })).toBe(false);
    expect(await browser.evaluate(() => {
      const event = Reflect.get(window, 'receivedText') as TextEvent;
      event.initTextEvent('reset');
      return [Reflect.get(window, 'received') as unknown,
        event.data, event.composed, event.isTrusted, event.target, event.defaultPrevented];
    })).toEqual([[true, 'text', true, true, true, true, true, true], 'undefined', true, false, null, false]);
  });
});
