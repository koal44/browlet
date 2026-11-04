import { describe, expect, it } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { Task } from '../../../../src/browlet/scripting/event-loop';
import { domManipulationTaskSource } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';

describe('fully active Documents', () => {
  // https://html.spec.whatwg.org/multipage/document-sequences.html#fully-active-documents
  it('keeps the grandchild active but not fully active when its container Document is replaced', () => {
    const root = TopLevelTraversable.create(new UserAgent(), null, '');
    const parent = createChild(root);
    const child = createChild(parent.navigable);
    const previousEntry = parent.navigable.activeSessionHistoryEntry;
    const location = child.document.location;
    const task = new Task(domManipulationTaskSource, child.document, () => {});
    const activity: boolean[] = [];
    child.document.observeFullyActiveState((active) => { activity.push(active); });
    expect(location).not.toBeNull();
    expect(child.document.history.state).toBeNull();
    expect(task.isRunnable).toBe(true);

    // Prepare entries directly; loading and traversal remain separate owner dependencies.
    const [, replacement] = BrowsingContext.create(
      root.activeDocument, parent.container, root.activeBrowsingContext!.group!,
    );
    const nextEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));
    parent.navigable.currentSessionHistoryEntry = nextEntry;
    expect(replacement.isFullyActive()).toBe(false);
    expect(parent.document.isFullyActive()).toBe(true);
    expect(child.document.isFullyActive()).toBe(true);

    parent.navigable.activeSessionHistoryEntry = nextEntry;

    expect(root.activeDocument!.isFullyActive()).toBe(true);
    expect(parent.document.getNodeNavigable()).toBeNull();
    expect(parent.document.isFullyActive()).toBe(false);
    expect(parent.navigable.activeDocument).toBe(replacement);
    expect(replacement.isFullyActive()).toBe(true);
    expect(child.navigable.activeDocument).toBe(child.document);
    expect(child.document.getNodeNavigable()).toBe(child.navigable);
    expect(child.navigable.containerDocument).toBe(parent.document);
    expect(child.document.isFullyActive()).toBe(false);
    expect(child.document.location).toBeNull();
    expect(() => child.document.history.state).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(task.isRunnable).toBe(false);
    expect(activity).toEqual([false]);

    parent.navigable.activeSessionHistoryEntry = previousEntry;

    expect(replacement.isFullyActive()).toBe(false);
    expect(parent.document.isFullyActive()).toBe(true);
    expect(child.document.isFullyActive()).toBe(true);
    expect(child.document.location).toBe(location);
    expect(child.document.history.state).toBeNull();
    expect(task.isRunnable).toBe(true);
    expect(activity).toEqual([false, true]);
  });

  it('keeps an auxiliary top-level Document fully active independently of its opener', () => {
    const userAgent = new UserAgent();
    const opener = TopLevelTraversable.create(userAgent, null, '');
    const context = opener.activeBrowsingContext!;
    const auxiliary = TopLevelTraversable.create(userAgent, context, 'auxiliary');
    const document = auxiliary.activeDocument!;
    const entry = opener.activeSessionHistoryEntry;
    const openerDocument = opener.activeDocument!;

    opener.activeSessionHistoryEntry = openerDocument.env.createSessionHistoryEntry(entry.url, new DocumentState());

    expect(openerDocument.isFullyActive()).toBe(false);
    expect(auxiliary.activeBrowsingContext!.openerBrowsingContext).toBe(context);
    expect(auxiliary.containerDocument).toBeNull();
    expect(document.isFullyActive()).toBe(true);
    expect(document.location).not.toBeNull();
  });
});

/** Connect a real initial child Document while element-driven startup remains unfinished. */
function createChild(parent: Navigable) {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
  owner.body!.appendChild(container);
  const [, document] = BrowsingContext.create(owner, container, parent.topLevelTraversable.activeBrowsingContext!.group!);
  const navigable = new Navigable(DocumentState.create(document), parent);
  container.contentNavigable = navigable;
  return { container, document, navigable };
}
