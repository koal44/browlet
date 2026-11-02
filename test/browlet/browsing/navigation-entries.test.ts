import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import type { NavigationHistoryEntryImpl } from '../../../src/browlet/browsing/navigation/api/navigation-history-entry';
import { createDocumentState, createSessionHistoryEntry } from '../../../src/browlet/browsing/navigation/state/index';
import { Navigable } from '../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Navigation entry lists', () => {
  it('disables entries for initial about:blank, even with an inherited tuple origin', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    document.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    expect(document.isFullyActive()).toBe(true);
    expect(document.isInitialAboutBlank).toBe(true);
    expect(browser.window.navigation.entries()).toEqual([]);
    expect(browser.window.navigation.currentEntry).toBeNull();
    expect(browser.window.navigation.canGoBack).toBe(false);
    expect(browser.window.navigation.canGoForward).toBe(false);
  });

  it('initializes before parser scripts run and returns fresh arrays of stable entries', async () => {
    const browser = new Browlet({ route: () => '<script>globalThis.entryAtParse = navigation.currentEntry;</script>' });
    await browser.navigate('https://example.test/first');
    expect(await browser.evaluate(() => {
      const first = navigation.entries();
      const second = navigation.entries();
      first.length = 0;
      const entry = navigation.currentEntry!;
      let constructible = true;
      try { Reflect.construct(NavigationHistoryEntry, []); } catch (error) { constructible = !(error instanceof TypeError); }
      return {
        parsed: Reflect.get(globalThis, 'entryAtParse') === entry,
        fresh: first !== second, intact: navigation.entries().length,
        stable: second[0] === entry && navigation.currentEntry === entry,
        realm: second instanceof Array && entry instanceof NavigationHistoryEntry && entry instanceof EventTarget,
        url: entry.url, index: entry.index, sameDocument: entry.sameDocument,
        state: entry.getState() as unknown, canGoBack: navigation.canGoBack, canGoForward: navigation.canGoForward,
        constructible, writable: Reflect.set(entry, 'key', 'changed'),
      };
    })).toEqual({
      parsed: true, fresh: true, intact: 1, stable: true, realm: true,
      url: 'https://example.test/first', index: 0, sameDocument: true,
      state: undefined, canGoBack: false, canGoForward: false, constructible: false, writable: false,
    });
  });

  it('includes entry zero and recreates its platform identity in the new Window', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const old = browser.window.navigation.currentEntry!;
    const { key, id } = old;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(key);
    await browser.navigate('https://example.test/second');
    const entries = browser.window.navigation.entries();
    expect(entries.map((entry) => entry.url)).toEqual(['https://example.test/first', 'https://example.test/second']);
    expect(entries[0]).not.toBe(old);
    expect(entries[0]).toMatchObject({ key, id, index: 0, sameDocument: false });
    expect(getRelevantRealm(entries[0]!)).toBe(getRelevantRealm(browser.window));
    expect(entries[1]).toBe(browser.window.navigation.currentEntry);
    expect(entries[1]!.sameDocument).toBe(true);
    expect(browser.window.navigation.canGoBack).toBe(true);
    expect(browser.window.navigation.canGoForward).toBe(false);
  });

  it('retains the position key on replacement, while giving the new entry a new ID', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/current');
    const { key, id } = browser.window.navigation.currentEntry!;
    await browser.navigate('https://example.test/current');
    const entry = browser.window.navigation.currentEntry!;
    expect(entry.key).toBe(key);
    expect(entry.id).not.toBe(id);
    expect(browser.window.navigation.entries()).toHaveLength(1);
  });

  it('stops at a cross-origin boundary even when older entries have the same origin', async () => {
    const browser = new Browlet({ route: () => '' });
    for (const url of ['https://example.test/first', 'https://other.test/boundary', 'https://example.test/last']) {
      await browser.navigate(url);
    }
    expect(browser.window.navigation.entries().map((entry) => entry.url)).toEqual(['https://example.test/last']);
    expect(browser.window.navigation.currentEntry!.index).toBe(0);
    expect(browser.window.navigation.canGoBack).toBe(false);
    expect(browser.window.history.length).toBe(3);
  });

  it('keeps entries disabled for a loaded opaque-origin Document', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('data:text/html,opaque');
    expect(unwrap<DocumentImpl>(browser.document).isInitialAboutBlank).toBe(false);
    expect(browser.window.navigation.entries()).toEqual([]);
    expect(browser.window.navigation.currentEntry).toBeNull();
    expect(browser.window.navigation.canGoBack).toBe(false);
    expect(browser.window.navigation.canGoForward).toBe(false);
  });

  it.each(['replace', 'detach'] as const)('hides retained Navigation and entry values after %s', async (change) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const navigation = browser.window.navigation;
    const entry = navigation.currentEntry!;
    const document = unwrap<DocumentImpl>(browser.document);
    const deserialize = vi.spyOn(document.env, 'deserialize');
    if (change === 'replace') await browser.navigate('https://example.test/second');
    else document.browsingContext = null;
    expect(navigation.entries()).toEqual([]);
    expect(navigation.currentEntry).toBeNull();
    expect(navigation.canGoBack).toBe(false);
    expect(navigation.canGoForward).toBe(false);
    expect(entry).toMatchObject({ key: '', id: '', url: '', index: -1, sameDocument: false });
    expect(entry.getState()).toBeUndefined();
    expect(deserialize).not.toHaveBeenCalled();
  });

  it('selects around a target-step gap and retains both back and forward entries', async () => {
    const { browser, document, navigable } = await fixture();
    const entries = [0, 3, 7].map((step) => {
      const state = createDocumentState(document);
      state.origin = document.origin;
      return { ...createSessionHistoryEntry(state), step };
    });
    navigable.traversable.sessionHistoryEntries = entries;
    expect(navigable.getSessionHistoryEntriesForNavigationAPI(5)).toEqual(entries);
    const navigation = document.getRelevantGlobalObject()!.navigation;
    // Traversal/reactivation are unfinished; provide their entry-list inputs at the owner boundary.
    navigation.entryList = [];
    navigation.currentEntryIndex = -1;
    navigation.initializeEntriesForNewDocument(entries, entries[1]!);
    expect(browser.window.navigation.currentEntry!.index).toBe(1);
    expect(browser.window.navigation.canGoBack).toBe(true);
    expect(browser.window.navigation.canGoForward).toBe(true);
    expect(navigation.getEntryIndex({ ...entries[1]! })).toBe(-1);
    expect(() => navigation.initializeEntriesForNewDocument(entries, entries[1]!)).toThrow('already initialized');
    entries[2]!.documentState.origin = createOpaqueOrigin();
    expect(navigable.getSessionHistoryEntriesForNavigationAPI(5)).toEqual(entries.slice(0, 2));
  });

  it('selects the child history rather than the parent list, including deeper retained lists', async () => {
    const { navigable: parent } = await fixture();
    const childBrowser = new Browlet({ route: () => '' });
    const childDocument = unwrap<DocumentImpl>(childBrowser.document);
    childDocument.browsingContext = new BrowsingContext();
    const child = new Navigable(createDocumentState(childDocument), parent);
    const childState = createDocumentState(childDocument);
    childState.origin = obtainURLOrigin(parseURL('https://child.test/').url!);
    const childEntries = [0, 2].map((step) => ({ ...createSessionHistoryEntry(childState), step }));
    // Child history production is unfinished; provide retained records at its owner boundary.
    const intermediateState = createDocumentState(null);
    intermediateState.nestedHistories.push({ id: child.id, entries: childEntries });
    parent.activeSessionHistoryEntry.documentState.nestedHistories.push({
      id: Symbol('intermediate'), entries: [{ ...childEntries[0]!, documentState: intermediateState }],
    });
    expect(child.getSessionHistoryEntries()).toBe(childEntries);
    expect(child.getSessionHistoryEntriesForNavigationAPI(2)).toEqual(childEntries);
    expect(parent.getSessionHistoryEntries()).toBe(parent.traversable.sessionHistoryEntries);
  });
});

