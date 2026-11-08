import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { InputEventImpl } from '../../../../src/browlet/interaction/events/index';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('UI Events: InputEvent', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it.each(['beforeinput', 'input'])('constructs %s with dictionary defaults rather than trusted-producer flags', async (type) => {
    const browser = prepared();
    expect(await browser.evaluate((type) => {
      const event = new InputEvent(type);
      return {
        type: event.type, data: event.data, isComposing: event.isComposing, inputType: event.inputType,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        ui: [event.view, event.detail],
        inheritance: [event instanceof InputEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(InputEvent.prototype) === UIEvent.prototype],
        tag: Object.prototype.toString.call(event), length: InputEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    }, type)).toEqual({
      type, data: null, isComposing: false, inputType: '', flags: [false, false, false, false], ui: [null, 0],
      inheritance: [true, true, true, true], tag: '[object InputEvent]', length: 1, timeStamp: true,
    });
  });

  it('converts inherited members first and own dictionary members in lexical order', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const values = {
        bubbles: 1, cancelable: 'yes', composed: {}, detail: '5.9', view: window,
        data: { toString() { reads.push('data.toString'); return 'text'; } },
        inputType: { toString() { reads.push('inputType.toString'); return 'insertText'; } },
        isComposing: {},
      };
      const init = new Proxy(values, {
        get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver) as unknown; },
      });
      const event = Reflect.construct(InputEvent, ['probe', init]) as InputEvent;
      const empty = Reflect.construct(InputEvent, ['empty', null]) as InputEvent;
      return {
        reads, flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        ui: [event.view === window, event.detail], data: [event.data, event.isComposing, event.inputType],
        empty: [empty.data, empty.isComposing, empty.inputType],
      };
    })).toEqual({
      reads: ['bubbles', 'cancelable', 'composed', 'detail', 'view', 'data', 'data.toString',
        'inputType', 'inputType.toString', 'isComposing'],
      flags: [true, true, true, false], ui: [true, 5], data: ['text', true, 'insertText'], empty: [null, false, ''],
    });
  });

  it('preserves nullable DOMString data, including decomposed text and lone surrogates', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      return [undefined, null, '', 5, false, 'e\u0301', '\ud800', '\udc00', '\ud83d\ude42'].map((data) =>
        (Reflect.construct(InputEvent, ['input', { data }]) as InputEvent).data);
    })).toEqual([null, null, '', '5', 'false', 'e\u0301', '\ud800', '\udc00', '\ud83d\ude42']);
  });

  it('preserves DOMString inputType after conversion without a known-operation filter', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      return [undefined, null, false, 5, '', 'insertText', 'insertFromPasteAsQuotation',
        'formatFontColor', 'vendorFuture', 'INSERTTEXT', '\ud800'].map((inputType) =>
        (Reflect.construct(InputEvent, ['input', { inputType }]) as InputEvent).inputType);
    })).toEqual(['', 'null', 'false', '5', '', 'insertText', 'insertFromPasteAsQuotation',
      'formatFontColor', 'vendorFuture', 'INSERTTEXT', '\ud800']);
  });

  it('propagates a data coercion failure before reading later members', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const sentinel = new Error('coercion');
      const reads: string[] = [];
      const init = {
        data: { toString() { reads.push('data'); throw sentinel; } },
        get inputType() { reads.push('inputType'); return 'insertText'; },
        get isComposing() { reads.push('isComposing'); return true; },
      };
      try { Reflect.construct(InputEvent, ['input', init]); return [false, reads]; }
      catch (error) { return [error === sentinel, reads]; }
    })).toEqual([true, ['data']]);
  });

  it('checks required arguments, call shape, and invalid inputs in the constructor realm', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const invalid = [[], [Symbol()], ['input', 1], ['input', { data: Symbol() }],
        ['input', { inputType: Symbol() }], ['input', { view: {} }]].map((args) => {
        try { Reflect.construct(InputEvent, args); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      let requiresNew = false;
      try { Reflect.apply(InputEvent, null, ['input']); }
      catch (error) { requiresNew = error instanceof TypeError; }
      return [invalid, requiresNew];
    })).toEqual([Array<boolean>(6).fill(true), true]);
  });

  it('exposes read-only attributes with InputEvent receiver checks', () => {
    const browser = prepared();
    for (const name of ['data', 'isComposing', 'inputType']) {
      const descriptor = Object.getOwnPropertyDescriptor(browser.window.InputEvent.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      for (const receiver of [{}, new browser.window.Event('probe'), new browser.window.UIEvent('probe')]) {
        expect(() => { descriptor.get!.call(receiver); }).toThrow(getRelevantRealm(browser.window).TypeError);
      }
    }
  });

  it('supports author subclasses', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      class Derived extends InputEvent {}
      const event = new Derived('input', { data: 'text', isComposing: true, inputType: 'insertText' });
      return [event instanceof Derived, event instanceof InputEvent, event instanceof UIEvent, event instanceof Event,
        Object.getPrototypeOf(event) === Derived.prototype, event.data, event.isComposing, event.inputType];
    })).toEqual([true, true, true, true, true, 'text', true, 'insertText']);
  });

  it('does not add InputEvent to DOM\'s legacy createEvent table', () => {
    const browser = prepared();
    expect(() => browser.document.createEvent('InputEvent')).toThrow(
      expect.objectContaining({ name: 'NotSupportedError' }),
    );
  });

  it('retains input-specific data through inherited legacy initialization', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const event = new InputEvent('beforeinput', { data: 'e\u0301', isComposing: true, inputType: 'vendorFuture' });
      const timeStamp = event.timeStamp;
      event.initUIEvent('after', true, true, window, 5);
      event.initEvent('final');
      return [event.type, event.data, event.isComposing, event.inputType, event.view === window,
        event.detail, event.timeStamp === timeStamp];
    })).toEqual(['final', 'e\u0301', true, 'vendorFuture', true, 5, true]);
  });

  it('dispatches cancellable synthetic beforeinput without editing or producing another event', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'before';
      document.body.append(editable);
      const order: string[] = [];
      editable.onbeforeinput = (event) => { order.push(event.type); event.preventDefault(); };
      editable.oninput = (event) => { order.push(event.type); };
      document.addEventListener('beforeinput', () => { order.push('document'); }, { once: true });
      const event = new InputEvent('beforeinput', {
        data: 'after', inputType: 'insertText', isComposing: true,
        bubbles: true, cancelable: true, composed: true,
      });
      const result = editable.dispatchEvent(event);
      return [result, event.defaultPrevented, event.isTrusted, editable.textContent, order,
        new InputEvent('input').isComposing];
    })).toEqual([false, true, false, 'before', ['beforeinput', 'document'], false]);
  });

  it('delivers a host-created InputEvent through the existing event factory', async () => {
    const browser = prepared();
    await browser.evaluate(() => {
      document.addEventListener('input', (input) => {
        Reflect.set(window, 'received', [input instanceof InputEvent, input.view === window,
          input.data, input.inputType, input.isComposing, input.isTrusted, input.target === document]);
      }, { once: true });
    });
    const env = getRelevantRealm(browser.document).env;
    const target = env.window.getAssociatedDocument();
    expect(target.fireEvent('input', InputEventImpl, (input) => {
      input.view = env.window;
      input.data = 'text';
      input.inputType = 'insertText';
      input.setFlags({ bubbles: true, composed: true });
    })).toBe(true);
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown))
      .toEqual([true, true, 'text', 'insertText', false, true, true]);
  });
});

describe('UI Events: InputEvent across environments', () => {
  const prepared = useFixture(() => [new Browlet({ route: () => '' }), new Browlet({ route: () => '' })] as const);

  it('keeps event ownership and the supplied view across borrowed getters', () => {
    const owner = prepared()[0];
    const other = prepared()[1];
    const event = new owner.window.InputEvent('input', {
      view: other.window, data: 'text', isComposing: true, inputType: 'insertText',
    });
    const data = Object.getOwnPropertyDescriptor(other.window.InputEvent.prototype, 'data')!;
    const view = Object.getOwnPropertyDescriptor(other.window.UIEvent.prototype, 'view')!;
    expect(data.get!.call(event)).toBe('text');
    expect(view.get!.call(event)).toBe(other.window);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });
});
