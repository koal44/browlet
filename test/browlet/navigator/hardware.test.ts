import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('HTML §10.2.7 concurrent hardware capabilities', () => {
  it('exposes a positive integer through a read-only Navigator attribute', async () => {
    const browser = new Browlet({ route: () => '' });
    const result = await browser.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency')!;
      let invalidReceiver = false;
      try { descriptor.get!.call({}); } catch (error) { invalidReceiver = error instanceof TypeError; }
      return {
        value: navigator.hardwareConcurrency,
        sameAlias: navigator.hardwareConcurrency === clientInformation.hardwareConcurrency,
        getterOnly: typeof descriptor.get === 'function' && descriptor.set === undefined,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        replaced: Reflect.set(navigator, 'hardwareConcurrency', 0),
        ownsAttribute: Object.hasOwn(navigator, 'hardwareConcurrency'),
        exposesMixin: Reflect.has(globalThis, 'NavigatorConcurrentHardware'),
        invalidReceiver,
      };
    });
    expect(Number.isInteger(result.value)).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(1);
    expect(result).toMatchObject({
      sameAlias: true, getterOnly: true, enumerable: true, configurable: true,
      replaced: false, ownsAttribute: false, exposesMixin: false, invalidReceiver: true,
    });
  });

  it('uses the receiver browser when borrowing another Window\'s getter', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    vi.spyOn(getRelevantRealm(first.window).env.userAgent, 'hardwareConcurrency', 'get').mockReturnValue(1);
    vi.spyOn(getRelevantRealm(second.window).env.userAgent, 'hardwareConcurrency', 'get').mockReturnValue(2);
    const descriptor = Object.getOwnPropertyDescriptor(second.window.Navigator.prototype, 'hardwareConcurrency')!;

    expect(second.window.navigator.hardwareConcurrency).toBe(2);
    expect(descriptor.get!.call(first.window.navigator)).toBe(1);
  });
});
