import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { WheelEventImpl } from '../../../../src/browlet/interaction/events/index';
import type { WheelEvent as WheelEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('Pointer Events: WheelEvent', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('inherits MouseEvent and defaults data without inferring native wheel flags', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const event = new WheelEvent('wheel');
      return {
        type: event.type, deltas: [event.deltaX, event.deltaY, event.deltaZ], mode: event.deltaMode,
        momentum: Reflect.get(event, 'momentum') as boolean,
        view: event.view, detail: event.detail, relatedTarget: event.relatedTarget,
        coordinates: [event.screenX, event.screenY, event.clientX, event.clientY],
        buttons: [event.button, event.buttons, event.which],
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        inheritance: [event instanceof MouseEvent, event instanceof UIEvent, event instanceof Event,
          Object.getPrototypeOf(WheelEvent.prototype) === MouseEvent.prototype],
        tag: Object.prototype.toString.call(event), length: WheelEvent.length,
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'wheel', deltas: [0, 0, 0], mode: 0, momentum: false,
      view: null, detail: 0, relatedTarget: null, coordinates: [0, 0, 0, 0], buttons: [0, 0, 1],
      flags: [false, false, false, false], inheritance: [true, true, true, true],
      tag: '[object WheelEvent]', length: 1, timeStamp: true,
    });
  });

  it('exposes the three non-writable unit constants on constructor, prototype, and instances', () => {
    const browser = prepared();
    const ctor = browser.window.WheelEvent;
    const event = new ctor('wheel');
    for (const [key, value] of [['DOM_DELTA_PIXEL', 0], ['DOM_DELTA_LINE', 1], ['DOM_DELTA_PAGE', 2]] as const) {
      for (const owner of [ctor, ctor.prototype]) {
        expect(Object.getOwnPropertyDescriptor(owner, key)).toEqual({
          value, enumerable: true, configurable: false, writable: false,
        });
      }
      expect(event[key]).toBe(value);
      expect(Object.hasOwn(event, key)).toBe(false);
    }
  });

  it('converts wheel and inherited mouse data once and retains it independently of the dictionary', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const init = {
        deltaX: '1.25', deltaY: -2.5, deltaZ: '3.75', deltaMode: 2 ** 32 + 1, momentum: 'inertia',
        screenX: 4.5, screenY: -4.5, clientX: 6.75, clientY: -6.75, button: 2, buttons: 5,
        ctrlKey: true, view: window, relatedTarget: document, detail: 3,
        bubbles: 1, cancelable: {}, composed: 'yes',
      };
      const event = Reflect.construct(WheelEvent, ['wheel', init]) as WheelEvent;
      init.deltaY = 99;
      init.ctrlKey = false;
      return {
        deltas: [event.deltaX, event.deltaY, event.deltaZ], mode: event.deltaMode,
        momentum: Reflect.get(event, 'momentum') as boolean,
        coordinates: [event.screenX, event.screenY, event.clientX, event.clientY],
        buttons: [event.button, event.buttons, event.which], ctrl: event.getModifierState('Control'),
        inherited: [event.view === window, event.relatedTarget === document, event.detail],
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
      };
    })).toEqual({
      deltas: [1.25, -2.5, 3.75], mode: 1, momentum: true, coordinates: [4, -5, 6, -7],
      buttons: [2, 5, 3], ctrl: true, inherited: [true, true, 3], flags: [true, true, true, false],
    });
  });

  it('reads inherited dictionary members before the alphabetically ordered wheel members', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const reads: string[] = [];
      const observed = new Set(['view', 'buttons', 'deltaX', 'deltaY', 'deltaZ', 'deltaMode', 'momentum']);
      new WheelEvent('wheel', new Proxy({}, {
        get(_target, key) {
          if (typeof key === 'string' && observed.has(key)) reads.push(key);
          return undefined;
        },
      }));
      return reads;
    })).toEqual(['view', 'buttons', 'deltaMode', 'deltaX', 'deltaY', 'deltaZ', 'momentum']);
  });

  it('preserves full double precision and signed zero on every delta axis', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const values = [-0, 1.123456789012345, Number.MIN_VALUE, 1e100, -1e100];
      return values.map((value) => {
        const event = new WheelEvent('wheel', { deltaX: value, deltaY: value, deltaZ: value });
        return [event.deltaX, event.deltaY, event.deltaZ].every((delta) => Object.is(delta, value));
      });
    })).toEqual([true, true, true, true, true]);
  });

  it('uses unsigned-long conversion for deltaMode without converting or clamping deltas', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() =>
      [-1, 0, 1, 2, 3, 4.9, NaN, Infinity, 2 ** 32 + 2].map((deltaMode) => {
        const event = new WheelEvent('wheel', { deltaMode, deltaY: 2.5 });
        return [event.deltaMode, event.deltaY];
      }),
    )).toEqual([[4294967295, 2.5], [0, 2.5], [1, 2.5], [2, 2.5], [3, 2.5], [4, 2.5], [0, 2.5], [0, 2.5], [2, 2.5]]);
  });

  it('rejects nonfinite and invalid numeric inputs in the constructor realm', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      return ['deltaX', 'deltaY', 'deltaZ'].flatMap((key) =>
        [NaN, Infinity, -Infinity, 1n, Symbol('delta')].map((value) => {
          try { Reflect.construct(WheelEvent, ['wheel', { [key]: value }]); return false; }
          catch (error) { return error instanceof TypeError; }
        }));
    })).toEqual(Array<boolean>(15).fill(true));
  });

  it('uses ordinary dictionary defaults and boolean conversion for momentum', () => {
    const browser = prepared();
    for (const init of [undefined, null, {}]) {
      const event = Reflect.construct(browser.window.WheelEvent, ['wheel', init]) as WheelEventPlatform;
      expect([event.deltaX, event.deltaY, event.deltaZ, event.deltaMode, event.momentum]).toEqual([0, 0, 0, 0, false]);
    }
    for (const [input, expected] of [[0, false], [null, false], ['', false], [1, true], ['yes', true], [{}, true]]) {
      const event = Reflect.construct(browser.window.WheelEvent, ['wheel', { momentum: input }]) as WheelEventPlatform;
      expect(event.momentum).toBe(expected);
    }
  });

  it('supports subclasses and requires construction and an event type', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      class Derived extends WheelEvent {}
      const event = new Derived('custom', { deltaX: 5 });
      const rejected = [
        () => { Reflect.construct(WheelEvent, []); },
        () => { Reflect.apply(WheelEvent, undefined, ['wheel']); },
      ].map((call) => {
        try { call(); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      return [event instanceof Derived, event instanceof WheelEvent, event instanceof MouseEvent,
        event.type, event.deltaX, rejected];
    })).toEqual([true, true, true, 'custom', 5, [true, true]]);
  });

  it('preserves wheel fields and timestamps through all inherited legacy initializers', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      return ['initEvent', 'initUIEvent', 'initMouseEvent'].map((method) => {
        const event = Reflect.construct(WheelEvent, ['wheel', {
          deltaX: 1.25, deltaY: -2.5, deltaZ: 3.75, deltaMode: 2, momentum: true,
        }]) as WheelEvent;
        const timestamp = event.timeStamp;
        Reflect.apply(Reflect.get(event, method) as CallableFunction, event, ['changed']);
        return [event.type, event.deltaX, event.deltaY, event.deltaZ, event.deltaMode,
          Reflect.get(event, 'momentum') as boolean, event.timeStamp === timestamp];
      });
    })).toEqual(Array.from({ length: 3 }, () => ['changed', 1.25, -2.5, 3.75, 2, true, true]));
  });

  it('does not add a legacy document factory name or an initWheelEvent method', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const rejected = ['WheelEvent', 'wheelevent', 'WheelEvents', 'MouseWheelEvent'].map((name) => {
        try { document.createEvent(name); return false; }
        catch (error) { return error instanceof DOMException && error.name === 'NotSupportedError'; }
      });
      return [rejected, 'initWheelEvent' in WheelEvent.prototype];
    })).toEqual([[true, true, true, true], false]);
  });

  it('dispatches through onwheel without converting deltas or making the event trusted', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const target = document.createElement('div');
      document.body.append(target);
      let seen: unknown[] = [];
      target.onwheel = (event) => {
        seen = [event instanceof WheelEvent, event.target === target, event.deltaY,
          event.deltaMode, event.isTrusted];
        return false;
      };
      const event = new WheelEvent('wheel', { deltaY: 2.5, deltaMode: 1, cancelable: true, bubbles: true });
      return [target.dispatchEvent(event), event.defaultPrevented, seen, event.deltaY];
    })).toEqual([false, true, [true, true, 2.5, 1, false], 2.5]);
  });

  it('retains DOM passive-listener cancellation rules for synthetic wheel events', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      const results: boolean[][] = [];
      const listener = (event: Event) => { event.preventDefault(); };
      for (const options of [{ once: true }, { once: true, passive: true }, { once: true, passive: false }]) {
        window.addEventListener('wheel', listener, options);
        const event = new WheelEvent('wheel', { cancelable: true });
        results.push([window.dispatchEvent(event), event.defaultPrevented]);
      }
      window.addEventListener('wheel', listener, { once: true, passive: false });
      const uncancelable = new WheelEvent('wheel');
      results.push([window.dispatchEvent(uncancelable), uncancelable.defaultPrevented]);
      return results;
    })).toEqual([[true, false], [true, false], [false, true], [true, false]]);
  });

  it('uses the existing host event factory without claiming native wheel processing', async () => {
    const browser = prepared();
    await browser.evaluate(() => {
      window.addEventListener('wheel', (event) => {
        Reflect.set(window, 'received', [event instanceof WheelEvent, event instanceof MouseEvent,
          event.deltaY, event.deltaMode, Reflect.get(event, 'momentum') as boolean,
          event.isTrusted, event.target === window]);
        event.preventDefault();
      }, { once: true, passive: false });
    });
    const target = getRelevantRealm(browser.window).env.window;
    expect(target.fireEvent('wheel', WheelEventImpl, (wheel) => {
      wheel.deltaY = 2.5;
      wheel.deltaMode = 1;
      wheel.momentum = true;
      wheel.setFlags({ cancelable: true });
    })).toBe(false);
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as unknown))
      .toEqual([true, true, 2.5, 1, true, true, true]);
  });
});

describe('Pointer Events: WheelEvent across environments', () => {
  const prepared = useFixture(() => [new Browlet({ route: () => '' }), new Browlet({ route: () => '' })] as const);

  it('checks getter brands and preserves event ownership across borrowed getters', () => {
    const owner = prepared()[0];
    const other = prepared()[1];
    const event = new owner.window.WheelEvent('wheel', { deltaY: -2.5, momentum: true, view: other.window });
    const otherRealm = getRelevantRealm(other.window);
    for (const [key, expected] of [['deltaX', 0], ['deltaY', -2.5], ['deltaZ', 0], ['deltaMode', 0], ['momentum', true]] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(other.window.WheelEvent.prototype, key)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(descriptor.get!.call(event)).toBe(expected);
      for (const receiver of [{}, new other.window.MouseEvent('wheel'), new Proxy(event, {})]) {
        expect(() => { descriptor.get!.call(receiver); }).toThrow(otherRealm.TypeError);
      }
    }
    expect(event.view).toBe(other.window);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    expect(() => new other.window.WheelEvent('wheel', { deltaX: Infinity })).toThrow(otherRealm.TypeError);
  });
});
