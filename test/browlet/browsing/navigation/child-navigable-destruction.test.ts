import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigateEventImpl } from '../../../../src/browlet/browsing/navigation/api/navigate-event';
import { createDocumentState, createSessionHistoryEntry } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { navigationAndTraversalTaskSource } from '../../../../src/browlet/scripting/tasks';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('child navigable destruction', () => {
  it.each(['iframe', 'object', 'embed', 'frame'])('does nothing for an empty %s', (tag) => {
    const browser = new Browlet({ route: () => '' });
    const owner = unwrap<DocumentImpl>(browser.document);
    const container = owner.createElement(tag);
    assert(container.isNavigableContainer());
    const destroyed = vi.spyOn(owner.env.userAgent, 'webDriverBiDiNavigableDestroyed');

    owner.env.userAgent.destroyChildNavigable(container);

    expect(container.contentNavigable).toBeNull();
    expect(destroyed).not.toHaveBeenCalled();
  });

  it.each(['iframe', 'object', 'embed', 'frame'])('detaches a %s before notification and removes only its history', (tag) => {
    const { owner, container, document, child, parent, teardown, queued, destroyed } = fixture(tag);
    const histories = parent.activeSessionHistoryEntry.documentState.nestedHistories;
    const sibling = { id: Symbol('sibling'), entries: [] };
    histories.unshift(sibling);
    const retainedProxy = child.activeWindowProxy;
    const notification = vi.spyOn(child, 'informNavigationAPIAboutChildNavigableDestruction').mockImplementation((loop) => {
      expect(loop).toBe(owner.env.responsibleEventLoop);
      expect(container.contentNavigable).toBeNull();
      expect(child.container).toBeNull();
      expect(document.containerDocument).toBeNull();
      expect(histories).toHaveLength(2);
      expect(teardown).not.toHaveBeenCalled();
    });
    teardown.mockImplementation(() => {
      expect(notification).toHaveBeenCalledOnce();
      expect(histories).toHaveLength(2);
    });
    destroyed.mockImplementation((navigable) => {
      expect(navigable).toBe(child);
      expect(histories).toEqual([sibling]);
      expect(queued).toHaveLength(1);
    });
    const update = vi.spyOn(parent, 'updateForNavigableCreationOrDestruction').mockReturnValue('applied');

    owner.env.userAgent.destroyChildNavigable(container);

    expect(teardown).toHaveBeenCalledExactlyOnceWith();
    expect(parent.activeSessionHistoryEntry.documentState.nestedHistories).toBe(histories);
    expect(child.activeWindowProxy).toBe(retainedProxy);
    expect(child.parent).toBe(parent);
    expect(update).not.toHaveBeenCalled();
    expect(destroyed).toHaveBeenCalledExactlyOnceWith(child);
    queued.shift()!();
    expect(update).toHaveBeenCalledExactlyOnceWith();
    owner.env.userAgent.destroyChildNavigable(container);
    expect(notification).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
    expect(destroyed).toHaveBeenCalledOnce();
    expect(queued).toEqual([]);
  });

  it('selects the parent active state after notification, leaving its different current state alone', () => {
    const { owner, container, child, parent } = fixture();
    const previousState = parent.activeSessionHistoryEntry.documentState;
    const nextState = { ...previousState, document: owner, nestedHistories: [...previousState.nestedHistories] };
    vi.spyOn(child, 'informNavigationAPIAboutChildNavigableDestruction').mockImplementation(() => {
      parent.activeSessionHistoryEntry = createSessionHistoryEntry(nextState);
    });

    owner.env.userAgent.destroyChildNavigable(container);

    expect(nextState.nestedHistories).toEqual([]);
    expect(previousState.nestedHistories.map((history) => history.id)).toEqual([child.id]);
    expect(parent.currentSessionHistoryEntry.documentState).toBe(previousState);
  });

  it('does not remove unrelated history when the child has no registered entry', () => {
    const { owner, container, parent, queued, destroyed } = fixture();
    const sibling = { id: Symbol('sibling'), entries: [] };
    parent.activeSessionHistoryEntry.documentState.nestedHistories = [sibling];

    owner.env.userAgent.destroyChildNavigable(container);

    expect(parent.activeSessionHistoryEntry.documentState.nestedHistories).toEqual([sibling]);
    expect(queued).toHaveLength(1);
    expect(destroyed).toHaveBeenCalledOnce();
  });

  it.each([true, false])('uses the container loop for notification (shared Agent: %s)', (sameAgent) => {
    const { owner, container, document, child } = fixture('iframe', sameAgent);
    const navigation = child.activeWindow!.navigation;
    const controller = document.env.createAbortController();
    const event = document.env.createEvent(NavigateEventImpl) as NavigateEventImpl;
    event.type = 'navigate';
    event.abortController = controller;
    event.signal = controller.signal;
    navigation.ongoingNavigateEvent = event;
    const pending = navigation.addUpcomingTraverseMethodTracker('pending', undefined);
    pending.committedPromise.observe(() => {}, () => {});
    const childLoop = document.env.responsibleEventLoop;
    expect(owner.env.responsibleEventLoop === childLoop).toBe(sameAgent);
    const queue = childLoop.getTaskQueue(navigationAndTraversalTaskSource);
    const queuedBefore = queue.size;

    owner.env.userAgent.destroyChildNavigable(container);

    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
    expect(controller.signal.aborted).toBe(sameAgent);
    expect(queue.size - queuedBefore).toBe(sameAgent ? 0 : 1);
    expect(document.isFullyActive()).toBe(false);
    // Off-loop delivery is still Document-gated. Teardown's treatment of this task remains §7.5.10 work.
    childLoop.removeTasksForDocument(document);
  });

  it('leaves recursive teardown explicit instead of removing history or reporting success', () => {
    const { owner, container, child, parent, teardown, queued, destroyed } = fixture();
    teardown.mockRestore();

    expect(() => owner.env.userAgent.destroyChildNavigable(container)).toThrow('Recursive Document destruction is not implemented');

    expect(container.contentNavigable).toBeNull();
    expect(parent.activeSessionHistoryEntry.documentState.nestedHistories.map((history) => history.id)).toEqual([child.id]);
    expect(queued).toEqual([]);
    expect(destroyed).not.toHaveBeenCalled();
  });
});

function fixture(tag = 'iframe', sameAgent = true) {
  const browser = new Browlet({ route: () => '' });
  const owner = unwrap<DocumentImpl>(browser.document);
  const parent = owner.getNodeNavigable()!.traversable;
  const container = owner.createElement(tag);
  assert(container.isNavigableContainer());
  owner.body!.appendChild(container);
  // Child startup is unfinished; retain real Window/Agent owners at its existing boundary.
  let document: DocumentImpl;
  if (sameAgent) {
    const realm = getRelevantRealm(createSiblingWindow(browser));
    document = realm.env.getAssociatedDocument()!;
    document.browsingContext = new BrowsingContext(realm.windowProxy);
    document.makeActive();
  } else {
    [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  }
  const child = new Navigable(createDocumentState(document), parent);
  container.contentNavigable = child;
  parent.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [child.activeSessionHistoryEntry] });
  // Supply only the unfinished recursive teardown and traversal queue; notifications remain real.
  const teardown = vi.spyOn(document, 'destroyAndDescendants').mockImplementation(() => {});
  const queued: (() => void)[] = [];
  vi.spyOn(parent, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { queued.push(steps); });
  const destroyed = vi.spyOn(owner.env.userAgent, 'webDriverBiDiNavigableDestroyed');
  return { owner, container, document, child, parent, teardown, queued, destroyed };
}
