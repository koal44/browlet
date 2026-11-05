import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { ClipboardEventImpl } from '../../../../src/browlet/interaction/clipboard/index';
import type { DataTransferImpl } from '../../../../src/browlet/interaction/drag-drop/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §5.1: ClipboardEvent', () => {
  it('inherits Event and defaults to null data without inferring type-specific flags', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new ClipboardEvent('paste');
      return {
        type: event.type, data: event.clipboardData,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        inheritance: [event instanceof ClipboardEvent, event instanceof Event,
          Object.getPrototypeOf(ClipboardEvent.prototype) === Event.prototype],
        target: event.target, timeStamp: Number.isFinite(event.timeStamp),
        length: ClipboardEvent.length, tag: Object.prototype.toString.call(event),
      };
    })).toEqual({
      type: 'paste', data: null, flags: [false, false, false, false], inheritance: [true, true, true],
      target: null, timeStamp: true, length: 1, tag: '[object ClipboardEvent]',
    });
  });

  it('uses null for omitted/null dictionaries and missing/null/undefined clipboardData', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const inits = [undefined, null, {}, { clipboardData: null }, { clipboardData: undefined }];
      return inits.map((init) => (Reflect.construct(ClipboardEvent, ['copy', init]) as ClipboardEvent).clipboardData);
    })).toEqual([null, null, null, null, null]);
  });

  it('retains the supplied transfer and reflects later item changes without cloning the store', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const transfer = new DataTransfer(); transfer.setData('text', 'before');
      const file = new File(['file'], 'a.txt'); transfer.items.add(file);
      const init = { clipboardData: transfer, bubbles: true, cancelable: true, composed: true };
      const event = new ClipboardEvent('copy', init);
      init.clipboardData = new DataTransfer(); init.bubbles = false;
      transfer.setData('text', 'after');
      return {
        same: event.clipboardData === transfer, stable: event.clipboardData === event.clipboardData,
        data: event.clipboardData!.getData('text'), file: event.clipboardData!.files[0] === file,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
      };
    })).toEqual({ same: true, stable: true, data: 'after', file: true, flags: [true, true, true, false] });
  });

  it('reads inherited dictionary members before clipboardData and ignores undeclared legacy options', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const reads: string[] = []; const transfer = new DataTransfer();
      const event = new ClipboardEvent('cut', new Proxy({}, {
        get(_target, key) {
          reads.push(String(key));
          return key === 'clipboardData' ? transfer : true;
        },
      }));
      const legacy = Reflect.construct(ClipboardEvent, ['copy', { data: 'old', dataType: 'text/plain' }]) as ClipboardEvent;
      return { reads, same: event.clipboardData === transfer, legacy: legacy.clipboardData };
    })).toEqual({ reads: ['bubbles', 'cancelable', 'composed', 'clipboardData'], same: true, legacy: null });
  });

  it('requires construction and a type, and validates the converted DataTransfer interface', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const transfer = new DataTransfer();
      const checks: (() => void)[] = [
        () => { Reflect.apply(ClipboardEvent, undefined, ['copy']); },
        () => { Reflect.construct(ClipboardEvent, []); },
        () => { Reflect.construct(ClipboardEvent, [Symbol()]); },
        ...[{}, 1, new Blob(), new Proxy(transfer, {})].map((clipboardData) => () => {
          Reflect.construct(ClipboardEvent, ['copy', { clipboardData }]);
        }),
      ];
      return checks.map((check) => { try { check(); return false; } catch (error) { return error instanceof TypeError; } });
    })).toEqual(Array(7).fill(true));
  });

  it('performs type conversion before the dictionary and keeps arbitrary DOMString event names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const order: string[] = [];
      const type = { toString() { order.push('type'); return 'custom\ud800'; } };
      const init = { get clipboardData() { order.push('data'); return null; } };
      const event = Reflect.construct(ClipboardEvent, [type, init]) as ClipboardEvent;
      return [order, event.type];
    })).toEqual([['type', 'data'], 'custom\ud800']);
  });

  it('exposes a readonly data getter with receiver validation', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new ClipboardEvent('copy');
      const descriptor = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData')!;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately invoke the getter with an invalid receiver.
      const getter = descriptor.get!;
      let invalid = false;
      try { Reflect.apply(getter, {}, []); } catch (error) { invalid = error instanceof TypeError; }
      return [typeof getter, descriptor.set === undefined, descriptor.enumerable, descriptor.configurable,
        Reflect.set(event, 'clipboardData', new DataTransfer()), event.clipboardData, invalid];
    })).toEqual(['function', true, true, true, false, null, true]);
  });

  it('preserves clipboardData through legacy initEvent without exposing a legacy factory name', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const transfer = new DataTransfer();
      const event = new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true });
      event.preventDefault(); event.initEvent('renamed', true, false);
      const legacy = ['ClipboardEvent', 'clipboardevent', 'CLIPBOARDEVENT'].map((name) => {
        try { document.createEvent(name); return ''; } catch (error) { return (error as DOMException).name; }
      });
      return { data: event.clipboardData === transfer, type: event.type, flags: [event.bubbles, event.cancelable, event.defaultPrevented], legacy };
    })).toEqual({ data: true, type: 'renamed', flags: [true, false, false], legacy: Array(3).fill('NotSupportedError') });
  });

  it.each(['copy', 'cut', 'paste'])('delivers synthetic %s through existing handlers without editing the selection', async (type) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((type) => {
      const target = document.createElement('div'); target.setAttribute('contenteditable', 'true');
      target.textContent = 'unchanged'; document.body.append(target);
      const range = document.createRange(); range.selectNodeContents(target);
      const selection = document.getSelection()!; selection.addRange(range);
      const transfer = new DataTransfer(); transfer.setData('text', 'supplied');
      const trace: unknown[] = [];
      Reflect.set(target, 'on' + type, function(event: ClipboardEvent) {
        trace.push(['handler', event.clipboardData === transfer, event.isTrusted]);
        event.clipboardData!.setData('text', 'listener');
      });
      document.addEventListener(type, (event) => { trace.push(['document', event.target === target]); }, { once: true });
      const event = new ClipboardEvent(type, { clipboardData: transfer, bubbles: true, cancelable: true, composed: true });
      const result = target.dispatchEvent(event);
      return {
        result, trace, text: target.textContent, selected: range.toString(), sameRange: selection.getRangeAt(0) === range,
        data: event.clipboardData === transfer, value: transfer.getData('text'),
      };
    }, type)).toEqual({
      result: true, trace: [['handler', true, false], ['document', true]], text: 'unchanged', selected: 'unchanged',
      sameRange: true, data: true, value: 'listener',
    });
  });

  it('honors cancellation by an existing content handler and retains author data after dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = document.createElement('div'); document.body.append(target);
      target.setAttribute('onpaste', 'event.clipboardData.setData("text", "handled"); return false;');
      const transfer = new DataTransfer(); const event = new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true });
      const result = target.dispatchEvent(event); transfer.setData('after', 'available');
      return [result, event.defaultPrevented, transfer.getData('text'), event.clipboardData!.getData('after')];
    })).toEqual([false, true, 'handled', 'available']);
  });

  it('keeps clipboard data identity through shadow retargeting', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      const inner = document.createElement('span'); host.attachShadow({ mode: 'closed' }).append(inner);
      const transfer = new DataTransfer(); const trace: boolean[][] = [];
      inner.addEventListener('paste', (event) => { trace.push([event.target === inner, event.clipboardData === transfer]); });
      host.addEventListener('paste', (event) => { trace.push([event.target === host, event.clipboardData === transfer]); });
      const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, composed: true });
      inner.dispatchEvent(event);
      return { trace, same: event.clipboardData === transfer };
    })).toEqual({ trace: [[true, true], [true, true]], same: true });
  });

  it('keeps shared transfer identity while cancellation state remains per event', () => {
    const browser = new Browlet({ route: () => '' }); const { window } = browser;
    const transfer = new window.DataTransfer();
    const first = new window.ClipboardEvent('copy', { clipboardData: transfer, cancelable: true });
    const second = new window.ClipboardEvent('copy', { clipboardData: transfer, cancelable: true });
    first.preventDefault(); transfer.setData('text', 'shared');
    expect([first.defaultPrevented, second.defaultPrevented]).toEqual([true, false]);
    expect(first.clipboardData).toBe(second.clipboardData); expect(second.clipboardData!.getData('text')).toBe('shared');
    expect(new window.ClipboardEvent('paste').clipboardData).toBeNull();
  });

  it('retains foreign DataTransfer/File realms when an event or data getter belongs to another realm', () => {
    const first = new Browlet({ route: () => '' }); const second = new Browlet({ route: () => '' });
    const transfer = new second.window.DataTransfer(); const file = new second.window.File(['x'], 'x'); transfer.items.add(file);
    const event = new first.window.ClipboardEvent('paste', { clipboardData: transfer });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately borrow the other realm's getter.
    const getter = Object.getOwnPropertyDescriptor(second.window.ClipboardEvent.prototype, 'clipboardData')!.get!;
    expect(Reflect.apply(getter, event, [])).toBe(transfer); expect(event.clipboardData!.files[0]).toBe(file);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(first.window));
    expect(getRelevantRealm(event.clipboardData!)).toBe(getRelevantRealm(second.window));
    expect(getRelevantRealm(file)).toBe(getRelevantRealm(second.window));
  });

  it('uses the event constructor realm for its timestamp', () => {
    const browser = new Browlet({ route: () => '' }); const realm = getRelevantRealm(browser.window);
    vi.spyOn(realm, 'eventTimeStamp').mockReturnValue(12.5);
    expect(new browser.window.ClipboardEvent('copy').timeStamp).toBe(12.5);
  });

  it('supports the existing typed trusted-event factory without implying a native clipboard action', async () => {
    const browser = new Browlet({ route: () => '' });
    const transfer = new browser.window.DataTransfer(); transfer.setData('text', 'host-supplied');
    await browser.evaluate(() => {
      document.addEventListener('copy', (event) => {
        const clipboard = event;
        Reflect.set(window, 'received', [clipboard instanceof ClipboardEvent, clipboard.isTrusted,
          clipboard.clipboardData!.getData('text')]);
      }, { once: true });
    });
    const target = getRelevantRealm(browser.window).env.window.getAssociatedDocument();
    const empty = target.createTrustedEvent(ClipboardEventImpl);
    expect(empty.clipboardData).toBeNull(); expect(empty.isTrusted).toBe(true);
    target.fireEvent('copy', ClipboardEventImpl, (event) => { event.clipboardData = unwrap<DataTransferImpl>(transfer); });
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown)).toEqual([true, true, 'host-supplied']);
    expect(transfer.getData('text')).toBe('host-supplied');
  });
});
