import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable, type UserNavigationInvolvement } from '../../../../src/browlet/browsing/navigation/navigable';
import type { NavigationType } from '../../../../src/browlet/browsing/navigation/api/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { PageSwapEvent, Window } from '../../../../src/browlet/platform';
import { ViewTransitionImpl } from '../../../../src/browlet/rendering/index';
import { InternalPromise, internalType } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document deactivation for cross-document navigation', () => {
  it('releases traversal ownership and lets unloading fire pageswap before completing', async () => {
    const { document, top, target, eligible, setup, unload, after, order, events, turns, deactivate } = fixture();
    const abort = vi.spyOn(top, 'informNavigationAPIAboutAbortingNavigation');
    expect(deactivate('none', 'push')).toBeInstanceOf(InternalPromise);
    const later = vi.fn(() => { expect(after).toHaveBeenCalledOnce(); });
    top.appendSessionHistoryTraversalSteps(later);

    expect(eligible).toHaveBeenCalledExactlyOnceWith(target.document, 'push', false);
    expect(abort).toHaveBeenCalledExactlyOnceWith(null);
    expect(top.ongoingNavigation).toBeNull();
    expect(unload).toHaveBeenCalledExactlyOnceWith(target.document, after, expect.any(Function));
    expect(setup).not.toHaveBeenCalled();
    expect(order).toEqual(['unload-start']);
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(later).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);

    await runTask(document); // Navigation abortion is queued from parallel history work.
    expect(events).toHaveLength(0);
    await runTask(document); // The unload owner supplies the outgoing Window task.
    expect(order).toEqual(['unload-start', 'pageswap', 'unload', 'after']);
    expect(events[0]!.viewTransition).toBeNull();
    expect(after).toHaveBeenCalledTimes(1);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
    expect(top.activeDocument).toBe(document);
    expect(top.activeSessionHistoryEntry).not.toBe(target);
  });

  it.each(['none', 'activation', 'browser UI'] as const)('supplies the browser-UI flag for %s involvement', (involvement) => {
    const { target, eligible, deactivate } = fixture();
    deactivate(involvement, 'replace');
    expect(eligible).toHaveBeenCalledExactlyOnceWith(target.document, 'replace', involvement === 'browser UI');
  });

  it.each(['push', 'replace', 'reload', 'traverse'] as const)('waits for capture before unloading a %s navigation', async (type: NavigationType) => {
    const { document, window, top, target, eligible, setup, unload, after, events, order, turns, deactivate } = fixture();
    const transition = new ViewTransitionImpl(document, window.env);
    eligible.mockReturnValue(true);
    setup.mockImplementation(() => {
      expect(document.env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      order.push('setup');
      return transition;
    });
    const ownershipAtPageSwap: (string | null)[] = [];
    (project(window) as Window).addEventListener('pageswap', () => { ownershipAtPageSwap.push(top.ongoingNavigation); });

    deactivate('none', type);
    expect(eligible).toHaveBeenCalledExactlyOnceWith(target.document, type, false);
    expect(setup).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(top.ongoingNavigation).toBe('traversal');
    await runTask(document);
    expect(setup).toHaveBeenCalledExactlyOnceWith(target.document, expect.any(Function));
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe(project(window));
    expect(events[0]!.isTrusted).toBe(true);
    expect(events[0]!.viewTransition).toBe(project(transition));
    expect(ownershipAtPageSwap).toEqual(['traversal']);
    expect(unload).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);

    order.push('capture');
    setup.mock.calls[0]![1]();
    expect(turns).toHaveLength(1);
    expect(top.ongoingNavigation).toBe('traversal');
    turns.shift()!();
    expect(top.ongoingNavigation).toBeNull();
    expect(unload).toHaveBeenCalledExactlyOnceWith(target.document, after);
    expect(after).not.toHaveBeenCalled();
    await runTask(document);
    await runTask(document);
    expect(order).toEqual(['setup', 'pageswap', 'capture', 'unload-start', 'unload', 'after']);
    expect(events).toHaveLength(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(top.activeDocument).toBe(document);
  });

  it('queues unloading immediately after pageswap when setup declines a transition', async () => {
    const { document, top, target, eligible, unload, after, order, events, turns, deactivate } = fixture();
    eligible.mockReturnValue(true);
    deactivate('activation', 'push');
    await runTask(document);
    expect(order).toEqual(['setup', 'pageswap']);
    expect(events[0]!.viewTransition).toBeNull();
    expect(top.ongoingNavigation).toBe('traversal');
    expect(unload).not.toHaveBeenCalled();
    expect(turns).toHaveLength(1);

    turns.shift()!();
    expect(top.ongoingNavigation).toBeNull();
    expect(unload).toHaveBeenCalledExactlyOnceWith(target.document, after);
    await runTask(document);
    await runTask(document);
    expect(order).toEqual(['setup', 'pageswap', 'unload-start', 'unload', 'after']);
    expect(events).toHaveLength(1);
  });

  it('appends capture completion behind traversal work already in the queue', async () => {
    const { document, window, top, eligible, setup, unload, turns, deactivate } = fixture();
    eligible.mockReturnValue(true);
    setup.mockReturnValue(new ViewTransitionImpl(document, window.env));
    deactivate('none', 'push');
    await runTask(document);
    const previousWork = vi.fn(() => {
      expect(top.ongoingNavigation).toBe('traversal');
      expect(unload).not.toHaveBeenCalled();
    });
    top.appendSessionHistoryTraversalSteps(previousWork);
    setup.mock.calls[0]![1]();
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(previousWork).toHaveBeenCalledTimes(1);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it('releases the queue during capture and retains the later unloading operation', async () => {
    const { document, window, top, eligible, setup, unload, after, turns, deactivate } = fixture();
    eligible.mockReturnValue(true);
    setup.mockReturnValue(new ViewTransitionImpl(document, window.env));
    expect(deactivate('none', 'push')).toBeUndefined();
    const duringCapture = vi.fn(() => { expect(unload).not.toHaveBeenCalled(); });
    top.appendSessionHistoryTraversalSteps(duringCapture);
    turns.shift()!();
    expect(duringCapture).toHaveBeenCalledOnce();

    await runTask(document);
    setup.mock.calls[0]![1]();
    turns.shift()!();
    expect(unload).toHaveBeenCalledOnce();
    const afterUnloading = vi.fn(() => { expect(after).toHaveBeenCalledOnce(); });
    top.appendSessionHistoryTraversalSteps(afterUnloading);
    expect(turns).toHaveLength(0);
    expect(afterUnloading).not.toHaveBeenCalled();
    await runTask(document);
    await runTask(document);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(afterUnloading).toHaveBeenCalledOnce();
  });

  it('keeps missing CSS eligibility explicit before releasing traversal ownership', () => {
    const { top, eligible, unload, after, events, deactivate } = fixture();
    eligible.mockRestore();
    expect(() => deactivate('none', 'push'))
      .toThrow('view transition eligibility is not implemented');
    expect(top.ongoingNavigation).toBe('traversal');
    expect(unload).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('keeps missing transition setup explicit on the outgoing task', async () => {
    const { document, top, eligible, setup, unload, after, events, deactivate } = fixture();
    eligible.mockReturnValue(true);
    setup.mockRestore();
    deactivate('none', 'push');
    await expect(runTask(document)).rejects.toThrow('view transition setup is not implemented');
    expect(top.ongoingNavigation).toBe('traversal');
    expect(unload).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('propagates the missing cache admission dependency through recursive unloading', async () => {
    const { document, top, unload, after, events, turns, deactivate } = fixture();
    unload.mockRestore();
    deactivate('none', 'push');
    await runTask(document);
    await runTask(document);
    await expect.poll(() => turns.length).toBe(1);
    expect(() => turns.shift()!()).toThrow('Back-forward cache admission is not implemented');
    expect(top.ongoingNavigation).toBeNull();
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });

  it.each(['navigable', 'destination'] as const)('requires a %s before checking CSS', (missing) => {
    const { document, top, target, eligible, deactivate } = fixture();
    if (missing === 'navigable') document.browsingContext = null;
    else target.documentState.document = null;
    expect(() => deactivate('none', 'push'))
      .toThrow(missing === 'navigable' ? 'requires a node navigable' : 'requires a populated destination');
    expect(eligible).not.toHaveBeenCalled();
    expect(top.ongoingNavigation).toBe('traversal');
  });
});

/** Retain real Window/Agent ownership and control CSS and the asynchronous unloading boundary. */
function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const destination = TopLevelTraversable.create(userAgent, null, '');
  for (const [navigable, path] of [[top, 'source'], [destination, 'destination']] as const) {
    const document = navigable.activeDocument!;
    document.setURL(parseURL(`https://example.test/${path}`).url!);
    document.origin = obtainURLOrigin(document.url);
    document.isInitialAboutBlank = false;
    navigable.activeSessionHistoryEntry.url = document.url;
    navigable.activeSessionHistoryEntry.documentState.origin = document.origin;
  }
  const document = top.activeDocument!;
  const window = document.getRelevantGlobalObject()!;
  const target = destination.activeSessionHistoryEntry;
  window.navigation.initializeEntriesForNewDocument([target, top.activeSessionHistoryEntry], top.activeSessionHistoryEntry);
  top.ongoingNavigation = 'traversal';
  const events: PageSwapEvent[] = [];
  const order: string[] = [];
  (project(window) as Window).addEventListener('pageswap', (event) => {
    order.push('pageswap');
    events.push(event as PageSwapEvent);
  });
  const after = vi.fn(() => { order.push('after'); });
  const eligible = vi.spyOn(document, 'canTriggerCrossDocumentViewTransition').mockReturnValue(false);
  const setup = vi.spyOn(document, 'setupCrossDocumentViewTransition').mockImplementation(() => {
    expect(document.env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
    order.push('setup');
    return null;
  });
  const unload = vi.spyOn(document, 'unloadAndDescendants').mockImplementation((_newDocument, afterAllUnloads, firePageSwap) => {
    const completion = userAgent.HostPromise.withResolvers(internalType<void>());
    order.push('unload-start');
    document.env.queueTask('navigation-and-traversal', () => {
      firePageSwap?.();
      order.push('unload');
      afterAllUnloads?.();
      completion.resolve();
    });
    return completion.promise;
  });
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  const deactivate = (involvement: UserNavigationInvolvement, type: NavigationType): void | InternalPromise<void> => {
    let completion: void | InternalPromise<void> = undefined;
    top.appendSessionHistoryTraversalSteps(() => {
      completion = document.deactivateForCrossDocumentNavigation(involvement, target, type, after);
      return completion;
    });
    turns.shift()!();
    return completion;
  };
  return { document, window, top, target, eligible, setup, unload, after, events, order, turns, deactivate };
}

async function runTask(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
