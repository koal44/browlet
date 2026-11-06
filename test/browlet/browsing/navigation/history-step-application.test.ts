import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { NavigateEventImpl } from '../../../../src/browlet/browsing/navigation/api/navigate-event';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type HistoryStepResult } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { NavigateEvent as BrowletNavigateEvent, Window } from '../../../../src/browlet/platform';
import { internalType, type InternalPromise } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('history-step admission', () => {
  it('requires the owning queue, even when another traversable is executing', async () => {
    const state = fixture();
    const { top, userAgent, turns } = state;
    const other = TopLevelTraversable.create(userAgent, null, '');
    const apply = () => top.applyTraverseHistoryStep(0, null, null, 'browser UI');
    await expect(read(apply())).rejects.toThrow('must begin in its session history traversal queue');
    let failure!: Promise<HistoryStepResult>;
    other.appendSessionHistoryTraversalSteps(() => { failure = read(apply()); });
    turns.shift()!();
    await expect(failure).rejects.toThrow('must begin in its session history traversal queue');
  });

  it('rejects an initiator without its source snapshot before checking cancellation', async () => {
    const state = fixture();
    const check = vi.spyOn(state.userAgent, 'checkIfUnloadingIsCanceled');
    await expect(run(state, () => state.top.applyTraverseHistoryStep(0, null, state.top, 'none')))
      .rejects.toThrow('requires a source snapshot');
    expect(check).not.toHaveBeenCalled();
  });

  it('rejects sandbox-disallowed traversal before events, population, or entry mutation', async () => {
    const state = fixture();
    const { top, userAgent, document, current } = state;
    const initiator = TopLevelTraversable.create(userAgent, null, '');
    const snapshot = new SourceSnapshotParams(null);
    snapshot.sandboxingFlags.add('sandboxed-navigation');
    const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled');
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument');
    const queueTask = vi.spyOn(document.env, 'queueTask');

    await expect(run(state, () => top.applyTraverseHistoryStep(0, snapshot, initiator, 'none')))
      .resolves.toBe('initiator-disallowed');

    expect(check).not.toHaveBeenCalled();
    expect(populate).not.toHaveBeenCalled();
    expect(queueTask).not.toHaveBeenCalled();
    expect(top.currentSessionHistoryEntry).toBe(current);
    expect(top.activeSessionHistoryEntry).toBe(current);
    expect(top.currentSessionHistoryStep).toBe(4);
  });

  it('normalizes a gap before cancellation, then advances only the current entry', async () => {
    const state = fixture();
    const { top, userAgent, document, current, target } = state;
    const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled');
    const result = run(state, () => top.applyTraverseHistoryStep(3, null, null, 'browser UI'));
    const rejected = expect(result).rejects.toThrow('History-step population and activation is not implemented');
    expect(check).toHaveBeenCalledExactlyOnceWith([top], top, 0, 'browser UI');
    expect(top.currentSessionHistoryEntry).toBe(current);

    await runDocumentTask(document);
    await rejected;
    expect(top.currentSessionHistoryEntry).toBe(target);
    expect(top.activeSessionHistoryEntry).toBe(current);
    expect(top.currentSessionHistoryStep).toBe(4);
    expect(top.ongoingNavigation).toBe('traversal');
  });

  it('retains browser-owned completion if a Document check fails', async () => {
    const state = fixture();
    const { top, document } = state;
    const failure = new Error('unfinished cancellation owner');
    vi.spyOn(document, 'fireBeforeUnload').mockImplementation(() => { throw failure; });
    const result = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    const rejected = expect(result).rejects.toBe(failure);
    await runDocumentTask(document);
    await rejected;
  });
});

