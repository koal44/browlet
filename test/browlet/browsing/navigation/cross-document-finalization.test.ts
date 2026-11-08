import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { type Traversable } from '../../../../src/browlet/browsing/navigation/traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchResponse } from '../../../../src/fetch/index';
import { createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('cross-document finalization', () => {
  it('releases the load delay without touching history when population produced no Document', async () => {
    const { document, traversable } = await fixture();
    const entry = document.env.createSessionHistoryEntry(document.url, new DocumentState());
    const previous = traversable.activeSessionHistoryEntry;
    const getEntries = vi.spyOn(traversable, 'getSessionHistoryEntries');
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep');
    traversable.isDelayingLoadEvents = true;

    await withinTraversal(traversable, () => {
      traversable.finalizeCrossDocumentNavigation('push', 'none', entry);
    });

    expect(traversable.isDelayingLoadEvents).toBe(false);
    expect(getEntries).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(traversable.sessionHistoryEntries).toEqual([previous]);
    expect(entry.step).toBe('pending');
  });

  it('gives a cross-origin replacement its fresh Navigation API key', async () => {
    const { traversable } = await fixture();
    const previous = traversable.activeSessionHistoryEntry;
    const replacement = createEntry(traversable, 'https://foreign.test/replacement');
    const key = replacement.navigationAPIKey;
    vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});

    await withinTraversal(traversable, () => {
      traversable.finalizeCrossDocumentNavigation('replace', 'none', replacement);
    });

    expect(replacement.navigationAPIKey).toBe(key);
    expect(replacement.navigationAPIKey).not.toBe(previous.navigationAPIKey);
    expect(replacement.step).toBe(previous.step);
  });

  it.each([
    ['push', false], ['replace', false], ['push', true], ['replace', true],
  ] as const)('uses the destination history list for %s (grandchild: %s)', async (handling, grandchild) => {
    const { traversable } = await fixture();
    const parent = grandchild ? createChild(traversable) : traversable;
    const child = createChild(parent);
    const entries = child.getSessionHistoryEntries();
    const previous = child.activeSessionHistoryEntry;
    const topEntry = traversable.activeSessionHistoryEntry;
    const replacement = createEntry(child, 'https://example.test/child-next');
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});

    await withinTraversal(traversable, () => {
      child.finalizeCrossDocumentNavigation(handling, 'activation', replacement);
    });

    expect(child.getSessionHistoryEntries()).toBe(entries);
    expect(entries).toEqual(handling === 'push' ? [previous, replacement] : [replacement]);
    expect(traversable.sessionHistoryEntries).toEqual([topEntry]);
    expect(replacement.step).toBe(handling === 'push' ? 1 : previous.step);
    expect(child.activeSessionHistoryEntry).toBe(previous);
    expect(traversable.activeSessionHistoryEntry).toBe(topEntry);
    expect(apply).toHaveBeenCalledExactlyOnceWith(
      handling === 'push' ? 1 : 0, handling, 'activation', child, replacement,
    );
  });

  it('pushes after the current joint step and clears forward history in other frames too', async () => {
    const { document, traversable } = await fixture();
    const child = createChild(traversable);
    const sibling = createChild(traversable);
    const childEntries = child.getSessionHistoryEntries();
    const siblingEntries = sibling.getSessionHistoryEntries();
    const childEntry = child.activeSessionHistoryEntry;
    const topEntry = traversable.activeSessionHistoryEntry;
    sibling.activeSessionHistoryEntry.step = 3;
    traversable.currentSessionHistoryStep = 3;
    const future = (step: number) => Object.assign(
      document.env.createSessionHistoryEntry(document.url, new DocumentState()), { step },
    );
    childEntries.push(future(5));
    siblingEntries.push(future(6));
    traversable.sessionHistoryEntries.push(future(7));
    const incoming = createEntry(child, 'https://example.test/child-next');
    const key = incoming.navigationAPIKey;
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});
    child.isDelayingLoadEvents = true;

    await withinTraversal(traversable, () => {
      child.finalizeCrossDocumentNavigation('push', 'browser UI', incoming);
    });

    expect(child.isDelayingLoadEvents).toBe(false);
    expect(incoming.step).toBe(4);
    expect(incoming.navigationAPIKey).toBe(key);
    expect(childEntries).toEqual([childEntry, incoming]);
    expect(siblingEntries).toEqual([sibling.activeSessionHistoryEntry]);
    expect(traversable.sessionHistoryEntries).toEqual([topEntry]);
    expect(traversable.currentSessionHistoryStep).toBe(3);
    expect(apply).toHaveBeenCalledExactlyOnceWith(4, 'push', 'browser UI', child, incoming);
  });

  it('replaces the active entry at its old step while applying the current joint step', async () => {
    const { document, traversable } = await fixture();
    const child = createChild(traversable);
    const sibling = createChild(traversable);
    sibling.activeSessionHistoryEntry.step = 3;
    traversable.currentSessionHistoryStep = 3;
    const entries = child.getSessionHistoryEntries();
    const previous = child.activeSessionHistoryEntry;
    const future = Object.assign(document.env.createSessionHistoryEntry(document.url, new DocumentState()), { step: 6 });
    entries.push(future);
    child.currentSessionHistoryEntry = future;
    const incoming = createEntry(child, 'https://example.test/replacement');
    const id = incoming.navigationAPIID;
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});
    const clearForward = vi.spyOn(traversable, 'clearForwardSessionHistory');

    await withinTraversal(traversable, () => {
      child.finalizeCrossDocumentNavigation('replace', 'none', incoming);
    });

    expect(entries).toEqual([incoming, future]);
    expect(incoming.step).toBe(previous.step);
    expect(incoming.navigationAPIKey).toBe(previous.navigationAPIKey);
    expect(incoming.navigationAPIID).toBe(id);
    expect(incoming.navigationAPIID).not.toBe(previous.navigationAPIID);
    expect(clearForward).not.toHaveBeenCalled();
    expect(child.currentSessionHistoryEntry).toBe(future);
    expect(child.activeSessionHistoryEntry).toBe(previous);
    expect(apply).toHaveBeenCalledExactlyOnceWith(3, 'replace', 'none', child, incoming);
  });

  it('uses strict retained origins for replacement keys despite document.domain relaxation', async () => {
    const { traversable } = await fixture('https://a.example.test/current');
    const previous = traversable.activeSessionHistoryEntry;
    const incoming = createEntry(traversable, 'https://b.example.test/replacement');
    const key = incoming.navigationAPIKey;
    const oldOrigin = previous.documentState.origin!;
    const newOrigin = incoming.documentState.origin!;
    if (oldOrigin.kind !== 'tuple' || newOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    oldOrigin.domain = newOrigin.domain = { kind: 'domain', value: 'example.test' };
    vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});

    await withinTraversal(traversable, () => {
      traversable.finalizeCrossDocumentNavigation('replace', 'none', incoming);
    });

    expect(incoming.navigationAPIKey).toBe(key);
  });

  it.each(['shared-opaque', 'distinct-opaque', 'missing'] as const)(
    'compares retained origins for %s state', async (kind) => {
      const { traversable } = await fixture();
      const previous = traversable.activeSessionHistoryEntry;
      const incoming = createEntry(traversable, 'https://example.test/replacement');
      const key = incoming.navigationAPIKey;
      previous.documentState.origin = kind === 'missing' ? null : createOpaqueOrigin();
      incoming.documentState.origin = kind === 'distinct-opaque' ? createOpaqueOrigin() : previous.documentState.origin;
      vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});

      await withinTraversal(traversable, () => {
        traversable.finalizeCrossDocumentNavigation('replace', 'none', incoming);
      });

      expect(incoming.navigationAPIKey).toBe(kind === 'shared-opaque' ? previous.navigationAPIKey : key);
    },
  );

  it.each([
    { child: false, foreign: false, auxiliary: false, opener: false, name: 'retained' },
    { child: false, foreign: true, auxiliary: false, opener: false, name: '' },
    { child: false, foreign: true, auxiliary: true, opener: true, name: 'retained' },
    { child: false, foreign: true, auxiliary: true, opener: false, name: '' },
    { child: false, foreign: true, auxiliary: false, opener: true, name: '' },
    { child: true, foreign: true, auxiliary: false, opener: false, name: 'retained' },
  ])('resets the target name only for the specified top-level case: %j', async (testCase) => {
    const { traversable } = await fixture();
    const target = testCase.child ? createChild(traversable) : traversable;
    const incoming = createEntry(target, `https://${testCase.foreign ? 'foreign' : 'example'}.test/next`);
    incoming.documentState.navigableTargetName = 'retained';
    const context = incoming.document!.browsingContext!;
    context.isAuxiliary = testCase.auxiliary;
    context.openerBrowsingContext = testCase.opener ? new BrowsingContext() : null;
    vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});

    await withinTraversal(traversable, () => {
      target.finalizeCrossDocumentNavigation('push', 'none', incoming);
    });

    expect(incoming.documentState.navigableTargetName).toBe(testCase.name);
  });

  it.each(['push', 'replace'] as const)('applies a child %s without replacing the top-level Document', async (handling) => {
    const { document, traversable } = await fixture();
    const child = createChild(traversable);
    const proxy = child.activeWindowProxy;
    const incoming = createEntry(child, 'https://example.test/child-next');

    await withinTraversal(traversable, () => {
      child.finalizeCrossDocumentNavigation(handling, 'none', incoming);
    });

    expect(child.currentSessionHistoryEntry).toBe(incoming);
    expect(child.activeSessionHistoryEntry).toBe(incoming);
    expect(child.activeDocument).toBe(incoming.document);
    expect(child.activeWindowProxy).toBe(proxy);
    expect(child.activeWindow!.document).toBe(incoming.document);
    expect(incoming.document!.getNodeNavigable()).toBe(child);
    expect(incoming.document!.history.lengthValue).toBe(handling === 'push' ? 2 : 1);
    expect(traversable.activeDocument).toBe(document);
    expect(traversable.currentSessionHistoryStep).toBe(handling === 'push' ? 1 : 0);
    expect(child.activeWindow!.navigation.activation!.navigationType).toBe(handling);
  });

  it.each(['example', 'foreign'])('exposes the %s-origin replacement key through Navigation', async (host) => {
    const { browser, traversable } = await fixture();
    const previousKey = browser.window.navigation.currentEntry!.key;
    const incoming = createEntry(traversable, `https://${host}.test/replacement`);
    const key = incoming.navigationAPIKey;

    await withinTraversal(traversable, () => {
      traversable.finalizeCrossDocumentNavigation('replace', 'none', incoming);
    });

    expect(browser.window.navigation.currentEntry!.key).toBe(host === 'example' ? previousKey : key);
    expect(browser.window.navigation.activation!.navigationType).toBe('replace');
    expect(browser.window.history.length).toBe(1);
  });
});

async function fixture(url = 'https://example.test/current') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  const document = unwrap<DocumentImpl>(browser.document);
  const traversable = document.getNodeNavigable()!.traversable;
  return { browser, document, traversable };
}

function createEntry(navigable: Navigable, url: string) {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  const params = navigable.createNavigationParams(response);
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  return navigable.createHistoryEntry(document, params);
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
  parent.activeSessionHistoryEntry.documentState.nestedHistories.push({
    id: child.id, entries: [child.activeSessionHistoryEntry],
  });
  return child;
}

/** Run the operation on the traversable's real queue, delivering failures to the test. */
function withinTraversal<T>(traversable: Traversable, steps: () => T): Promise<T> {
  const completion = Promise.withResolvers<T>();
  traversable.appendSessionHistoryTraversalSteps(() => {
    try { completion.resolve(steps()); } catch (error) { completion.reject(error); }
  });
  return completion.promise;
}
