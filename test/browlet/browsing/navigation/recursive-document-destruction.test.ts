import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { taskSources } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { InternalPromise } from '../../../../src/infra/index';
import { parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('recursive Document destruction', () => {
  it('collects a retained Document\'s diagnostics without overwriting the displayed page', () => {
    const f = fixture();
    const retired = load(f.top, 'https://example.test/old');
    const state = f.top.activeSessionHistoryEntry.documentState;
    const current = load(f.top, 'https://example.test/new');
    current.buildNotRestoredReasons();
    const currentReasons = current.notRestoredReasons;
    retired.makeUnsalvageable('fetch');

    retired.buildNotRestoredReasons();

    expect(state.notRestoredReasons?.reasons).toEqual([{ reason: 'fetch' }]);
    expect(state.notRestoredReasons?.url).toBe(retired.url);
    expect(current.notRestoredReasons).toBe(currentReasons);
    expect(currentReasons?.reasons).toEqual([]);
  });

  it('destroys descendants before the parent, including shadow and foreign-loop children', async () => {
    const f = fixture();
    const first = addChild(f.document);
    const nested = addChild(first);
    const shadow = addChild(f.document, true);
    const foreign = load(shadow.getNodeNavigable()!, 'https://foreign.test/');
    expect(foreign.env.responsibleEventLoop).not.toBe(f.document.env.responsibleEventLoop);
    const navigables = [first, nested, foreign].map((document) => document.getNodeNavigable()!);
    const order: string[] = [];
    for (const [document, name] of [[f.document, 'root'], [first, 'first'], [nested, 'nested'], [foreign, 'foreign']] as const) {
      const destroy = document.destroy.bind(document);
      vi.spyOn(document, 'destroy').mockImplementation(() => { destroy(); order.push(name); });
    }
    const completion = f.document.destroyAndDescendants(() => {
      expect(f.document.env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      order.push('after');
    });
    expect(completion).toBeInstanceOf(InternalPromise);
    expect(order).toEqual([]);
    await Promise.all([observe(completion), drain(f, [f.document, first, nested, foreign])]);
    expect(order).toEqual(['nested', 'first', 'foreign', 'root', 'after']);
    expect(f.top.activeDocument).toBeNull();
    expect(f.top.childNavigables.size).toBe(0);
    for (const navigable of navigables) {
      expect(navigable.activeDocument).toBeNull();
      expect(navigable.container).toBeNull();
      expect(navigable.parent).not.toBeNull();
    }
  });

  it('evicts an inactive tree while preserving the replacement Document and its children', async () => {
    const f = fixture();
    const retired = load(f.top, 'https://example.test/old');
    const state = f.top.activeSessionHistoryEntry.documentState;
    const oldChild = addChild(retired);
    const current = load(f.top, 'https://example.test/new');
    const currentChild = addChild(current);
    const currentNavigable = currentChild.getNodeNavigable()!;
    const pageTask = vi.fn();
    const discarded = vi.fn();
    retired.env.queueTask('network', pageTask, { discardSteps: discarded });
    expect(retired.isFullyActive()).toBe(false);
    state.evictDocument();
    const completion = retired.destroyAndDescendants();
    await Promise.all([observe(completion), drain(f, [retired, oldChild, current, currentChild])]);
    expect(state.document).toBeNull();
    expect(state.notRestoredReasons?.reasons).toContainEqual({ reason: 'masked' });
    expect(state.notRestoredReasons?.children).toHaveLength(1);
    expect(oldChild.browsingContext).toBeNull();
    expect(f.top.activeDocument).toBe(current);
    expect([...f.top.childNavigables]).toEqual([currentNavigable]);
    expect(currentChild.isFullyActive()).toBe(true);
    expect(pageTask).not.toHaveBeenCalled();
    expect(discarded).toHaveBeenCalledOnce();
  });

  it('coalesces repeated requests and runs each continuation once, including after completion', async () => {
    const f = fixture();
    const destroy = vi.spyOn(f.document, 'destroy');
    const first = f.document.destroyAndDescendants();
    expect(f.document.destroyAndDescendants()).toBe(first);
    const after = vi.fn();
    const second = f.document.destroyAndDescendants(after);
    await Promise.all([observe(first), observe(second), drain(f, [f.document])]);
    const third = f.document.destroyAndDescendants(after);
    await Promise.all([observe(third), drain(f, [f.document])]);
    expect(destroy).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('completes for a Document already destroyed by unloading', async () => {
    const f = fixture();
    f.document.env.queueTask('navigation-and-traversal', () => { f.document.destroy(); });
    f.document.env.responsibleEventLoop.runTaskTurn();
    const after = vi.fn();
    await Promise.all([observe(f.document.destroyAndDescendants(after)), drain(f, [f.document])]);
    expect(after).toHaveBeenCalledOnce();
  });

  it('rejects a child cleanup failure without destroying its parent or running the continuation', async () => {
    const f = fixture();
    const child = addChild(f.document);
    const failure = new Error('cleanup failed');
    vi.spyOn(child, 'runUnloadingCleanup').mockImplementation(() => { throw failure; });
    const after = vi.fn();
    const completion = observe(f.document.destroyAndDescendants(after));
    await Promise.all([expect(completion).rejects.toBe(failure), drain(f, [f.document, child])]);
    expect(f.document.browsingContext).not.toBeNull();
    expect(after).not.toHaveBeenCalled();
  });

  it('rejects discarded cleanup tasks instead of leaving a pending completion', async () => {
    const f = fixture();
    const completion = observe(f.document.destroyAndDescendants());
    const assertion = expect(completion).rejects.toThrow('Document destruction task was discarded');
    f.turns.shift()!();
    const loop = f.document.env.responsibleEventLoop;
    for (const task of loop.getTaskQueue(taskSources['navigation-and-traversal'])) loop.removeTask(task);
    await Promise.all([assertion, drain(f, [f.document])]);
  });

  it('keeps successful teardown settled when a continuation throws', async () => {
    const f = fixture();
    const failure = new Error('continuation failed');
    const completion = observe(f.document.destroyAndDescendants(() => { throw failure; }));
    await Promise.all([expect(completion).rejects.toBe(failure), drain(f, [f.document])]);
    await expect(observe(f.document.destroyAndDescendants())).resolves.toBeUndefined();
  });

  it('completes on automatic loops without manual turns or checkpoints', async () => {
    const userAgent = new UserAgent();
    const top = TopLevelTraversable.create(userAgent, null, 'automatic-destruction');
    const document = top.activeDocument!;
    const child = load(addChild(document).getNodeNavigable()!, 'https://foreign.test/');
    await observe(document.destroyAndDescendants());
    expect(document.browsingContext).toBeNull();
    expect(child.browsingContext).toBeNull();
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, 'destruction');
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { userAgent, top, document: top.activeDocument!, turns };
}

function addChild(parent: DocumentImpl, inShadowTree = false): DocumentImpl {
  const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
  const parentNavigable = parent.getNodeNavigable()!;
  const [, document] = BrowsingContext.create(parent, container, parentNavigable.traversable.activeBrowsingContext!.group!);
  container.contentNavigable = new Navigable(DocumentState.create(document), parentNavigable);
  if (inShadowTree) {
    const host = parent.createElement('div');
    parent.body!.appendChild(host);
    host.attachShadow({ mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false }).appendChild(container);
  } else {
    parent.body!.appendChild(container);
  }
  return document;
}

function load(navigable: Navigable, url: string): DocumentImpl {
  const params = navigable.createNavigationParamsFromSource(parseURL(url).url!);
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const entry = navigable.createHistoryEntry(document, params);
  // Retain the old entry without invoking the unfinished complete history-application algorithm.
  if (navigable instanceof TopLevelTraversable) navigable.sessionHistoryEntries.push(entry);
  navigable.currentSessionHistoryEntry = navigable.activeSessionHistoryEntry = entry;
  document.makeActive();
  const html = document.createElement('html');
  document.appendChild(html);
  html.appendChild(document.createElement('body'));
  return document;
}

function observe(completion: InternalPromise<void>): Promise<void> {
  return new Promise((resolve, reject) => { completion.observe(resolve, reject); });
}

async function drain(f: ReturnType<typeof fixture>, documents: DocumentImpl[]): Promise<void> {
  for (let turn = 0; turn < 30; turn++) {
    await runInHostTask(() => {
      while (f.turns.length !== 0) f.turns.shift()!();
      for (const document of documents) document.env.responsibleEventLoop.runTaskTurn();
    });
  }
}