describe('history-step cancellation and waiting', () => {
  it('finishes a real beforeunload dismissal, then releases the queue for a later request', async () => {
    const state = fixture();
    const { top, userAgent, document, platform, turns } = state;
    let block = true;
    platform.addEventListener('beforeunload', (event) => { if (block) event.preventDefault(); });
    const navigate = vi.fn();
    platform.navigation.addEventListener('navigate', navigate);
    vi.spyOn(userAgent, 'shouldShowBeforeUnloadPrompt').mockReturnValue(true);
    vi.spyOn(userAgent, 'webDriverBiDiUserPromptOpened').mockReturnValue('dismiss');
    const result = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    const later = vi.fn();
    top.appendSessionHistoryTraversalSteps(later);
    const other = TopLevelTraversable.create(userAgent, null, '');
    const unrelated = vi.fn();
    other.appendSessionHistoryTraversalSteps(unrelated);
    turns.shift()!();
    expect(unrelated).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();

    await runDocumentTask(document);
    await expect(result).resolves.toBe('canceled-by-beforeunload');
    expect(navigate).not.toHaveBeenCalled();
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();

    block = false;
    const next = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    const rejected = expect(next).rejects.toThrow('History-step population and activation is not implemented');
    await runDocumentTask(document);
    await rejected;
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('returns cancellation from a real same-document navigate event without dispatching beforeunload', async () => {
    const state = fixture(true);
    const { top, document, platform, current } = state;
    const beforeUnload = vi.fn();
    platform.addEventListener('beforeunload', beforeUnload);
    const seen: string[] = [];
    platform.navigation.addEventListener('navigate', (value) => {
      const event = value as BrowletNavigateEvent;
      seen.push(event.navigationType);
      expect(event.destination.sameDocument).toBe(true);
      expect(event.cancelable).toBe(true);
      event.preventDefault();
    });
    const result = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    await runDocumentTask(document);

    await expect(result).resolves.toBe('canceled-by-navigate');
    expect(seen).toEqual(['traverse']);
    expect(beforeUnload).not.toHaveBeenCalled();
    expect(top.currentSessionHistoryEntry).toBe(current);
    expect(top.activeSessionHistoryEntry).toBe(current);
  });

  it('rejects an unrelated call while this queue is suspended on a Document task', async () => {
    const state = fixture();
    const { top, document } = state;
    vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([true, true]);
    const result = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    await expect(read(top.applyReloadHistoryStep('none'))).rejects.toThrow('must begin in its session history traversal queue');
    await runDocumentTask(document);
    await expect(result).resolves.toBe('canceled-by-beforeunload');
  });

  it('checks a reload even when the current entry has not changed, preserving its pending flag after cancellation', async () => {
    const state = fixture();
    const { top, userAgent, document, current } = state;
    current.documentState.reloadPending = true;
    const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled');
    vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([true, true]);
    const result = run(state, () => top.applyReloadHistoryStep('activation'));
    expect(check).toHaveBeenCalledExactlyOnceWith([top], top, 4, 'activation');
    await runDocumentTask(document);
    await expect(result).resolves.toBe('canceled-by-beforeunload');
    expect(current.documentState.reloadPending).toBe(true);
  });

  it.each(['creation-destruction', 'resume'] as const)('skips cancellation for %s without pretending population is complete', async (kind) => {
    const state = fixture(true);
    const { top, userAgent, document } = state;
    const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled');
    const tasks = vi.spyOn(document.env, 'queueTask');
    const result = run(state, () => kind === 'resume'
      ? top.resumeTraverseHistoryStep(0, 'activation')
      : top.updateForNavigableCreationOrDestruction());
    await expect(result).rejects.toThrow('History-step population and activation is not implemented');
    expect(check).not.toHaveBeenCalled();
    expect(tasks).not.toHaveBeenCalled();
  });

  it('keeps its browser owner when creation/destruction runs after the active Document was cleared', async () => {
    const state = fixture();
    state.current.documentState.document = null;
    await expect(run(state, () => state.top.updateForNavigableCreationOrDestruction()))
      .rejects.toThrow('History-step population and activation is not implemented');
  });
});

describe('history-step current entries and Navigation cleanup', () => {
  it('reselects entries after beforeunload callbacks without activating or populating them', async () => {
    const state = fixture();
    const { top, document, current, target, platform } = state;
    const replacement = document.env.createSessionHistoryEntry(target.url, new DocumentState());
    replacement.step = 0;
    platform.addEventListener('beforeunload', () => { top.sessionHistoryEntries[0] = replacement; });
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument');
    const result = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    const rejected = expect(result).rejects.toThrow('History-step population and activation is not implemented');

    await runDocumentTask(document);
    await rejected;
    expect(top.currentSessionHistoryEntry).toBe(replacement);
    expect(top.activeSessionHistoryEntry).toBe(current);
    expect(top.activeDocument).toBe(document);
    expect(top.currentSessionHistoryStep).toBe(4);
    expect(populate).not.toHaveBeenCalled();
  });

  it('clears cross-document Navigation on its Window loop without aborting or settling the request', async () => {
    const state = fixture();
    const { top, document, platform } = state;
    const { navigation, event, tracker } = pendingNavigation(top);
    const finished = vi.fn();
    const committed = vi.fn();
    tracker.finishedPromise.observe(finished, finished);
    tracker.committedPromise.observe(committed, committed);
    const error = vi.fn();
    platform.navigation.addEventListener('navigateerror', error);
    const abort = vi.spyOn(navigation, 'abortOngoingNavigation');
    const wake = vi.fn();
    top.addNavigationChangeSteps(wake);
    const tasks = vi.spyOn(document.env, 'queueTask');

    await expect(run(state, () => top.applyHistoryStep(0, false, null, null, 'none', 'push')))
      .rejects.toThrow('History-step population and activation is not implemented');

    expect(wake).toHaveBeenCalledOnce();
    expect(top.ongoingNavigation).toBe('traversal');
    expect(navigation.ongoingNavigateEvent).toBe(event);
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
    expect(tasks).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function));
    await runDocumentTask(document);
    expect(navigation.ongoingNavigateEvent).toBeNull();
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(event.signal.aborted).toBe(false);
    expect(abort).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });

  it.each(['traverse', 'reload'] as const)('retains the Navigation event and tracker for a same-Document %s target', async (kind) => {
    const state = fixture(true);
    const { top, document, current, target } = state;
    const { navigation, event, tracker } = pendingNavigation(top);
    if (kind === 'reload') current.documentState.reloadPending = true;
    const tasks = vi.spyOn(document.env, 'queueTask');

    await expect(run(state, () => top.applyHistoryStep(kind === 'reload' ? 4 : 0, false, null, null, 'none', kind)))
      .rejects.toThrow('History-step population and activation is not implemented');

    expect(top.currentSessionHistoryEntry).toBe(kind === 'reload' ? current : target);
    expect(top.activeSessionHistoryEntry).toBe(current);
    expect(top.ongoingNavigation).toBe('traversal');
    expect(navigation.ongoingNavigateEvent).toBe(event);
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
    expect(event.signal.aborted).toBe(false);
    expect(current.documentState.reloadPending).toBe(kind === 'reload');
    expect(tasks).not.toHaveBeenCalled();
  });

  it('recomputes child work after a navigate callback marks the parent for reload', async () => {
    const state = fixture(true);
    const { top, document, platform } = state;
    const child = createChild(top);
    const childDocument = child.activeDocument!;
    const childCurrent = child.currentSessionHistoryEntry;
    const childTarget = childDocument.env.createSessionHistoryEntry(childDocument.url, new DocumentState());
    childTarget.step = 0;
    childCurrent.step = 4;
    child.getSessionHistoryEntries().unshift(childTarget);
    const grandchild = createChild(child);
    const grandchildCurrent = grandchild.currentSessionHistoryEntry;
    const topTasks = vi.spyOn(document.env, 'queueTask');
    const childTasks = vi.spyOn(childDocument.env, 'queueTask');
    const grandchildTasks = vi.spyOn(grandchild.activeDocument!.env, 'queueTask');
    const { navigation, event, tracker } = pendingNavigation(child);
    platform.navigation.addEventListener('navigate', () => { top.currentSessionHistoryEntry.documentState.reloadPending = true; });

    const result = run(state, () => top.applyTraverseHistoryStep(0, null, null, 'none'));
    const rejected = expect(result).rejects.toThrow('History-step population and activation is not implemented');
    // The callback marks the parent for reload, pruning child work selected before cancellation.
    await runDocumentTask(document);
    await runDocumentTask(childDocument);
    await rejected;
    expect(child.currentSessionHistoryEntry).toBe(childCurrent);
    expect(childTasks).toHaveBeenCalledOnce(); // The already-selected beforeunload check, with no later cleanup.
    expect(navigation.ongoingNavigateEvent).toBe(event);
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
    expect(topTasks).toHaveBeenCalledOnce();
    expect(grandchildTasks).not.toHaveBeenCalled();
    expect(grandchild.currentSessionHistoryEntry).toBe(grandchildCurrent);
  });

  it('queues child cleanup on the child loop while preserving its active entry and pruned descendants', async () => {
    const state = fixture(true);
    const { top, document } = state;
    const child = createChild(top);
    const childDocument = child.activeDocument!;
    const childCurrent = child.currentSessionHistoryEntry;
    childCurrent.step = 4;
    const childTarget = childDocument.env.createSessionHistoryEntry(childDocument.url, new DocumentState());
    childTarget.step = 0;
    child.getSessionHistoryEntries().unshift(childTarget);
    const grandchild = createChild(child);
    const { navigation, event } = pendingNavigation(child);
    const topTasks = vi.spyOn(document.env, 'queueTask');
    const childTasks = vi.spyOn(childDocument.env, 'queueTask');
    const grandchildTasks = vi.spyOn(grandchild.activeDocument!.env, 'queueTask');

    await expect(run(state, () => top.resumeTraverseHistoryStep(0, 'none')))
      .rejects.toThrow('History-step population and activation is not implemented');
    expect(child.currentSessionHistoryEntry).toBe(childTarget);
    expect(child.activeSessionHistoryEntry).toBe(childCurrent);
    expect(child.ongoingNavigation).toBe('traversal');
    expect(navigation.ongoingNavigateEvent).toBe(event);
    expect(topTasks).not.toHaveBeenCalled();
    expect(childTasks).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function));
    expect(grandchildTasks).not.toHaveBeenCalled();
    expect(grandchild.ongoingNavigation).toBeNull();
    await runDocumentTask(childDocument);
    expect(navigation.ongoingNavigateEvent).toBeNull();
    expect(event.signal.aborted).toBe(false);
  });
});

