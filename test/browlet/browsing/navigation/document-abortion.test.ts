import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { NavigateEventImpl } from '../../../../src/browlet/browsing/navigation/api/navigate-event';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { HTMLDocumentParser } from '../../../../src/browlet/html/parser/html-document-parser';
import type { Window } from '../../../../src/browlet/platform';
import { taskSources } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document and descendant abortion', () => {
  it('requires the owning task before queueing descendant work', () => {
    const f = fixture();
    const child = addChild(f.document);
    const abort = vi.spyOn(f.document, 'abort');
    const queue = vi.spyOn(child.env, 'queueTask');
    expect(() => f.document.abortAndDescendants()).toThrow('Recursive Document abortion requires a task on its owning event loop');
    expect(abort).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it('aborts the parent now, then each snapshotted descendant in tree order', () => {
    const f = fixture();
    const first = addChild(f.document);
    const grandchild = addChild(first);
    const second = addChild(f.document);
    const shadow = addChild(f.document, true);
    const order: string[] = [];
    for (const [document, name] of [[f.document, 'parent'], [first, 'first'], [grandchild, 'grandchild'], [second, 'second'], [shadow, 'shadow']] as const) {
      const parser = new HTMLDocumentParser(document, () => {});
      const abort = parser.abort.bind(parser);
      vi.spyOn(parser, 'abort').mockImplementation(() => { abort(); order.push(name); });
    }
    f.document.body!.insertBefore(second.getNodeNavigable()!.container!, first.getNodeNavigable()!.container);
    run(f.document, () => { expect(f.document.abortAndDescendants()).toBeUndefined(); });
    expect(order).toEqual(['parent']);
    expect(f.loop.getTaskQueue(taskSources['navigation-and-traversal']).size).toBe(4);
    for (let turn = 0; turn < 4; turn++) expect(f.loop.runTaskTurn()).toBe(true);
    expect(order).toEqual(['parent', 'second', 'first', 'grandchild', 'shadow']);
    for (const document of [f.document, first, grandchild, second, shadow]) {
      expect(document.activeParser).toBeNull();
      expect(document.activeParserWasAborted).toBe(true);
      expect(document.salvageable).toBe(false);
      expect(document.browsingContext).not.toBeNull();
    }
  });

  it('runs a foreign child on its own loop and propagates unsalvageability afterward', () => {
    const f = fixture();
    const initial = addChild(f.document);
    const child = load(initial.getNodeNavigable()!, 'https://foreign.test/child');
    const parser = new HTMLDocumentParser(child, () => {});
    const childLoop = child.env.responsibleEventLoop;
    expect(childLoop).not.toBe(f.loop);
    run(f.document, () => f.document.abortAndDescendants());
    expect(parser.stopped).toBe(false);
    expect(f.document.salvageable).toBe(true);
    expect(childLoop.runTaskTurn()).toBe(true);
    expect(parser.stopped).toBe(true);
    expect(f.document.salvageable).toBe(false);
    expect([...f.document.bfcacheBlockingDetails]).toEqual([]);
    expect([...child.bfcacheBlockingDetails]).toEqual([{ reason: 'parser-aborted' }]);
  });

  it('propagates an already unsalvageable child without inventing a parent blocking reason', () => {
    const f = fixture();
    const child = addChild(f.document);
    child.makeUnsalvageable('websocket');
    run(f.document, () => f.document.abortAndDescendants());
    expect(f.document.salvageable).toBe(true);
    f.loop.runTaskTurn();
    expect(f.document.salvageable).toBe(false);
    expect([...f.document.bfcacheBlockingDetails]).toEqual([]);
  });

  it('keeps idle Documents salvageable and does not issue load or dismissal events', () => {
    const f = fixture();
    const child = addChild(f.document);
    const events = vi.fn();
    for (const document of [f.document, child]) {
      const window = document.env.realm.globalObject as Window;
      for (const type of ['load', 'beforeunload', 'pagehide', 'unload']) window.addEventListener(type, events);
    }
    run(f.document, () => f.document.abortAndDescendants());
    f.loop.runTaskTurn();
    expect([f.document.salvageable, child.salvageable]).toEqual([true, true]);
    expect(events).not.toHaveBeenCalled();
  });

  it('snapshots descendants before parent parser callbacks can insert another child', () => {
    const f = fixture();
    const child = addChild(f.document);
    const childParser = new HTMLDocumentParser(child, () => {});
    new HTMLDocumentParser(f.document, () => {});
    let added: HTMLDocumentParser | undefined;
    f.document.getRelevantGlobalObject()!.document.addEventListener('readystatechange', () => {
      added ??= new HTMLDocumentParser(addChild(f.document), () => {});
    });
    run(f.document, () => f.document.abortAndDescendants());
    expect(added).toBeDefined();
    expect(f.loop.getTaskQueue(taskSources['navigation-and-traversal']).size).toBe(1);
    f.loop.runTaskTurn();
    expect(childParser.stopped).toBe(true);
    expect(added!.stopped).toBe(false);
  });

  it('retains the global-task activity gate if a selected child becomes inactive', () => {
    const f = fixture();
    const child = addChild(f.document);
    const navigable = child.getNodeNavigable()!;
    const parser = new HTMLDocumentParser(child, () => {});
    const container = navigable.container!;
    run(f.document, () => f.document.abortAndDescendants());
    container.contentNavigable = null;
    expect(f.loop.runTaskTurn()).toBe(false);
    expect(parser.stopped).toBe(false);
    container.contentNavigable = navigable;
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(parser.stopped).toBe(true);
  });

  it('delivers descendant abortion on automatic loops without manual checkpoints', async () => {
    const f = fixture(new UserAgent());
    const child = load(addChild(f.document).getNodeNavigable()!, 'https://foreign.test/');
    const parser = new HTMLDocumentParser(child, () => {});
    f.document.env.queueTask('navigation-and-traversal', { run: () => f.document.abortAndDescendants() });
    await expect.poll(() => parser.stopped).toBe(true);
    expect(f.document.salvageable).toBe(false);
  });
});

