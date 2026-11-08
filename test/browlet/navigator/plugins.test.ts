import { describe, expect, it } from 'vitest';

import { parseURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

const pluginNames = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];
const mimeNames = ['application/pdf', 'text/pdf'];

describe.each(['https://plugins.test/', 'http://plugins.test/'])('NavigatorPlugins without a PDF viewer at %s', (url) => {
  const prepared = useFixture(() => createFixture(false, url));

  it('exposes the Window interfaces with stable empty collections and false capability getters', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => {
      const { plugins, mimeTypes } = navigator;
      return {
        enabled: navigator.pdfViewerEnabled, java: navigator.javaEnabled(),
        same: plugins === navigator.plugins && mimeTypes === window.clientInformation.mimeTypes,
        brands: [plugins instanceof PluginArray, mimeTypes instanceof MimeTypeArray],
        lengths: [plugins.length, mimeTypes.length], keys: [Reflect.ownKeys(plugins), Reflect.ownKeys(mimeTypes)],
        items: [plugins.item(0), plugins.namedItem('PDF Viewer'), mimeTypes.item(0), mimeTypes.namedItem('application/pdf')],
        missing: [plugins[0], mimeTypes[0], Reflect.get(plugins, 'PDF Viewer')],
        constructors: [typeof PluginArray, typeof MimeTypeArray, typeof Plugin, typeof MimeType],
        mixin: 'NavigatorPlugins' in globalThis, refresh: plugins.refresh(),
      };
    })).toEqual({
      enabled: false, java: false, same: true, brands: [true, true], lengths: [0, 0], keys: [[], []],
      items: [null, null, null, null], missing: [undefined, undefined, undefined],
      constructors: ['function', 'function', 'function', 'function'], mixin: false, refresh: undefined,
    });
  });

  it('keeps attributes readonly and interfaces nonconstructible', async () => {
    const { browser, env } = prepared();
    for (const constructor of [browser.window.PluginArray, browser.window.MimeTypeArray, browser.window.Plugin, browser.window.MimeType]) {
      // @ts-expect-error These exposed interfaces intentionally have no author constructor.
      expect(() => Reflect.construct(constructor, [])).toThrow(env.realm.TypeError);
    }
    expect(await browser.evaluate(() => ['plugins', 'mimeTypes', 'pdfViewerEnabled'].map((name) => {
      const d = Object.getOwnPropertyDescriptor(Navigator.prototype, name)!;
      return [Object.hasOwn(navigator, name), d.enumerable, d.configurable, d.set === undefined, Reflect.set(navigator, name, null)];
    }))).toEqual(Array.from({ length: 3 }, () => [false, true, true, true, false]));
  });
});

