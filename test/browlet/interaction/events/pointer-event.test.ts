import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { PointerEventImpl } from '../../../../src/browlet/interaction/events/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('Pointer Events: event objects', () => {
  it('inherits MouseEvent and supplies constructor defaults without native pointer state', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new PointerEvent('pointermove');
      return {
        data: [event.pointerId, event.width, event.height, event.pressure, event.tangentialPressure,
          event.tiltX, event.tiltY, event.twist, event.altitudeAngle, event.azimuthAngle,
          event.pointerType, event.isPrimary, event.persistentDeviceId],
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        mouse: [event.view, event.detail, event.button, event.buttons, event.which, event.relatedTarget],
        inheritance: [event instanceof PointerEvent, event instanceof MouseEvent, event instanceof UIEvent,
          event instanceof Event, Object.getPrototypeOf(PointerEvent.prototype) === MouseEvent.prototype],
        tag: Object.prototype.toString.call(event), length: PointerEvent.length,
        predicted: event.getPredictedEvents().length, timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      data: [0, 1, 1, 0, 0, 0, 0, 0, Math.PI / 2, 0, '', false, 0],
      flags: [false, false, false, false], mouse: [null, 0, 0, 0, 1, null],
      inheritance: [true, true, true, true, true], tag: '[object PointerEvent]', length: 1,
      predicted: 0, timeStamp: true,
    });
  });

  it('converts numeric widths and inherited data without enforcing hardware ranges on author input', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = Reflect.construct(PointerEvent, ['pointerdown', {
        pointerId: 2 ** 32 + 5, persistentDeviceId: 2 ** 31, width: -2, height: '3.5',
        pressure: 0.1, tangentialPressure: -2, twist: 730, pointerType: 'custom\ud800', isPrimary: 'yes',
        clientX: 3.25, clientY: -4.75, buttons: 1, ctrlKey: true, relatedTarget: document, view: window,
      }]) as PointerEvent;
      return [event.pointerId, event.persistentDeviceId, event.width, event.height,
        event.pressure, event.tangentialPressure, event.twist, event.pointerType, event.isPrimary,
        event.clientX, event.clientY, event.buttons, event.ctrlKey, event.relatedTarget === document,
        event.view === window, new PointerEvent('pointerdown', { buttons: 1 }).pressure];
    })).toEqual([5, -2147483648, -2, 3.5, Math.fround(0.1), -2, 730, 'custom\ud800', true,
      3.25, -4.75, 1, true, true, true, 0]);
  });

  it('reads own dictionary members once in lexical order after inherited members', async () => {
    const browser = new Browlet({ route: () => '' });
    const result = await browser.evaluate(() => {
      const reads: string[] = [];
      const init = new Proxy({}, { get(_target, key) { reads.push(String(key)); return key === 'tiltX' ? 45 : undefined; } });
      const event = new PointerEvent('probe', init);
      return { reads, tilt: [event.tiltX, event.tiltY], angles: [event.altitudeAngle, event.azimuthAngle] };
    });
    expect(result.reads.slice(-15)).toEqual(['altitudeAngle', 'azimuthAngle', 'coalescedEvents', 'height', 'isPrimary',
      'persistentDeviceId', 'pointerId', 'pointerType', 'predictedEvents', 'pressure', 'tangentialPressure',
      'tiltX', 'tiltY', 'twist', 'width']);
    expect(new Set(result.reads).size).toBe(result.reads.length);
    expect(result.tilt).toEqual([45, 0]);
    expect(result.angles).toEqual([Math.PI / 4, 0]);
  });

  it('rejects nonfinite floating-point input and finite values that overflow float', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const inputs = ['width', 'height', 'pressure', 'tangentialPressure', 'altitudeAngle', 'azimuthAngle']
        .flatMap((key) => [NaN, Infinity, -Infinity].map((value) => ({ [key]: value })));
      inputs.push({ pressure: 1e40 }, { tangentialPressure: -1e40 });
      return inputs.map((init) => {
        try { new PointerEvent('probe', init); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    })).toEqual(Array<boolean>(20).fill(true));
  });

  it('preserves fractional coordinates except for the three compatibility event types', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => ['pointermove', 'pointerdown', 'probe', 'click', 'auxclick', 'contextmenu'].map((type) => {
      const event = new PointerEvent(type, { screenX: 3.75, screenY: -4.25, clientX: 1.75, clientY: -2.25 });
      const before = [event.screenX, event.screenY, event.clientX, event.clientY];
      event.initEvent(type === 'click' ? 'pointermove' : 'click');
      return [before, [event.screenX, event.screenY, event.clientX, event.clientY]];
    }))).toEqual([
      ...Array.from({ length: 3 }, () => [[3.75, -4.25, 1.75, -2.25], [3.75, -4.25, 1.75, -2.25]]),
      ...Array.from({ length: 3 }, () => [[3, -5, 1, -3], [3, -5, 1, -3]]),
    ]);
  });

  it('derives spherical angles from plane tilts, including axes and horizontal transducers', async () => {
    const browser = new Browlet({ route: () => '' });
    const cases = [
      [0, 0, Math.PI / 2, 0], [0, 45, Math.PI / 4, Math.PI / 2], [0, -45, Math.PI / 4, 3 * Math.PI / 2],
      [45, 0, Math.PI / 4, 0], [-45, 0, Math.PI / 4, Math.PI],
      [90, 0, 0, 0], [-90, 0, 0, Math.PI], [0, 90, 0, Math.PI / 2], [0, -90, 0, 3 * Math.PI / 2],
      [90, 90, 0, 0], [-90, 90, 0, 0], [90, -90, 0, 0], [-90, -90, 0, 0],
      [45, 45, Math.atan(1 / Math.sqrt(2)), Math.PI / 4],
      [-45, -45, Math.atan(1 / Math.sqrt(2)), 5 * Math.PI / 4],
    ];
    const results = await browser.evaluate((cases) => cases.map(([tiltX, tiltY]) => {
      const event = new PointerEvent('probe', { tiltX, tiltY });
      return [event.tiltX, event.tiltY, event.altitudeAngle, event.azimuthAngle];
    }), cases);
    for (let i = 0; i < cases.length; i++) {
      expect(results[i]!.slice(0, 2)).toEqual(cases[i]!.slice(0, 2));
      expect(results[i]![2]).toBeCloseTo(cases[i]![2]!, 12);
      expect(results[i]![3]).toBeCloseTo(cases[i]![3]!, 12);
    }
  });

  it('derives integer tilts from spherical angles with exact horizontal-axis handling', async () => {
    const browser = new Browlet({ route: () => '' });
    const cases = [
      [0, 0, 90, 0], [0, Math.PI / 2, 0, 90], [0, Math.PI, -90, 0], [0, 3 * Math.PI / 2, 0, -90],
      [0, 2 * Math.PI, 90, 0], [0, Math.PI / 4, 90, 90], [0, 3 * Math.PI / 4, -90, 90],
      [0, 5 * Math.PI / 4, -90, -90], [0, 7 * Math.PI / 4, 90, -90],
      [Math.PI / 4, 0, 45, 0], [Math.PI / 4, Math.PI / 2, 0, 45],
      [Math.PI / 4, Math.PI, -45, 0], [Math.PI / 4, 3 * Math.PI / 2, 0, -45],
      [Math.PI / 2, 1, 0, 0], [Math.PI / 4, Math.PI / 4, 35, 35],
    ];
    expect(await browser.evaluate((cases) => cases.map(([altitudeAngle, azimuthAngle]) => {
      const event = new PointerEvent('probe', { altitudeAngle, azimuthAngle });
      return [event.altitudeAngle, event.azimuthAngle, event.tiltX, event.tiltY];
    }), cases)).toEqual(cases);
  });

  it('distinguishes absent orientation members from explicit zero and mixed representations', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => [{}, { tiltX: undefined }, { tiltX: 45 }, { tiltY: -45 },
      { altitudeAngle: 0 }, { azimuthAngle: Math.PI / 2 }, { tiltX: 45, altitudeAngle: Math.PI / 3 },
      { tiltY: 30, azimuthAngle: Math.PI }, { tiltX: 0, tiltY: 0, altitudeAngle: 0, azimuthAngle: 1 },
      { altitudeAngle: null }].map((init) => {
      const event = Reflect.construct(PointerEvent, ['probe', init]) as PointerEvent;
      return [event.tiltX, event.tiltY, event.altitudeAngle, event.azimuthAngle];
    }))).toEqual([
      [0, 0, Math.PI / 2, 0], [0, 0, Math.PI / 2, 0], [45, 0, Math.PI / 4, 0], [0, -45, Math.PI / 4, 3 * Math.PI / 2],
      [90, 0, 0, 0], [0, 0, Math.PI / 2, Math.PI / 2], [45, 0, Math.PI / 3, 0],
      [0, 30, Math.PI / 2, Math.PI], [0, 0, 0, 1], [90, 0, 0, 0],
    ]);
  });

  it('wraps only calculation inputs for out-of-range orientation without loops proportional to the input', async () => {
    const browser = new Browlet({ route: () => '' });
    const result = await browser.evaluate(() => {
      const tilt = new PointerEvent('probe', { tiltX: 100, tiltY: -181 });
      const angles = new PointerEvent('probe', { altitudeAngle: -2, azimuthAngle: 8 });
      const large = new PointerEvent('probe', { altitudeAngle: 1e300, azimuthAngle: -1e300 });
      return {
        tilt: [tilt.tiltX, tilt.tiltY, tilt.altitudeAngle, tilt.azimuthAngle],
        angles: [angles.tiltX, angles.tiltY, angles.altitudeAngle, angles.azimuthAngle],
        large: [large.altitudeAngle, large.azimuthAngle,
          Number.isInteger(large.tiltX) && Math.abs(large.tiltX) <= 90,
          Number.isInteger(large.tiltY) && Math.abs(large.tiltY) <= 90],
      };
    });
    expect(result.tilt.slice(0, 2)).toEqual([100, -181]);
    expect(result.tilt[2]).toBeCloseTo(0.17453211522903106, 12);
    expect(result.tilt[3]).toBeCloseTo(3.144670442768206, 12);
    expect(result.angles).toEqual([-4, 24, -2, 8]);
    expect(result.large).toEqual([1e300, -1e300, true, true]);
  });

  it('exposes coalesced access only in secure contexts while predicted access remains available', async () => {
    const browser = new Browlet({ route: () => '' });
    const results: unknown[] = [];
    for (const url of ['http://pointer.test/', 'https://pointer.test/']) {
      await browser.navigate(url);
      results.push(await browser.evaluate(() => [isSecureContext, typeof PointerEvent.prototype.getCoalescedEvents,
        typeof PointerEvent.prototype.getPredictedEvents]));
    }
    expect(results).toEqual([[false, 'undefined', 'function'], [true, 'function', 'function']]);
  });

  it('copies the lists, retains repeated event identities, and returns fresh sequence arrays', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://pointer.test/');
    expect(await browser.evaluate(() => {
      const first = new PointerEvent('first', { pointerId: 9 });
      const second = new PointerEvent('second', { pointerId: 8, predictedEvents: [first] });
      const input = [second, first, second];
      const event = new PointerEvent('pointerup', { pointerId: 2, coalescedEvents: input, predictedEvents: input });
      input.length = 0;
      const coalesced = event.getCoalescedEvents();
      const predicted = event.getPredictedEvents();
      const before = [coalesced !== predicted, coalesced !== event.getCoalescedEvents(),
        predicted !== event.getPredictedEvents(), coalesced instanceof Array, predicted instanceof Array,
        coalesced[0] === second, coalesced[1] === first, coalesced[2] === second];
      coalesced.reverse();
      coalesced.length = 0;
      predicted.length = 0;
      document.dispatchEvent(event);
      return [before, event.getCoalescedEvents().length, event.getPredictedEvents().length,
        second.target, second.pointerId, second.getPredictedEvents()[0] === first, second.isTrusted,
        event.target === document];
    })).toEqual([Array<boolean>(8).fill(true), 3, 3, null, 8, true, false, true]);
  });

  it('converts sequences from iterables and rejects non-PointerEvent entries, including author proxies', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://pointer.test/');
    expect(await browser.evaluate(() => {
      const child = new PointerEvent('child');
      const event = Reflect.construct(PointerEvent, ['probe', { predictedEvents: new Set([child]) }]) as PointerEvent;
      const failures = ['coalescedEvents', 'predictedEvents'].flatMap((key) =>
        [null, [null], [{}], [new MouseEvent('probe')], [new Event('probe')], [new Proxy(child, {})]].map((value) => {
          try { Reflect.construct(PointerEvent, ['probe', { [key]: value }]); return false; }
          catch (error) { return error instanceof TypeError; }
        }));
      return [event.getPredictedEvents()[0] === child, failures];
    })).toEqual([true, Array<boolean>(12).fill(true)]);
  });

  it('allocates borrowed-method arrays in the receiver realm without moving contained events', async () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    await owner.navigate('https://pointer.test/');
    await other.navigate('https://pointer.test/');
    const child = new other.window.PointerEvent('child');
    const event = new owner.window.PointerEvent('probe', { coalescedEvents: [child], predictedEvents: [child] });
    const coalesced = other.window.PointerEvent.prototype.getCoalescedEvents.call(event);
    const predicted = other.window.PointerEvent.prototype.getPredictedEvents.call(event);
    expect(Object.getPrototypeOf(coalesced)).toBe(getRelevantRealm(owner.window).Array.prototype);
    expect(Object.getPrototypeOf(predicted)).toBe(getRelevantRealm(owner.window).Array.prototype);
    expect(coalesced[0]).toBe(child);
    expect(predicted[0]).toBe(child);
    expect(getRelevantRealm(child)).toBe(getRelevantRealm(other.window));
    const getter = Object.getOwnPropertyDescriptor(other.window.PointerEvent.prototype, 'pointerId')!;
    expect(getter.get!.call(event)).toBe(0);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
  });

  it('keeps the copied implementation lists independent of caller-owned arrays', () => {
    const child = new PointerEventImpl('child');
    const input = [child];
    const event = new PointerEventImpl('probe', { coalescedEvents: input, predictedEvents: input });
    input.length = 0;
    expect(event.getCoalescedEvents()).toEqual([child]);
    expect(event.getPredictedEvents()).toEqual([child]);
    expect(event.getCoalescedEvents()).not.toBe(event.getPredictedEvents());
  });

  it('does not rewrite sample trust when an author redispatches the containing event', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://pointer.test/');
    const child = new browser.window.PointerEvent('sample');
    const event = new browser.window.PointerEvent('pointermove', { coalescedEvents: [child], predictedEvents: [child] });
    // Simulate a host-created event at the author-redispatch boundary, not a native producer.
    unwrap<PointerEventImpl>(child).isTrusted = true;
    unwrap<PointerEventImpl>(event).isTrusted = true;
    browser.document.dispatchEvent(event);
    expect(event.isTrusted).toBe(false);
    expect(event.getCoalescedEvents()[0]!.isTrusted).toBe(true);
    expect(event.getPredictedEvents()[0]!.isTrusted).toBe(true);
  });

  it('checks receiver brands, supports subclasses, and rejects legacy factory names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      class Derived extends PointerEvent {}
      const event = new Derived('probe', { pointerId: 5 });
      const descriptor = Object.getOwnPropertyDescriptor(PointerEvent.prototype, 'pointerId')!;
      const receivers = [{}, new Event('probe'), new MouseEvent('probe')].map((receiver) => {
        try { descriptor.get!.call(receiver); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      const names = ['PointerEvent', 'PointerEvents'].map((name) => {
        try { document.createEvent(name); return false; }
        catch (error) { return error instanceof DOMException && error.name === 'NotSupportedError'; }
      });
      return [event instanceof Derived, event instanceof MouseEvent, event.pointerId,
        descriptor.set === undefined, descriptor.enumerable, descriptor.configurable, receivers, names];
    })).toEqual([true, true, 5, true, true, true, [true, true, true], [true, true]]);
  });

  it('preserves pointer data and lists when using inherited legacy mouse initialization', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const child = new PointerEvent('child');
      const event = new PointerEvent('pointermove', {
        pointerId: 5, pointerType: 'pen', tiltX: 45, clientX: 3.5, predictedEvents: [child],
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- lib.dom still requires the optional legacy arguments.
      Reflect.apply(event.initMouseEvent, event, ['changed']);
      return [event.type, event.pointerId, event.pointerType, event.tiltX, event.altitudeAngle,
        event.clientX, event.getPredictedEvents()[0] === child];
    })).toEqual(['changed', 5, 'pen', 45, Math.PI / 4, 0, true]);
  });
});
