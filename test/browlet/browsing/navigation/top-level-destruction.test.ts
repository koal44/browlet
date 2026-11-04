import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState, createSessionHistoryEntry } from '../../../../src/browlet/browsing/navigation/state/index';
import { navigationAndTraversalTaskSource } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { PointerEventStream } from '../../../../src/browlet/interaction/index';
import { StorageKey, StorageShelf } from '../../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';

afterEach(() => { vi.restoreAllMocks(); });

describe('top-level traversable destruction', () => {
  it('requests each retained Document before removing its context, UI, registration, and session storage', () => {
    const { userAgent, traversable, document, context, group } = fixture();
    const other = TopLevelTraversable.create(userAgent, null, 'other');
    traversable.pointerEventStreams.set(7, new PointerEventStream(7, false, true, () => false));
    other.pointerEventStreams.set(7, new PointerEventStream(7, false, true, () => false));
    const session = putSession(traversable);
    const otherSession = putSession(other);
    const retiredDocument = document.env.createDocument();
    const retiredEntry = createSessionHistoryEntry(createDocumentState(retiredDocument));
    const emptyEntry = { ...retiredEntry, documentState: createDocumentState(null) };
    const activeEntry = traversable.activeSessionHistoryEntry;
    // Preserve the per-entry requests, including repeated Document identity; completion belongs to recursive teardown.
    traversable.sessionHistoryEntries = [retiredEntry, emptyEntry, activeEntry, { ...activeEntry }];
    const retired = vi.spyOn(retiredDocument, 'destroyAndDescendants').mockImplementation(() => {});
    const active = vi.spyOn(document, 'destroyAndDescendants').mockImplementation(() => {});
    const ui = vi.spyOn(userAgent, 'removeTopLevelTraversableFromUI').mockImplementation((removed) => {
      expect(removed).toBe(traversable);
      expect(retired).toHaveBeenCalledExactlyOnceWith();
      expect(active).toHaveBeenCalledTimes(2);
      expect(context.group).toBeNull();
      expect(traversable.pointerEventStreams.size).toBe(0);
      expect(other.pointerEventStreams.size).toBe(1);
      expect(group.browsingContextSet.size).toBe(0);
      expect(userAgent.browsingContextGroupSet.has(group)).toBe(false);
      expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(true);
      expect(session.get('saved')).toBe('session');
    });
    const destroyed = vi.spyOn(userAgent, 'webDriverBiDiNavigableDestroyed').mockImplementation((removed) => {
      expect(removed).toBe(traversable);
      expect(ui).toHaveBeenCalledExactlyOnceWith(traversable);
      expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(false);
      expect(session.size).toBe(0);
    });

    userAgent.destroyTopLevelTraversable(traversable);

    expect(destroyed).toHaveBeenCalledExactlyOnceWith(traversable);
    expect(traversable.storageShed.size).toBe(0);
    expect(userAgent.topLevelTraversableSet.has(other)).toBe(true);
    expect(otherSession.get('saved')).toBe('session');
    expect(other.activeBrowsingContext!.group).not.toBeNull();
    expect(traversable.sessionHistoryEntries).toHaveLength(4);
  });

  it('captures the context before teardown can clear the active Document', () => {
    const { traversable, document, context, group } = fixture();
    vi.spyOn(document, 'destroyAndDescendants').mockImplementation(() => {
      document.browsingContext = null;
      traversable.activeSessionHistoryEntry.documentState.document = null;
    });

    traversable.destroy();

    expect(traversable.activeBrowsingContext).toBeNull();
    expect(context.group).toBeNull();
    expect(group.browsingContextSet.size).toBe(0);
  });

  it('preserves a group that still owns another browsing context', () => {
    const { userAgent, traversable, document, context, group } = fixture();
    const [otherContext] = BrowsingContext.create(null, null, group);
    group.append(otherContext);
    vi.spyOn(document, 'destroyAndDescendants').mockImplementation(() => {});

    traversable.destroy();

    expect(context.group).toBeNull();
    expect(group.browsingContextSet).toEqual(new Set([otherContext]));
    expect(otherContext.group).toBe(group);
    expect(userAgent.browsingContextGroupSet.has(group)).toBe(true);
  });

  it('stops at recursive teardown without unregistering the traversable', () => {
    const { userAgent, traversable, context, group } = fixture();
    const session = putSession(traversable);
    const ui = vi.spyOn(userAgent, 'removeTopLevelTraversableFromUI');
    const destroyed = vi.spyOn(userAgent, 'webDriverBiDiNavigableDestroyed');

    expect(() => traversable.destroy()).toThrow('Recursive Document destruction is not implemented');

    expect(context.group).toBe(group);
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(true);
    expect(session.get('saved')).toBe('session');
    expect(ui).not.toHaveBeenCalled();
    expect(destroyed).not.toHaveBeenCalled();
  });
});

