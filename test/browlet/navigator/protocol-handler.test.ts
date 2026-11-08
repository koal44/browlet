import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { Navigator, DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { parseURL, serializeURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

const methods = ['registerProtocolHandler', 'unregisterProtocolHandler'] as const;

describe.each([
  ['https://protocol.test/', true], ['http://protocol.test/', false], ['http://localhost/', true],
] as const)('NavigatorContentUtils exposure at %s', (url, secure) => {
  const prepared = useFixture(async () => {
    const browser = new Browlet({ route: () => '<!doctype html>' });
    await browser.navigate(url);
    return browser;
  });

  it('exposes both operations only in secure Window contexts, without a mixin constructor', async () => {
    expect(await prepared().evaluate(() => {
      const result = ['registerProtocolHandler', 'unregisterProtocolHandler'].map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, name);
        const operation: unknown = descriptor?.value;
        return descriptor && typeof operation === 'function'
          ? [operation.length, descriptor.enumerable, descriptor.configurable, descriptor.writable] : null;
      });
      return [isSecureContext, 'NavigatorContentUtils' in window, ...result];
    })).toEqual([secure, false, secure ? [2, true, true, true] : null, secure ? [2, true, true, true] : null]);
  });
});

describe.each(methods)('HTML NavigatorContentUtils.%s', (method) => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => createFixture());

  it('normalizes in the calling task and hands the parsed URL and original Document to parallel work', () => {
    const { browser, env, document, parallel, registration, removal } = prepared();
    expect(browser.window.navigator[method]('WEB+BROWLET', '../handler?url=%s')).toBeUndefined();
    expect(registration).not.toHaveBeenCalled();
    expect(removal).not.toHaveBeenCalled();
    expect(parallel).toHaveLength(1);
    parallel.shift()!();
    const called = method === 'registerProtocolHandler' ? registration : removal;
    const unused = method === 'registerProtocolHandler' ? removal : registration;
    expect(called).toHaveBeenCalledTimes(1);
    const [scheme, url, originDocument] = called.mock.calls[0]!;
    expect(scheme).toBe('web+browlet');
    expect(serializeURL(url)).toBe('https://protocol.test/handler?url=%s');
    expect(originDocument).toBe(document);
    expect(originDocument.env).toBe(env);
    expect(unused).not.toHaveBeenCalled();
  });

  it('accepts every specified safelisted scheme and ASCII-case variants', () => {
    const { browser, parallel, registration, removal } = prepared();
    const schemes = [
      'bitcoin', 'ftp', 'ftps', 'geo', 'im', 'irc', 'ircs', 'magnet', 'mailto', 'matrix', 'mms', 'news',
      'nntp', 'openpgp4fpr', 'sftp', 'sip', 'sms', 'smsto', 'ssh', 'tel', 'urn', 'webcal', 'wtai', 'xmpp', 'web+abc',
    ];
    for (const scheme of schemes) browser.window.navigator[method](scheme.toUpperCase(), '/handler?url=%s');
    for (const steps of parallel) steps();
    const called = method === 'registerProtocolHandler' ? registration : removal;
    expect(called.mock.calls.map(([scheme]) => scheme)).toEqual(schemes);
  });

  it('rejects invalid schemes before URL checks, including non-ASCII letters and trailing line breaks', async () => {
    const { browser, parallel } = prepared();
    const schemes = ['', 'http', 'https', 'data', 'javascript', 'mailto:', 'web+', 'web+a1', 'web+a-b',
      ' web+a', 'web+a\n', 'web+a\r', 'web+\u212A', 'web+\u00E9', 'web+\uD800'];
    const results = await browser.evaluate(({ method, schemes }) => schemes.map((scheme) => {
      try { (navigator as unknown as Navigator)[method](scheme, '/missing-token'); return [scheme, 'accepted']; }
      catch (error) { return [scheme, error instanceof DOMException ? error.name : 'other']; }
    }), { method, schemes });
    expect(results).toEqual(schemes.map((scheme) => [scheme, 'SecurityError']));
    expect(parallel).toEqual([]);
  });

  it('requires the original lowercase placeholder and a parsable URL', async () => {
    const { browser, parallel } = prepared();
    const urls = ['/handler', '/?url=%S', '/?url=%25s', '/?url=%\ns',
      'https://%s.protocol.test/', 'https://protocol.test:%s/', 'https://[::1/handler?url=%s'];
    const results = await browser.evaluate(({ method, urls }) => urls.map((url) => {
      try { (navigator as unknown as Navigator)[method]('web+browlet', url); return [url, 'accepted']; }
      catch (error) { return [url, error instanceof DOMException ? error.name : 'other']; }
    }), { method, urls });
    expect(results).toEqual(urls.map((url) => [url, 'SyntaxError']));
    expect(parallel).toEqual([]);
  });

  it('rejects placeholders discarded by path normalization but permits a remaining placeholder', async () => {
    const { browser, parallel, registration, removal } = prepared();
    expect(await browser.evaluate((method) => {
      try { (navigator as unknown as Navigator)[method]('web+browlet', '/%s/../handler'); return ''; }
      catch (error) { return error instanceof DOMException ? error.name : 'other'; }
    }, method)).toBe('SyntaxError');
    expect(parallel).toEqual([]);
    browser.window.navigator[method]('web+browlet', '/%s/../handler?url=%s');
    parallel.shift()!();
    const called = method === 'registerProtocolHandler' ? registration : removal;
    expect(serializeURL(called.mock.calls[0]![1])).toBe('https://protocol.test/handler?url=%s');
  });

  it('requires an HTTP(S) handler with exactly the receiver origin', async () => {
    const { browser, parallel } = prepared();
    const urls = ['https://other.test/?url=%s', 'https://protocol.test:8443/?url=%s',
      'http://protocol.test/?url=%s', 'data:text/plain,%s', 'blob:https://protocol.test/%s'];
    const results = await browser.evaluate(({ method, urls }) => urls.map((url) => {
      try { (navigator as unknown as Navigator)[method]('web+browlet', url); return [url, 'accepted']; }
      catch (error) { return [url, error instanceof DOMException ? error.name : 'other']; }
    }), { method, urls });
    expect(results).toEqual(urls.map((url) => [url, 'SecurityError']));
    expect(parallel).toEqual([]);
  });

  it('preserves URL records, multiple placeholders, credentials, and URL-standard normalization', () => {
    const { browser, parallel, registration, removal } = prepared();
    const urls = [
      'https://PROTOCOL.test:443/a/../handler?first=%s&second=%s',
      'https://user:pass@protocol.test/handler#%s', 'https://%s@protocol.test/handler', '/%s/path',
    ];
    for (const url of urls) browser.window.navigator[method]('web+browlet', url);
    for (const steps of parallel) steps();
    const called = method === 'registerProtocolHandler' ? registration : removal;
    expect(called.mock.calls.map(([, url]) => serializeURL(url))).toEqual([
      'https://protocol.test/handler?first=%s&second=%s', 'https://user:pass@protocol.test/handler#%s',
      'https://%s@protocol.test/handler', 'https://protocol.test/%s/path',
    ]);
  });

  it('uses the current base URL and Document encoding before parallel work starts', async () => {
    const { browser, document: documentImpl, parallel, registration, removal } = prepared();
    documentImpl.encoding = 'windows-1252';
    await browser.evaluate((method) => {
      const base = document.createElement('base');
      base.href = '/first/';
      document.head.append(base);
      (navigator as unknown as Navigator)[method]('web+browlet', 'caf\u00E9?name=\u00E9&url=%s');
      base.href = '/second/';
    }, method);
    documentImpl.encoding = 'UTF-8';
    parallel.shift()!();
    const called = method === 'registerProtocolHandler' ? registration : removal;
    expect(serializeURL(called.mock.calls[0]![1])).toBe('https://protocol.test/first/caf%C3%A9?name=%E9&url=%s');
  });

  it('converts both arguments before validation and preserves author conversion failures', async () => {
    const { browser, parallel } = prepared();
    expect(await browser.evaluate((method) => {
      const seen: string[] = [];
      const sentinel = new Error('author conversion');
      const scheme = { toString() { seen.push('scheme'); return 'https'; } };
      const url = { toString() { seen.push('url'); throw sentinel; } };
      try { Reflect.apply((navigator as unknown as Navigator)[method], navigator, [scheme, url]); return []; }
      catch (error) { return [seen, error === sentinel]; }
    }, method)).toEqual([['scheme', 'url'], true]);
    expect(parallel).toEqual([]);
  });

  it('applies DOMString/USVString conversion and required-argument checks at Binding', async () => {
    const { browser, parallel, registration, removal } = prepared();
    expect(await browser.evaluate((method) => {
      const operation = (navigator as unknown as Navigator)[method];
      const failures = [[], ['web+browlet'], [Symbol(), '/%s'], ['web+browlet', Symbol()]].map((args) => {
        try { Reflect.apply(operation, navigator, args); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      Reflect.apply(operation, navigator, [{ toString: () => 'WEB+BROWLET' }, { toString: () => '/\uD800?url=%s' }]);
      return failures;
    }, method)).toEqual([true, true, true, true]);
    expect(parallel).toHaveLength(1);
    parallel.shift()!();
    const called = method === 'registerProtocolHandler' ? registration : removal;
    expect(serializeURL(called.mock.calls[0]![1])).toBe('https://protocol.test/%EF%BF%BD?url=%s');
  });
});

describe('NavigatorContentUtils ownership', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(async () => ({ first: await createFixture(), second: await createFixture('https://other.test/base/page') }));

  it.each(methods)('uses the receiver settings and owner when borrowing %s', (method) => {
    const { first, second } = prepared();
    second.browser.window.navigator[method].call(first.browser.window.navigator, 'web+browlet', 'handler?url=%s');
    expect(first.parallel).toHaveLength(1);
    expect(second.parallel).toEqual([]);
    first.parallel.shift()!();
    const called = method === 'registerProtocolHandler' ? first.registration : first.removal;
    expect(serializeURL(called.mock.calls[0]![1])).toBe('https://protocol.test/directory/handler?url=%s');
    expect(called.mock.calls[0]![2]).toBe(first.document);
  });

  it.each(methods)('keeps receiver failures and validation exceptions in the borrowed %s method realm', (method) => {
    const { first, second } = prepared();
    expect(() => { second.browser.window.navigator[method].call(null, 'web+browlet', '/%s'); })
      .toThrow(second.env.realm.TypeError);
    try {
      second.browser.window.navigator[method].call(first.browser.window.navigator, 'https', '/missing-token');
      expect.unreachable('Expected scheme validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(second.browser.window.DOMException);
      expect(error).not.toBeInstanceOf(first.browser.window.DOMException);
      expect(error).toHaveProperty('name', 'SecurityError');
    }
  });
});

describe.each([false, true])('WorkerNavigator custom-handler exposure, shared: %s', (shared) => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(async (fixture) => {
    const { browser, env } = await createFixture();
    const agent = env.userAgent.obtainDedicatedOrSharedWorkerAgent(env, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected a worker agent');
    const workerEnv = createWorkerEnvironment({
      agent, outsideEnv: env, url: parseURL('https://protocol.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'protocol', credentials: 'same-origin', extendedLifetime: shared,
    });
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { browser, scope: workerEnv.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it('keeps the Window-only mixin off workers', () => {
    const { scope } = prepared();
    for (const method of methods) expect(Reflect.has(scope.navigator, method)).toBe(false);
    expect(Reflect.has(scope, 'NavigatorContentUtils')).toBe(false);
  });
});

async function createFixture(url = 'https://protocol.test/directory/page') {
  const browser = new Browlet({ route: () => '<!doctype html><title>Protocol handlers</title>' });
  await browser.navigate(url);
  const env = getRelevantRealm(browser.window).env;
  const document = env.window.document;
  const parallel: (() => void)[] = [];
  vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { parallel.push(steps); });
  const registration = vi.spyOn(env.userAgent, 'registerProtocolHandler').mockImplementation(() => {});
  const removal = vi.spyOn(env.userAgent, 'unregisterProtocolHandler').mockImplementation(() => {});
  return { browser, env, document, parallel, registration, removal };
}