describe('NavigatorPlugins with configured PDF support', () => {
  const prepared = useFixture(() => createFixture(true));

  it('supplies the five compatibility names and two shared MIME objects in specification order', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => ({
      enabled: navigator.pdfViewerEnabled, java: navigator.javaEnabled(),
      plugins: Array.from(navigator.plugins, (p) => [p.name, p.description, p.filename, p.length]),
      mimes: Array.from(navigator.mimeTypes, (m) => [m.type, m.description, m.suffixes, m.enabledPlugin.name]),
    }))).toEqual({
      enabled: true, java: false,
      plugins: pluginNames.map((name) => [name, 'Portable Document Format', 'internal-pdf-viewer', 2]),
      mimes: mimeNames.map((type) => [type, 'Portable Document Format', 'pdf', 'PDF Viewer']),
    });
  });

  it('shares exact objects through indexed, named, iterator, and enabledPlugin paths', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => {
      const ps = navigator.plugins;
      const ms = navigator.mimeTypes;
      return Array.from(ps, (p, index) => [
        ps.item(index) === p, ps.namedItem(p.name) === p, Reflect.get(ps, p.name) === p,
        ...Array.from(p, (m, j) => m === ms[j] && m === ms.item(j) && m === ms.namedItem(m.type) &&
          m === Reflect.get(ms, m.type) && p.item(j) === m && p.item(j) === p.item(j) &&
          p.namedItem(m.type) === m && Reflect.get(p, m.type) === m && m.enabledPlugin === ps[0]),
      ]);
    })).toEqual(Array.from({ length: 5 }, () => [true, true, true, true, true]));
  });

  it('exposes readonly indexed properties and unenumerable exact-name properties', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => [navigator.plugins, navigator.mimeTypes, navigator.plugins[0]!].map((collection) => {
      const names = Object.getOwnPropertyNames(collection);
      const name = names.find((name) => !/^\d+$/.test(name))!;
      const indexDescriptor = Object.getOwnPropertyDescriptor(collection, '0')!;
      const nameDescriptor = Object.getOwnPropertyDescriptor(collection, name)!;
      return {
        names, keys: Object.keys(collection),
        indexed: [indexDescriptor.writable, indexDescriptor.enumerable, indexDescriptor.configurable],
        named: [nameDescriptor.writable, nameDescriptor.enumerable, nameDescriptor.configurable],
        mutations: [Reflect.set(collection, '0', null), Reflect.set(collection, name, null),
          Reflect.deleteProperty(collection, '0'), Reflect.deleteProperty(collection, name),
          Reflect.defineProperty(collection, '0', { value: null }), Reflect.set(collection, 'extra', 123)],
        extra: Reflect.get(collection, 'extra') === 123,
      };
    }))).toEqual([
      { names: ['0', '1', '2', '3', '4', ...pluginNames], keys: ['0', '1', '2', '3', '4'] },
      { names: ['0', '1', ...mimeNames], keys: ['0', '1'] },
      { names: ['0', '1', ...mimeNames], keys: ['0', '1'] },
    ].map((entry) => ({
      ...entry, indexed: [false, true, true], named: [false, false, true],
      mutations: [false, false, false, false, false, true], extra: true,
    })));
  });

  it('uses Web IDL argument conversion and exact matching without MIME normalization', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => {
      const ps = navigator.plugins;
      const ms = navigator.mimeTypes;
      const p = ps[0]!;
      return {
        converted: [ps.item(2 ** 32) === p,
          ps.namedItem({ toString: () => 'PDF Viewer' } as unknown as string) === p,
          ms.item('1' as unknown as number) === ms[1],
          p.namedItem({ toString: () => 'text/pdf' } as unknown as string) === ms[1]],
        absent: [ps.item(-1), ps.item(5), ps.namedItem('pdf viewer'), ps.namedItem(''),
          ms.namedItem('APPLICATION/PDF'), ms.namedItem('application/pdf; charset=utf-8'),
          p.namedItem('text'), p.item(2)],
        properties: [Reflect.get(ps, 'pdf viewer'), Reflect.get(ms, 'APPLICATION/PDF')],
      };
    })).toEqual({ converted: [true, true, true, true], absent: Array(8).fill(null), properties: [undefined, undefined] });
  });

  it('rejects missing arguments and invalid receivers through real bindings', () => {
    const { browser, env } = prepared();
    const { plugins, mimeTypes } = browser.window.navigator;
    for (const receiver of [plugins, mimeTypes, plugins[0]!]) {
      expect(() => { Reflect.apply(receiver.item, receiver, []); }).toThrow(env.realm.TypeError);
      expect(() => { Reflect.apply(receiver.namedItem, receiver, []); }).toThrow(env.realm.TypeError);
      expect(() => { Reflect.apply(receiver.item, {}, [0]); }).toThrow(env.realm.TypeError);
      expect(() => { Reflect.apply(receiver.namedItem, null, ['application/pdf']); }).toThrow(env.realm.TypeError);
    }
    const d = Object.getOwnPropertyDescriptor(browser.window.MimeType.prototype, 'enabledPlugin')!;
    expect(() => { d.get!.call({}); }).toThrow(env.realm.TypeError);
  });

  it('keeps refresh a no-op even with extra author arguments', async () => {
    const { browser } = prepared();
    expect(await browser.evaluate(() => {
      const ps = navigator.plugins;
      const m = navigator.mimeTypes[0];
      // @ts-expect-error Extra JavaScript arguments must be ignored by the zero-argument operation.
      const result = ps.refresh.call(ps, { valueOf() { throw new Error('Unexpected conversion'); } });
      return [result, ps.refresh.length, ps === navigator.plugins, ps[0]![0] === m];
    })).toEqual([undefined, 0, true, true]);
  });

  it('retains collections, entries, and the UserAgent capability after context detachment', () => {
    const { browser, document } = prepared();
    const n = browser.window.navigator;
    const ps = n.plugins;
    const ms = n.mimeTypes;
    const p = ps[0]!;
    const m = ms[0]!;
    // Supply the context-detachment boundary independently of unfinished iframe destruction.
    document.browsingContext!.activeDocument = null;
    document.browsingContext = null;
    expect(n.pdfViewerEnabled).toBe(true);
    expect(n.plugins).toBe(ps);
    expect(n.mimeTypes).toBe(ms);
    expect(ps.item(0)).toBe(p);
    expect(p.item(0)).toBe(m);
    expect(m.enabledPlugin).toBe(p);
  });

  it('creates separate objects for a replacement Window while retained objects keep their realm', async () => {
    const { browser } = prepared();
    const previous = browser.window.navigator;
    const oldEnv = getRelevantRealm(browser.window).env;
    await browser.navigate('https://replacement.test/');
    const next = browser.window;
    const ps = previous.plugins;
    const p = next.PluginArray.prototype.item.call(ps, 0)!;
    const m = next.Plugin.prototype.item.call(p, 0)!;
    expect(ps).not.toBe(next.navigator.plugins);
    expect(p).not.toBe(next.navigator.plugins[0]);
    expect(m).not.toBe(next.navigator.mimeTypes[0]);
    expect(next.PluginArray.prototype.namedItem.call(ps, 'PDF Viewer')).toBe(p);
    expect(next.MimeTypeArray.prototype.item.call(previous.mimeTypes, 0)).toBe(m);
    for (const value of [ps, previous.mimeTypes, p, m]) expect(getRelevantRealm(value).env).toBe(oldEnv);
    const d = Object.getOwnPropertyDescriptor(next.MimeType.prototype, 'enabledPlugin')!;
    expect(d.get!.call(m)).toBe(p);
    expect(() => { d.get!.call({}); }).toThrow(getRelevantRealm(next).TypeError);
  });
});

