import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { Document, DocumentVisibilityState } from '../../../../src/browlet/platform';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { project, unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

describe('navigable initialization and lookup', () => {
  it('initializes Document visibility before notifying activity, without a visibilitychange event', () => {
    const document = createTestDocument();
    const platform = project(document) as Document;
    const changed = vi.fn();
    platform.addEventListener('visibilitychange', changed);
    expect(platform.visibilityState).toBe('hidden');
    expect(platform.hidden).toBe(true);

    document.browsingContext = new BrowsingContext();
    const observed: [boolean, DocumentVisibilityState][] = [];
    document.observeFullyActiveState((active) => { observed.push([active, platform.visibilityState]); });
    const traversable = new TopLevelTraversable(DocumentState.create(document));

    expect(traversable.systemVisibilityState).toBe('visible');
    expect(platform.visibilityState).toBe('visible');
    expect(platform.hidden).toBe(false);
    expect(observed).toEqual([[true, 'visible']]);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['visible', 'hidden'] as const)('initializes descendants from the traversable\'s %s state', (state) => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const top = document.getNodeNavigable()!.traversable;
    top.systemVisibilityState = state;
    let parent: Navigable = top;

    for (let depth = 0; depth < 2; ++depth) {
      const childDocument = createTestDocument(document.env);
      childDocument.browsingContext = new BrowsingContext();
      const child = new Navigable(DocumentState.create(childDocument), parent);
      const platform = project(childDocument) as Document;

      expect(child.parent).toBe(parent);
      expect(child.id).not.toBe(parent.id);
      expect(child.isClosing).toBe(false);
      expect(child.isDelayingLoadEvents).toBe(false);
      expect(child.isNavigationOrHistoryUpdateBlocked()).toBe(false);
      expect(platform.visibilityState).toBe(state);
      expect(platform.hidden).toBe(state === 'hidden');
      parent = child;
    }
  });

  it.each(['visible', 'hidden'] as const)('initializes a replacement Document from the traversable\'s %s state', async (state) => {
    const browlet = new Browlet({ route: () => '<p>replacement</p>' });
    const initial = unwrap<DocumentImpl>(browlet.document);
    initial.getNodeNavigable()!.traversable.systemVisibilityState = state;

    await browlet.navigate('https://example.test/replacement');

    expect(browlet.document).not.toBe(project(initial));
    expect(browlet.document.visibilityState).toBe(state);
    expect(browlet.document.hidden).toBe(state === 'hidden');
  });

  it('resolves every Node through its current node document, including disconnected and adopted nodes', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const navigable = document.getNodeNavigable()!;
    const element = document.createElement('div');
    const text = document.createTextNode('text');
    const fragment = document.createDocumentFragment();
    for (const node of [document, element, text, fragment]) {
      expect(node.getNodeNavigable()).toBe(navigable);
    }
    expect(element.isConnected).toBe(false);

    const detached = createTestDocument(document.env);
    detached.adoptNode(element);
    expect(element.getNodeNavigable()).toBeNull();
    document.adoptNode(element);
    expect(element.getNodeNavigable()).toBe(navigable);

    const replacement = createTestDocument(document.env);
    replacement.browsingContext = document.browsingContext;
    navigable.activeSessionHistoryEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));
    expect(navigable.currentSessionHistoryEntry.documentState.document).toBe(document);
    for (const node of [document, element, text, fragment]) expect(node.getNodeNavigable()).toBeNull();
    expect(replacement.getNodeNavigable()).toBe(navigable);
  });

  it('derives active views from the active entry when the current entry advances independently', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const navigable = document.getNodeNavigable()!;
    const active = navigable.activeSessionHistoryEntry;
    active.documentState.navigableTargetName = 'active';
    const pendingDocument = createTestDocument(document.env);
    const pendingState = DocumentState.create(pendingDocument);
    pendingState.navigableTargetName = 'current';

    navigable.currentSessionHistoryEntry = pendingDocument.env.createSessionHistoryEntry(pendingDocument.url, pendingState);

    expect(navigable.activeSessionHistoryEntry).toBe(active);
    expect(navigable.activeDocument).toBe(document);
    expect(navigable.activeBrowsingContext).toBe(document.browsingContext);
    expect(navigable.activeWindowProxy).toBe(document.browsingContext!.windowProxy);
    expect(navigable.activeWindow).toBe(document.getRelevantGlobalObject());
    expect(navigable.targetName).toBe('active');
    expect(document.getNodeNavigable()).toBe(navigable);
    expect(pendingDocument.getNodeNavigable()).toBeNull();
  });
});

describe('traversable foundations', () => {
  it('initializes each traversable with independent history and queue state', () => {
    const first = createTraversable();
    const second = createTraversable();
    for (const traversable of [first, second]) {
      expect(traversable.currentSessionHistoryStep).toBe(0);
      expect(traversable.sessionHistoryEntries).toEqual([]);
      expect(traversable.sessionHistoryTraversalQueue.algorithmSet).toEqual(new Set());
      expect(traversable.runningNestedApplyHistoryStep).toBe(false);
      expect(traversable.systemVisibilityState).toBe('visible');
      expect(traversable.isCreatedByWebContent).toBe(false);
    }

    expect(first.sessionHistoryEntries).not.toBe(second.sessionHistoryEntries);
    expect(first.sessionHistoryTraversalQueue).not.toBe(second.sessionHistoryTraversalQueue);
    const steps = Object.assign(vi.fn(), { targetNavigable: first });
    first.sessionHistoryTraversalQueue.algorithmSet.add(steps);
    first.sessionHistoryEntries.push(first.activeSessionHistoryEntry);

    expect(second.sessionHistoryEntries).toEqual([]);
    expect(second.sessionHistoryTraversalQueue.algorithmSet.size).toBe(0);
  });

  it('selects itself or the nearest traversable ancestor through nested child navigables', () => {
    const traversable = createTraversable();
    expect(traversable.traversable).toBe(traversable);
    expect(traversable.topLevelTraversable).toBe(traversable);
    let parent: Navigable = traversable;
    const env = traversable.activeDocument!.env;
    for (let depth = 0; depth < 2; ++depth) {
      const document = createTestDocument(env);
      document.browsingContext = new BrowsingContext();
      const child = new Navigable(DocumentState.create(document), parent);
      expect(child.traversable).toBe(traversable);
      expect(child.topLevelTraversable).toBe(traversable);
      parent = child;
    }
  });
});

function createTraversable(): TopLevelTraversable {
  const document = createTestDocument();
  document.browsingContext = new BrowsingContext();
  return new TopLevelTraversable(DocumentState.create(document));
}
