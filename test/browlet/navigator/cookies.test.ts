import { describe, expect, it } from 'vitest';

import { FetchRequest, FetchResponse } from '../../../src/fetch/index';
import { parseURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe.each(['https://cookies.test/', 'http://cookies.test/'])('NavigatorCookies exposure at %s', (url) => {
  const prepared = useFixture(() => createFixture(url));

  it('exposes a readonly boolean on Navigator.prototype without a mixin constructor', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'cookieEnabled')!;
      return {
        enabled: navigator.cookieEnabled, alias: window.clientInformation.cookieEnabled,
        own: Object.hasOwn(navigator, 'cookieEnabled'), mixin: 'NavigatorCookies' in globalThis,
        enumerable: descriptor.enumerable, configurable: descriptor.configurable,
        getter: typeof descriptor.get, setter: descriptor.set === undefined,
        writable: Reflect.set(navigator, 'cookieEnabled', false),
        after: navigator.cookieEnabled,
      };
    })).toEqual({
      enabled: true, alias: true, own: false, mixin: false, enumerable: true,
      configurable: true, getter: 'function', setter: true, writable: false, after: true,
    });
  });
});

describe('NavigatorCookies policy and ownership', () => {
  const prepared = useFixture(() => createFixture());

  it('tracks the live policy used by Document and Fetch without deleting stored cookies', async () => {
    const { browser, env, userAgent, document } = prepared();
    const navigator = browser.window.navigator;
    browser.document.cookie = 'retained=1; Path=/';
    const request = () => {
      const value = new FetchRequest(document.url, env);
      value.client = env;
      return value;
    };
    const allowed = request();
    allowed.appendCookieHeader();
    expect([navigator.cookieEnabled, allowed.headerList.get('Cookie')]).toEqual([true, 'retained=1']);

    userAgent.cookiesEnabled = false;
    expect(await browser.evaluate(() => {
      document.cookie = 'blocked=2; Path=/';
      return [navigator.cookieEnabled, document.cookie];
    })).toEqual([false, '']);
    const blocked = request();
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'server=3; Path=/');
    response.parseAndStoreCookies(blocked);
    blocked.appendCookieHeader();
    expect(blocked.headerList.get('Cookie')).toBeNull();

    userAgent.cookiesEnabled = true;
    expect(browser.window.navigator).toBe(navigator);
    expect([navigator.cookieEnabled, browser.document.cookie]).toEqual([true, 'retained=1']);
    const restored = request();
    restored.appendCookieHeader();
    expect(restored.headerList.get('Cookie')).toBe('retained=1');
  });

  it('reads the receiver UserAgent when a different realm supplies the getter', async () => {
    const { browser: first, userAgent: firstUserAgent } = prepared();
    const { browser: second, env: secondEnv, userAgent: secondUserAgent } = await createFixture();
    secondUserAgent.cookiesEnabled = false;
    const descriptor = Object.getOwnPropertyDescriptor(second.window.Navigator.prototype, 'cookieEnabled')!;
    expect(second.window.navigator.cookieEnabled).toBe(false);
    expect(descriptor.get!.call(first.window.navigator)).toBe(true);
    firstUserAgent.cookiesEnabled = false;
    secondUserAgent.cookiesEnabled = true;
    expect(descriptor.get!.call(first.window.navigator)).toBe(false);
    expect(second.window.navigator.cookieEnabled).toBe(true);
    expect(() => { descriptor.get!.call({}); }).toThrow(secondEnv.realm.TypeError);
    expect(() => { descriptor.get!.call(null); }).toThrow(secondEnv.realm.TypeError);
  });

  it('keeps reporting policy when its Document loses its browsing context', () => {
    const { browser, document, userAgent } = prepared();
    const navigator = browser.window.navigator;
    // Exercise the retained receiver at the context-detachment boundary, independently
    // of the unfinished iframe startup and recursive destruction algorithms.
    document.browsingContext!.activeDocument = null;
    document.browsingContext = null;
    expect(navigator.cookieEnabled).toBe(true);
    userAgent.cookiesEnabled = false;
    expect(navigator.cookieEnabled).toBe(false);
    userAgent.cookiesEnabled = true;
    expect(navigator.cookieEnabled).toBe(true);
  });

  it('shares the same live policy with a replacement Document and its previous Navigator', async () => {
    const { browser, userAgent } = prepared();
    const previous = browser.window.navigator;
    userAgent.cookiesEnabled = false;
    await browser.navigate('https://other.test/next');
    expect(browser.window.navigator).not.toBe(previous);
    expect([previous.cookieEnabled, browser.window.navigator.cookieEnabled]).toEqual([false, false]);
    userAgent.cookiesEnabled = true;
    expect([previous.cookieEnabled, browser.window.navigator.cookieEnabled]).toEqual([true, true]);
  });
});

describe('NavigatorCookies in a cookie-averse Document', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('reports enabled cookie handling without promising that this Document can store a cookie', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => {
      document.cookie = 'ignored=1';
      return [location.href, navigator.cookieEnabled, document.cookie];
    })).toEqual(['about:blank', true, '']);
  });
});

describe.each([false, true])('WorkerNavigator excludes NavigatorCookies, shared: %s', (shared) => {
  const prepared = useFixture(async (fixture) => {
    const { browser, env: outsideEnv, userAgent } = await createFixture();
    const agent = userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected a worker agent');
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://cookies.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'cookies', credentials: 'same-origin', extendedLifetime: shared,
    });
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { browser, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it('has no cookieEnabled member or mixin constructor and rejects borrowing the Window getter', () => {
    const { browser, scope } = prepared();
    expect(Reflect.has(scope.navigator, 'cookieEnabled')).toBe(false);
    expect(Reflect.has(scope, 'NavigatorCookies')).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(browser.window.Navigator.prototype, 'cookieEnabled')!;
    expect(() => { descriptor.get!.call(scope.navigator); }).toThrow(getRelevantRealm(browser.window).TypeError);
  });
});

async function createFixture(url = 'https://cookies.test/') {
  const browser = new Browlet({ route: () => '<!doctype html><body>' });
  await browser.navigate(url);
  const env = getRelevantRealm(browser.window).env;
  return { browser, env, userAgent: env.userAgent, document: env.window.document };
}