describe('top-level traversable closing', () => {
  it('does nothing when script closing has already begun', () => {
    const { traversable } = fixture();
    const close = vi.spyOn(traversable, 'definitelyClose');
    traversable.isClosing = true;

    traversable.close();

    expect(close).not.toHaveBeenCalled();
  });

  it.each(['canceled-by-beforeunload', 'canceled-by-navigate'] as const)('preserves the destination after %s', (status) => {
    const { userAgent, traversable, document } = fixture();
    const session = putSession(traversable);
    const check = vi.spyOn(Navigable, 'checkIfUnloadingIsCanceled').mockReturnValue(status);
    const queue = vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps');
    const unload = vi.spyOn(document, 'unloadAndDescendants');

    traversable.close();

    expect(check).toHaveBeenCalledExactlyOnceWith([traversable]);
    expect(queue).not.toHaveBeenCalled();
    expect(unload).not.toHaveBeenCalled();
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(true);
    expect(session.get('saved')).toBe('session');
    expect(traversable.isClosing).toBe(false);
  });

  it('checks inclusive descendants, including a shadow-tree child, before queuing unloading', () => {
    const { userAgent, traversable, document } = fixture();
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const container = document.createElement('iframe');
    assert(container.isNavigableContainer());
    shadow.appendChild(container);
    // Supply the child-startup dependency; collection and closing use real retained owners.
    const [, childDocument] = BrowsingContext.createTopLevel(userAgent);
    const child = new Navigable(createDocumentState(childDocument), traversable);
    container.contentNavigable = child;
    const check = vi.spyOn(Navigable, 'checkIfUnloadingIsCanceled').mockReturnValue('continue');
    const queue = vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation(() => {
      expect(check).toHaveBeenCalledExactlyOnceWith([traversable, child]);
    });

    traversable.close();

    expect(queue).toHaveBeenCalledOnce();
    expect(traversable.isClosing).toBe(false);
  });

  it('definitely closes despite isClosing and unloads the active Document selected when the queue runs', () => {
    const { userAgent, traversable, document, context, group } = fixture();
    traversable.isClosing = true;
    vi.spyOn(Navigable, 'checkIfUnloadingIsCanceled').mockReturnValue('continue');
    const queued: (() => void)[] = [];
    vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { queued.push(steps); });
    const originalUnload = vi.spyOn(document, 'unloadAndDescendants');
    const retired = vi.spyOn(document, 'destroyAndDescendants').mockImplementation(() => {});

    traversable.definitelyClose();

    expect(queued).toHaveLength(1);
    expect(originalUnload).not.toHaveBeenCalled();
    const [replacementContext, replacement] = BrowsingContext.createTopLevel(userAgent);
    traversable.activeSessionHistoryEntry = createSessionHistoryEntry(createDocumentState(replacement));
    traversable.sessionHistoryEntries.push(traversable.activeSessionHistoryEntry);
    const active = vi.spyOn(replacement, 'destroyAndDescendants').mockImplementation(() => {});
    let afterAllUnloads: (() => void) | undefined;
    const unload = vi.spyOn(replacement, 'unloadAndDescendants').mockImplementation((newDocument, after) => {
      expect(newDocument).toBeNull();
      afterAllUnloads = after;
    });
    queued.shift()!();
    expect(originalUnload).not.toHaveBeenCalled();
    expect(unload).toHaveBeenCalledExactlyOnceWith(null, expect.any(Function));
    expect(retired).not.toHaveBeenCalled();
    expect(active).not.toHaveBeenCalled();
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(true);
    afterAllUnloads!();
    expect(retired).toHaveBeenCalledExactlyOnceWith();
    expect(active).toHaveBeenCalledExactlyOnceWith();
    expect(context.group).toBe(group);
    expect(replacementContext.group).toBeNull();
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(false);
  });

  it('finishes closing after unloading destroys the active Document', () => {
    const { userAgent, traversable, document, context, group } = fixture();
    const session = putSession(traversable);
    const ui = vi.spyOn(userAgent, 'removeTopLevelTraversableFromUI');
    const destroyed = vi.spyOn(userAgent, 'webDriverBiDiNavigableDestroyed');
    vi.spyOn(Navigable, 'checkIfUnloadingIsCanceled').mockReturnValue('continue');
    let queued: (() => void) | undefined;
    vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { queued = steps; });
    let afterAllUnloads: (() => void) | undefined;
    vi.spyOn(document, 'unloadAndDescendants').mockImplementation((_newDocument, after) => { afterAllUnloads = after; });

    traversable.close();
    queued!();
    // Supply unloading's destruction step on the real owning loop, then deliver its completion below.
    document.env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    document.env.responsibleEventLoop.runTaskTurn();

    expect(document.browsingContext).toBeNull();
    expect(traversable.activeDocument).toBeNull();
    expect(context.group).toBe(group);
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(true);
    expect(session.get('saved')).toBe('session');
    expect(ui).not.toHaveBeenCalled();
    expect(destroyed).not.toHaveBeenCalled();

    expect(() => afterAllUnloads!()).not.toThrow();

    expect(context.group).toBeNull();
    expect(userAgent.browsingContextGroupSet.has(group)).toBe(false);
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(false);
    expect(session.size).toBe(0);
    expect(ui).toHaveBeenCalledExactlyOnceWith(traversable);
    expect(destroyed).toHaveBeenCalledExactlyOnceWith(traversable);
  });

  it('keeps cancellation, traversal execution, and unloading as separate explicit dependencies', () => {
    const { traversable } = fixture();
    expect(() => traversable.close()).toThrow('Unload cancellation checks are not implemented');
    vi.spyOn(Navigable, 'checkIfUnloadingIsCanceled').mockReturnValue('continue');
    expect(() => traversable.close()).toThrow('Session history traversal queue is not implemented');
    let unload: (() => void) | undefined;
    vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { unload = steps; });
    traversable.close();
    expect(() => unload!()).toThrow('Document and descendant unloading is not implemented');
  });
});

function fixture() {
  const userAgent = new UserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument!;
  const context = traversable.activeBrowsingContext!;
  return { userAgent, traversable, document, context, group: context.group! };
}

function putSession(traversable: TopLevelTraversable) {
  const shelf = StorageShelf.create('session');
  const map = shelf.bucketMap.get('default')!.bottleMap.get('sessionStorage')!.map;
  map.set('saved', 'session');
  traversable.storageShed.set(new StorageKey(obtainURLOrigin(parseURL('https://session.test/').url!)), shelf);
  return map;
}
