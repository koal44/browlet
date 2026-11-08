import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type HistoryStepResult } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { internalType } from '../../../../src/infra/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('joint history delta traversal', () => {
  it.each([['go', 0], ['back', 2], ['forward', 7]] as const)('selects distinct nested-history positions for History.%s', async (method, target) => {
    const { browser, document, traversable, entry, apply, turns } = await fixture();
    traversable.activeSessionHistoryEntry.documentState.nestedHistories.push({
      id: Symbol('retained child'), entries: [entry(7), entry(4), entry(2)],
    });
    const active = traversable.activeSessionHistoryEntry;
    expect(await browser.evaluate((method) => {
      if (method === 'go') return history.go(-2);
      return history[method]();
    }, method)).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
    expect(turns).toHaveLength(1);
    expect([...traversable.sessionHistoryTraversalQueue.algorithmSet][0]?.targetNavigable).toBeUndefined();

    turns.shift()!();

    expect(apply).toHaveBeenCalledExactlyOnceWith(target, expect.any(SourceSnapshotParams), traversable, 'none');
    expect(apply.mock.calls[0]![1]!.fetchClient).toBe(document.env);
    expect(traversable.activeSessionHistoryEntry).toBe(active);
    expect(traversable.currentSessionHistoryStep).toBe(4);
  });

  it('captures the script source before queued work and retains it after source detachment', async () => {
    const { document, traversable, activation, apply, turns } = await fixture();
    activation.mockReturnValue(true);
    document.activeSandboxingFlagSet.add('sandboxed-downloads');
    document.policyContainer.referrerPolicy = 'origin';

    traversable.traverseHistoryByDelta(-1, document);

    expect(activation).toHaveBeenCalledOnce();
    activation.mockReturnValue(false);
    document.policyContainer.referrerPolicy = 'no-referrer';
    document.browsingContext = null;
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith(0, expect.any(SourceSnapshotParams), traversable, 'none');
    const snapshot = apply.mock.calls[0]![1]!;
    expect(snapshot.hasTransientActivation).toBe(true);
    expect(snapshot.allowsDownloading).toBe(false);
    expect(snapshot.sandboxingFlags.has('sandboxed-downloads')).toBe(true);
    expect(snapshot.fetchClient).toBe(document.env);
    expect(snapshot.sourcePolicyContainer.referrerPolicy).toBe('origin');
    expect(activation).toHaveBeenCalledOnce();
  });

  it('uses null source inputs for browser UI without consulting Window activation', async () => {
    const { traversable, activation, apply, turns } = await fixture();
    activation.mockRestore();
    traversable.traverseHistoryByDelta(1);
    expect(apply).not.toHaveBeenCalled();
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith(9, null, null, 'browser UI');
  });

  it('selects from history and the current step after earlier queued work has run', async () => {
    const { traversable, entry, apply, turns } = await fixture();
    const usedSteps = vi.spyOn(traversable, 'getAllUsedHistorySteps');
    traversable.appendSessionHistoryTraversalSteps(() => {
      traversable.sessionHistoryEntries.push(entry(15));
      traversable.currentSessionHistoryStep = 9;
    });
    traversable.traverseHistoryByDelta(1);
    expect(usedSteps).not.toHaveBeenCalled();
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith(15, null, null, 'browser UI');
  });

  it('lets sequential requests observe the history step reached by earlier application', async () => {
    const { document, traversable, apply, turns } = await fixture();
    traversable.currentSessionHistoryStep = 9;
    apply.mockImplementation((step) => {
      traversable.currentSessionHistoryStep = step;
      return document.env.userAgent.HostPromise.resolve('applied', internalType<HistoryStepResult>());
    });
    traversable.traverseHistoryByDelta(-1);
    traversable.traverseHistoryByDelta(-1);
    turns.shift()!();
    expect(apply).toHaveBeenCalledTimes(1);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(apply.mock.calls).toEqual([[4, null, null, 'browser UI'], [0, null, null, 'browser UI']]);
  });

  it.each([-3, 3, -(2 ** 31), 2 ** 31 - 1])('silently drops an out-of-range delta (%s) inside the queue', async (delta) => {
    const { document, traversable, apply, turns } = await fixture();
    const original = traversable.sessionHistoryEntries;
    traversable.traverseHistoryByDelta(delta, document);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(apply).not.toHaveBeenCalled();
    expect(traversable.currentSessionHistoryStep).toBe(4);
    expect(traversable.sessionHistoryEntries).toBe(original);
  });

  it('rechecks bounds after earlier queued work removes a formerly reachable target', async () => {
    const { traversable, apply, turns } = await fixture();
    traversable.appendSessionHistoryTraversalSteps(() => { traversable.sessionHistoryEntries.pop(); });
    traversable.traverseHistoryByDelta(1);
    turns.shift()!();
    expect(apply).not.toHaveBeenCalled();
  });

  it('retains the child as initiator while selecting a position in the containing joint history', async () => {
    const { document, traversable, apply, turns } = await fixture();
    const frame = document.createElement('iframe') as HTMLIFrameElementImpl;
    document.body!.appendChild(frame);
    const [, childDocument] = BrowsingContext.create(document, frame, traversable.activeBrowsingContext!.group!);
    const child = new Navigable(DocumentState.create(childDocument), traversable);
    frame.contentNavigable = child;
    vi.spyOn(child.activeWindow!, 'hasTransientActivation').mockReturnValue(false);

    getRelevantRealm(childDocument).windowProxy.platform.history.back();
    turns.shift()!();

    expect(apply).toHaveBeenCalledExactlyOnceWith(0, expect.any(SourceSnapshotParams), child, 'none');
    expect(apply.mock.calls[0]![1]!.fetchClient).toBe(childDocument.env);
  });

  it('keeps zero-delta reload routing at History while the internal operation selects the current step', async () => {
    const { browser, traversable, apply, turns } = await fixture();
    const reload = vi.spyOn(traversable, 'reload').mockImplementation(() => {});
    await browser.evaluate(() => history.go(0));
    expect(reload).toHaveBeenCalledExactlyOnceWith();
    expect(turns).toHaveLength(0);
    traversable.traverseHistoryByDelta(0);
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith(4, null, null, 'browser UI');
  });

  it('queues script traversal using the real source-activation state', async () => {
    const { browser, activation, apply, turns } = await fixture();
    activation.mockRestore();
    browser.window.history.back();
    expect(turns).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it('reaches the explicit population dependency after the queued cancellation checks', async () => {
    const { traversable, apply, turns } = await fixture();
    apply.mockRestore();
    expect(traversable.traverseHistoryByDelta(-1)).toBeUndefined();
    turns.shift()!();
    await expect.poll(() => turns.length).toBe(1);
    expect(turns.shift()!).toThrow('History-step population and activation is not implemented');
  });

  it('rejects an inconsistent current step instead of traversing from index minus one', async () => {
    const { traversable, apply, turns } = await fixture();
    traversable.currentSessionHistoryStep = 5;
    traversable.traverseHistoryByDelta(1);
    expect(turns.shift()!).toThrow('The current history step is not present');
    expect(apply).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const traversable = document.getNodeNavigable()!.traversable;
  const active = traversable.activeSessionHistoryEntry;
  active.step = 4;
  traversable.currentSessionHistoryStep = 4;
  const entry = (step: number) => Object.assign(
    document.env.createSessionHistoryEntry(document.url, Object.assign(new DocumentState(), { origin: document.origin })), { step },
  );
  traversable.sessionHistoryEntries = [entry(0), active, entry(9)];
  const activation = vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  const apply = vi.spyOn(traversable, 'applyTraverseHistoryStep')
    .mockReturnValue(document.env.userAgent.HostPromise.resolve('applied', internalType<HistoryStepResult>()));
  const turns: (() => void)[] = [];
  vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { browser, document, traversable, entry, activation, apply, turns };
}