describe('stopping a navigable', () => {
  it('rejects an off-loop call before clearing navigation ownership', () => {
    const f = fixture();
    f.top.ongoingNavigation = 'pending';
    expect(() => f.top.stopLoading()).toThrow('Stopping navigation requires a task on its owning event loop');
    expect(f.top.ongoingNavigation).toBe('pending');
  });

  it.each([
    { ongoing: 'pending', counter: 0, canceled: true },
    { ongoing: 'pending', counter: 1, canceled: false },
    { ongoing: 'traversal', counter: 0, canceled: false },
    { ongoing: null, counter: 0, canceled: false },
  ])('respects ownership $ongoing and unload counter $counter', ({ ongoing, counter, canceled }) => {
    const f = fixture();
    const navigation = f.document.getRelevantGlobalObject()!.navigation;
    const controller = f.document.env.createAbortController();
    const event = f.document.env.createEvent(NavigateEventImpl);
    event.type = 'navigate';
    event.signal = controller.signal;
    event.abortController = controller;
    if (ongoing !== null) navigation.ongoingNavigateEvent = event;
    f.top.ongoingNavigation = ongoing;
    f.document.unloadCounter = counter;
    const parser = new HTMLDocumentParser(f.document, () => {});
    run(f.document, () => f.top.stopLoading());
    expect(f.top.ongoingNavigation).toBe(canceled ? null : ongoing);
    expect(controller.signal.aborted).toBe(canceled);
    expect(parser.stopped).toBe(counter === 0);
    expect(f.document.unloadCounter).toBe(counter);
  });

  it('ignores Window.stop() during beforeunload but permits it after the event', () => {
    const f = fixture();
    const window = f.document.env.realm.globalObject as Window;
    const parser = new HTMLDocumentParser(f.document, () => {});
    f.top.ongoingNavigation = 'pending';
    const during = vi.fn(() => {
      expect(f.document.unloadCounter).toBe(1);
      window.stop();
      expect(parser.stopped).toBe(false);
      expect(f.top.ongoingNavigation).toBe('pending');
    });
    window.addEventListener('beforeunload', during);
    run(f.document, () => { f.document.fireBeforeUnload(false); });
    expect(during).toHaveBeenCalledOnce();
    expect(f.document.unloadCounter).toBe(0);
    run(f.document, () => window.stop());
    expect(parser.stopped).toBe(true);
    expect(f.top.ongoingNavigation).toBeNull();
  });

  it('keeps the selected Document when navigation-abort callbacks change the active entry', () => {
    const f = fixture();
    const document = f.document;
    const original = new HTMLDocumentParser(document, () => {});
    const navigation = document.getRelevantGlobalObject()!.navigation;
    const controller = document.env.createAbortController();
    const event = document.env.createEvent(NavigateEventImpl);
    event.type = 'navigate'; event.signal = controller.signal; event.abortController = controller;
    navigation.ongoingNavigateEvent = event;
    f.top.ongoingNavigation = 'pending';
    let replacement: HTMLDocumentParser | undefined;
    controller.signal.addEventListener('abort', () => {
      replacement = new HTMLDocumentParser(load(f.top, 'https://foreign.test/replacement'), () => {});
    });
    run(document, () => f.top.stopLoading());
    expect(original.stopped).toBe(true);
    expect(replacement).toBeDefined();
    expect(replacement!.stopped).toBe(false);
  });

  it('connects the projected Window.stop() operation to parser and descendant abortion', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = addChild(document);
    const parentParser = new HTMLDocumentParser(document, () => {});
    const childParser = new HTMLDocumentParser(child, () => {});
    document.getNodeNavigable()!.ongoingNavigation = 'pending';
    expect(await browser.evaluate(() => { window.stop(); return document.readyState; })).toBe('complete');
    expect(parentParser.stopped).toBe(true);
    await expect.poll(() => childParser.stopped).toBe(true);
    expect(document.getNodeNavigable()!.ongoingNavigation).toBeNull();
  });
});

function fixture(userAgent = createManualUserAgent()) {
  const top = TopLevelTraversable.create(userAgent, null, 'abortion');
  const document = top.activeDocument!;
  return { userAgent, top, document, loop: document.env.responsibleEventLoop };
}

function run(document: DocumentImpl, steps: () => void): void {
  document.env.queueTask('navigation-and-traversal', { run: steps });
  expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true);
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
  navigable.currentSessionHistoryEntry = navigable.activeSessionHistoryEntry = entry;
  document.makeActive();
  return document;
}
