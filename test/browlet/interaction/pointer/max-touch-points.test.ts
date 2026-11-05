import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('Pointer Events §6: Navigator.maxTouchPoints', () => {
  it.each(['https://example.test/', 'http://example.test/'])('exposes a read-only attribute at %s', async (url) => {
    const browser = await createBrowser(url);
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env.userAgent, 'getMaxTouchPoints').mockReturnValue(10);

    expect(await browser.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints')!;
      let illegalReceiver = false;
      try { descriptor.get!.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
      return {
        capacity: navigator.maxTouchPoints,
        alias: window.clientInformation.maxTouchPoints,
        own: Object.hasOwn(navigator, 'maxTouchPoints'),
        getterOnly: typeof descriptor.get === 'function' && descriptor.set === undefined,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        replaced: Reflect.set(navigator, 'maxTouchPoints', 99),
        retained: navigator.maxTouchPoints,
        illegalReceiver,
        secure: isSecureContext,
      };
    })).toEqual({
      capacity: 10, alias: 10, own: false, getterOnly: true,
      enumerable: true, configurable: true, replaced: false, retained: 10,
      illegalReceiver: true, secure: url.startsWith('https:'),
    });
  });

  it('reads current device capacity, including a known non-touch host', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const capacity = vi.spyOn(env.userAgent, 'getMaxTouchPoints').mockReturnValue(0);

    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(0);
    capacity.mockReturnValue(5);
    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(5);
    capacity.mockReturnValue(10);
    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(10);
    expect(capacity).toHaveBeenCalledTimes(3);
  });

  it('uses scoped emulation before querying hardware and resumes hardware queries when it clears', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    // The real hardware operation is unfinished; an override must bypass it entirely.
    const capacity = vi.spyOn(env.userAgent, 'getMaxTouchPoints');
    const emulation = vi.spyOn(env.userAgent, 'webDriverBiDiEmulatedMaxTouchPoints').mockReturnValue(5);

    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(5);
    expect(emulation).toHaveBeenLastCalledWith(env);
    expect(capacity).not.toHaveBeenCalled();
    emulation.mockReturnValue(10);
    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(10);
    expect(capacity).not.toHaveBeenCalled();

    emulation.mockReturnValue(null);
    capacity.mockReturnValue(2);
    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(2);
    expect(capacity).toHaveBeenCalledTimes(1);
  });

  it('does not confuse active contacts or constructed events with hardware capacity', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env.userAgent, 'getMaxTouchPoints').mockReturnValue(10);
    const pointer = env.userAgent.activePointers.activate('touch');

    expect(await browser.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', buttons: 1 }));
      return navigator.maxTouchPoints;
    })).toBe(10);
    env.userAgent.activePointers.deactivate(pointer);
    expect(await browser.evaluate(() => navigator.maxTouchPoints)).toBe(10);
  });

  it('uses the receiver environment when borrowing a getter from another Window', async () => {
    const first = await createBrowser();
    const second = await createBrowser();
    const firstEnv = getRelevantRealm(first.window).env;
    const secondEnv = getRelevantRealm(second.window).env;
    const firstEmulation = vi.spyOn(firstEnv.userAgent, 'webDriverBiDiEmulatedMaxTouchPoints').mockReturnValue(5);
    const secondEmulation = vi.spyOn(secondEnv.userAgent, 'webDriverBiDiEmulatedMaxTouchPoints').mockReturnValue(10);
    const descriptor = Object.getOwnPropertyDescriptor(second.window.Navigator.prototype, 'maxTouchPoints')!;

    expect(descriptor.get!.call(first.window.navigator)).toBe(5);
    expect(firstEmulation).toHaveBeenLastCalledWith(firstEnv);
    expect(secondEmulation).not.toHaveBeenCalled();
    expect(second.window.navigator.maxTouchPoints).toBe(10);
    expect(secondEmulation).toHaveBeenLastCalledWith(secondEnv);
  });

  it('retains each Navigator\'s environment after document replacement', async () => {
    const browser = await createBrowser();
    const previousNavigator = browser.window.navigator;
    const previousEnv = getRelevantRealm(browser.window).env;
    const emulation = vi.spyOn(previousEnv.userAgent, 'webDriverBiDiEmulatedMaxTouchPoints')
      .mockImplementation((env) => env === previousEnv ? 5 : 10);

    await browser.navigate('https://example.test/second');
    const env = getRelevantRealm(browser.window).env;
    expect(env).not.toBe(previousEnv);
    expect(browser.window.navigator.maxTouchPoints).toBe(10);
    expect(emulation).toHaveBeenLastCalledWith(env);
    expect(previousNavigator.maxTouchPoints).toBe(5);
    expect(emulation).toHaveBeenLastCalledWith(previousEnv);
  });
});

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}
