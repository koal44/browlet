import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { ClipboardChangeEventImpl } from '../../../../src/browlet/interaction/clipboard/index';
import type { ClipboardChangeEvent, Window } from '../../../../src/browlet/platform';
import { getRelevantRealm, project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §5.2.1: ClipboardChangeEvent data', () => {
  it('inherits Event with empty data and no inferred native flags', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const event = new ClipboardChangeEvent('clipboardchange');
      return {
        type: event.type, types: [...event.types], changeId: event.changeId,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        inheritance: [event instanceof ClipboardChangeEvent, event instanceof Event,
          Object.getPrototypeOf(ClipboardChangeEvent.prototype) === Event.prototype],
        frozen: Object.isFrozen(event.types), stable: event.types === event.types,
        realm: Object.getPrototypeOf(event.types) === Array.prototype,
        target: event.target, timeStamp: Number.isFinite(event.timeStamp),
        length: ClipboardChangeEvent.length, tag: Object.prototype.toString.call(event),
      };
    })).toEqual({
      type: 'clipboardchange', types: [], changeId: 0n, flags: [false, false, false, false],
      inheritance: [true, true, true], frozen: true, stable: true, realm: true,
      target: null, timeStamp: true, length: 1, tag: '[object ClipboardChangeEvent]',
    });
  });

  it('defaults omitted/null dictionaries and undefined members without sharing arrays between events', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const events = [undefined, null, {}, { types: undefined, changeId: undefined }].map((init) =>
        Reflect.construct(ClipboardChangeEvent, ['custom', init]) as ClipboardChangeEvent);
      return {
        values: events.map((event) => [[...event.types], event.changeId]),
        distinct: new Set(events.map((event) => event.types)).size,
      };
    })).toEqual({ values: Array.from({ length: 4 }, () => [[], 0n]), distinct: 4 });
  });

  it('clones types and retains supplied spelling, duplicates, UTF-16 text and arbitrary bigint values', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const types = ['TEXT/PLAIN', 'custom', 'custom', '\ud800', ''];
      const init = { types, changeId: -(1n << 160n), bubbles: true, cancelable: true, composed: true };
      const event = new ClipboardChangeEvent('custom\ud800', init);
      types[0] = 'changed'; types.push('late'); init.changeId = 2n; init.bubbles = false;
      return {
        type: event.type, types: [...event.types], changeId: event.changeId,
        copied: event.types !== types, flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
      };
    })).toEqual({
      type: 'custom\ud800', types: ['TEXT/PLAIN', 'custom', 'custom', '\ud800', ''], changeId: -(1n << 160n),
      copied: true, flags: [true, true, true, false],
    });
  });

  it('converts type, inherited dictionary members, bigint and iterable strings in IDL order', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const order: string[] = [];
      const type = { toString() { order.push('type'); return 'custom'; } };
      const init = new Proxy({}, {
        get(_target, key) {
          order.push(String(key));
          if (key === 'changeId') return { [Symbol.toPrimitive](hint: string) { order.push(hint); return '12'; } };
          if (key === 'types') return new Set([23, { toString() { order.push('entry'); return 'TEXT'; } }]);
          return true;
        },
      });
      const event = Reflect.construct(ClipboardChangeEvent, [type, init]) as ClipboardChangeEvent;
      return { order, types: [...event.types], changeId: event.changeId, flags: [event.bubbles, event.cancelable, event.composed] };
    })).toEqual({
      order: ['type', 'bubbles', 'cancelable', 'composed', 'changeId', 'number', 'types', 'entry'],
      types: ['23', 'TEXT'], changeId: 12n, flags: [true, true, true],
    });
  });

  it('requires new and a type, and rejects invalid sequence and bigint inputs in the constructor realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const checks: (() => void)[] = [
        () => { Reflect.apply(ClipboardChangeEvent, undefined, ['clipboardchange']); },
        () => { Reflect.construct(ClipboardChangeEvent, []); },
        () => { Reflect.construct(ClipboardChangeEvent, [Symbol()]); },
        ...[null, 'text/plain', {}, [Symbol()]].map((types) => () => {
          Reflect.construct(ClipboardChangeEvent, ['clipboardchange', { types }]);
        }),
        ...[null, 0, 3.5, Symbol()].map((changeId) => () => {
          Reflect.construct(ClipboardChangeEvent, ['clipboardchange', { changeId }]);
        }),
      ];
      return checks.map((check) => { try { check(); return false; } catch (error) { return error instanceof TypeError; } });
    })).toEqual(Array(11).fill(true));
  });

  it('accepts bigint-compatible booleans and strings without imposing native identifier limits', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      return [true, false, '', '-17', '0xffff', 1n << 160n].map((changeId) =>
        (Reflect.construct(ClipboardChangeEvent, ['clipboardchange', { changeId }]) as ClipboardChangeEvent).changeId);
    })).toEqual([1n, 0n, 0n, -17n, 65535n, 1n << 160n]);
  });

  it('propagates conversion failures before reading later dictionary fields', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const sentinel = new Error('conversion sentinel'); let typesRead = false; let exact = false; let syntax = false;
      try {
        Reflect.construct(ClipboardChangeEvent, ['clipboardchange', {
          get changeId() { throw sentinel; }, get types() { typesRead = true; return []; },
        }]);
      } catch (error) { exact = error === sentinel; }
      try { Reflect.construct(ClipboardChangeEvent, ['clipboardchange', { changeId: 'fraction.5' }]); }
      catch (error) { syntax = error instanceof SyntaxError; }
      return { exact, typesRead, syntax };
    })).toEqual({ exact: true, typesRead: false, syntax: true });
  });

  it('provides readonly attributes, frozen elements and branded getters', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const event = new ClipboardChangeEvent('clipboardchange', { types: ['text/plain'], changeId: 8n });
      const attributes = ['types', 'changeId'].map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(ClipboardChangeEvent.prototype, name)!;
        let invalid = false;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately invoke the getter with an invalid receiver.
        try { Reflect.apply(descriptor.get!, new Event('unrelated'), []); }
        catch (error) { invalid = error instanceof TypeError; }
        return [descriptor.set === undefined, descriptor.enumerable, descriptor.configurable,
          Reflect.set(event, name, null), invalid];
      });
      const writes = [Reflect.set(event.types, '0', 'changed'), Reflect.set(event.types, 'length', 0)];
      return { attributes, writes, types: [...event.types], changeId: event.changeId };
    })).toEqual({
      attributes: [[true, true, true, false, true], [true, true, true, false, true]],
      writes: [false, false], types: ['text/plain'], changeId: 8n,
    });
  });

  it('preserves data and array identity across initEvent without adding a legacy factory name', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const event = new ClipboardChangeEvent('clipboardchange', { types: ['x'], changeId: 3n, cancelable: true });
      const types = event.types;
      event.preventDefault(); event.initEvent('renamed', true, false);
      let legacy = '';
      try { document.createEvent('ClipboardChangeEvent'); } catch (error) { legacy = (error as DOMException).name; }
      return {
        same: event.types === types, types: [...event.types], changeId: event.changeId,
        type: event.type, flags: [event.bubbles, event.cancelable, event.defaultPrevented], legacy,
      };
    })).toEqual({ same: true, types: ['x'], changeId: 3n, type: 'renamed', flags: [true, false, false], legacy: 'NotSupportedError' });
  });

  it('dispatches supplied data with ordinary DOM cancellation and shadow retargeting', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const { ClipboardChangeEvent } = window as unknown as Window;
      const host = document.createElement('div'); document.body.append(host);
      const inner = document.createElement('span'); host.attachShadow({ mode: 'closed' }).append(inner);
      const event = new ClipboardChangeEvent('clipboardchange', {
        types: ['text/plain'], changeId: 41n, bubbles: true, composed: true, cancelable: true,
      });
      const types = event.types; const trace: unknown[] = [];
      inner.addEventListener('clipboardchange', (received) => {
        trace.push([received.target === inner, received === event]);
      });
      host.addEventListener('clipboardchange', (received) => {
        const change = received as unknown as ClipboardChangeEvent;
        trace.push([change.target === host, change.types === types, change.changeId, change.isTrusted]);
        change.preventDefault();
      });
      return { accepted: inner.dispatchEvent(event), trace, same: event.types === types, target: event.target === host };
    })).toEqual({ accepted: false, trace: [[true, true], [true, true, 41n, false]], same: true, target: true });
  });

  it('exposes the synthetic constructor on both insecure and secure Window globals', async () => {
    const results: unknown[] = [];
    for (const url of ['http://clipboard.test/', 'https://clipboard.test/']) {
      const browser = new Browlet({ route: () => '' }); await browser.navigate(url);
      results.push(await browser.evaluate(() => {
        const { ClipboardChangeEvent } = window as unknown as Window;
        return [isSecureContext, typeof ClipboardChangeEvent, new ClipboardChangeEvent('custom').type];
      }));
    }
    expect(results).toEqual([[false, 'function', 'custom'], [true, 'function', 'custom']]);
  });

  it('allocates the frozen array in the receiver realm even when another realm supplies the getter or input', () => {
    const first = new Browlet({ route: () => '' }); const second = new Browlet({ route: () => '' });
    const firstRealm = getRelevantRealm(first.window); const secondRealm = getRelevantRealm(second.window);
    const input = new secondRealm.Array<string>('text/plain');
    const event = new first.window.ClipboardChangeEvent('clipboardchange', { types: input });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately borrow the other realm's getter.
    const getter = Object.getOwnPropertyDescriptor(second.window.ClipboardChangeEvent.prototype, 'types')!.get!;
    const borrowed = Reflect.apply(getter, event, []) as readonly string[];
    expect(borrowed).toBe(event.types); expect(borrowed).not.toBe(input);
    expect(Object.getPrototypeOf(borrowed)).toBe(firstRealm.Array.prototype);
    expect(Object.getPrototypeOf(borrowed)).not.toBe(secondRealm.Array.prototype);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(first.window));
  });

  it('uses the constructor realm timestamp and supports DOM internal event allocation', () => {
    const browser = new Browlet({ route: () => '' }); const realm = getRelevantRealm(browser.window);
    vi.spyOn(realm, 'eventTimeStamp').mockReturnValue(12.5);
    expect(new browser.window.ClipboardChangeEvent('clipboardchange').timeStamp).toBe(12.5);
    const target = realm.env.window.getAssociatedDocument();
    const event = target.createTrustedEvent(ClipboardChangeEventImpl);
    expect([event.isTrusted, event.changeId, event.types]).toEqual([true, 0n, []]);
    const platform = project(event) as ClipboardChangeEvent;
    expect(platform.types).toBe(platform.types); expect(Object.isFrozen(platform.types)).toBe(true);
    // Generic allocation does not perform Clipboard's native notification algorithm.
  });
});
