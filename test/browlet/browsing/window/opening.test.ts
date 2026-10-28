/* eslint-disable @typescript-eslint/unbound-method -- Invoke retained Window accessors with explicit receivers. */
import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('Window opening and closing state', () => {
  it('reads and updates the active history entry target name through the IDL attribute', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const state = window.navigable!.activeSessionHistoryEntry.documentState;
    expect(browser.window.name).toBe('');
    Reflect.set(browser.window, 'name', { toString: () => 'named window' });
    expect(state.navigableTargetName).toBe('named window');
    state.navigableTargetName = 'renamed internally';
    expect(browser.window.name).toBe('renamed internally');
  });

  it('reports whether its navigable is closing or absent', () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const window = getRelevantRealm(proxy).windowImplementation;
    const navigable = window.navigable!;
    expect(proxy.closed).toBe(false);
    navigable.isClosing = true;
    expect(proxy.closed).toBe(true);
    navigable.isClosing = false;
    window.document.browsingContext = null;
    expect(proxy.closed).toBe(true);
  });

  it('keeps inactive Window name and closed getters tied to their own Document', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    browser.window.name = 'original';
    const previousRealm = getRelevantRealm(browser.window);
    const previousState = previousRealm.windowImplementation.navigable!.activeSessionHistoryEntry.documentState;
    const name = Object.getOwnPropertyDescriptor(previousRealm.globalObject, 'name')!;
    const closed = Object.getOwnPropertyDescriptor(previousRealm.globalObject, 'closed')!;

    await browser.navigate('https://example.test/second');

    expect(Reflect.apply(name.get!, previousRealm.globalObject, [])).toBe('');
    Reflect.apply(name.set!, previousRealm.globalObject, ['ignored']);
    expect(previousState.navigableTargetName).toBe('original');
    expect(browser.window.name).toBe('original');
    expect(Reflect.apply(closed.get!, previousRealm.globalObject, [])).toBe(true);
    expect(browser.window.closed).toBe(false);
  });

  it('resets the target name on cross-origin navigation', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    browser.window.name = 'private name';
    await browser.navigate('https://other.test/');
    expect(browser.window.name).toBe('');
  });

  it('permits cross-origin closed reads and close calls but protects name and stop', () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const targetWindow = getRelevantRealm(target.window).windowImplementation;
    const closed = Object.getOwnPropertyDescriptor(caller.window, 'closed')!;
    const name = Object.getOwnPropertyDescriptor(caller.window, 'name')!;
    expect(Reflect.apply(closed.get!, target.window, [])).toBe(false);
    expect(() => { Reflect.apply(name.get!, target.window, []); }).toThrow(caller.window.DOMException);
    expect(() => { Reflect.apply(caller.window.stop, target.window, []); }).toThrow(caller.window.DOMException);
    targetWindow.navigable!.isClosing = true;
    expect(Reflect.apply(closed.get!, target.window, [])).toBe(true);
    expect(Reflect.apply(caller.window.close, target.window, [])).toBeUndefined();
  });

  it('makes close and stop no-ops for an inactive Window', () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    getRelevantRealm(proxy).windowImplementation.document.browsingContext = null;
    expect(proxy.close()).toBeUndefined();
    expect(proxy.stop()).toBeUndefined();
  });

  it('hands stop to the active navigable', () => {
    const browser = new Browlet({ route: () => '' });
    const navigable = getRelevantRealm(browser.window).windowImplementation.navigable!;
    const stopLoading = vi.spyOn(navigable, 'stopLoading').mockImplementation(() => {});
    try {
      browser.window.stop();
      expect(stopLoading).toHaveBeenCalledExactlyOnceWith();
    } finally {
      stopLoading.mockRestore();
    }
  });

  it('requires a top-level traversable and either web creation or a single history entry for script-closability', () => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    expect(traversable.isScriptClosable).toBe(true);
    traversable.sessionHistoryEntries.push({ ...traversable.activeSessionHistoryEntry });
    expect(traversable.isScriptClosable).toBe(false);
    traversable.isCreatedByWebContent = true;
    expect(traversable.isScriptClosable).toBe(true);

    const [, childDocument] = BrowsingContext.createTopLevel(new UserAgent());
    const navigable = new Navigable(createDocumentState(childDocument), traversable);
    expect(navigable.isScriptClosable).toBe(false);
    expect(getRelevantRealm(childDocument).windowProxy.platform.close()).toBeUndefined();
  });
});

describe('window-open entry', () => {
  it.each(['_self', '_PARENT', '_Top'])('returns the existing special target %s without navigating for an empty URL', (target) => {
    const browser = new Browlet({ route: () => '' });
    expect(browser.window.open('', target)).toBe(browser.window);
  });

  it('distinguishes the parent and top targets in a nested navigable tree', () => {
    const userAgent = new UserAgent();
    const top = TopLevelTraversable.create(userAgent, null, '');
    // Compose the hierarchy explicitly until child browsing-context creation is implemented.
    const [, parentDocument] = BrowsingContext.createTopLevel(userAgent);
    const parent = new Navigable(createDocumentState(parentDocument), top);
    const [, childDocument] = BrowsingContext.createTopLevel(userAgent);
    const child = new Navigable(createDocumentState(childDocument), parent);
    const window = child.activeWindowProxy.platform;

    expect(window.open('', '_self')).toBe(window);
    expect(window.open('', '_parent')).toBe(parent.activeWindowProxy.platform);
    expect(window.open('', '_top')).toBe(top.activeWindowProxy.platform);
  });

  it('performs IDL conversion before the termination guard, and the guard before URL parsing', () => {
    const browser = new Browlet({ route: () => '' });
    const eventLoop = getRelevantRealm(browser.window).env.responsibleEventLoop;
    eventLoop.terminationNestingLevel = 1;
    try {
      expect(browser.window.open('https://[')).toBeNull();
      expect(() => { Reflect.apply(browser.window.open, browser.window, [Symbol()]); })
        .toThrow(Reflect.get(browser.window, 'TypeError'));
    } finally {
      eventLoop.terminationNestingLevel = 0;
    }
  });

  it('throws a realm-owned SyntaxError DOMException for invalid URLs', () => {
    const browser = new Browlet({ route: () => '' });
    expect(() => browser.window.open('https://[')).toThrow(browser.window.DOMException);
    expect(() => browser.window.open('https://[')).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  it('uses the entry Document when invoking a previous realm\'s open function', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const previousRealm = getRelevantRealm(browser.window);
    const previousOpen = browser.window.open;
    const previousParse = vi.spyOn(previousRealm.windowImplementation.document, 'encodingParseURL');
    await browser.navigate('https://example.test/second');
    expect(getRelevantRealm(browser.window).agent).toBe(previousRealm.agent);
    const currentParse = vi.spyOn(getRelevantRealm(browser.window).windowImplementation.document, 'encodingParseURL');
    Reflect.set(browser.window, 'previousOpen', previousOpen);
    try {
      expect(await browser.evaluate((url) => {
        const open = Reflect.get(globalThis, 'previousOpen') as typeof window.open;
        try { Reflect.apply(open, globalThis, [url]); }
        catch (error) { return (error as { name: string; }).name; }
        return 'did not throw';
      }, 'https://[')).toBe('SyntaxError');
      expect(previousParse).not.toHaveBeenCalled();
      expect(currentParse).toHaveBeenCalledExactlyOnceWith('https://[');
    } finally {
      previousParse.mockRestore();
      currentParse.mockRestore();
    }
  });
});
