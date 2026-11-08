import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { getEnvironmentDefaultUserAgent } from '../../../src/fetch/headers';
import { parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

const identificationMembers = [
  'appCodeName', 'appName', 'appVersion', 'platform', 'product', 'productSub', 'userAgent', 'vendor', 'vendorSub',
] as const;

describe('HTML NavigatorID', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    return { browser, env, userAgent: env.userAgent };
  });

  it('exposes the selected Chrome compatibility values while identifying Browlet', async () => {
    expect(await prepared().browser.evaluate(() => ({
      appCodeName: navigator.appCodeName, appName: navigator.appName,
      appVersion: navigator.appVersion, platform: navigator.platform,
      product: navigator.product, productSub: navigator.productSub,
      userAgent: navigator.userAgent, vendor: navigator.vendor, vendorSub: navigator.vendorSub,
      alias: navigator === window.clientInformation, stable: navigator === window.navigator,
      ownMixinConstructor: 'NavigatorID' in globalThis,
      geckoOnly: 'oscpu' in navigator || 'taintEnabled' in navigator,
    }))).toEqual({
      appCodeName: 'Mozilla', appName: 'Netscape', appVersion: '5.0 (compatible; Browlet)', platform: 'Win32',
      product: 'Gecko', productSub: '20030107', userAgent: 'Mozilla/5.0 (compatible; Browlet)',
      vendor: 'Google Inc.', vendorSub: '', alias: true, stable: true, ownMixinConstructor: false, geckoOnly: false,
    });
  });

  it('uses ordinary readonly prototype attributes with receiver checks', async () => {
    const { browser, env } = prepared();
    const { window } = browser;
    for (const name of identificationMembers) {
      const descriptor = Object.getOwnPropertyDescriptor(window.Navigator.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(typeof descriptor.get).toBe('function');
      expect(Object.hasOwn(window.navigator, name)).toBe(false);
      expect(Reflect.set(window.navigator, name, 'author value')).toBe(false);
      expect(() => { descriptor.get!.call({}); }).toThrow(env.realm.TypeError);
      expect(() => { descriptor.get!.call(null); }).toThrow(env.realm.TypeError);
    }
    expect(await browser.evaluate(() => {
      try { Reflect.construct(Navigator, []); }
      catch (error) { return error instanceof TypeError; }
      return false;
    })).toBe(true);
  });

  it.each([
    ['Mozilla/5.0 (compatible; Browlet)', '5.0 (compatible; Browlet)'],
    ['Mozilla/5.0 (\u00e9)', '5.0 (\u00e9)'],
    ['Mozilla/5.0 (', '5.0 ('],
    ['Custom/1.0', ''],
    ['Mozilla/4.0 (compatible; Browlet)', ''],
    ['Mozilla/5.0 plain', ''],
    ['mozilla/5.0 (test)', ''],
    ['', ''],
  ])('derives appVersion from the exact HTML prefix in %j', (value, version) => {
    const { browser, userAgent, env } = prepared();
    userAgent.defaultUserAgentValue = value;
    expect(browser.window.navigator.userAgent).toBe(value);
    expect(browser.window.navigator.appVersion).toBe(version);
    expect(browser.window.navigator.userAgent).toBe(getEnvironmentDefaultUserAgent(env));
  });

  it('uses the current environment override, including an explicitly empty value', () => {
    const { browser, env, userAgent } = prepared();
    let emulation: string | null = 'Mozilla/5.0 (Emulated)';
    vi.spyOn(userAgent, 'webDriverBiDiEmulatedUserAgent').mockImplementation((queriedEnv) => {
      expect(queriedEnv).toBe(env);
      return emulation;
    });
    expect(browser.window.navigator.userAgent).toBe('Mozilla/5.0 (Emulated)');
    expect(browser.window.navigator.appVersion).toBe('5.0 (Emulated)');
    emulation = '';
    expect(browser.window.navigator.userAgent).toBe('');
    expect(browser.window.navigator.appVersion).toBe('');
    emulation = null;
    expect(browser.window.navigator.userAgent).toBe(userAgent.defaultUserAgentValue);
  });

  it('reads changed platform configuration without deriving it from the User-Agent text', () => {
    const { browser, userAgent } = prepared();
    userAgent.defaultUserAgentValue = 'Mozilla/5.0 (Macintosh; test)';
    expect(browser.window.navigator.platform).toBe('Win32');
    userAgent.navigatorPlatform = 'MacIntel';
    expect(browser.window.navigator.platform).toBe('MacIntel');
  });
});

