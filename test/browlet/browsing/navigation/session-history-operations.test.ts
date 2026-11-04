import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type Traversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { unwrap } from '../../../support/browlet-binding';

describe('low-level session history operations', () => {
  it('finds the original child list through retained, unpopulated ancestor states', async () => {
    const { userAgent, traversable, entry } = fixture();
    const [, childDocument] = BrowsingContext.createTopLevel(userAgent);
    const child = new Navigable(DocumentState.create(childDocument), traversable);
    const retainedState = new DocumentState();
    const intermediateState = new DocumentState();
    const childEntries = [entry(0), entry(3)];
    retainedState.nestedHistories.push({ id: Symbol('intermediate'), entries: [entry(0, intermediateState)] });
    intermediateState.nestedHistories.push({ id: child.id, entries: childEntries });
    traversable.activeSessionHistoryEntry.step = 4;
    traversable.currentSessionHistoryStep = 4;
    traversable.sessionHistoryEntries.unshift(entry(0, retainedState));

    const found = await withinTraversal(traversable, () => child.getSessionHistoryEntries());
    expect(found).toBe(childEntries);
    expect(await withinTraversal(traversable, () => traversable.getSessionHistoryEntries()))
      .toBe(traversable.sessionHistoryEntries);
  });

  it('rejects a child whose history is not retained instead of returning the parent history', async () => {
    const { userAgent, traversable } = fixture();
    const [, childDocument] = BrowsingContext.createTopLevel(userAgent);
    const child = new Navigable(DocumentState.create(childDocument), traversable);

    await expect(withinTraversal(traversable, () => child.getSessionHistoryEntries()))
      .rejects.toThrow('The navigable has no retained session history');
  });

  it('clears forward entries from retained child histories while preserving their list identities', async () => {
    const { traversable, entry } = fixture();
    const rootState = traversable.activeSessionHistoryEntry.documentState;
    const childState = new DocumentState();
    const discardedState = new DocumentState();
    const children = [entry(1, childState), entry(4, discardedState), entry(7)];
    const grandchildren = [entry(2), entry(5)];
    const futureChildren = [entry(6), entry(9)];
    const discardedChildren = [entry(8), entry(10)];
    rootState.nestedHistories.push(
      { id: Symbol('child'), entries: children },
      { id: Symbol('future child'), entries: futureChildren },
    );
    childState.nestedHistories.push({ id: Symbol('grandchild'), entries: grandchildren });
    discardedState.nestedHistories.push({ id: Symbol('discarded child'), entries: discardedChildren });
    const roots = [entry(0, rootState), entry(3, rootState), entry(7, discardedState)];
    traversable.sessionHistoryEntries = roots;
    traversable.currentSessionHistoryStep = 3;

    await withinTraversal(traversable, () => { traversable.clearForwardSessionHistory(); });

    expect(roots.map((item) => item.step)).toEqual([0, 3]);
    expect(children.map((item) => item.step)).toEqual([1]);
    expect(grandchildren.map((item) => item.step)).toEqual([2]);
    expect(futureChildren).toEqual([]);
    // Only histories reachable after pruning are visited; detached state is not destroyed here.
    expect(discardedChildren.map((item) => item.step)).toEqual([8, 10]);
    expect(traversable.sessionHistoryEntries).toBe(roots);
    expect(rootState.nestedHistories[0]!.entries).toBe(children);
    expect(childState.nestedHistories[0]!.entries).toBe(grandchildren);
    expect(traversable.currentSessionHistoryStep).toBe(3);
  });

  it('uses nested forward clearing in the existing document commit path', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const document = unwrap<DocumentImpl>(browser.document);
    const traversable = document.getNodeNavigable()!.traversable;
    const rootState = traversable.activeSessionHistoryEntry.documentState;
    // Supply retained forward history while automatic child traversal remains unfinished.
    const childEntries = [Object.assign(
      document.env.createSessionHistoryEntry(document.url, new DocumentState()), { step: 2 },
    )];
    rootState.nestedHistories.push({ id: Symbol('child'), entries: childEntries });

    await browser.navigate('https://example.test/second');

    expect(childEntries).toEqual([]);
    expect(browser.window.history.length).toBe(2);
    expect(await withinTraversal(traversable, () => traversable.getAllUsedHistorySteps())).toEqual([0, 1]);
  });

  it('collects numeric sorted steps across shared histories without requiring live Documents', async () => {
    const { traversable, entry } = fixture();
    const rootState = new DocumentState();
    const childState = new DocumentState();
    const children = [entry(2, childState), entry(6, childState)];
    rootState.nestedHistories.push({ id: Symbol('child'), entries: children });
    childState.nestedHistories.push({ id: Symbol('grandchild'), entries: [entry(6), entry(100)] });
    traversable.sessionHistoryEntries = [entry(0, rootState), entry(2, rootState), entry(10)];

    const steps = await withinTraversal(traversable, () => traversable.getAllUsedHistorySteps());

    expect(steps).toEqual([0, 2, 6, 10, 100]);
    expect(await withinTraversal(traversable, () => traversable.getHistoryLengthAndIndex(10))).toEqual([5, 3]);
    steps.length = 0;
    expect(await withinTraversal(traversable, () => traversable.getAllUsedHistorySteps())).toEqual([0, 2, 6, 10, 100]);
    await expect(withinTraversal(traversable, () => traversable.getHistoryLengthAndIndex(7)))
      .rejects.toThrow('The selected history step is not present');
    expect(children.map((item) => item.step)).toEqual([2, 6]);
  });

  it('rejects pending entries in retained history instead of treating them as numeric steps', async () => {
    const { traversable, document } = fixture();
    const pending = document.env.createSessionHistoryEntry(document.url, new DocumentState());
    traversable.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: Symbol('child'), entries: [pending] });

    await expect(withinTraversal(traversable, () => traversable.getAllUsedHistorySteps()))
      .rejects.toThrow('Used history steps require committed entries');
    await expect(withinTraversal(traversable, () => traversable.clearForwardSessionHistory()))
      .rejects.toThrow('Forward history clearing requires committed entries');
  });
});

function fixture() {
  const userAgent = new UserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument!;
  const entry = (step: number, state = new DocumentState()) =>
    Object.assign(document.env.createSessionHistoryEntry(document.url, state), { step });
  return { userAgent, traversable, document, entry };
}

/** Run the operation within the real traversal queue and deliver failures to the test. */
function withinTraversal<T>(traversable: Traversable, steps: () => T): Promise<T> {
  const completion = Promise.withResolvers<T>();
  traversable.appendSessionHistoryTraversalSteps(() => {
    try { completion.resolve(steps()); } catch (error) { completion.reject(error); }
  });
  return completion.promise;
}
