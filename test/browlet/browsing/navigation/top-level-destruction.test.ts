import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type UnloadCancellationResult } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { SessionHistoryTraversalSteps } from '../../../../src/browlet/browsing/navigation/session-history-traversal-queue';
import { navigationAndTraversalTaskSource } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { PointerEventStream } from '../../../../src/browlet/interaction/index';
import { internalType } from '../../../../src/infra/index';
import { runInHostTask } from '../../../support/tasks';
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
    const retiredEntry = retiredDocument.env.createSessionHistoryEntry(retiredDocument.url, DocumentState.create(retiredDocument));
    const emptyEntry = document.env.createSessionHistoryEntry(retiredEntry.url, new DocumentState());
    const activeEntry = traversable.activeSessionHistoryEntry;
    // Several entries can share one Document; teardown and failure reporting need only one request.
    const otherActiveEntry = document.env.createSessionHistoryEntry(activeEntry.url, activeEntry.documentState);
    traversable.sessionHistoryEntries = [retiredEntry, emptyEntry, activeEntry, otherActiveEntry];
    const retired = vi.spyOn(retiredDocument, 'destroyAndDescendants').mockReturnValue(userAgent.HostPromise.resolve(undefined, internalType<void>()));
    const active = vi.spyOn(document, 'destroyAndDescendants').mockReturnValue(userAgent.HostPromise.resolve(undefined, internalType<void>()));
    const ui = vi.spyOn(userAgent, 'removeTopLevelTraversableFromUI').mockImplementation((removed) => {
      expect(removed).toBe(traversable);
      expect(retired).toHaveBeenCalledExactlyOnceWith();
      expect(active).toHaveBeenCalledOnce();
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
      return document.env.userAgent.HostPromise.resolve(undefined, internalType<void>());
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
    vi.spyOn(document, 'destroyAndDescendants').mockReturnValue(userAgent.HostPromise.resolve(undefined, internalType<void>()));

    traversable.destroy();

    expect(context.group).toBeNull();
    expect(group.browsingContextSet).toEqual(new Set([otherContext]));
    expect(otherContext.group).toBe(group);
    expect(userAgent.browsingContextGroupSet.has(group)).toBe(true);
  });

  it('unregisters immediately and completes real Document teardown on its owning loop', async () => {
    const { userAgent, traversable, document, context } = fixture();
    const session = putSession(traversable);
    const ui = vi.spyOn(userAgent, 'removeTopLevelTraversableFromUI');
    const destroyed = vi.spyOn(userAgent, 'webDriverBiDiNavigableDestroyed');

    traversable.destroy();

    expect(context.group).toBeNull();
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(false);
    expect(session.size).toBe(0);
    expect(ui).toHaveBeenCalledExactlyOnceWith(traversable);
    expect(destroyed).toHaveBeenCalledExactlyOnceWith(traversable);
    await new Promise<void>((resolve, reject) => { document.destroyAndDescendants().observe(resolve, reject); });
    expect(document.browsingContext).toBeNull();
    expect(traversable.activeDocument).toBeNull();
  });
});