describe('NavigationHistoryEntry state and metadata', () => {
  it('deserializes a fresh state graph on each read, independently of History.state', async () => {
    const { browser, document, navigable } = await fixture();
    const state = await browser.evaluate(() => {
      const value: { items: number[]; self?: unknown; } = { items: [1] };
      value.self = value;
      return value;
    });
    navigable.activeSessionHistoryEntry.navigationAPIState = document.env.serializeForStorage(state);
    expect(await browser.evaluate(() => {
      const first = navigation.currentEntry!.getState() as { items: number[]; self: unknown; };
      const second = navigation.currentEntry!.getState() as typeof first;
      first.items.push(2);
      return {
        realm: first instanceof Object && first.items instanceof Array,
        fresh: first !== second && first.items !== second.items,
        cycle: first.self === first && second.self === second,
        items: second.items, historyState: history.state as unknown,
      };
    })).toEqual({ realm: true, fresh: true, cycle: true, items: [1], historyState: null });
  });

  it('uses a borrowed getState method realm while checking the receiver Document', async () => {
    const first = await fixture();
    const second = await fixture();
    first.navigable.activeSessionHistoryEntry.navigationAPIState = first.document.env.serializeForStorage({ items: [1] });
    const entry = first.browser.window.navigation.currentEntry!;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the method realm with an explicit foreign receiver.
    const getState = second.browser.window.NavigationHistoryEntry.prototype.getState;
    const state: unknown = Reflect.apply(getState, entry, []);
    expect(state).toBeInstanceOf(getRelevantRealm(second.browser.window).Object);
    expect(state).not.toBeInstanceOf(getRelevantRealm(first.browser.window).Object);
    first.document.browsingContext = null;
    expect(Reflect.apply(getState, entry, [])).toBeUndefined();
    expect(() => { Reflect.apply(getState, {}, []); }).toThrow(getRelevantRealm(second.browser.window).TypeError);
  });

  it('propagates deserialization failures', async () => {
    const { browser, document } = await fixture();
    const failure = new RangeError('allocation failed');
    vi.spyOn(document.env, 'deserialize').mockImplementation(() => { throw failure; });
    expect(() => { browser.window.navigation.currentEntry!.getState(); }).toThrow('allocation failed');
  });

  it.each(['no-referrer', 'origin', 'same-origin', 'strict-origin-when-cross-origin'] as const)(
    'applies request referrer policy %s only to another Document', async (policy) => {
      const { browser, document, navigable } = await fixture();
      const oldState = navigable.activeSessionHistoryEntry.documentState;
      oldState.requestReferrerPolicy = policy;
      expect(browser.window.navigation.currentEntry!.url).toBe('https://example.test/current');
      await browser.navigate('https://example.test/next');
      const entry = browser.window.navigation.entries()[0]!;
      expect(entry.sameDocument).toBe(false);
      expect(entry.url).toBe(policy === 'no-referrer' || policy === 'origin' ? null : 'https://example.test/current');
      // Retained metadata is still sufficient after eviction clears the live Document.
      oldState.document = null;
      expect(entry.url).toBe(policy === 'no-referrer' || policy === 'origin' ? null : 'https://example.test/current');
      expect(document.isFullyActive()).toBe(false);
    },
  );

  it('uses the Window-owned Navigation after its replaceable property is overwritten', async () => {
    const { browser, document } = await fixture();
    const entry = browser.window.navigation.currentEntry!;
    Reflect.set(browser.window, 'navigation', 'author replacement');
    expect(entry.index).toBe(0);
    const implementation = unwrap<NavigationHistoryEntryImpl>(entry);
    document.getRelevantGlobalObject()!.navigation.entryList = [];
    expect(implementation.index).toBe(-1);
  });

  it.each(['navigate', 'navigatesuccess', 'navigateerror', 'currententrychange', 'dispose'] as const)(
    'supports the on%s attribute through EventTarget dispatch', async (type) => {
      const { browser } = await fixture();
      expect(await browser.evaluate((eventType) => {
        const target = eventType === 'dispose' ? navigation.currentEntry! : navigation;
        const name = `on${eventType}`;
        let calls = 0;
        let correctThis = false;
        const callback = function(this: unknown, event: Event) {
          calls++;
          correctThis = this === target && event.target === target;
        };
        const initiallyNull = Reflect.get(target, name) === null;
        Reflect.set(target, name, callback);
        const stable = Reflect.get(target, name) === callback;
        target.dispatchEvent(new Event(eventType));
        Reflect.set(target, name, null);
        target.dispatchEvent(new Event(eventType));
        return { initiallyNull, stable, calls, correctThis };
      }, type)).toEqual({ initiallyNull: true, stable: true, calls: 1, correctThis: true });
    },
  );
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  return { browser, document, navigable: document.getNodeNavigable()! };
}
