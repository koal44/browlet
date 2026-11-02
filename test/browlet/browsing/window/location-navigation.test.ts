import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { WindowEnvironment } from '../../../../src/browlet/environment/index';
import type { Location } from '../../../../src/browlet/platform';
import { DOMExceptionImpl } from '../../../../src/web-idl/core/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Location URL navigation preparation', () => {
  it.each(['href', 'assign', 'replace'] as const)('hands %s to the owning navigable without changing the Document URL', async (member) => {
    const { browser, document, navigable, navigate } = await createTarget();
    const originalURL = document.url;
    const activation = vi.spyOn(getRelevantRealm(browser.window).env.window, 'hasTransientActivation');
    await browser.evaluate((member) => {
      if (member === 'href') location.href = '../next?query#fragment';
      else location[member]('../next?query#fragment');
    }, member);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), document, {
      exceptionsEnabled: true, historyHandling: member === 'replace' ? 'replace' : 'auto',
    });
    expect(navigate.mock.contexts[0]).toBe(navigable);
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test/next?query#fragment');
    expect(document.url).toBe(originalURL);
    expect(browser.window.location.href).toBe('https://example.test/current/page');
    expect(activation).not.toHaveBeenCalled();
  });

  it.each(['href', 'assign', 'replace'] as const)('keeps entry, incumbent, method, and receiver separate for %s', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const entry = createCaller(browser, 'https://example.test/entry/');
    const incumbent = createCaller(browser, 'https://example.test/incumbent/');
    const method = createCaller(browser, 'https://example.test/method/');
    entry.window.document.encoding = 'windows-1252';
    document.encoding = 'UTF-8';
    const methodLocation = method.realm.globalObject.location;
    const loop = method.responsibleEventLoop;
    // Supply the engine observation explicitly; stock Node cannot discover an arbitrary B-authored call.
    loop.runScriptEvaluation(entry, () => loop.runPlatformCall(method.realm, incumbent, () => {
      call(member, methodLocation, browser.window.location, 'next?query=\u00e9');
    }));
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test/entry/next?query=%E9');
    expect(navigate.mock.calls[0]![1]).toBe(incumbent.window.document);
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it.each(['href', 'assign', 'replace'] as const)('converts %s once before reading the entry base and encoding', async (member) => {
    const { browser, document, navigate } = await createTarget();
    document.encoding = 'windows-1252';
    const conversions = await browser.evaluate((member) => {
      const base = window.document.createElement('base');
      base.href = 'https://example.test/before/';
      window.document.head.append(base);
      let conversions = 0;
      const value = {
        toString() {
          conversions++;
          base.href = 'https://example.test/after/';
          return 'next/\uD800?query=\u00e9';
        },
      };
      if (member === 'href') Reflect.set(location, member, value);
      else Reflect.apply(location[member], location, [value]);
      return conversions;
    }, member);
    expect(conversions).toBe(1);
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test/after/next/%EF%BF%BD?query=%E9');
  });

  it.each(['href', 'assign', 'replace'] as const)('throws a realm-owned SyntaxError for invalid %s URLs', async (member) => {
    const { browser, navigate } = await createTarget();
    const result = await browser.evaluate((member) => {
      try {
        if (member === 'href') location.href = 'http://[';
        else location[member]('http://[');
        return null;
      } catch (error) {
        return { name: (error as DOMException).name, realm: error instanceof DOMException };
      }
    }, member);
    expect(result).toEqual({ name: 'SyntaxError', realm: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['href', 'assign', 'replace'] as const)('returns after conversion when %s has no relevant Document', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const location = browser.window.location;
    const parse = vi.spyOn(document.env, 'encodingParseURL');
    const convert = vi.fn(() => 'http://[');
    document.browsingContext = null;
    expect(() => call(member, location, location, { toString: convert })).not.toThrow();
    expect(convert).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('checks the assign entry origin before parsing, after Web IDL conversion', async () => {
    const { browser, document, navigate } = await createTarget();
    const entry = createCaller(browser, 'https://other.test/entry/');
    entry.window.document.origin = createOpaqueOrigin();
    const parse = vi.spyOn(entry, 'encodingParseURL');
    const convert = vi.fn(() => 'http://[');
    const loop = document.env.responsibleEventLoop;
    expect(() => loop.runScriptEvaluation(entry, () => {
      call('assign', browser.window.location, browser.window.location, { toString: convert });
    })).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(convert).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it.each(['href', 'replace'] as const)('does not impose assign\'s entry-origin check on %s', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const entry = createCaller(browser, 'https://other.test/entry/');
    entry.window.document.origin = createOpaqueOrigin();
    document.env.responsibleEventLoop.runScriptEvaluation(entry, () => {
      call(member, browser.window.location, browser.window.location, 'next');
    });
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://other.test/entry/next');
    expect(navigate.mock.calls[0]![1]).toBe(entry.window.document);
  });

  it('permits assign when entry and relevant Document domains have both relaxed', async () => {
    const { browser, document, navigate } = await createTarget();
    const entry = createCaller(browser, 'https://sub.example.test/entry/');
    entry.window.document.origin = obtainURLOrigin(parseURL('https://sub.example.test/').url!);
    if (document.origin.kind !== 'tuple' || entry.window.document.origin.kind !== 'tuple') throw new Error('Expected tuple origins');
    document.origin.domain = { kind: 'domain', value: 'example.test' };
    entry.window.document.origin.domain = { kind: 'domain', value: 'example.test' };
    document.env.responsibleEventLoop.runScriptEvaluation(entry, () => browser.window.location.assign('/next'));
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://sub.example.test/next');
  });

  it.each([
    ['href', false, 'replace'], ['href', true, 'auto'],
    ['assign', false, 'replace'], ['assign', true, 'auto'],
    ['replace', false, 'replace'], ['replace', true, 'replace'],
  ] as const)('selects history for %s during loading with incumbent activation %s', async (member, active, historyHandling) => {
    const { browser, document, navigate } = await createTarget();
    const incumbent = createCaller(browser, 'https://example.test/source/');
    document.completelyLoadedTime = null;
    const sourceActivation = vi.spyOn(incumbent.window, 'hasTransientActivation').mockReturnValue(active);
    const targetActivation = vi.spyOn(getRelevantRealm(browser.window).env.window, 'hasTransientActivation');
    document.env.responsibleEventLoop.runScriptEvaluation(incumbent, () => {
      call(member, browser.window.location, browser.window.location, '/next');
    });
    expect(sourceActivation).toHaveBeenCalledOnce();
    expect(targetActivation).not.toHaveBeenCalled();
    expect(navigate.mock.calls[0]![2]).toEqual({ exceptionsEnabled: true, historyHandling });
  });

  it('leaves transient activation explicit instead of treating every loading write as unactivated', async () => {
    const { browser, document, navigate } = await createTarget();
    document.completelyLoadedTime = null;
    expect(() => browser.window.location.assign('/next')).toThrow('Window transient activation is not implemented');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('forwards Window.location and Document.location through href without losing the modeled incumbent', async () => {
    const { browser, document, navigate } = await createTarget();
    const entry = createCaller(browser, 'https://example.test/entry/');
    const incumbent = createCaller(browser, 'https://example.test/source/');
    const loop = document.env.responsibleEventLoop;
    loop.runScriptEvaluation(entry, () => loop.runPlatformCall(document.env.realm, incumbent, () => {
      Reflect.set(browser.window, 'location', 'from-window');
      Reflect.set(browser.document, 'location', 'from-document');
    }));
    expect(navigate.mock.calls.map(([url, source]) => [serializeURL(url), source])).toEqual([
      ['https://example.test/entry/from-window', incumbent.window.document],
      ['https://example.test/entry/from-document', incumbent.window.document],
    ]);
  });

  it('retains the backup incumbent for a bound platform callback', async () => {
    const { browser, document, navigate } = await createTarget();
    const incumbent = createCaller(browser, 'https://example.test/callback/');
    const loop = document.env.responsibleEventLoop;
    loop.runScriptEvaluation(document.env, () => {
      loop.prepareToRunCallback(incumbent);
      try { browser.window.location.replace('/next'); }
      finally { loop.cleanUpAfterRunningCallback(incumbent); }
    });
    expect(navigate.mock.calls[0]![1]).toBe(incumbent.window.document);
    expect(loop.backupIncumbentEnvironmentStack).toHaveLength(0);
  });

  it('realizes navigation failures in a borrowed member\'s realm', async () => {
    const { browser, navigate } = await createTarget();
    const method = createCaller(browser, 'https://example.test/method/');
    navigate.mockImplementation(() => { throw new DOMExceptionImpl('Blocked navigation', 'SecurityError'); });
    let caught: unknown;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the borrowed method with the target Location.
    try { Reflect.apply(method.realm.globalObject.location.replace, browser.window.location, ['https://example.test/next']); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(method.realm.globalObject.DOMException);
    expect(caught).not.toBeInstanceOf(browser.window.DOMException);
    expect(caught).toMatchObject({ name: 'SecurityError', message: 'Blocked navigation' });
  });

  it.each(['href', 'assign', 'replace'] as const)('navigates the live relevant Document through retained %s', async (member) => {
    const { browser, document, navigable, navigate } = await createTarget();
    const previousLocation = browser.window.location;
    await browser.navigate('https://example.test/replacement/page');
    const currentDocument = unwrap<DocumentImpl>(browser.document);
    expect(previousLocation).not.toBe(browser.window.location);
    expect(previousLocation.href).toBe('https://example.test/replacement/page');
    expect(document.getRelevantGlobalObject()!.navigable).toBeNull();
    expect(currentDocument.getNodeNavigable()).toBe(navigable);
    currentDocument.env.responsibleEventLoop.runScriptEvaluation(currentDocument.env, () => {
      call(member, previousLocation, previousLocation, 'next');
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), currentDocument, {
      exceptionsEnabled: true, historyHandling: member === 'replace' ? 'replace' : 'auto',
    });
    expect(navigate.mock.contexts[0]).toBe(navigable);
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test/replacement/next');
    expect(serializeURL(document.url)).toBe('https://example.test/current/page');
    expect(previousLocation.href).toBe('https://example.test/replacement/page');
  });

  it.each(['href', 'assign', 'replace'] as const)('keeps the entry-origin rule for retained %s after foreign replacement', async (member) => {
    const { browser, document, navigable, navigate } = await createTarget();
    const previousLocation = browser.window.location;
    const entry = createCaller(browser, 'https://example.test/source/');
    const parse = vi.spyOn(entry, 'encodingParseURL');
    await browser.navigate('https://other.test/replacement');
    expect(document.getRelevantGlobalObject()!.navigable).toBeNull();
    expect(unwrap<DocumentImpl>(browser.document).getNodeNavigable()).toBe(navigable);
    const write = () => entry.responsibleEventLoop.runScriptEvaluation(entry, () => {
      call(member, previousLocation, previousLocation, 'next');
    });
    if (member === 'assign') {
      expect(write).toThrow(expect.objectContaining({ name: 'SecurityError' }));
      expect(parse).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } else {
      write();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), entry.window.document, {
        exceptionsEnabled: true, historyHandling: member === 'replace' ? 'replace' : 'auto',
      });
      expect(navigate.mock.contexts[0]).toBe(navigable);
      expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test/source/next');
    }
  });

  it.each([false, true])('uses the live Document loading state for retained writes with incumbent activation %s', async (active) => {
    const { browser, document, navigate } = await createTarget();
    const previousLocation = browser.window.location;
    await browser.navigate('https://example.test/replacement');
    const currentDocument = unwrap<DocumentImpl>(browser.document);
    currentDocument.completelyLoadedTime = null;
    expect(document.completelyLoadedTime).not.toBeNull();
    const sourceActivation = vi.spyOn(currentDocument.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(active);
    const previousActivation = vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation');
    currentDocument.env.responsibleEventLoop.runScriptEvaluation(currentDocument.env, () => {
      call('href', previousLocation, previousLocation, '/next');
    });
    expect(sourceActivation).toHaveBeenCalledOnce();
    expect(previousActivation).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), currentDocument, {
      exceptionsEnabled: true, historyHandling: active ? 'auto' : 'replace',
    });
  });

  it.each(['href', 'assign', 'replace'] as const)('does not navigate through retained %s after its owning Window disconnects', async (member) => {
    const { browser, document, navigate } = await createTarget();
    const previousLocation = browser.window.location;
    await browser.navigate('https://example.test/replacement');
    const currentDocument = unwrap<DocumentImpl>(browser.document);
    const parse = vi.spyOn(currentDocument.env, 'encodingParseURL');
    const convert = vi.fn(() => 'http://[');
    document.browsingContext = null;
    currentDocument.env.responsibleEventLoop.runScriptEvaluation(currentDocument.env, () => {
      call(member, previousLocation, previousLocation, { toString: convert });
    });
    expect(convert).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

/** Exercise real Location bindings while observing only the unfinished navigation effect. */
async function createTarget() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current/page');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  const navigate = vi.spyOn(navigable, 'navigate').mockImplementation(() => {});
  return { browser, document, navigable, navigate };
}

/** Supply another realm on the same agent without depending on iframe startup. */
function createCaller(browser: Browlet, url: string): WindowEnvironment {
  const realm = getRelevantRealm(createSiblingWindow(browser));
  const document = realm.env.window.document;
  document.url = parseURL(url).url!;
  document.origin = unwrap<DocumentImpl>(browser.document).origin;
  return realm.env;
}

function call(member: 'href' | 'assign' | 'replace', owner: Location, receiver: Location, value: unknown): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the borrowed setter with its explicit receiver.
  if (member === 'href') Reflect.apply(Object.getOwnPropertyDescriptor(owner, 'href')!.set!, receiver, [value]);
  else Reflect.apply(owner[member], receiver, [value]);
}
