import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createWindowEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe('HTML §8.2: WindowOrWorkerGlobalScope.origin', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it.each([
    ['https://EXAMPLE.test:443/path?query#fragment', 'https://example.test'],
    ['https://example.test:8443/path', 'https://example.test:8443'],
    ['https://bücher.example/', 'https://xn--bcher-kva.example'],
    ['http://[0::1]:8080/', 'http://[::1]:8080'],
  ])('serializes the settings origin for %s', async (url, expected) => {
    const browser = prepared();
    await browser.navigate(url);
    expect(await browser.evaluate(() => [origin, self.origin, window.origin])).toEqual([expected, expected, expected]);
  });

  it('serializes an opaque environment origin as null', async () => {
    const browser = prepared();
    expect(await browser.evaluate(() => origin)).toBe('null');
  });

  it('uses the inherited environment origin rather than an about:blank URL origin', async () => {
    const browser = prepared();
    await browser.navigate('https://parent.test/');
    const parentEnv = getRelevantRealm(browser.window).env;
    // Supply the child creation input while automatic iframe startup belongs to HTML navigation.
    const url = parseURL('about:blank').url!;
    const env = createWindowEnvironment({
      agent: parentEnv.realm.agent, userAgent: parentEnv.userAgent,
      creationURL: url, origin: parentEnv.origin, parent: parentEnv.window,
      topLevelCreationURL: parentEnv.topLevelCreationURL!, topLevelOrigin: parentEnv.topLevelOrigin!,
    });
    const document = env.createDocument();
    document.url = url;
    document.origin = parentEnv.origin;
    env.window.setAssociatedDocument(document);
    env.realm.windowProxy.setAssociatedWindow(env.realm.globalObject);
    const window = env.realm.windowProxy.platform;
    expect(window.origin).toBe('https://parent.test');
    expect(window.location.origin).toBe('null');
  });

  it('lets author replacement shadow the getter without changing the actual origin', async () => {
    const browser = prepared();
    await browser.navigate('https://origin.test/');
    const result = await browser.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'origin')!;
      const replacement = { toString() { throw new Error('Replacement must not convert'); } };
      const set = Reflect.set(window, 'origin', replacement);
      const replaced = Object.getOwnPropertyDescriptor(window, 'origin')!;
      const original = descriptor.get!.call(window) as string;
      return {
        initial: [typeof descriptor.get, typeof descriptor.set, descriptor.enumerable, descriptor.configurable],
        set, retained: Object.is(Reflect.get(window, 'origin'), replacement),
        replacement: [replaced.writable, replaced.enumerable, replaced.configurable], original,
      };
    });
    expect(result).toEqual({
      initial: ['function', 'function', true, true], set: true, retained: true,
      replacement: [true, true, true], original: 'https://origin.test',
    });
    const env = getRelevantRealm(browser.window).env;
    expect(env.getWindowOrWorkerGlobalScopeMixin().extractOrigin(env)).toBe(env.origin);
    expect(env.getWindowOrWorkerGlobalScopeMixin().origin).toBe('https://origin.test');
  });

  it('follows navigation through the retained WindowProxy and drops author replacement', async () => {
    const browser = prepared();
    await browser.navigate('https://first.test/');
    const window = browser.window;
    expect(window.origin).toBe('https://first.test');
    Reflect.set(window, 'origin', 'author value');
    await browser.navigate('https://second.test/');
    expect(browser.window).toBe(window);
    expect(window.origin).toBe('https://second.test');
  });
});

describe('Window origin receiver ownership', () => {
  const prepared = useFixture(async () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const foreign = new Browlet({ route: () => '' });
    await Promise.all([
      first.navigate('https://www.example.com:8000/'),
      second.navigate('https://shop.example.com:9000/'),
      foreign.navigate('https://foreign.test/'),
    ]);
    return { first, second, foreign };
  });

  it('uses the permitted receiver settings, preserving host and port after domain relaxation', () => {
    const { first, second, foreign } = prepared();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- borrowing the getter tests receiver ownership
    const getter = Object.getOwnPropertyDescriptor(first.window, 'origin')!.get!;
    expect(() => { Reflect.apply(getter, second.window, []); }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    first.document.domain = 'example.com';
    second.document.domain = 'example.com';
    expect(first.window.origin).toBe('https://www.example.com:8000');
    expect(second.window.origin).toBe('https://shop.example.com:9000');
    expect(Reflect.apply(getter, second.window, [])).toBe('https://shop.example.com:9000');
    expect(() => { Reflect.apply(getter, foreign.window, []); }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(() => { Reflect.apply(getter, {}, []); }).toThrow(getRelevantRealm(first.window).TypeError);
  });
});
