import { assert, describe, expect, it } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type Traversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { UserAgent } from '../../../../src/browlet/user-agent';

describe('history-step navigable selection', () => {
  it('collects unchanged branches breadth first, including shadow-tree children', async () => {
    const top = fixture();
    const first = createChild(top, 'iframe');
    const grandchild = createChild(first, 'object');
    const second = createChild(top, 'embed');
    const host = top.activeDocument!.createElement('div');
    top.activeDocument!.body!.appendChild(host);
    const shadow = host.attachShadow({
      mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    shadow.appendChild(second.container!);
    const initialEntries = [top, first, second, grandchild].map((navigable) => navigable.currentSessionHistoryEntry);

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(0)).toEqual([]);
      expect(top.getNavigablesThatMightCrossDocuments(0)).toEqual([]);
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(0)).toEqual([top, first, second, grandchild]);
    });

    expect(top.activeDocument!.getDocumentTreeChildNavigables()).toEqual([first]);
    expect([top, first, second, grandchild].map((navigable) => navigable.currentSessionHistoryEntry)).toEqual(initialEntries);
    expect([top, first, second, grandchild].map((navigable) => navigable.ongoingNavigation)).toEqual([null, null, null, null]);
  });

  it('follows same-document changes but stops below a possible cross-document traversal', async () => {
    const top = fixture();
    const first = createChild(top);
    const grandchild = createChild(first);
    const second = createChild(top);
    const unloadingChild = createChild(second);
    const unchanged = createChild(top);
    addEntry(first, 1, first.activeSessionHistoryEntry.documentState);
    addEntry(grandchild, 2, grandchild.activeSessionHistoryEntry.documentState);
    addEntry(second, 3);
    addEntry(unloadingChild, 4);

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(4)).toEqual([first, second, grandchild]);
      expect(top.getNavigablesThatMightCrossDocuments(4)).toEqual([second]);
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(4)).toEqual([top, unchanged]);
    });
  });

  it('includes a reload of the current entry and excludes its descendants', async () => {
    const top = fixture();
    const child = createChild(top);
    const grandchild = createChild(child);
    child.currentSessionHistoryEntry.documentState.reloadPending = true;
    addEntry(grandchild, 1);

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(1)).toEqual([child]);
      expect(top.getNavigablesThatMightCrossDocuments(1)).toEqual([child]);
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(1)).toEqual([top]);
    });
    expect(child.currentSessionHistoryEntry.documentState.reloadPending).toBe(true);
  });

  it('uses the target state reload flag, not the current state flag', async () => {
    const top = fixture();
    const child = createChild(top);
    const grandchild = createChild(child);
    const target = child.currentSessionHistoryEntry;
    child.currentSessionHistoryEntry = addEntry(child, 1);
    child.currentSessionHistoryEntry.documentState.reloadPending = true;
    addEntry(grandchild, 1);

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(0)).toEqual([child]);
      expect(top.getNavigablesThatMightCrossDocuments(0)).toEqual([]);
    });
    expect(child.activeSessionHistoryEntry).toBe(target);
  });

  it('selects a synchronous update whose active entry is ahead of its current entry', async () => {
    const top = fixture();
    const child = createChild(top);
    const previous = child.currentSessionHistoryEntry;
    const target = addEntry(child, 1, previous.documentState);
    child.activeSessionHistoryEntry = target;

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(1)).toEqual([child]);
      expect(top.getNavigablesThatMightCrossDocuments(1)).toEqual([]);
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(1)).toEqual([top]);
    });
    expect(child.currentSessionHistoryEntry).toBe(previous);
    expect(child.activeSessionHistoryEntry).toBe(target);
  });

  it('compares Documents rather than entry or DocumentState identity for cross-document selection', async () => {
    const top = fixture();
    const child = createChild(top);
    const grandchild = createChild(child);
    addEntry(child, 1, DocumentState.create(child.activeDocument!));
    addEntry(grandchild, 2);

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(2)).toEqual([child, grandchild]);
      expect(top.getNavigablesThatMightCrossDocuments(2)).toEqual([grandchild]);
    });
  });

  it('handles a non-displayable current entry independently of the still-active Document', async () => {
    const top = fixture();
    const child = createChild(top);
    const grandchild = createChild(child);
    const displayedEntry = child.activeSessionHistoryEntry;
    child.currentSessionHistoryEntry = addEntry(child, 1);

    await withinTraversal(top, () => {
      // A 204 can leave the current entry unpopulated while the old Document stays active.
      expect(top.getNavigablesThatWillChangeOrReload(1)).toEqual([]);
      expect(top.getNavigablesThatMightCrossDocuments(1)).toEqual([child]);
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(1)).toEqual([top, child, grandchild]);
      // Traversing back changes the current entry without replacing the displayed Document.
      expect(top.getNavigablesThatWillChangeOrReload(0)).toEqual([child]);
      expect(top.getNavigablesThatMightCrossDocuments(0)).toEqual([]);
    });
    expect(child.activeSessionHistoryEntry).toBe(displayedEntry);
  });

  it('prunes the entire descendant tree when the top-level Document changes', async () => {
    const top = fixture();
    createChild(top);
    const [, replacement] = BrowsingContext.createTopLevel(top.activeDocument!.env.userAgent);
    addEntry(top, 1, DocumentState.create(replacement));

    await withinTraversal(top, () => {
      expect(top.getNavigablesThatWillChangeOrReload(1)).toEqual([top]);
      expect(top.getNavigablesThatMightCrossDocuments(1)).toEqual([top]);
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(1)).toEqual([]);
    });
  });

  it('returns fresh lists and reevaluates entry selection and reload flags on each call', async () => {
    const top = fixture();
    const child = createChild(top);

    await withinTraversal(top, () => {
      const unchanged = top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(0);
      unchanged.length = 0;
      expect(top.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(0)).toEqual([top, child]);
      child.currentSessionHistoryEntry.documentState.reloadPending = true;
      const changing = top.getNavigablesThatWillChangeOrReload(0);
      const crossing = top.getNavigablesThatMightCrossDocuments(0);
      child.currentSessionHistoryEntry.documentState.reloadPending = false;
      expect(changing).toEqual([child]);
      expect(crossing).toEqual([child]);
      expect(top.getNavigablesThatWillChangeOrReload(0)).toEqual([]);
      expect(top.getNavigablesThatMightCrossDocuments(0)).toEqual([]);
    });
  });
});

