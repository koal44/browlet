import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { internalType, type InternalPromise } from '../../../../src/infra/index';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('history-step synchronous navigation queue jumping', () => {
  it('selects eligible targets in order without consuming ordinary or blocked work', async () => {
    const f = fixture();
    const { top, child, queue, turns, userAgent } = f;
    const order: string[] = [];
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const result = enqueue(f, () => {
      const selected = top.runSynchronousNavigationSteps(new Set([child]));
      expect(queue.isExecuting).toBe(true);
      return selected.then(() => { order.push('resume traversal'); return pending.promise; });
    });
    top.appendSessionHistoryTraversalSteps(() => { order.push('ordinary'); });
    top.appendSessionHistorySynchronousNavigationSteps(child, () => { order.push('blocked'); });
    top.appendSessionHistorySynchronousNavigationSteps(top, () => {
      expect(queue.algorithmSet.size).toBe(3);
      expect(queue.isExecuting).toBe(true);
      expect(top.runningNestedApplyHistoryStep).toBe(true);
      order.push('first');
    });
    top.appendSessionHistorySynchronousNavigationSteps(top, () => { order.push('second'); });
    turns.shift()!();
    expect(order).toEqual(['first', 'second']);
    expect(top.runningNestedApplyHistoryStep).toBe(false);
    expect(queue.isExecuting).toBe(false);
    await expect.poll(() => order).toEqual(['first', 'second', 'resume traversal']);
    expect(turns).toHaveLength(0);
    expect(queue.algorithmSet.size).toBe(2);

    pending.resolve();
    await result;
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(order).toEqual(['first', 'second', 'resume traversal', 'ordinary', 'blocked']);
  });

  it('reselects from the beginning after each job using the live waiting set', async () => {
    const f = fixture();
    const { top, child, turns } = f;
    const waiting = new Set([child]);
    const order: string[] = [];
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(waiting));
    top.appendSessionHistorySynchronousNavigationSteps(child, () => { order.push('previously blocked'); });
    top.appendSessionHistorySynchronousNavigationSteps(top, () => {
      order.push('unblock');
      waiting.delete(child);
      waiting.add(top);
      top.appendSessionHistorySynchronousNavigationSteps(child, () => { order.push('newly appended'); });
    });
    const newlyBlocked = vi.fn();
    top.appendSessionHistorySynchronousNavigationSteps(top, newlyBlocked);
    turns.shift()!();
    await result;
    expect(order).toEqual(['unblock', 'previously blocked', 'newly appended']);
    expect(newlyBlocked).not.toHaveBeenCalled();
    expect(f.queue.algorithmSet.size).toBe(1);
  });

  it('does not allow a nested history application to jump the queue again', async () => {
    const f = fixture();
    const { top, turns, queue } = f;
    const second = vi.fn();
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(new Set()));
    top.appendSessionHistorySynchronousNavigationSteps(top, () => {
      return top.runSynchronousNavigationSteps(new Set()).then(() => {
        expect(top.runningNestedApplyHistoryStep).toBe(true);
        expect(queue.isExecuting).toBe(false);
        expect(second).not.toHaveBeenCalled();
      });
    });
    top.appendSessionHistorySynchronousNavigationSteps(top, second);
    turns.shift()!();
    expect(top.runningNestedApplyHistoryStep).toBe(true);
    await result;
    expect(second).toHaveBeenCalledOnce();
    expect(top.runningNestedApplyHistoryStep).toBe(false);
  });

  it('holds the guard through a wait, then admits a real nested history operation', async () => {
    const f = fixture();
    const { top, turns, queue, userAgent } = f;
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const snapshot = new SourceSnapshotParams(null);
    snapshot.sandboxingFlags.add('sandboxed-navigation');
    const initiator = TopLevelTraversable.create(userAgent, null, '');
    top.currentSessionHistoryEntry.documentState.reloadPending = true;
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(new Set()));
    top.appendSessionHistorySynchronousNavigationSteps(top, () => pending.promise);
    const nested = vi.fn(() => {
      expect(queue.isExecuting).toBe(true);
      return top.applyTraverseHistoryStep(0, snapshot, initiator, 'none').then((outcome) => {
        expect(outcome).toBe('initiator-disallowed');
      }, undefined, internalType<void>());
    });
    top.appendSessionHistorySynchronousNavigationSteps(top, nested);
    turns.shift()!();
    expect(top.runningNestedApplyHistoryStep).toBe(true);
    expect(queue.isExecuting).toBe(false);
    expect(nested).not.toHaveBeenCalled();
    await expect(read(top.applyTraverseHistoryStep(0, null, null, 'none')))
      .rejects.toThrow('must begin in its session history traversal queue');

    pending.resolve();
    await result;
    expect(nested).toHaveBeenCalledOnce();
    expect(top.runningNestedApplyHistoryStep).toBe(false);
    expect(queue.isExecuting).toBe(false);
  });

  it('includes new eligible work appended during a selected job\'s wait', async () => {
    const f = fixture();
    const { top, child, turns, userAgent } = f;
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const waiting = new Set<Navigable>();
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(waiting));
    top.appendSessionHistorySynchronousNavigationSteps(top, () => pending.promise);
    turns.shift()!();
    const eligible = vi.fn();
    const blocked = vi.fn();
    const ordinary = vi.fn();
    top.appendSessionHistorySynchronousNavigationSteps(child, blocked);
    top.appendSessionHistoryTraversalSteps(ordinary);
    top.appendSessionHistorySynchronousNavigationSteps(top, eligible);
    waiting.add(child);
    expect(turns).toHaveLength(0);
    expect(eligible).not.toHaveBeenCalled();
    pending.resolve();
    await result;
    expect(eligible).toHaveBeenCalledOnce();
    expect(blocked).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
  });

  it('observes selected completion through the browser owner after its Document retires', async () => {
    const f = fixture();
    const { top, turns } = f;
    const document = top.activeDocument!;
    const pending = document.env.realm.InternalPromise.withResolvers(internalType<string>());
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(new Set()));
    top.appendSessionHistorySynchronousNavigationSteps(top, () => pending.promise);
    const next = vi.fn();
    top.appendSessionHistorySynchronousNavigationSteps(top, next);
    turns.shift()!();
    top.activeSessionHistoryEntry.documentState.document = null;
    expect(document.isFullyActive()).toBe(false);
    pending.resolve('completion payload is irrelevant');
    await result;
    expect(next).toHaveBeenCalledOnce();
    expect(top.runningNestedApplyHistoryStep).toBe(false);
  });

  it('allows an unrelated traversable to progress while a selected job waits', async () => {
    const f = fixture();
    const { top, turns, userAgent } = f;
    const other = TopLevelTraversable.create(userAgent, null, '');
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(new Set()));
    top.appendSessionHistorySynchronousNavigationSteps(top, () => pending.promise);
    const unrelated = vi.fn();
    other.appendSessionHistoryTraversalSteps(unrelated);
    turns.shift()!();
    turns.shift()!();
    expect(unrelated).toHaveBeenCalledOnce();
    expect(top.runningNestedApplyHistoryStep).toBe(true);
    expect(other.runningNestedApplyHistoryStep).toBe(false);
    pending.resolve();
    await result;
  });

  it.each(['empty', 'blocked'] as const)('finishes an %s selection without setting the nested flag', async (kind) => {
    const f = fixture();
    const result = enqueue(f, () => f.top.runSynchronousNavigationSteps(new Set([f.child])));
    const blocked = vi.fn();
    if (kind === 'blocked') f.top.appendSessionHistorySynchronousNavigationSteps(f.child, blocked);
    f.turns.shift()!();
    await result;
    expect(blocked).not.toHaveBeenCalled();
    expect(f.top.runningNestedApplyHistoryStep).toBe(false);
    expect(f.queue.isExecuting).toBe(false);
  });

  it('requires its own occupied queue before removing a pending item', async () => {
    const f = fixture();
    const selected = vi.fn();
    f.top.appendSessionHistorySynchronousNavigationSteps(f.top, selected);
    await expect(read(f.top.runSynchronousNavigationSteps(new Set())))
      .rejects.toThrow('require an occupied session history traversal queue');
    expect(f.queue.algorithmSet.size).toBe(1);
    expect(f.top.runningNestedApplyHistoryStep).toBe(false);

    const other = TopLevelTraversable.create(f.userAgent, null, '');
    let rejected!: Promise<void>;
    other.appendSessionHistoryTraversalSteps(() => {
      rejected = read(f.top.runSynchronousNavigationSteps(new Set()));
    });
    f.turns.pop()!();
    await expect(rejected).rejects.toThrow('require an occupied session history traversal queue');
    expect(f.queue.algorithmSet.size).toBe(1);
    expect(selected).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'] as const)('releases nested ownership after a selected job fails by %s', async (kind) => {
    const f = fixture();
    const { top, turns, queue, userAgent } = f;
    const failure = new Error('nested history failed');
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const result = enqueue(f, () => top.runSynchronousNavigationSteps(new Set()));
    top.appendSessionHistorySynchronousNavigationSteps(top, () => {
      if (kind === 'throw') throw failure;
      return pending.promise;
    });
    const later = vi.fn(() => {
      expect(top.runningNestedApplyHistoryStep).toBe(false);
      expect(queue.isExecuting).toBe(true);
    });
    top.appendSessionHistorySynchronousNavigationSteps(top, later);
    const rejected = expect(result).rejects.toBe(failure);
    turns.shift()!();
    if (kind === 'reject') pending.reject(failure);
    await rejected;
    expect(top.runningNestedApplyHistoryStep).toBe(false);
    expect(queue.isExecuting).toBe(false);
    expect(later).not.toHaveBeenCalled();
    expect(queue.algorithmSet.size).toBe(1);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const [, document] = BrowsingContext.createTopLevel(userAgent);
  const child = new Navigable(DocumentState.create(document), top);
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { top, child, userAgent, turns, queue: top.sessionHistoryTraversalQueue };
}

/** Keep the real queue occupied until the selected work completes; let the test observe any failure. */
function enqueue(f: ReturnType<typeof fixture>, steps: () => InternalPromise<void>): Promise<void> {
  const result = Promise.withResolvers<void>();
  f.top.appendSessionHistoryTraversalSteps(() => steps().then(result.resolve, result.reject));
  return result.promise;
}

function read<T>(promise: InternalPromise<T>): Promise<T> {
  return new Promise((resolve, reject) => { promise.observe(resolve, reject); });
}
