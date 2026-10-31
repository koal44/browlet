import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { Location } from '../../../../src/browlet/platform';
import { createOpaqueOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

type Component = 'protocol' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash';
const components: Component[] = ['protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
const initialURL = 'https://example.test:8443/dir/page?old#before';

afterEach(() => { vi.restoreAllMocks(); });

describe('Location URL component navigation', () => {
  it.each([
    ['protocol', 'http::::', 'http://example.test:8443/dir/page?old#before'],
    ['protocol', 'https', initialURL],
    ['protocol', 'mailto', initialURL],
    ['host', 'other.test', 'https://other.test:8443/dir/page?old#before'],
    ['host', '[2001:db8::1]:443', 'https://[2001:db8::1]/dir/page?old#before'],
    ['hostname', '[2001:db8::1]', 'https://[2001:db8::1]:8443/dir/page?old#before'],
    ['port', '', 'https://example.test/dir/page?old#before'],
    ['port', '443', 'https://example.test/dir/page?old#before'],
    ['port', '1234abc', 'https://example.test:1234/dir/page?old#before'],
    ['pathname', '/a/../next?x#y', 'https://example.test:8443/next%3Fx%23y?old#before'],
    ['pathname', '', 'https://example.test:8443/?old#before'],
    ['search', '', 'https://example.test:8443/dir/page#before'],
    ['search', '?', 'https://example.test:8443/dir/page?#before'],
    ['search', '??q=#value', 'https://example.test:8443/dir/page??q=%23value#before'],
    ['hash', '', 'https://example.test:8443/dir/page?old#'],
    ['hash', '##next', 'https://example.test:8443/dir/page?old##next'],
    ['hash', '\u00e9', 'https://example.test:8443/dir/page?old#%C3%A9'],
  ] as const)('prepares %s = %j without changing the current URL', async (member, value, expected) => {
    const { browser, document, navigable, navigate } = await createTarget();
    // The navigation URL is independently mutable; the Document still owns its original record and path.
    Object.freeze(document.url);
    Object.freeze(document.url.path);
    await browser.evaluate(({ member, value }) => { location[member] = value; }, { member, value });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), document, {
      exceptionsEnabled: true, historyHandling: 'auto',
    });
    expect(navigate.mock.contexts[0]).toBe(navigable);
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe(expected);
    expect(browser.window.location.href).toBe(initialURL);
  });

  it.each([
    ['host', 'bad host', initialURL],
    ['host', 'other.test:99999', 'https://other.test:8443/dir/page?old#before'],
    ['hostname', 'other.test:1234', initialURL],
    ['port', ':1234', initialURL],
    ['port', '99999', initialURL],
  ] as const)('keeps the URL parser result after invalid %s = %j', async (member, value, expected) => {
    const { browser, navigate } = await createTarget();
    // HTML ignores these parser failures, including a host change before port parsing fails.
    await browser.evaluate(({ member, value }) => { location[member] = value; }, { member, value });
    expect(navigate).toHaveBeenCalledOnce();
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe(expected);
    expect(browser.window.location.href).toBe(initialURL);
  });

  it.each(['', '1https', 'ht^tp'])('throws a realm-owned SyntaxError for protocol %j', async (value) => {
    const { browser, navigate } = await createTarget();
    const result = await browser.evaluate((value) => {
      try { location.protocol = value; return null; }
      catch (error) { return { name: (error as DOMException).name, realm: error instanceof DOMException }; }
    }, value);
    expect(result).toEqual({ name: 'SyntaxError', realm: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['ftp', 'ws'])('does not navigate a resulting %s URL', async (value) => {
    const { browser, navigate } = await createTarget();
    await browser.evaluate((value) => { location.protocol = value; }, value);
    expect(navigate).not.toHaveBeenCalled();
    expect(browser.window.location.href).toBe(initialURL);
  });

  it.each(['host', 'hostname', 'pathname'] as const)('returns for %s on an opaque path', async (member) => {
    const { browser, document, navigate } = await createTarget();
    document.url = parseURL('mailto:user@example.test?old#before').url!;
    await browser.evaluate((member) => { location[member] = 'next'; }, member);
    expect(navigate).not.toHaveBeenCalled();
    expect(browser.window.location.href).toBe('mailto:user@example.test?old#before');
  });

  it.each(['file:///path', 'custom:/path', 'custom:///path', 'mailto:user@example.test'])('returns for port on %s', async (url) => {
    const { browser, document, navigate } = await createTarget();
    document.url = parseURL(url).url!;
    await browser.evaluate(() => { location.port = '8080'; });
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['https://example.test/path', ''], ['https://example.test/path', '#'],
    ['https://example.test/path#', ''], ['https://example.test/path#same', '#same'],
    ['https://example.test/path#a%20b', '#a b'],
  ] as const)('does not navigate %s when its parsed fragment is unchanged by %j', async (url, value) => {
    const { browser, document, navigate } = await createTarget();
    document.url = parseURL(url).url!;
    document.completelyLoadedTime = null;
    const activation = vi.spyOn(getRelevantRealm(browser.window).env.window, 'hasTransientActivation');
    await browser.evaluate((value) => { location.hash = value; }, value);
    expect(navigate).not.toHaveBeenCalled();
    expect(activation).not.toHaveBeenCalled();
    expect(browser.window.location.href).toBe(url);
  });

  it('does not apply the hash bailout to href or assign', async () => {
    const { browser, navigate } = await createTarget();
    await browser.evaluate(() => {
      location.hash = '#before';
      location.href = '#before';
      location.assign('#before');
    });
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate.mock.calls.map(([url]) => serializeURL(url))).toEqual([initialURL, initialURL]);
  });

  it.each(components)('converts %s before returning for a disconnected Location', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const location = browser.window.location;
    document.browsingContext = null;
    const convert = vi.fn(() => 'invalid');
    set(location, location, member, { toString: convert });
    expect(convert).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(components)('checks %s against the entry origin after conversion, before parsing or early return', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const entry = getRelevantRealm(createSiblingWindow(browser)).env;
    entry.window.document.origin = createOpaqueOrigin();
    document.url = parseURL('mailto:user@example.test').url!;
    const convert = vi.fn(() => 'invalid');
    expect(() => entry.responsibleEventLoop.runScriptEvaluation(entry, () => {
      set(browser.window.location, browser.window.location, member, { toString: convert });
    })).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(convert).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(components)('keeps %s entry, incumbent, method, and receiver environments separate', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const entry = getRelevantRealm(createSiblingWindow(browser)).env;
    const incumbent = getRelevantRealm(createSiblingWindow(browser)).env;
    const method = getRelevantRealm(createSiblingWindow(browser)).env;
    for (const env of [entry, incumbent, method]) env.window.document.origin = document.origin;
    entry.window.document.url = parseURL('https://example.test:8443/entry/').url!;
    document.completelyLoadedTime = null;
    const activation = vi.spyOn(incumbent.window, 'hasTransientActivation').mockReturnValue(false);
    const values: Record<Component, string> = {
      protocol: 'http', host: 'other.test', hostname: 'other.test', port: '8080',
      pathname: 'next', search: '?next', hash: '#next',
    };
    const loop = method.responsibleEventLoop;
    // Stock Node receives the modeled engine observation explicitly.
    loop.runScriptEvaluation(entry, () => loop.runPlatformCall(method.realm, incumbent, () => {
      set(method.realm.globalObject.location, browser.window.location, member, values[member]);
    }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), incumbent.window.document, {
      exceptionsEnabled: true, historyHandling: 'replace',
    });
    expect(activation).toHaveBeenCalledOnce();
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it('uses UTF-8 for search independently of Document and execution encodings', async () => {
    const { browser, document, navigate } = await createTarget();
    const entry = getRelevantRealm(createSiblingWindow(browser)).env;
    const incumbent = getRelevantRealm(createSiblingWindow(browser)).env;
    const method = getRelevantRealm(createSiblingWindow(browser)).env;
    document.encoding = 'windows-1252';
    for (const env of [entry, incumbent, method]) {
      env.window.document.origin = document.origin;
      env.window.document.encoding = 'windows-1251';
    }
    const loop = method.responsibleEventLoop;
    loop.runScriptEvaluation(entry, () => loop.runPlatformCall(method.realm, incumbent, () => {
      set(method.realm.globalObject.location, browser.window.location, 'search', '?q=\u00e9');
    }));
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test:8443/dir/page?q=%C3%A9#before');
    expect(navigate.mock.calls[0]![1]).toBe(incumbent.window.document);
  });

  it('captures current URL state after one USVString conversion', async () => {
    const { browser, document, navigate } = await createTarget();
    const convert = vi.fn(() => {
      document.url = parseURL('https://example.test:8443/changed?new#old').url!;
      return 'next/\uD800';
    });
    set(browser.window.location, browser.window.location, 'pathname', { toString: convert });
    expect(convert).toHaveBeenCalledOnce();
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test:8443/next/%EF%BF%BD?new#old');
    expect(browser.window.location.href).toBe('https://example.test:8443/changed?new#old');
  });

  it.each(['windows-1252', 'windows-1251', 'Shift_JIS', 'UTF-16LE', 'UTF-16BE', 'replacement'])(
    'uses UTF-8 for search in a %s Document', async (encoding) => {
      const { browser, document, navigate } = await createTarget();
      document.encoding = encoding;
      await browser.evaluate(() => { location.search = '?q=\u00e9'; });
      expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test:8443/dir/page?q=%C3%A9#before');
    },
  );

  it.each(components)('applies retained %s writes to the replacement Document', async (member) => {
    const { browser, document, navigable, navigate } = await createTarget();
    const retained = browser.window.location;
    await browser.navigate('https://example.test:8443/replacement?new#now');
    const currentDocument = unwrap<DocumentImpl>(browser.document);
    currentDocument.encoding = 'windows-1252';
    expect(document.getNodeNavigable()).toBeNull();
    const values: Record<Component, string> = {
      protocol: 'http', host: 'other.test', hostname: 'other.test', port: '8080',
      pathname: '/next', search: '?q=\u00e9', hash: '#next',
    };
    const expected: Record<Component, string> = {
      protocol: 'http://example.test:8443/replacement?new#now',
      host: 'https://other.test:8443/replacement?new#now',
      hostname: 'https://other.test:8443/replacement?new#now',
      port: 'https://example.test:8080/replacement?new#now',
      pathname: 'https://example.test:8443/next?new#now',
      search: 'https://example.test:8443/replacement?q=%C3%A9#now',
      hash: 'https://example.test:8443/replacement?new#next',
    };
    currentDocument.env.responsibleEventLoop.runScriptEvaluation(currentDocument.env, () => {
      set(retained, retained, member, values[member]);
    });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.contexts[0]).toBe(navigable);
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe(expected[member]);
    expect(navigate.mock.calls[0]![1]).toBe(currentDocument);
    expect(serializeURL(currentDocument.url)).toBe('https://example.test:8443/replacement?new#now');
  });
});

/** Exercise real Location bindings, replacing only the unfinished navigation effect. */
async function createTarget() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(initialURL);
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  const navigate = vi.spyOn(navigable, 'navigate').mockImplementation(() => {});
  return { browser, document, navigable, navigate };
}

function set(owner: Location, receiver: Location, member: Component, value: unknown): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the real setter with an explicit Location receiver.
  Reflect.apply(Object.getOwnPropertyDescriptor(owner, member)!.set!, receiver, [value]);
}
