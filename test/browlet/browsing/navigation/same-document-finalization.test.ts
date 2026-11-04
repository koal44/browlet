import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState, type SessionHistoryEntry } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('same-document finalization', () => {
  it.each([0, 1, 2])('inserts in the destination history at child depth %i without repeating activation', async (depth) => {
    const { document, traversable, turns } = await fixture();
    let target: Navigable = traversable;
    for (let i = 0; i < depth; i++) target = createChild(target);
    const previous = target.activeSessionHistoryEntry;
    const entries = target.getSessionHistoryEntries();
    const entry = createEntry(target, 'next');
    entry.navigationAPIState = document.env.serializeForStorage({ retained: true });
    const state = entry.navigationAPIState;
    const key = entry.navigationAPIKey;
    const id = entry.navigationAPIID;
    const latestEntry = target.activeDocument!.latestEntry;
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});
    target.activeSessionHistoryEntry = entry;
    traversable.appendSessionHistorySynchronousNavigationSteps(target, () => {
      traversable.finalizeSameDocumentNavigation(target, entry, null, 'push', 'activation');
    });

    expect(entry.step).toBe('pending');
    expect(entries).toEqual([previous]);
    turns.shift()!();

    expect(entries).toEqual([previous, entry]);
    expect(entry.step).toBe(1);
    expect(entry.navigationAPIState).toBe(state);
    expect(entry.navigationAPIKey).toBe(key);
    expect(entry.navigationAPIID).toBe(id);
    expect(target.activeSessionHistoryEntry).toBe(entry);
    expect(target.currentSessionHistoryEntry).toBe(previous);
    expect(target.activeDocument!.latestEntry).toBe(latestEntry);
    expect(traversable.currentSessionHistoryStep).toBe(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(1, 'push', 'activation', target, entry);
  });

  it('replaces the captured predecessor at its step without clearing forward history', async () => {
    const { traversable, turns } = await fixture();
    const child = createChild(traversable);
    const previous = child.activeSessionHistoryEntry;
    const future = createEntry(child, 'forward');
    future.step = 6;
    const entries = child.getSessionHistoryEntries();
    entries.push(future);
    const entry = createEntry(child, 'replacement');
    const newer = createEntry(child, 'newer');
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});
    const clear = vi.spyOn(traversable, 'clearForwardSessionHistory');
    child.activeSessionHistoryEntry = newer;
    child.currentSessionHistoryEntry = future;
    traversable.appendSessionHistorySynchronousNavigationSteps(child, () => {
      traversable.finalizeSameDocumentNavigation(child, entry, previous, 'replace', 'browser UI');
    });
    // Another navigable advances joint history while this child's request waits in the queue.
    traversable.currentSessionHistoryStep = 3;

    turns.shift()!();

    expect(entries).toEqual([entry, future]);
    expect(entry.step).toBe(previous.step);
    expect(clear).not.toHaveBeenCalled();
    expect(child.activeSessionHistoryEntry).toBe(newer);
    expect(child.currentSessionHistoryEntry).toBe(future);
    expect(apply).toHaveBeenCalledExactlyOnceWith(3, 'replace', 'browser UI', child, entry);
  });

  it('pushes from the live joint step and prunes forward entries across retained child histories', async () => {
    const { traversable, turns } = await fixture();
    const child = createChild(traversable);
    const grandchild = createChild(child);
    const topEntry = traversable.activeSessionHistoryEntry;
    const childEntry = child.activeSessionHistoryEntry;
    const grandchildEntry = grandchild.activeSessionHistoryEntry;
    for (const target of [traversable, child, grandchild]) {
      const future = createEntry(target, 'forward');
      future.step = 7;
      target.getSessionHistoryEntries().push(future);
    }
    const entry = createEntry(child, 'next');
    child.activeSessionHistoryEntry = entry;
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});
    traversable.appendSessionHistorySynchronousNavigationSteps(child, () => {
      traversable.finalizeSameDocumentNavigation(child, entry, null, 'push', 'none');
    });
    traversable.currentSessionHistoryStep = 4;

    turns.shift()!();

    expect(entry.step).toBe(5);
    expect(traversable.sessionHistoryEntries).toEqual([topEntry]);
    expect(child.getSessionHistoryEntries()).toEqual([childEntry, entry]);
    expect(grandchild.getSessionHistoryEntries()).toEqual([grandchildEntry]);
    expect(apply).toHaveBeenCalledExactlyOnceWith(5, 'push', 'none', child, entry);
  });

  it.each([
    ['push', 'push'], ['push', 'replace'], ['replace', 'replace'], ['replace', 'push'],
  ] as const)('preserves queued %s/%s entries even though the later entry is already active', async (first, second) => {
    const { document, traversable, turns } = await fixture();
    const initial = traversable.activeSessionHistoryEntry;
    const one = createEntry(traversable, 'one');
    const two = createEntry(traversable, 'two');
    const applied: SessionHistoryEntry[] = [];
    // Supply completion at the unfinished history-application boundary; queue and finalizer remain real.
    vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation((step, _handling, _involvement, _target, entry) => {
      traversable.currentSessionHistoryStep = step;
      applied.push(entry);
    });
    traversable.activeSessionHistoryEntry = one;
    traversable.appendSessionHistorySynchronousNavigationSteps(traversable, () => {
      traversable.finalizeSameDocumentNavigation(traversable, one, first === 'replace' ? initial : null, first, 'none');
    });
    traversable.activeSessionHistoryEntry = two;
    document.url = two.url;
    traversable.appendSessionHistorySynchronousNavigationSteps(traversable, () => {
      traversable.finalizeSameDocumentNavigation(traversable, two, second === 'replace' ? one : null, second, 'none');
    });
    // A pending cross-document navigation must retain its cancellation identity during reconciliation.
    traversable.ongoingNavigation = 'newer-cross-document-navigation';

    expect(turns).toHaveLength(1);
    turns.shift()!();

    const expected = first === 'push' ? [initial, one] : [one];
    if (second === 'push') expected.push(two);
    else expected[expected.length - 1] = two;
    expect(traversable.sessionHistoryEntries).toEqual(expected);
    expect(expected.map((entry) => entry.step)).toEqual(expected.map((_entry, index) => index));
    expect(applied).toEqual([one, two]);
    expect(traversable.currentSessionHistoryStep).toBe(expected.length - 1);
    expect(traversable.currentSessionHistoryEntry).toBe(initial);
    expect(traversable.activeSessionHistoryEntry).toBe(two);
    expect(document.url).toBe(two.url);
    expect(traversable.ongoingNavigation).toBe('newer-cross-document-navigation');
  });

  it.each(['replaced', 'destroyed'] as const)('discards a queued entry after its DocumentState is %s', async (kind) => {
    const { document, traversable, turns } = await fixture();
    const initial = traversable.activeSessionHistoryEntry;
    const entry = createEntry(traversable, 'stale');
    traversable.activeSessionHistoryEntry = entry;
    traversable.appendSessionHistorySynchronousNavigationSteps(traversable, () => {
      traversable.finalizeSameDocumentNavigation(traversable, entry, null, 'push', 'none');
    });
    if (kind === 'destroyed') {
      entry.documentState.document = null;
    } else {
      const [, replacement] = BrowsingContext.create(document, null, traversable.activeBrowsingContext!.group!);
      traversable.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));
    }
    const getEntries = vi.spyOn(traversable, 'getSessionHistoryEntries');
    const clear = vi.spyOn(traversable, 'clearForwardSessionHistory');
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep');

    turns.shift()!();

    expect(traversable.sessionHistoryEntries).toEqual([initial]);
    expect(entry.step).toBe('pending');
    expect(getEntries).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects a missing replacement predecessor without overwriting another entry', async () => {
    const { traversable, turns } = await fixture();
    const initial = traversable.activeSessionHistoryEntry;
    const missing = createEntry(traversable, 'missing');
    const entry = createEntry(traversable, 'replacement');
    traversable.activeSessionHistoryEntry = entry;
    traversable.appendSessionHistorySynchronousNavigationSteps(traversable, () => {
      traversable.finalizeSameDocumentNavigation(traversable, entry, missing, 'replace', 'none');
    });

    expect(() => turns.shift()!()).toThrow('The same-document replacement entry is not present in session history');
    expect(traversable.sessionHistoryEntries).toEqual([initial]);
    expect(entry.step).toBe('pending');
  });

  it('does not use new-Document activation to apply a same-document history step', async () => {
    const { browser, document, traversable } = await fixture();
    const navigation = document.getRelevantGlobalObject()!.navigation;
    const currentEntry = browser.window.navigation.currentEntry;
    const activation = browser.window.navigation.activation;
    const initialEntry = traversable.currentSessionHistoryEntry;
    const url = parseURL('https://example.test/page#next').url!;
    const entry = document.env.createSessionHistoryEntry(url, initialEntry.documentState);
    entry.step = 1;
    traversable.sessionHistoryEntries.push(entry);
    traversable.activeSessionHistoryEntry = entry;
    const initialize = vi.spyOn(navigation, 'initializeEntriesForNewDocument');
    const activate = vi.spyOn(document, 'makeActive');
    const visibility = vi.spyOn(document, 'setInitialVisibilityState');
    let failure: unknown;

    try {
      traversable.applyPushOrReplaceHistoryStep(1, 'push', 'none', traversable, entry);
    } catch (error) { failure = error; }

    expect(initialize).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(visibility).not.toHaveBeenCalled();
    expect(browser.window.navigation.currentEntry).toBe(currentEntry);
    expect(browser.window.navigation.activation).toBe(activation);
    expect(traversable.currentSessionHistoryEntry).toBe(initialEntry);
    expect(traversable.currentSessionHistoryStep).toBe(0);
    expect(failure).toEqual(expect.objectContaining({ message: 'Same-document history-step application is not implemented' }));
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/page');
  const document = unwrap<DocumentImpl>(browser.document);
  const traversable = document.getNodeNavigable()!.traversable;
  const turns: (() => void)[] = [];
  vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { browser, document, traversable, turns };
}

function createEntry(navigable: Navigable, fragment: string): SessionHistoryEntry {
  const url = { ...navigable.activeSessionHistoryEntry.url, fragment };
  return navigable.activeDocument!.env.createSessionHistoryEntry(url, navigable.activeSessionHistoryEntry.documentState);
}

/** Supply the retained child history while automatic iframe loading remains unfinished. */
function createChild(parent: Navigable): Navigable {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
  const [, document] = BrowsingContext.create(owner, container, parent.topLevelTraversable.activeBrowsingContext!.group!);
  const state = DocumentState.create(document);
  state.origin = document.origin;
  const child = new Navigable(state, parent);
  container.contentNavigable = child;
  owner.body!.appendChild(container);
  child.activeSessionHistoryEntry.step = parent.activeSessionHistoryEntry.step;
  parent.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [child.activeSessionHistoryEntry] });
  return child;
}
