import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { PageTransitionEvent, Window } from '../../../../src/browlet/platform';
import { taskSources } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchResponse } from '../../../../src/fetch/index';
import { InternalPromise } from '../../../../src/infra/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('recursive Document unloading', () => {
  it('requires the owning traversal queue', () => {
    const { document } = fixture();
    expect(() => document.unloadAndDescendants()).toThrow('Recursive unloading must begin in its session history traversal queue');
  });

  it('unloads parent-first, preserves descendant diagnostics, and completes after destruction', async () => {
    const f = fixture();
    const first = addChild(f.document);
    const grandchild = addChild(first);
    const second = addChild(f.document);
    const order: string[] = [];
    for (const [document, name] of [[f.document, 'parent'], [first, 'first'], [grandchild, 'grandchild'], [second, 'second']] as const) {
      document.makeUnsalvageable(name);
      (document.env.realm.globalObject as Window).addEventListener('unload', () => { order.push(name); });
    }
    const after = vi.fn(() => { order.push('after'); });
    const result = enqueue(f, () => f.document.unloadAndDescendants(null, after, () => { order.push('pageswap'); }));
    const assertion = expect(result).resolves.toBeUndefined();
    await Promise.all([assertion, drain(f, [f.document, first, grandchild, second])]);
    expect(order).toEqual(['pageswap', 'parent', 'first', 'grandchild', 'second', 'after']);
    expect(after).toHaveBeenCalledOnce();
    for (const document of [f.document, first, grandchild, second]) {
      expect(document.browsingContext).toBeNull();
      expect(document.unloadCounter).toBe(0);
    }
    expect(f.top.activeSessionHistoryEntry.documentState.notRestoredReasons!.children).toHaveLength(2);
  });

  it('keeps retained child order after a state-preserving DOM move and includes shadow children', async () => {
    const f = fixture();
    const first = addChild(f.document);
    const second = addChild(f.document);
    const shadowChild = addChild(f.document, undefined, true);
    f.document.body!.moveBefore(second.getNodeNavigable()!.container!, first.getNodeNavigable()!.container);
    const order: string[] = [];
    for (const [document, name] of [[f.document, 'parent'], [first, 'first'], [second, 'second'], [shadowChild, 'shadow']] as const) {
      document.salvageable = false;
      (document.env.realm.globalObject as Window).addEventListener('unload', () => { order.push(name); });
    }
    await Promise.all([enqueue(f, () => f.document.unloadAndDescendants()), drain(f, [f.document, first, second, shadowChild])]);
    expect(order).toEqual(['parent', 'first', 'second', 'shadow']);
  });

  it('runs foreign child work on its own loop and holds later traversal work until completion', async () => {
    const f = fixture();
    const child = addChild(f.document, 'https://foreign.test/child');
    const grandchild = addChild(child, 'https://other.test/grandchild');
    const documents = [f.document, child, grandchild];
    expect(child.env.responsibleEventLoop).not.toBe(f.document.env.responsibleEventLoop);
    const observed: unknown[] = [];
    for (const document of documents) {
      document.salvageable = false;
      const loop = document.env.responsibleEventLoop;
      (document.env.realm.globalObject as Window).addEventListener('unload', () => {
        observed.push([loop.currentlyRunningTask?.document, loop.currentlyRunningTask?.source, f.document.browsingContext !== null]);
      });
    }
    const after = vi.fn(() => {
      expect(documents.every((document) => document.browsingContext === null)).toBe(true);
      expect(f.document.env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
    });
    const result = enqueue(f, () => f.document.unloadAndDescendants(null, after));
    const later = vi.fn(() => { expect(after).toHaveBeenCalledOnce(); });
    f.top.appendSessionHistoryTraversalSteps(later);
    expect(later).not.toHaveBeenCalled();
    await Promise.all([result, drain(f, documents)]);
    expect(observed).toEqual(documents.map((document) => [document, taskSources['navigation-and-traversal'], true]));
    expect(later).toHaveBeenCalledOnce();
    expect(f.top.activeSessionHistoryEntry.documentState.notRestoredReasons!.children![0]!.reasons).toBeNull();
  });

  it('collects a blocker added during child cleanup before destroying any Document', async () => {
    const f = fixture();
    const child = addChild(f.document);
    vi.spyOn(f.userAgent, 'shouldKeepDocumentInBfcache').mockReturnValue(true);
    vi.spyOn(child, 'runUnloadingCleanup').mockImplementation(() => { child.makeUnsalvageable('late-child-blocker'); });
    const collect = f.document.buildNotRestoredReasons.bind(f.document);
    const diagnostics = vi.spyOn(f.document, 'buildNotRestoredReasons').mockImplementation(() => {
      expect(child.browsingContext).not.toBeNull();
      collect();
    });
    await Promise.all([enqueue(f, () => f.document.unloadAndDescendants()), drain(f, [f.document, child])]);
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(f.top.activeSessionHistoryEntry.documentState.notRestoredReasons!.children![0]!.reasons)
      .toContainEqual({ reason: 'late-child-blocker' });
  });

  it('retains admitted Documents and sends parent-first persisted pagehide without unload', async () => {
    const f = fixture();
    const child = addChild(f.document);
    vi.spyOn(f.userAgent, 'shouldKeepDocumentInBfcache').mockReturnValue(true);
    const events: unknown[] = [];
    for (const [document, name] of [[f.document, 'parent'], [child, 'child']] as const) {
      document.pageShowing = true;
      const window = document.env.realm.globalObject as Window;
      window.addEventListener('pagehide', (event) => { events.push([name, 'pagehide', (event as PageTransitionEvent).persisted]); });
      window.addEventListener('unload', () => { events.push([name, 'unload']); });
      vi.spyOn(document, 'updateVisibilityState').mockImplementation((state) => { events.push([name, state]); });
    }
    await Promise.all([enqueue(f, () => f.document.unloadAndDescendants()), drain(f, [f.document, child])]);
    expect(events).toEqual([['parent', 'pagehide', true], ['parent', 'hidden'], ['child', 'pagehide', true], ['child', 'hidden']]);
    for (const document of [f.document, child]) {
      expect(document.browsingContext).not.toBeNull();
      expect(document.salvageable).toBe(true);
      expect(document.pageShowing).toBe(false);
      expect(document.unloadCounter).toBe(0);
    }
  });

  it('does not take child navigables owned by a different retained Document', async () => {
    const f = fixture();
    const otherDocument = f.document.env.createDocument();
    const container = otherDocument.createElement('iframe') as HTMLIFrameElementImpl;
    const [, childDocument] = BrowsingContext.createTopLevel(f.userAgent);
    const child = new Navigable(DocumentState.create(childDocument), f.top);
    container.contentNavigable = child;
    const unload = vi.spyOn(childDocument, 'runUnloadingCleanup');
    f.document.salvageable = false;
    await Promise.all([enqueue(f, () => f.document.unloadAndDescendants()), drain(f, [f.document])]);
    expect(unload).not.toHaveBeenCalled();
    expect(childDocument.browsingContext).not.toBeNull();
  });

  it.each(['pageswap', 'admission', 'visibility', 'cleanup', 'after'] as const)('rejects a %s failure and releases all counters', async (phase) => {
    const f = fixture();
    const child = addChild(f.document);
    const failure = new Error(phase);
    f.document.salvageable = child.salvageable = false;
    if (phase === 'admission') {
      child.salvageable = true;
      vi.spyOn(f.userAgent, 'shouldKeepDocumentInBfcache').mockImplementation(() => { throw failure; });
    } else if (phase === 'visibility') {
      child.pageShowing = true;
      vi.spyOn(child, 'updateVisibilityState').mockImplementation(() => { throw failure; });
    } else if (phase === 'cleanup') {
      vi.spyOn(child, 'runUnloadingCleanup').mockImplementation(() => { throw failure; });
    }
    const after = vi.fn(() => { if (phase === 'after') throw failure; });
    const result = enqueue(f, () => f.document.unloadAndDescendants(null, after, () => {
      if (phase === 'pageswap') throw failure;
    }));
    await Promise.all([expect(result).rejects.toBe(failure), drain(f, [f.document, child])]);
    expect([f.document.unloadCounter, child.unloadCounter]).toEqual([0, 0]);
    expect(f.document.env.responsibleEventLoop.terminationNestingLevel).toBe(0);
    expect(after).toHaveBeenCalledTimes(phase === 'after' ? 1 : 0);
    const later = vi.fn();
    f.top.appendSessionHistoryTraversalSteps(later);
    await drain(f, []);
    expect(later).toHaveBeenCalledOnce();
  });

  it('rejects when the initial task is discarded instead of leaving the queue occupied', async () => {
    const f = fixture();
    f.document.env.queueTask('network', { run: () => { f.document.destroy(); } });
    const after = vi.fn();
    const result = enqueue(f, () => f.document.unloadAndDescendants(null, after));
    await Promise.all([expect(result).rejects.toThrow('Document unload task was discarded'), drain(f, [f.document])]);
    expect(after).not.toHaveBeenCalled();
    expect(f.document.unloadCounter).toBe(0);
  });

  it('cancels pending child work when the parent is destroyed during the wait', async () => {
    const f = fixture();
    const child = addChild(f.document, 'https://foreign.test/child');
    f.document.salvageable = child.salvageable = false;
    const childEvent = vi.fn();
    (child.env.realm.globalObject as Window).addEventListener('unload', childEvent);
    const result = enqueue(f, () => f.document.unloadAndDescendants());
    const assertion = expect(result).rejects.toThrow('Document was destroyed during recursive unloading');
    await Promise.all([assertion, (async () => {
      f.turns.shift()!();
      await runInHostTask(() => { f.document.env.responsibleEventLoop.runTaskTurn(); });
      await expect.poll(() => child.env.responsibleEventLoop.getTaskQueue(taskSources['navigation-and-traversal']).size).toBe(1);
      f.document.env.queueTask('network', { run: () => { f.document.destroy(); } });
      await drain(f, [f.document, child]);
    })()]);
    expect(childEvent).not.toHaveBeenCalled();
    expect([f.document.unloadCounter, child.unloadCounter]).toEqual([0, 0]);
  });

  it('does not dispatch unload after pageswap destroys its Document', async () => {
    const f = fixture();
    f.document.salvageable = false;
    const unload = vi.fn();
    (f.document.env.realm.globalObject as Window).addEventListener('unload', unload);
    const result = enqueue(f, () => f.document.unloadAndDescendants(null, undefined, () => { f.document.destroy(); }));
    await Promise.all([expect(result).rejects.toThrow('Document was destroyed during recursive unloading'), drain(f, [f.document])]);
    expect(unload).not.toHaveBeenCalled();
    expect(f.document.unloadCounter).toBe(0);
  });

  it('completes on automatic event loops without manual task turns or checkpoints', async () => {
    const userAgent = new UserAgent();
    const top = TopLevelTraversable.create(userAgent, null, 'automatic-unload');
    const document = top.activeDocument!;
    const child = addChild(document, 'https://foreign.test/child');
    document.salvageable = child.salvageable = false;
    const after = vi.fn();
    const completion = Promise.withResolvers<void>();
    top.appendSessionHistoryTraversalSteps(() => document.unloadAndDescendants(null, after).then(completion.resolve, completion.reject));
    await completion.promise;
    expect(after).toHaveBeenCalledOnce();
    expect(document.browsingContext).toBeNull();
    expect(child.browsingContext).toBeNull();
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, 'unload');
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { userAgent, top, document: top.activeDocument!, turns };
}

function addChild(parent: DocumentImpl, url?: string, inShadowTree = false): DocumentImpl {
  const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
  const parentNavigable = parent.getNodeNavigable()!;
  const [, childDocument] = BrowsingContext.create(parent, container, parentNavigable.traversable.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(childDocument), parentNavigable);
  container.contentNavigable = child;
  if (inShadowTree) {
    const host = parent.createElement('div');
    parent.body!.appendChild(host);
    host.attachShadow({ mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false }).appendChild(container);
  } else {
    parent.body!.appendChild(container);
  }
  if (url !== undefined) {
    const response = new FetchResponse();
    response.urlList.push(parent.env.parseURL(url)!);
    const params = child.createNavigationParams(response);
    const document = child.createAndInitializeDocument('html', 'text/html', params);
    const entry = child.createHistoryEntry(document, params);
    child.currentSessionHistoryEntry = child.activeSessionHistoryEntry = entry;
    document.makeActive();
    const html = document.createElement('html');
    document.appendChild(html);
    html.appendChild(document.createElement('body'));
    return document;
  }
  return childDocument;
}

function enqueue(f: ReturnType<typeof fixture>, steps: () => InternalPromise<void>): Promise<void> {
  const result = Promise.withResolvers<void>();
  f.top.appendSessionHistoryTraversalSteps(() => {
    const completion = steps();
    expect(completion).toBeInstanceOf(InternalPromise);
    return completion.then(result.resolve, result.reject);
  });
  return result.promise;
}

async function drain(f: ReturnType<typeof fixture>, documents: DocumentImpl[]): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await runInHostTask(() => {
      while (f.turns.length !== 0) f.turns.shift()!();
      for (const document of documents) document.env.responsibleEventLoop.runTaskTurn();
    });
  }
}