describe('Navigator identification ownership', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const first = new Browlet({ route: () => '', userAgent: 'Mozilla/5.0 (First)' });
    const second = new Browlet({ route: () => '', userAgent: 'Mozilla/5.0 (Second)' });
    return { first, second };
  });

  it('keeps borrowed getters on the receiver environment and errors in the method realm', () => {
    const { first, second } = prepared();
    getRelevantRealm(first.window).env.userAgent.navigatorPlatform = 'First platform';
    getRelevantRealm(second.window).env.userAgent.navigatorPlatform = 'Second platform';
    for (const [name, expected] of [
      ['userAgent', 'Mozilla/5.0 (First)'], ['appVersion', '5.0 (First)'], ['platform', 'First platform'],
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(second.window.Navigator.prototype, name)!;
      expect(descriptor.get!.call(first.window.navigator)).toBe(expected);
      expect(() => { descriptor.get!.call({}); }).toThrow(getRelevantRealm(second.window).TypeError);
    }
    expect(first.window.navigator).not.toBe(second.window.navigator);
  });

  it('retains configuration after navigation and keeps the previous Navigator tied to its original environment', async () => {
    const { first } = prepared();
    const previous = first.window.navigator;
    const oldEnv = getRelevantRealm(first.window).env;
    const userAgent = oldEnv.userAgent;
    userAgent.navigatorPlatform = 'Configured platform';
    vi.spyOn(userAgent, 'webDriverBiDiEmulatedUserAgent')
      .mockImplementation((env) => env === oldEnv ? 'Mozilla/5.0 (Old override)' : null);
    await first.navigate('https://navigator.test/next');
    expect(first.window.navigator).not.toBe(previous);
    expect(first.window.navigator.userAgent).toBe('Mozilla/5.0 (First)');
    expect(first.window.navigator.appVersion).toBe('5.0 (First)');
    expect(first.window.navigator.platform).toBe('Configured platform');
    expect(previous.userAgent).toBe('Mozilla/5.0 (Old override)');
    expect(previous.appVersion).toBe('5.0 (Old override)');
  });
});

describe.each([false, true])('WorkerNavigator identification, shared: %s', (shared) => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '', userAgent: 'Mozilla/5.0 (Shared owner)' });
    const outsideEnv = getRelevantRealm(browser.window).env;
    const userAgent = outsideEnv.userAgent;
    const agent = userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) {
      throw new Error('Expected a dedicated or shared worker agent');
    }
    // Real worker settings and bindings; this slice does not start a worker thread or fetch its script.
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://navigator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'identification', credentials: 'same-origin', extendedLifetime: shared,
    });
    const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    return { browser, env, userAgent, scope };
  });

  it('shares configured identification while keeping Window-only attributes absent', () => {
    const { browser, scope, userAgent } = prepared();
    expect(scope.navigator).not.toBe(browser.window.navigator);
    expect(scope.navigator).toBe(scope.navigator);
    for (const name of ['appCodeName', 'appName', 'appVersion', 'platform', 'product', 'userAgent'] as const) {
      expect(scope.navigator[name]).toBe(browser.window.navigator[name]);
      expect(Reflect.set(scope.navigator, name, 'author value')).toBe(false);
    }
    for (const name of ['productSub', 'vendor', 'vendorSub', 'oscpu', 'taintEnabled']) {
      expect(Reflect.has(scope.navigator, name)).toBe(false);
    }
    expect(Reflect.has(scope, 'Navigator')).toBe(false);
    expect(Reflect.has(scope, 'NavigatorID')).toBe(false);
    userAgent.defaultUserAgentValue = 'Mozilla/5.0 (Updated)';
    userAgent.navigatorPlatform = 'MacIntel';
    expect(scope.navigator.userAgent).toBe('Mozilla/5.0 (Updated)');
    expect(scope.navigator.appVersion).toBe('5.0 (Updated)');
    expect(scope.navigator.platform).toBe('MacIntel');
  });

  it('selects emulation from the worker environment rather than its creator', () => {
    const { browser, scope, env, userAgent } = prepared();
    vi.spyOn(userAgent, 'webDriverBiDiEmulatedUserAgent')
      .mockImplementation((queriedEnv) => queriedEnv === env ? 'Mozilla/5.0 (Worker override)' : 'Window override');
    expect(scope.navigator.userAgent).toBe('Mozilla/5.0 (Worker override)');
    expect(scope.navigator.appVersion).toBe('5.0 (Worker override)');
    expect(browser.window.navigator.userAgent).toBe('Window override');
    expect(browser.window.navigator.appVersion).toBe('');
  });

  it('rejects borrowing identification getters between different including interfaces', () => {
    const { browser, scope, env } = prepared();
    const windowDescriptor = Object.getOwnPropertyDescriptor(browser.window.Navigator.prototype, 'userAgent')!;
    const workerDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(scope.navigator), 'userAgent')!;
    expect(() => { windowDescriptor.get!.call(scope.navigator); }).toThrow(getRelevantRealm(browser.window).TypeError);
    expect(() => { workerDescriptor.get!.call(browser.window.navigator); }).toThrow(env.realm.TypeError);
  });
});