describe.each([false, true])('WorkerNavigator excludes PDF compatibility, shared: %s', (shared) => {
  const prepared = useFixture(async (fixture) => {
    const { browser, env: outsideEnv, userAgent } = await createFixture(true);
    const agent = userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected a worker agent');
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://plugins.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'plugins', credentials: 'same-origin', extendedLifetime: shared,
    });
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { browser, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it('excludes all four interfaces and all NavigatorPlugins members', () => {
    const { browser, scope } = prepared();
    for (const name of ['NavigatorPlugins', 'PluginArray', 'MimeTypeArray', 'Plugin', 'MimeType']) expect(Reflect.has(scope, name)).toBe(false);
    for (const name of ['plugins', 'mimeTypes', 'javaEnabled', 'pdfViewerEnabled']) expect(Reflect.has(scope.navigator, name)).toBe(false);
    const d = Object.getOwnPropertyDescriptor(browser.window.Navigator.prototype, 'plugins')!;
    expect(() => { d.get!.call(scope.navigator); }).toThrow(getRelevantRealm(browser.window).TypeError);
  });
});

async function createFixture(supported: boolean, url = 'https://plugins.test/') {
  const browser = new Browlet({ route: () => '<!doctype html><body>' });
  getRelevantRealm(browser.window).env.userAgent.pdfViewerSupported = supported;
  await browser.navigate(url);
  const env = getRelevantRealm(browser.window).env;
  return { browser, env, userAgent: env.userAgent, document: env.window.document };
}