describe('top-level traversable closing', () => {
  it('does nothing when script closing has already begun', async () => {
    const { traversable } = fixture();
    const close = vi.spyOn(traversable, 'definitelyClose');
    traversable.isClosing = true;

    traversable.close();
    await runInHostTask(() => {});

    expect(close).not.toHaveBeenCalled();
  });

  it.each(['canceled-by-beforeunload', 'canceled-by-navigate'] as const)('preserves the destination after %s', async (status) => {
    const { userAgent, traversable, document } = fixture();
    const session = putSession(traversable);
    const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled').mockReturnValue(userAgent.HostPromise.resolve(status, internalType<UnloadCancellationResult>()));
    const queue = vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps');
    const unload = vi.spyOn(document, 'unloadAndDescendants');

    traversable.close();
    await runInHostTask(() => {});

    expect(check).toHaveBeenCalledExactlyOnceWith([traversable]);
    expect(queue).not.toHaveBeenCalled();
    expect(unload).not.toHaveBeenCalled();
    expect(userAgent.topLevelTraversableSet.has(traversable)).toBe(true);
    expect(session.get('saved')).toBe('session');
    expect(traversable.isClosing).toBe(false);
  });

  it('checks inclusive descendants, including a shadow-tree child, before queuing unloading', async () => {
    const { userAgent, traversable, document } = fixture();
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const container = document.createElement('iframe');
    assert(container.isNavigableContainer());
    shadow.appendChild(container);
    // Supply the child-startup dependency; collection and closing use real retained owners.
    const [, childDocument] = BrowsingContext.createTopLevel(userAgent);
    const child = new Navigable(DocumentState.create(childDocument), traversable);
    container.contentNavigable = child;
    const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled').mockReturnValue(userAgent.HostPromise.resolve('continue', internalType<UnloadCancellationResult>()));
    const queue = vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation(() => {
      expect(check).toHaveBeenCalledExactlyOnceWith([traversable, child]);
    });

    traversable.close();
    await runInHostTask(() => {});

    expect(queue).toHaveBeenCalledOnce();
    expect(traversable.isClosing).toBe(false);
  });

  it('definitely closes despite isClosing and unloads the active Document selected when the queue runs', async () => {
    const { userAgent, traversable, document, context, group } = fixture();
    traversable.isClosing = true;
    vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled').mockReturnValue(userAgent.HostPromise.resolve('continue', internalType<UnloadCancellationResult>()));
    const queued: (() => void)[] = [];
    vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { queued.push(steps); });
    const originalUnload = vi.spyOn(document, 'unloadAndDescendants');
    const retired = vi.spyOn(document, 'destroyAndDescendants').mockReturnValue(userAgent.HostPromise.resolve(undefined, internalType<void>()));

    traversable.definitelyClose();
    await runInHostTask(() => {});

    expect(queued).toHaveLength(1);
    expect(originalUnload).not.toHaveBeenCalled();
    const [replacementContext, replacement] = BrowsingContext.createTopLevel(userAgent);
    traversable.activeSessionHistoryEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));
    traversable.sessionHistoryEntries.push(traversable.activeSessionHistoryEntry);
    const active = vi.spyOn(replacement, 'destroyAndDescendants').mockReturnValue(userAgent.HostPromise.resolve(undefined, internalType<void>()));
    let afterAllUnloads: (() => void) | undefined;
    const unload = vi.spyOn(replacement, 'unloadAndDescendants').mockImplementation((newDocument, after) => {
      expect(newDocument).toBeNull();
      const completion = userAgent.HostPromise.withResolvers(internalType<void>());
      afterAllUnloads = () => { after?.(); completion.resolve(); };
      return completion.promise;
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

  it('finishes closing after unloading destroys the active Document', async () => {
    const { userAgent, traversable, document, context, group } = fixture();
    const session = putSession(traversable);
    const ui = vi.spyOn(userAgent, 'removeTopLevelTraversableFromUI');
    const destroyed = vi.spyOn(userAgent, 'webDriverBiDiNavigableDestroyed');
    vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled').mockReturnValue(userAgent.HostPromise.resolve('continue', internalType<UnloadCancellationResult>()));
    let queued: SessionHistoryTraversalSteps | undefined;
    vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { queued = steps; });
    let afterAllUnloads: (() => void) | undefined;
    vi.spyOn(document, 'unloadAndDescendants').mockImplementation((_newDocument, after) => {
      const completion = userAgent.HostPromise.withResolvers(internalType<void>());
      afterAllUnloads = () => { after?.(); completion.resolve(); };
      return completion.promise;
    });

    traversable.close();
    await runInHostTask(() => {});
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

  it('reports the explicit cache admission dependency after real cancellation checks complete', async () => {
    const { userAgent, traversable, document } = fixture();
    const beforeUnload = vi.spyOn(document, 'fireBeforeUnload');
    const turns: (() => void)[] = [];
    vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
    traversable.close();
    expect(turns).toHaveLength(0);
    await expect.poll(() => turns.length).toBe(1);
    expect(beforeUnload).toHaveBeenCalledExactlyOnceWith(false);
    turns.shift()!();
    await expect.poll(() => turns.length).toBe(1);
    expect(() => turns.shift()!()).toThrow('Back-forward cache admission is not implemented');
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
