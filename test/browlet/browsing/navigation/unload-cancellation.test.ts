import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { type UnloadCancellationResult } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { Window } from '../../../../src/browlet/platform';
import { type InternalPromise } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('unload cancellation coordination', () => {
  it('completes an empty list without needing a Document or queuing a task', async () => {
    const userAgent = createManualUserAgent();
    await expect(read(userAgent.checkIfUnloadingIsCanceled([]))).resolves.toBe('continue');
  });

  it('dispatches through the real bindings on each Document loop and waits for every task', async () => {
    const { userAgent, top, document } = fixture();
    const other = TopLevelTraversable.create(userAgent, null, '');
    const otherDocument = other.activeDocument!;
    const seen: DocumentImpl[] = [];
    for (const owner of [document, otherDocument]) {
      const window = project(owner.getRelevantGlobalObject()!) as Window;
      window.addEventListener('beforeunload', (event) => {
        expect(event.isTrusted).toBe(true);
        expect(owner.env.responsibleEventLoop.currentlyRunningTask?.source.name).toBe('navigation and traversal');
        seen.push(owner);
      });
    }
    let completed = false;
    const result = read(userAgent.checkIfUnloadingIsCanceled([top, other]));
    void result.then(() => { completed = true; });
    expect(seen).toEqual([]);
    expect(document.env.responsibleEventLoop).not.toBe(otherDocument.env.responsibleEventLoop);

    await runCheck(otherDocument);
    expect(seen).toEqual([otherDocument]);
    expect(completed).toBe(false);
    await runCheck(document);

    await expect(result).resolves.toBe('continue');
    expect(seen).toEqual([otherDocument, document]);
  });

  it('shares prompt state in task execution order, preserves cancellation, and still checks the remaining Documents', async () => {
    const { userAgent, top, document } = fixture();
    const other = TopLevelTraversable.create(userAgent, null, '');
    const otherDocument = other.activeDocument!;
    const first = vi.spyOn(otherDocument, 'fireBeforeUnload').mockReturnValue([true, true]);
    const second = vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([true, false]);
    const result = read(userAgent.checkIfUnloadingIsCanceled([top, other]));

    await runCheck(otherDocument);
    await runCheck(document);

    await expect(result).resolves.toBe('canceled-by-beforeunload');
    expect(first).toHaveBeenCalledExactlyOnceWith(false);
    expect(second).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('snapshots the input list and Documents before queuing', async () => {
    const { userAgent, top, document } = fixture();
    const list = [top];
    const queued = vi.spyOn(document.env, 'queueTask');
    const check = vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([false, false]);
    const result = read(userAgent.checkIfUnloadingIsCanceled(list));
    list.length = 0;
    const other = TopLevelTraversable.create(userAgent, null, '');
    const replacement = vi.spyOn(other.activeDocument!, 'fireBeforeUnload');
    list.push(other);

    expect(queued).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', {
      run: expect.any(Function) as unknown, discard: expect.any(Function) as unknown,
    });
    await runCheck(document);

    await expect(result).resolves.toBe('continue');
    expect(check).toHaveBeenCalledExactlyOnceWith(false);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('preserves the queued Document activity gate while the check waits', async () => {
    const { userAgent, top, document } = fixture();
    const check = vi.spyOn(document, 'fireBeforeUnload');
    const result = read(userAgent.checkIfUnloadingIsCanceled([top]));
    const activity = vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(check).not.toHaveBeenCalled();
    activity.mockRestore();
    await runCheck(document);
    await expect(result).resolves.toBe('continue');
  });

  it('rejects internal check failures instead of leaving a completion pending or reporting approval', async () => {
    const { userAgent, top, document } = fixture();
    const failure = new Error('unfinished owner');
    vi.spyOn(document, 'fireBeforeUnload').mockImplementation(() => { throw failure; });
    const result = read(userAgent.checkIfUnloadingIsCanceled([top]));
    const rejected = expect(result).rejects.toBe(failure);

    await runCheck(document);

    await rejected;
  });

  it('rejects the internal wait when teardown discards an unload check without firing beforeunload', async () => {
    const { userAgent, top, document } = fixture();
    const check = vi.spyOn(document, 'fireBeforeUnload');
    document.env.queueTask('navigation-and-traversal', { run: () => { document.destroy(); } });
    const result = read(userAgent.checkIfUnloadingIsCanceled([top]));
    const rejected = expect(result).rejects.toThrow('Unload check task was discarded');
    await runCheck(document);
    await rejected;
    expect(document.browsingContext).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
});

describe('top-level traversal checks', () => {
  it('completes a real beforeunload dismissal and allows a later check to reach the navigate event', async () => {
    const { userAgent, top, document, navigation } = traversalFixture();
    const window = document.getRelevantGlobalObject()!;
    const platform = project(window) as Window;
    let block = true;
    let navigateCount = 0;
    platform.addEventListener('beforeunload', (event) => { if (block) event.preventDefault(); });
    platform.navigation.addEventListener('navigate', () => { navigateCount++; });
    window.lastActivationTimestamp = -Infinity;
    vi.spyOn(userAgent, 'shouldShowBeforeUnloadPrompt').mockReturnValue(true);
    vi.spyOn(userAgent, 'webDriverBiDiUserPromptOpened').mockReturnValue('dismiss');
    const navigate = vi.spyOn(navigation, 'fireTraverseNavigateEvent');
    const first = read(userAgent.checkIfUnloadingIsCanceled([top], top, 0, 'none'));
    await runCheck(document);
    await expect(first).resolves.toBe('canceled-by-beforeunload');
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateCount).toBe(0);

    block = false;
    const second = read(userAgent.checkIfUnloadingIsCanceled([top], top, 0, 'none'));
    await runCheck(document);
    await expect(second).resolves.toBe('continue');
    expect(navigateCount).toBe(1);
  });

  it('runs beforeunload before navigate and queues the remaining Documents only after that pair', async () => {
    const { userAgent, top, document, target, navigation } = traversalFixture();
    const other = TopLevelTraversable.create(userAgent, null, '');
    const otherDocument = other.activeDocument!;
    const order: string[] = [];
    vi.spyOn(document, 'fireBeforeUnload').mockImplementation((shown) => {
      expect(shown).toBe(false); order.push('beforeunload'); return [true, false];
    });
    const navigate = vi.spyOn(navigation, 'fireTraverseNavigateEvent').mockImplementation(() => { order.push('navigate'); return true; });
    const remaining = vi.spyOn(otherDocument, 'fireBeforeUnload').mockImplementation((shown) => {
      expect(shown).toBe(true); order.push('remaining'); return [true, false];
    });
    const result = read(userAgent.checkIfUnloadingIsCanceled([top, other], top, 0, 'browser UI'));
    expect(otherDocument.env.responsibleEventLoop.runTaskTurn()).toBe(false);

    await runCheck(document);
    expect(order).toEqual(['beforeunload', 'navigate']);
    expect(remaining).not.toHaveBeenCalled();
    await runCheck(otherDocument);

    await expect(result).resolves.toBe('continue');
    expect(navigate).toHaveBeenCalledExactlyOnceWith(target, 'browser UI');
    expect(order).toEqual(['beforeunload', 'navigate', 'remaining']);
  });

  it.each(['beforeunload', 'navigate'] as const)('finishes a %s cancellation without checking descendants', async (source) => {
    const { userAgent, top, document, navigation } = traversalFixture();
    const other = TopLevelTraversable.create(userAgent, null, '');
    vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([true, source === 'beforeunload']);
    const navigate = vi.spyOn(navigation, 'fireTraverseNavigateEvent').mockReturnValue(source !== 'navigate');
    const remaining = vi.spyOn(other.activeDocument!, 'fireBeforeUnload');
    const result = read(userAgent.checkIfUnloadingIsCanceled([top, other], top, 0, 'none'));

    await runCheck(document);

    await expect(result).resolves.toBe(`canceled-by-${source}`);
    expect(navigate).toHaveBeenCalledTimes(source === 'navigate' ? 1 : 0);
    expect(remaining).not.toHaveBeenCalled();
    expect(other.activeDocument!.env.responsibleEventLoop.runTaskTurn()).toBe(false);
  });

  it('fires navigate without beforeunload when the traversable is not in the unload list', async () => {
    const { userAgent, top, document, navigation } = traversalFixture();
    const beforeUnload = vi.spyOn(document, 'fireBeforeUnload');
    const navigate = vi.spyOn(navigation, 'fireTraverseNavigateEvent').mockReturnValue(true);
    const result = read(userAgent.checkIfUnloadingIsCanceled([], top, 0, 'activation'));

    await runCheck(document);

    await expect(result).resolves.toBe('continue');
    expect(beforeUnload).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(['current-entry', 'different-origin'] as const)('skips the special pair for %s but retains ordinary unload checks', async (kind) => {
    const { userAgent, top, document, target, navigation } = traversalFixture();
    if (kind === 'different-origin') target.documentState.origin = obtainURLOrigin(parseURL('https://other.test/').url!);
    else top.currentSessionHistoryEntry.documentState.origin = null;
    const beforeUnload = vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([false, false]);
    const navigate = vi.spyOn(navigation, 'fireTraverseNavigateEvent');
    const result = read(userAgent.checkIfUnloadingIsCanceled([top], top, kind === 'current-entry' ? 1 : 0, 'none'));

    await runCheck(document);

    await expect(result).resolves.toBe('continue');
    expect(beforeUnload).toHaveBeenCalledExactlyOnceWith(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('rejects incomplete traversal inputs and missing history origins explicitly', async () => {
    const { userAgent, top, target } = traversalFixture();
    await expect(read(userAgent.checkIfUnloadingIsCanceled([], top))).rejects.toThrow('target step and user involvement');
    await expect(read(userAgent.checkIfUnloadingIsCanceled([], top, 0))).rejects.toThrow('target step and user involvement');
    target.documentState.origin = null;
    await expect(read(userAgent.checkIfUnloadingIsCanceled([], top, 0, 'none'))).rejects.toThrow('recorded history origins');
  });
});

describe('target history entry selection', () => {
  it('selects the greatest eligible step, including gaps and unordered storage', () => {
    const { top, document, target } = traversalFixture();
    const later = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));
    later.step = 7;
    top.currentSessionHistoryEntry.step = 3;
    top.sessionHistoryEntries = [later, target, top.currentSessionHistoryEntry];
    expect(top.getTargetHistoryEntry(0)).toBe(target);
    expect(top.getTargetHistoryEntry(2)).toBe(target);
    expect(top.getTargetHistoryEntry(4)).toBe(top.currentSessionHistoryEntry);
    expect(top.getTargetHistoryEntry(7)).toBe(later);
    target.step = 2;
    expect(() => top.getTargetHistoryEntry(0)).toThrow('has no entry');
    later.step = 'pending';
    expect(() => top.getTargetHistoryEntry(7)).toThrow('requires committed entries');
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const document = top.activeDocument!;
  return { userAgent, top, document };
}

function traversalFixture() {
  const result = fixture();
  const { top, document } = result;
  document.setURL(parseURL('https://example.test/current').url!);
  document.origin = obtainURLOrigin(document.url);
  document.isInitialAboutBlank = false;
  top.currentSessionHistoryEntry.documentState.origin = document.origin;
  top.currentSessionHistoryEntry.step = 1;
  const targetState = new DocumentState();
  targetState.origin = document.origin;
  targetState.everPopulated = true;
  const target = document.env.createSessionHistoryEntry(parseURL('https://example.test/previous').url!, targetState);
  target.step = 0;
  top.sessionHistoryEntries.unshift(target);
  return { ...result, target, navigation: document.getRelevantGlobalObject()!.navigation };
}

function read(result: InternalPromise<UnloadCancellationResult>): Promise<UnloadCancellationResult> {
  return new Promise((resolve, reject) => { result.observe(resolve, reject); });
}

async function runCheck(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
