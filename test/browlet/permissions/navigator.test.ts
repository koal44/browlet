import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Permissions §6.1: Navigator permissions identity', () => {
  it.each(['https://example.test/', 'http://example.test/'])('exposes a stable, read-only Permissions object at %s', async (url) => {
    const browser = await createBrowser(url);
    expect(await browser.evaluate(() => {
      const permissions = navigator.permissions;
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'permissions')!;
      let illegalConstructor = false;
      let illegalReceiver = false;
      try { Reflect.construct(Permissions, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      try { descriptor.get!.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
      return {
        sameObject: permissions === navigator.permissions && permissions === window.clientInformation.permissions,
        branded: permissions instanceof Permissions,
        prototype: Object.getPrototypeOf(permissions) === Permissions.prototype,
        tag: Object.prototype.toString.call(permissions),
        getterOnly: typeof descriptor.get === 'function' && descriptor.set === undefined,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        replaced: Reflect.set(navigator, 'permissions', {}),
        retained: navigator.permissions === permissions,
        illegalConstructor,
        illegalReceiver,
        secure: isSecureContext,
      };
    })).toEqual({
      sameObject: true, branded: true, prototype: true, tag: '[object Permissions]',
      getterOnly: true, enumerable: true, configurable: true, replaced: false, retained: true,
      illegalConstructor: true, illegalReceiver: true, secure: url.startsWith('https:'),
    });
    const env = getRelevantRealm(browser.window).env;
    expect(unwrap(browser.window.navigator.permissions)).toBe(env.permissions);
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('uses the receiver realm even when its first read borrows another realm\'s getter', async () => {
    const first = await createBrowser();
    const second = await createBrowser();
    const descriptor = Object.getOwnPropertyDescriptor(second.window.Navigator.prototype, 'permissions')!;

    const permissions = descriptor.get!.call(first.window.navigator) as object;

    expect(permissions).toBe(first.window.navigator.permissions);
    expect(permissions).not.toBe(second.window.navigator.permissions);
    expect(Object.getPrototypeOf(permissions)).toBe(first.window.Permissions.prototype);
    expect(getRelevantRealm(permissions)).toBe(getRelevantRealm(first.window));
  });

  it('keeps the same object after decisions change and replaces it with a new Navigator after navigation', async () => {
    const browser = await createBrowser();
    const previousNavigator = browser.window.navigator;
    const permissions = previousNavigator.permissions;
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(browser.window.navigator.permissions).toBe(permissions);
    env.userAgent.permissionStore.revoke({ name: 'persistent-storage' }, env.origin);
    expect(browser.window.navigator.permissions).toBe(permissions);

    await browser.navigate('https://example.test/second');

    expect(browser.window.navigator).not.toBe(previousNavigator);
    expect(browser.window.navigator.permissions).not.toBe(permissions);
    expect(previousNavigator.permissions).toBe(permissions);
    expect(getRelevantRealm(browser.window.navigator.permissions)).toBe(getRelevantRealm(browser.window));
    expect(await browser.evaluate(() => navigator.permissions === navigator.permissions)).toBe(true);
  });
});

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}
