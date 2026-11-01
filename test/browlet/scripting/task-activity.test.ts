import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserAgent } from '../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/document-state';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { mockEventLoopTurns } from '../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('task runnability after document activity changes', () => {
  it('wakes a child loop when its container association makes its Document fully active', () => {
    const turns: (() => void)[] = [];
    mockEventLoopTurns((steps) => { turns.push(steps); });
    const parent = TopLevelTraversable.create(new UserAgent(), null, '');
    const parentDocument = parent.activeDocument!;
    const [, document] = BrowsingContext.createTopLevel(parentDocument.env.userAgent);
    const child = new Navigable(createDocumentState(document), parent);
    const steps = vi.fn();

    document.env.realm.queueGlobalTask(networkingTaskSource, steps);
    expect(document.isFullyActive()).toBe(false);
    expect(turns).toHaveLength(0);

    const container = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
    parentDocument.body!.appendChild(container);
    container.contentNavigable = child;

    expect(document.isFullyActive()).toBe(true);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(steps).toHaveBeenCalledOnce();
    expect(turns).toHaveLength(0);
  });

  it.each([false, true])('resumes retained tasks throughout an ancestor history restoration (shadow container: %s)', (inShadowTree) => {
    const turns: (() => void)[] = [];
    mockEventLoopTurns((steps) => { turns.push(steps); });
    const parent = TopLevelTraversable.create(new UserAgent(), null, '');
    const parentDocument = parent.activeDocument!;
    const childDocument = createChildDocument(parentDocument, inShadowTree);
    const grandchildDocument = createChildDocument(childDocument);
    const documents = [parentDocument, childDocument, grandchildDocument];
    const loops = documents.map((document) => document.env.responsibleEventLoop);
    const observed: string[] = [];
    const activeEntry = parent.activeSessionHistoryEntry;
    // Separate real agents make this catch missing descendant wake-ups, even
    // when the parent loop already has work. Child creation itself is unfinished.
    expect(new Set(loops).size).toBe(3);
    for (const [index, document] of documents.entries()) {
      document.env.realm.queueGlobalTask(networkingTaskSource, () => { observed.push(`${index}:first`); });
    }
    expect(turns).toHaveLength(3);

    parent.activeSessionHistoryEntry = {
      ...activeEntry, documentState: createDocumentState(null),
    };
    for (const document of documents) expect(document.isFullyActive()).toBe(false);
    for (const turn of turns.splice(0)) turn();
    expect(observed).toEqual([]);
    expect(turns).toHaveLength(0);
    for (const [index, document] of documents.entries()) {
      document.env.realm.queueGlobalTask(networkingTaskSource, () => { observed.push(`${index}:second`); });
    }
    expect(turns).toHaveLength(0);

    parent.activeSessionHistoryEntry = activeEntry;

    for (const document of documents) expect(document.isFullyActive()).toBe(true);
    expect(turns).toHaveLength(3);
    for (const turn of turns.splice(0)) turn();
    expect(new Set(observed)).toEqual(new Set(['0:first', '1:first', '2:first']));
    expect(turns).toHaveLength(3);
    for (const turn of turns.splice(0)) turn();
    for (const index of documents.keys()) {
      expect(observed.filter((entry) => entry.startsWith(`${index}:`)))
        .toEqual([`${index}:first`, `${index}:second`]);
    }
    expect(turns).toHaveLength(0);
    for (const loop of loops) expect(loop.getTaskQueue(networkingTaskSource).size).toBe(0);
  });
});

function createChildDocument(parentDocument: DocumentImpl, inShadowTree = false): DocumentImpl {
  const container = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
  if (inShadowTree) {
    const host = parentDocument.createElement('div');
    parentDocument.body!.appendChild(host);
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    shadow.appendChild(container);
  } else {
    parentDocument.body!.appendChild(container);
  }
  const [, document] = BrowsingContext.createTopLevel(parentDocument.env.userAgent);
  const child = new Navigable(createDocumentState(document), parentDocument.getNodeNavigable());
  // Use the existing container seam until HTML child creation owns this graph.
  container.contentNavigable = child;
  return document;
}
