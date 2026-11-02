import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSessionHistoryEntry } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { NavigationCurrentEntryChangeEvent } from '../../../src/browlet/platform';
import { createOpaqueOrigin } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Navigation same-document entry updates', () => {
  it('pushes after the current entry, disposing the forward entries in list order', async () => {
    const { browser, document, navigation, entries } = await fixture();
    const previous = browser.window.navigation.entries();
    const added = createSessionHistoryEntry({ ...entries[0]!.documentState, document });
    const order: unknown[] = [];
    browser.window.navigation.oncurrententrychange = (event) => {
      const change = event as NavigationCurrentEntryChangeEvent;
      order.push({
        type: change.navigationType, from: change.from === previous[1],
        index: browser.window.navigation.currentEntry!.index,
        entries: browser.window.navigation.entries().length,
        flags: [event.isTrusted, event.bubbles, event.cancelable, event.composed],
      });
    };
    for (const [index, entry] of previous.entries()) {
      entry.ondispose = (event) => {
        order.push({ disposed: index, index: entry.index, target: event.target === entry, trusted: event.isTrusted });
      };
    }
    navigation.updateEntriesForSameDocumentNavigation(added, 'push');
    const current = browser.window.navigation.entries();
    expect(current.slice(0, 2)).toEqual(previous.slice(0, 2));
    expect(current[2]).not.toBe(previous[2]);
    expect(getRelevantRealm(current[2]!)).toBe(document.env.realm);
    expect(browser.window.navigation.currentEntry).toBe(current[2]);
    expect(browser.window.navigation.canGoBack).toBe(true);
    expect(browser.window.navigation.canGoForward).toBe(false);
    expect(order).toEqual([
      { type: 'push', from: true, index: 2, entries: 3, flags: [true, false, false, false] },
      { disposed: 2, index: -1, target: true, trusted: true },
      { disposed: 3, index: -1, target: true, trusted: true },
    ]);
  });

  it.each(['replace', 'reload', 'traverse'] as const)('updates %s identities without truncating forward history', async (type) => {
    const { browser, document, navigation, entries } = await fixture();
    const previous = browser.window.navigation.entries();
    const destination = type === 'replace' ? createSessionHistoryEntry({ ...entries[1]!.documentState, document }) : entries[0]!;
    const disposed: number[] = [];
    const changes: unknown[] = [];
    for (const [index, entry] of previous.entries()) entry.ondispose = () => { disposed.push(index); };
    browser.window.navigation.oncurrententrychange = (event) => {
      const change = event as NavigationCurrentEntryChangeEvent;
      changes.push([change.navigationType, change.from === previous[1], browser.window.navigation.currentEntry!.index]);
    };
    navigation.updateEntriesForSameDocumentNavigation(destination, type);
    const current = browser.window.navigation.entries();
    expect(current).toHaveLength(4);
    expect(current[0]).toBe(previous[0]);
    expect(current[2]).toBe(previous[2]);
    expect(current[3]).toBe(previous[3]);
    if (type === 'replace') {
      expect(current[1]).not.toBe(previous[1]);
      expect(previous[1]!.index).toBe(-1);
    } else {
      expect(current[1]).toBe(previous[1]);
    }
    expect(changes).toEqual([[type, true, type === 'traverse' ? 0 : 1]]);
    expect(disposed).toEqual(type === 'replace' ? [1] : []);
  });

  it('notifies the captured method tracker before entry-change and disposal callbacks', async () => {
    const { browser, document, navigation, entries } = await fixture();
    const destination = createSessionHistoryEntry({ ...entries[1]!.documentState, document });
    const tracker = navigation.setupNavigateReloadMethodTracker(undefined, document.env.serializeForStorage({ value: 42 }));
    navigation.ongoingAPIMethodTracker = tracker;
    const callbacks: string[] = [];
    const check = (name: string) => {
      expect(tracker.committedToEntry).toBe(navigation.currentEntry);
      expect(tracker.serializedState).toBeNull();
      expect(browser.window.navigation.currentEntry!.getState()).toEqual({ value: 42 });
      expect(document.env.responsibleEventLoop.runningExecutionContext).toBe(document.env.realmExecutionContext);
      callbacks.push(name);
    };
    browser.window.navigation.oncurrententrychange = () => { check('change'); };
    browser.window.navigation.currentEntry!.ondispose = () => { check('dispose'); };
    navigation.updateEntriesForSameDocumentNavigation(destination, 'replace');
    expect(callbacks).toEqual(['change', 'dispose']);
    expect(document.env.responsibleEventLoop.executionContextStack).toEqual([]);
  });

  it('updates an entry without inventing a navigate event or success notification', async () => {
    const { browser, navigation, entries } = await fixture();
    const events: string[] = [];
    browser.window.navigation.oncurrententrychange = () => { events.push('change'); };
    browser.window.navigation.onnavigatesuccess = () => { events.push('success'); };
    navigation.updateEntriesForSameDocumentNavigation(entries[0]!, 'traverse');
    expect(events).toEqual(['change']);
    expect(navigation.ongoingNavigateEvent).toBeNull();
  });

  it.each(['inactive', 'initial', 'opaque'] as const)('leaves disabled %s entries and notifications alone', async (condition) => {
    const { browser, document, navigation, entries } = await fixture();
    const previous = [...navigation.entryList];
    const events: string[] = [];
    browser.window.navigation.oncurrententrychange = () => { events.push('change'); };
    for (const entry of browser.window.navigation.entries()) entry.ondispose = () => { events.push('dispose'); };
    if (condition === 'inactive') document.browsingContext = null;
    else if (condition === 'initial') document.isInitialAboutBlank = true;
    else document.origin = createOpaqueOrigin();
    navigation.updateEntriesForSameDocumentNavigation(entries[0]!, 'replace');
    expect(navigation.entryList).toEqual(previous);
    expect(navigation.currentEntryIndex).toBe(1);
    expect(events).toEqual([]);
  });

  it('requires a traversal destination already present by session-history identity', async () => {
    const { navigation, entries } = await fixture();
    expect(() => navigation.updateEntriesForSameDocumentNavigation({ ...entries[0]! }, 'traverse'))
      .toThrow('Traversal requires an existing Navigation entry');
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const active = document.getNodeNavigable()!.activeSessionHistoryEntry;
  const entries = [active, ...Array.from({ length: 3 }, () => createSessionHistoryEntry({ ...active.documentState, document }))];
  // §7.4 history application supplies these already-selected session-history records.
  navigation.entryList = [];
  navigation.currentEntryIndex = -1;
  navigation.initializeEntriesForNewDocument(entries, entries[1]!);
  return { browser, document, navigation, entries };
}