describe('creation/destruction history bookkeeping', () => {
  it.each(['reload', 'document-change', 'pending-navigation', 'pending-same-document'] as const)(
    'does not take over a %s belonging to another navigation', async (kind) => {
      const state = fixture(kind === 'pending-same-document');
      const { top, document, current, target } = state;
      if (kind === 'reload') current.documentState.reloadPending = true;
      else target.step = top.currentSessionHistoryStep = 5;
      const ongoing = kind.startsWith('pending-') ? 'another-request' : null;
      top.ongoingNavigation = ongoing;
      const tasks = vi.spyOn(document.env, 'queueTask');

      await expect(run(state, () => top.updateForNavigableCreationOrDestruction()))
        .rejects.toThrow('History-step population and activation is not implemented');

      expect(top.currentSessionHistoryEntry).toBe(current);
      expect(top.activeSessionHistoryEntry).toBe(current);
      expect(top.ongoingNavigation).toBe(ongoing);
      expect(current.documentState.reloadPending).toBe(kind === 'reload');
      expect(tasks).not.toHaveBeenCalled();
    },
  );

  it.each(['same-document', 'already-traversing'] as const)('still advances %s bookkeeping', async (kind) => {
    const state = fixture(kind === 'same-document');
    const { top, current, target } = state;
    target.step = top.currentSessionHistoryStep = 5;
    if (kind === 'already-traversing') top.ongoingNavigation = 'traversal';

    await expect(run(state, () => top.updateForNavigableCreationOrDestruction()))
      .rejects.toThrow('History-step population and activation is not implemented');

    expect(top.currentSessionHistoryEntry).toBe(target);
    expect(top.activeSessionHistoryEntry).toBe(current);
    expect(top.ongoingNavigation).toBe('traversal');
  });
});

