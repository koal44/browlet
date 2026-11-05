import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { NavigationType } from '../../../../src/browlet/browsing/navigation/api/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { PageSwapEvent, Window } from '../../../../src/browlet/platform';
import { ViewTransitionImpl } from '../../../../src/browlet/rendering/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document deactivation for cross-document navigation', () => {
  it('releases traversal ownership and lets unloading fire pageswap before completing', async () => {
    const { document, top, target, eligible, setup, unload, after, order, events } = fixture();
    const abort = vi.spyOn(top, 'informNavigationAPIAboutAbortingNavigation');
    document.deactivateForCrossDocumentNavigation('none', target, 'push', after);

    expect(eligible).toHaveBeenCalledExactlyOnceWith(target.document, 'push', false);
    expect(abort).toHaveBeenCalledExactlyOnceWith(null);
    expect(top.ongoingNavigation).toBeNull();
    expect(unload).toHaveBeenCalledExactlyOnceWith(target.document, after, expect.any(Function));
    expect(setup).not.toHaveBeenCalled();
    expect(order).toEqual(['unload-start']);
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);

    await runTask(document); // Navigation abortion is queued from parallel history work.
    expect(events).toHaveLength(0);
    await runTask(document); // The unload owner supplies the outgoing Window task.
    expect(order).toEqual(['unload-start', 'pageswap', 'unload', 'after']);
    expect(events[0]!.viewTransition).toBeNull();
    expect(after).toHaveBeenCalledTimes(1);
    expect(top.activeDocument).toBe(document);
    expect(top.activeSessionHistoryEntry).not.toBe(target);
  });

  it.each(['none', 'activation', 'browser UI'] as const)('supplies the browser-UI flag for %s involvement', (involvement) => {
    const { document, target, eligible, after } = fixture();
    document.deactivateForCrossDocumentNavigation(involvement, target, 'replace', after);
    expect(eligible).toHaveBeenCalledExactlyOnceWith(target.document, 'replace', involvement === 'browser UI');
  });

  it.each(['push', 'replace', 'reload', 'traverse'] as const)('waits for capture before unloading a %s navigation', async (type: NavigationType) => {
    const { document, window, top, target, eligible, setup, unload, after, events, order, turns } = fixture();
    const transition = new ViewTransitionImpl(document, window.env);
    eligible.mockReturnValue(true);
    setup.mockImplementation(() => {
      expect(document.env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      order.push('setup');
      return transition;
    });
    const ownershipAtPageSwap: (string | null)[] = [];
    (project(window) as Window).addEventListener('pageswap', () => { ownershipAtPageSwap.push(top.ongoingNavigation); });

    document.deactivateForCrossDocumentNavigation('none', target, type, after);
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
    const { document, top, target, eligible, unload, after, order, events, turns } = fixture();
    eligible.mockReturnValue(true);
    document.deactivateForCrossDocumentNavigation('activation', target, 'push', after);
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
    const { document, window, top, target, eligible, setup, unload, after, turns } = fixture();
    eligible.mockReturnValue(true);
    setup.mockReturnValue(new ViewTransitionImpl(document, window.env));
    document.deactivateForCrossDocumentNavigation('none', target, 'push', after);
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

  it('keeps missing CSS eligibility explicit before releasing traversal ownership', () => {
    const { document, top, target, eligible, unload, after, events } = fixture();
    eligible.mockRestore();
    expect(() => document.deactivateForCrossDocumentNavigation('none', target, 'push', after))
      .toThrow('view transition eligibility is not implemented');
    expect(top.ongoingNavigation).toBe('traversal');
    expect(unload).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('keeps missing transition setup explicit on the outgoing task', async () => {
    const { document, top, target, eligible, setup, unload, after, events } = fixture();
    eligible.mockReturnValue(true);
    setup.mockRestore();
    document.deactivateForCrossDocumentNavigation('none', target, 'push', after);
    await expect(runTask(document)).rejects.toThrow('view transition setup is not implemented');
    expect(top.ongoingNavigation).toBe('traversal');
    expect(unload).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('does not disguise the missing unloading owner as successful completion', () => {
    const { document, top, target, unload, after, events } = fixture();
    unload.mockRestore();
    expect(() => document.deactivateForCrossDocumentNavigation('none', target, 'push', after))
      .toThrow('Document and descendant unloading is not implemented');
    expect(top.ongoingNavigation).toBeNull();
    expect(after).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it.each(['navigable', 'destination'] as const)('requires a %s before checking CSS', (missing) => {
    const { document, top, target, eligible, after } = fixture();
    if (missing === 'navigable') document.browsingContext = null;
    else target.documentState.document = null;
    expect(() => document.deactivateForCrossDocumentNavigation('none', target, 'push', after))
      .toThrow(missing === 'navigable' ? 'requires a node navigable' : 'requires a populated destination');
    expect(eligible).not.toHaveBeenCalled();
    expect(top.ongoingNavigation).toBe('traversal');
  });
});

/** Retain real Window/Agent ownership and control only the unfinished CSS and unloading owners. */
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
    order.push('unload-start');
    document.env.queueTask('navigation-and-traversal', () => {
      firePageSwap?.();
      order.push('unload');
      afterAllUnloads?.();
    });
  });
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { document, window, top, target, eligible, setup, unload, after, events, order, turns };
}

async function runTask(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