function fixture(): TopLevelTraversable {
  return TopLevelTraversable.create(new UserAgent(), null, '');
}

/** Supply retained child history while automatic element startup and history application remain unfinished. */
function createChild(parent: Navigable, tag: 'iframe' | 'object' | 'embed' | 'frame' = 'iframe'): Navigable {
  const owner = parent.activeDocument!;
  const container = owner.createElement(tag);
  assert(container.isNavigableContainer());
  owner.body!.appendChild(container);
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  const child = new Navigable(DocumentState.create(document), parent);
  container.contentNavigable = child;
  child.currentSessionHistoryEntry.step = 0;
  parent.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [child.currentSessionHistoryEntry] });
  return child;
}

function addEntry(navigable: Navigable, step: number, state = new DocumentState()) {
  const document = navigable.activeDocument!;
  const entry = document.env.createSessionHistoryEntry(document.url, state);
  entry.step = step;
  navigable.getSessionHistoryEntries().push(entry);
  return entry;
}

function withinTraversal<T>(traversable: Traversable, steps: () => T): Promise<T> {
  const completion = Promise.withResolvers<T>();
  traversable.appendSessionHistoryTraversalSteps(() => {
    try { completion.resolve(steps()); } catch (error) { completion.reject(error); }
  });
  return completion.promise;
}
