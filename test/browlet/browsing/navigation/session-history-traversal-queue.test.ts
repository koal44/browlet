import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { UserAgent } from '../../../../src/browlet/user-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('session history traversal parallel queue', () => {
  it('runs appended work in order on a later browser-owned turn', () => {
    const { traversable, turns } = fixture();
    const order: number[] = [];
    expect(turns).toHaveLength(0);
    traversable.appendSessionHistoryTraversalSteps(() => { order.push(1); });
    traversable.appendSessionHistoryTraversalSteps(() => { order.push(2); });

    expect(order).toEqual([]);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(order).toEqual([1, 2]);
    expect(traversable.sessionHistoryTraversalQueue.algorithmSet.size).toBe(0);
    expect(turns).toHaveLength(0);
  });

  it('removes the running item and appends reentrant work after already pending work', () => {
    const { traversable, turns } = fixture();
    const queue = traversable.sessionHistoryTraversalQueue;
    const order: number[] = [];
    const first = () => {
      expect(queue.algorithmSet.has(first)).toBe(false);
      order.push(1);
      traversable.appendSessionHistoryTraversalSteps(() => { order.push(3); });
    };
    traversable.appendSessionHistoryTraversalSteps(first);
    traversable.appendSessionHistoryTraversalSteps(first);
    traversable.appendSessionHistoryTraversalSteps(() => { order.push(2); });

    expect(queue.algorithmSet.size).toBe(2);
    turns.shift()!();
    expect(order).toEqual([1, 2, 3]);
    expect(turns).toHaveLength(0);
  });

  it('waits for one algorithm to finish while another traversable can run', async () => {
    const { userAgent, traversable, turns } = fixture();
    const other = TopLevelTraversable.create(userAgent, null, '');
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const order: string[] = [];
    traversable.appendSessionHistoryTraversalSteps(() => {
      order.push('waiting');
      return pending.promise;
    });
    traversable.appendSessionHistoryTraversalSteps(() => { order.push('after wait'); });
    other.appendSessionHistoryTraversalSteps(() => { order.push('other traversable'); });

    turns.shift()!();
    turns.shift()!();
    expect(order).toEqual(['waiting', 'other traversable']);
    expect(turns).toHaveLength(0);
    traversable.appendSessionHistoryTraversalSteps(() => { order.push('appended during wait'); });
    expect(turns).toHaveLength(0);

    pending.resolve();
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(order).toEqual(['waiting', 'other traversable', 'after wait', 'appended during wait']);
    expect(turns).toHaveLength(0);
  });

  it('distinguishes entry from a suspended algorithm and ignores its returned status', async () => {
    const { userAgent, traversable, turns } = fixture();
    const queue = traversable.sessionHistoryTraversalQueue;
    const pending = userAgent.HostPromise.withResolvers(internalType<string>());
    const later = vi.fn();
    expect(queue.userAgent).toBe(userAgent);
    expect(queue.isExecuting).toBe(false);
    traversable.appendSessionHistoryTraversalSteps(() => {
      expect(queue.isExecuting).toBe(true);
      return pending.promise;
    });
    traversable.appendSessionHistoryTraversalSteps(later);
    turns.shift()!();
    expect(queue.isExecuting).toBe(false);
    expect(later).not.toHaveBeenCalled();

    pending.resolve('canceled');
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
    expect(queue.isExecuting).toBe(false);
  });

  it('tags synchronous navigation per append without changing the supplied callback', () => {
    const { userAgent, traversable, turns } = fixture();
    const [, document] = BrowsingContext.createTopLevel(userAgent);
    const child = new Navigable(DocumentState.create(document), traversable);
    const steps = vi.fn();
    traversable.appendSessionHistoryTraversalSteps(steps);
    traversable.appendSessionHistorySynchronousNavigationSteps(child, steps);
    traversable.appendSessionHistorySynchronousNavigationSteps(traversable, steps);

    const entries = [...traversable.sessionHistoryTraversalQueue.algorithmSet];
    expect(entries.map((entry) => entry.targetNavigable)).toEqual([undefined, child, traversable]);
    expect(entries[0]).toBe(steps);
    expect(Reflect.has(steps, 'targetNavigable')).toBe(false);
    turns.shift()!();
    expect(steps).toHaveBeenCalledTimes(3);
  });

  it('leaves pending items accessible for selective removal by history application', () => {
    const { traversable, turns } = fixture();
    const steps = vi.fn();
    traversable.appendSessionHistorySynchronousNavigationSteps(traversable, steps);
    const queue = traversable.sessionHistoryTraversalQueue;
    const pending = queue.algorithmSet.values().next().value!;
    // Selective history application removes the chosen item before invoking it.
    queue.algorithmSet.delete(pending);
    pending();
    turns.shift()!();
    expect(steps).toHaveBeenCalledOnce();
    expect(turns).toHaveLength(0);
  });

  it('wakes after idling and keeps the original UserAgent when the active Document is cleared', () => {
    const { traversable, turns } = fixture();
    const steps = vi.fn();
    traversable.appendSessionHistoryTraversalSteps(steps);
    turns.shift()!();
    traversable.activeSessionHistoryEntry.documentState.document = null;
    traversable.appendSessionHistoryTraversalSteps(steps);
    turns.shift()!();
    expect(steps).toHaveBeenCalledTimes(2);
  });

  it('surfaces a throwing algorithm without stranding later queued work', () => {
    const { traversable, turns } = fixture();
    const error = new Error('history application failed');
    const later = vi.fn();
    traversable.appendSessionHistoryTraversalSteps(() => { throw error; });
    traversable.appendSessionHistoryTraversalSteps(later);
    expect(() => turns.shift()!()).toThrow(error);
    expect(later).not.toHaveBeenCalled();
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
  });

  it('surfaces rejected completion on the browser scheduler and releases later work', async () => {
    const { userAgent, traversable, turns } = fixture();
    const pending = userAgent.HostPromise.withResolvers(internalType<void>());
    const error = new Error('history wait failed');
    const later = vi.fn();
    traversable.appendSessionHistoryTraversalSteps(() => pending.promise);
    traversable.appendSessionHistoryTraversalSteps(later);
    turns.shift()!();
    expect(later).not.toHaveBeenCalled();

    pending.reject(error);
    await expect.poll(() => turns.length).toBe(2);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
    expect(() => turns.shift()!()).toThrow(error);
    expect(turns).toHaveLength(0);
  });

  it('retries a failed host wake-up without losing queued algorithms', () => {
    const { traversable, schedule, turns } = fixture();
    const error = new Error('host scheduling failed');
    schedule.mockImplementationOnce(() => { throw error; });
    const first = vi.fn();
    const later = vi.fn();
    expect(() => traversable.appendSessionHistoryTraversalSteps(first)).toThrow(error);
    traversable.appendSessionHistoryTraversalSteps(later);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(first).toHaveBeenCalledOnce();
    expect(later).toHaveBeenCalledOnce();
  });

  it('observes a retired Document\'s completion through the browser owner', async () => {
    const { traversable, turns } = fixture();
    const document = traversable.activeDocument!;
    const pending = document.env.realm.InternalPromise.withResolvers(internalType<void>());
    const later = vi.fn();
    traversable.appendSessionHistoryTraversalSteps(() => pending.promise);
    traversable.appendSessionHistoryTraversalSteps(later);
    turns.shift()!();
    traversable.activeSessionHistoryEntry.documentState.document = null;
    expect(document.isFullyActive()).toBe(false);

    pending.resolve();
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
  });

  it('executes through the real parallel scheduler without entering a Document task', async () => {
    const userAgent = new UserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const env = traversable.activeDocument!.env;
    const queueTask = vi.spyOn(env, 'queueTask');
    const ran = vi.fn(() => {
      expect(env.responsibleEventLoop.currentlyRunningTask).toBeNull();
    });
    traversable.appendSessionHistoryTraversalSteps(ran);
    expect(ran).not.toHaveBeenCalled();
    await expect.poll(() => ran.mock.calls.length).toBe(1);
    expect(queueTask).not.toHaveBeenCalled();
  });
});

function fixture() {
  const userAgent = new UserAgent();
  const turns: (() => void)[] = [];
  const schedule = vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  return { userAgent, traversable, turns, schedule };
}