function fixture(sameDocument = false) {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const document = top.activeDocument!;
  document.setURL(parseURL('https://example.test/current').url!);
  document.origin = obtainURLOrigin(document.url);
  document.isInitialAboutBlank = false;
  const current = top.currentSessionHistoryEntry;
  current.url = document.url;
  current.documentState.origin = document.origin;
  current.step = top.currentSessionHistoryStep = 4;
  const state = sameDocument ? current.documentState : new DocumentState();
  state.origin = document.origin;
  state.everPopulated = true;
  const target = document.env.createSessionHistoryEntry(parseURL('https://example.test/previous').url!, state);
  target.step = 0;
  top.sessionHistoryEntries.unshift(target);
  const window = document.getRelevantGlobalObject()!;
  window.lastActivationTimestamp = -Infinity;
  window.navigation.initializeEntriesForNewDocument([target, current], current);
  const platform = project(window) as Window;
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { userAgent, top, document, current, target, platform, turns };
}

/** Supply retained child history until automatic frame startup reaches the specified history coordinator. */
function createChild(parent: Navigable): Navigable {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe');
  assert(container.isNavigableContainer());
  owner.body!.appendChild(container);
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  document.setURL(owner.url);
  document.origin = owner.origin;
  document.isInitialAboutBlank = false;
  const child = new Navigable(DocumentState.create(document), parent);
  container.contentNavigable = child;
  child.currentSessionHistoryEntry.step = 0;
  parent.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [child.currentSessionHistoryEntry] });
  return child;
}

/** Retain the internal state that the history coordinator must release without running the abortion algorithm. */
function pendingNavigation(navigable: Navigable) {
  const navigation = navigable.activeWindow!.navigation;
  const event = navigation.env.createEvent(NavigateEventImpl);
  event.type = 'navigate';
  event.abortController = navigation.env.createAbortController();
  event.signal = event.abortController.signal;
  navigation.ongoingNavigateEvent = event;
  const tracker = navigation.setupNavigateReloadMethodTracker(undefined, null);
  tracker.pending = false;
  navigation.ongoingAPIMethodTracker = tracker;
  navigable.ongoingNavigation = 'request';
  return { navigation, event, tracker };
}

/** Observe failures here while leaving the real queue occupied until the checked operation finishes. */
function run(state: ReturnType<typeof fixture>, steps: () => InternalPromise<HistoryStepResult>): Promise<HistoryStepResult> {
  const result = Promise.withResolvers<HistoryStepResult>();
  state.top.appendSessionHistoryTraversalSteps(() => steps().then(result.resolve, result.reject, internalType<void>()));
  state.turns.shift()!();
  return result.promise;
}

function read(result: InternalPromise<HistoryStepResult>): Promise<HistoryStepResult> {
  return new Promise((resolve, reject) => { result.observe(resolve, reject); });
}

async function runDocumentTask(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
