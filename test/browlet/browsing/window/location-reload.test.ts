import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-reload
describe('Location reload preparation', () => {
  it('rejects a derived receiver through Web IDL', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise an explicit invalid receiver.
      try { Reflect.apply(location.reload, Object.create(location), []); }
      catch (error) { return error instanceof TypeError; }
      return false;
    })).toBe(true);
  });

  it('returns for a null relevant Document before checking a foreign entry origin', async () => {
    const browser = await createBrowser();
    const location = browser.window.location;
    const document = unwrap<DocumentImpl>(browser.document);
    const entry = getRelevantRealm(createSiblingWindow(browser)).env;
    entry.window.document.origin = createOpaqueOrigin();
    const reload = observeReload(browser);
    document.browsingContext = null;
    expect(entry.responsibleEventLoop.runScriptEvaluation(entry, () => location.reload())).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
    expect(entry.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });

  it('checks the entry origin independently and realizes the error in the method realm', async () => {
    const browser = await createBrowser();
    const location = browser.window.location;
    const entry = getRelevantRealm(createSiblingWindow(browser)).env;
    entry.window.document.origin = createOpaqueOrigin();
    const reload = observeReload(browser);
    const run = () => entry.responsibleEventLoop.runScriptEvaluation(entry, () => location.reload());
    expect(run).toThrow(browser.window.DOMException);
    expect(run).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(reload).not.toHaveBeenCalled();
    expect(entry.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });

  it('allows same-origin-domain entry only after both domains have relaxed', async () => {
    const browser = await createBrowser();
    const document = unwrap<DocumentImpl>(browser.document);
    const entry = getRelevantRealm(createSiblingWindow(browser)).env;
    entry.window.document.origin = obtainURLOrigin(parseURL('https://sub.example.test/').url!);
    if (document.origin.kind !== 'tuple' || entry.window.document.origin.kind !== 'tuple') {
      throw new Error('Expected tuple origins');
    }
    const reload = observeReload(browser);
    document.origin.domain = { kind: 'domain', value: 'example.test' };
    const run = () => entry.responsibleEventLoop.runScriptEvaluation(entry, () => browser.window.location.reload());
    expect(run).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(reload).not.toHaveBeenCalled();
    entry.window.document.origin.domain = { kind: 'domain', value: 'example.test' };
    expect(run()).toBeUndefined();
    expect(reload).toHaveBeenCalledExactlyOnceWith();
  });

  it('hands the active Document to its navigable without parsing a URL or consulting activation', async () => {
    const browser = await createBrowser();
    const document = unwrap<DocumentImpl>(browser.document);
    const navigable = document.getNodeNavigable()!;
    const reload = observeReload(browser);
    const originalURL = document.url;
    const originalEntry = navigable.activeSessionHistoryEntry;
    const parse = vi.spyOn(document.env, 'encodingParseURL');
    const activation = vi.spyOn(getRelevantRealm(browser.window).env.window, 'hasTransientActivation');
    expect(await browser.evaluate(() => location.reload())).toBeUndefined();
    expect(reload).toHaveBeenCalledExactlyOnceWith();
    expect(reload.mock.contexts[0]).toBe(navigable);
    expect(parse).not.toHaveBeenCalled();
    expect(activation).not.toHaveBeenCalled();
    expect(document.url).toBe(originalURL);
    expect(navigable.activeSessionHistoryEntry).toBe(originalEntry);
    expect(originalEntry.documentState.reloadPending).toBe(false);
  });

  it('uses the receiver Document when borrowing another Window\'s reload method', async () => {
    const browser = await createBrowser();
    const methodWindow = createSiblingWindow(browser);
    unwrap<DocumentImpl>(methodWindow.document).origin = unwrap<DocumentImpl>(browser.document).origin;
    const reload = observeReload(browser);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the borrowed method with its receiver.
    expect(Reflect.apply(methodWindow.location.reload, browser.window.location, [])).toBeUndefined();
    expect(reload).toHaveBeenCalledExactlyOnceWith();
  });

  it('uses the live Document navigable for a retained Location after replacement', async () => {
    const browser = await createBrowser();
    const location = browser.window.location;
    const oldDocument = unwrap<DocumentImpl>(browser.document);
    await browser.navigate('https://example.test/replacement');
    expect(oldDocument.getNodeNavigable()).toBeNull();
    const reload = observeReload(browser);
    expect(location.reload()).toBeUndefined();
    expect(reload).toHaveBeenCalledExactlyOnceWith();
  });

  it('denies a retained Location after a foreign replacement before reloading', async () => {
    const browser = await createBrowser();
    const location = browser.window.location;
    const DOMException = browser.window.DOMException;
    await browser.navigate('https://other.test/replacement');
    const reload = observeReload(browser);
    expect(() => location.reload()).toThrow(DOMException);
    expect(() => location.reload()).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(reload).not.toHaveBeenCalled();
  });

  it('uses the replacement receiver when calling a retained method', async () => {
    const browser = await createBrowser();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Retain the old method for an explicit receiver call.
    const method = browser.window.location.reload;
    await browser.navigate('https://example.test/replacement');
    const reload = observeReload(browser);
    expect(Reflect.apply(method, browser.window.location, [])).toBeUndefined();
    expect(reload).toHaveBeenCalledExactlyOnceWith();
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  return browser;
}

/** Observe the reload coordinator without simulating its unfinished navigation effects. */
function observeReload(browser: Browlet) {
  const navigable = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
  return vi.spyOn(navigable, 'reload').mockImplementation(() => {});
}
