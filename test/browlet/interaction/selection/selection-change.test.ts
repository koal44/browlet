import { describe, expect, it, vi } from 'vitest';

import type { Document, Event, HTMLElement, HTMLInputElement, HTMLTextAreaElement, Window } from '../../../../src/browlet/platform';
import { PageEvaluation } from '../../../../src/browlet/automation/index';
import { BrowsingContext, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { HTMLInputElementImpl, HTMLTextAreaElementImpl } from '../../../../src/browlet/dom/nodes/html/forms/index';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project, unwrap } from '../../../support/browlet-binding';

describe.each(['input', 'textarea'] as const)('Selection API §6.2: %s notifications', (localName) => {
  it('coalesces into one trusted bubbling event without changing the Document Selection', () => {
    const f = createFixture(localName);
    const events: Event[] = [];
    const path: string[] = [];
    f.control.onselectionchange = function(event: Event) {
      expect(this).toBe(f.control);
      events.push(event);
      path.push('control');
      event.preventDefault();
    };
    f.parent.onselectionchange = () => { path.push('parent'); };
    f.document.onselectionchange = () => { path.push('document'); };
    f.window.onselectionchange = () => { path.push('window'); };
    f.controlImpl.scheduleSelectionChange();
    f.controlImpl.scheduleSelectionChange();
    expect(events).toEqual([]);
    const tasks = [...f.loop.getTaskQueue(userInteractionTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document).toBeNull();
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(f.window.Event);
    expect(events[0]).toMatchObject({
      target: f.control, isTrusted: true, bubbles: true, cancelable: false, composed: false, defaultPrevented: false,
    });
    expect(path).toEqual(['control', 'parent', 'document', 'window']);
    expect(f.document.getSelection()!.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('clears its flag before listeners and coalesces their reentrant requests into a later task', () => {
    const f = createFixture(localName);
    let calls = 0;
    f.control.onselectionchange = () => {
      if (++calls !== 1) return;
      f.controlImpl.scheduleSelectionChange();
      f.controlImpl.scheduleSelectionChange();
    };
    f.controlImpl.scheduleSelectionChange();
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(calls).toBe(1);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(calls).toBe(2);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('coalesces each control independently of the Document', () => {
    const f = createFixture(localName);
    const other = f.document.createElement(localName);
    f.parent.appendChild(other);
    const otherImpl = unwrap<ControlImpl>(other);
    const targets: Event['target'][] = [];
    f.document.onselectionchange = (event) => { targets.push(event.target); };
    f.documentImpl.scheduleSelectionChange();
    f.controlImpl.scheduleSelectionChange();
    otherImpl.scheduleSelectionChange();
    f.documentImpl.scheduleSelectionChange();
    f.controlImpl.scheduleSelectionChange();
    otherImpl.scheduleSelectionChange();
    for (let i = 0; i < 3; ++i) expect(f.loop.runTaskTurn()).toBe(true);
    expect(targets).toEqual([f.document, f.control, other]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('uses the current handler and does not expose its internal scheduler through Web IDL', () => {
    const f = createFixture(localName);
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    f.control.onselectionchange = oldHandler;
    f.controlImpl.scheduleSelectionChange();
    f.control.onselectionchange = newHandler;
    f.loop.runTaskTurn();
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledOnce();
    expect('scheduleSelectionChange' in f.control).toBe(false);
    expect('selectionChangeScheduled' in f.control).toBe(false);
  });

  it.each(['before', 'after'])('delivers to a control removed %s scheduling', (when) => {
    const f = createFixture(localName);
    const listener = vi.fn<(event: Event) => void>();
    const ancestor = vi.fn();
    f.control.onselectionchange = listener;
    f.document.onselectionchange = ancestor;
    if (when === 'before') f.control.remove();
    f.controlImpl.scheduleSelectionChange();
    if (when === 'after') f.control.remove();
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0].target).toBe(f.control);
    expect(ancestor).not.toHaveBeenCalled();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('builds the path from the new ancestors after removal and reinsertion', () => {
    const f = createFixture(localName);
    const oldParent = vi.fn();
    const newParent = vi.fn();
    const other = f.document.createElement('div') as HTMLElement;
    f.document.documentElement!.appendChild(other);
    f.parent.onselectionchange = oldParent;
    other.onselectionchange = newParent;
    f.controlImpl.scheduleSelectionChange();
    f.control.remove();
    other.appendChild(f.control);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(oldParent).not.toHaveBeenCalled();
    expect(newParent).toHaveBeenCalledOnce();
  });

  it.each(['open', 'closed'] as const)('bubbles within the %s shadow tree without a separate Document event', (mode) => {
    const f = createFixture(localName);
    const shadow = f.parent.attachShadow({ mode });
    shadow.appendChild(f.control);
    const control = vi.fn();
    const inside = vi.fn((event: Event) => event.target);
    const outside = vi.fn();
    f.control.onselectionchange = control;
    shadow.addEventListener('selectionchange', inside);
    f.document.addEventListener('selectionchange', outside);
    f.controlImpl.scheduleSelectionChange();
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(control).toHaveBeenCalledOnce();
    expect(inside).toHaveBeenCalledOnce();
    expect(inside.mock.results[0]!.value).toBe(f.control);
    expect(outside).not.toHaveBeenCalled();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('delivers in an inert Document without a browsing context', () => {
    const f = createFixture(localName);
    const document = f.document.implementation.createHTMLDocument('inert');
    document.body!.appendChild(f.control);
    const control = vi.fn();
    const ancestor = vi.fn();
    f.control.onselectionchange = control;
    document.onselectionchange = ancestor;
    expect(unwrap<DocumentImpl>(document).browsingContext).toBeNull();
    f.controlImpl.scheduleSelectionChange();
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(control).toHaveBeenCalledOnce();
    expect(ancestor).toHaveBeenCalledOnce();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('uses the current node Document loop when an already adopted control changes', () => {
    const first = createFixture(localName);
    const second = createFixture(localName);
    expect(first.loop).not.toBe(second.loop);
    second.parent.appendChild(first.control);
    const listener = vi.fn<(event: Event) => void>();
    first.control.onselectionchange = listener;
    first.controlImpl.scheduleSelectionChange();
    expect(first.loop.runTaskTurn()).toBe(false);
    expect(second.loop.runTaskTurn()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('retains a pending task across adoption and cleanup of the original Document tasks', () => {
    const first = createFixture(localName);
    const second = createFixture(localName);
    const original = vi.fn();
    const destination = vi.fn<(event: Event) => void>();
    first.document.onselectionchange = original;
    second.document.onselectionchange = destination;
    first.controlImpl.scheduleSelectionChange();
    second.parent.appendChild(first.control);
    first.controlImpl.scheduleSelectionChange();
    const browsingContext = first.documentImpl.browsingContext;
    try {
      first.documentImpl.browsingContext = null;
      first.loop.removeTasksForDocument(first.documentImpl);
      expect(second.loop.runTaskTurn()).toBe(false);
      expect(first.loop.runTaskTurn()).toBe(true);
      expect(original).not.toHaveBeenCalled();
      expect(destination).toHaveBeenCalledOnce();
      expect(destination.mock.calls[0]![0].target).toBe(first.control);
      first.controlImpl.scheduleSelectionChange();
      expect(first.loop.runTaskTurn()).toBe(false);
      expect(second.loop.runTaskTurn()).toBe(true);
      expect(destination).toHaveBeenCalledTimes(2);
    } finally {
      first.documentImpl.browsingContext = browsingContext;
    }
  });

  it.each(['before', 'after'])('delivers when the node Document loses its browsing context %s scheduling', async (when) => {
    const f = createFixture(localName);
    // The browser probe installs its handler from the still-active parent Window.
    const observer = await createActiveObserver(f.documentImpl);
    Reflect.set(f.control, 'onselectionchange', observer.callback);
    const browsingContext = f.documentImpl.browsingContext;
    try {
      if (when === 'before') f.documentImpl.browsingContext = null;
      f.controlImpl.scheduleSelectionChange();
      if (when === 'after') f.documentImpl.browsingContext = null;
      expect(f.documentImpl.isFullyActive()).toBe(false);
      expect(f.loop.runTaskTurn()).toBe(true);
      expect(observer.events).toEqual([[f.control, true]]);
      f.controlImpl.scheduleSelectionChange();
      expect(f.loop.runTaskTurn()).toBe(true);
      expect(observer.events).toEqual([[f.control, true], [f.control, true]]);
    } finally {
      f.documentImpl.browsingContext = browsingContext;
    }
  });
});

describe('Selection API §6.2: Document scheduling', () => {
  it('keeps Document notifications activity-gated while control notifications remain runnable', async () => {
    const f = createFixture('input');
    const { callback, events } = await createActiveObserver(f.documentImpl);
    Reflect.set(f.document, 'onselectionchange', callback);
    f.documentImpl.scheduleSelectionChange();
    f.controlImpl.scheduleSelectionChange();
    const browsingContext = f.documentImpl.browsingContext;
    try {
      f.documentImpl.browsingContext = null;
      expect(f.loop.runTaskTurn()).toBe(true);
      expect(events).toEqual([[f.control, true]]);
      expect(f.loop.runTaskTurn()).toBe(false);
    } finally {
      f.documentImpl.browsingContext = browsingContext;
    }
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([[f.control, true], [f.document, false]]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });
});

/** Real bindings and task delivery; future HTML control mutators call the internal scheduling entry. */
function createFixture(localName: 'input' | 'textarea') {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const documentImpl = traversable.activeDocument!;
  const document = project(documentImpl) as Document;
  const root = document.documentElement ?? document.createElement('html');
  if (!root.isConnected) document.appendChild(root);
  const parent = document.createElement('div') as HTMLElement;
  const control = document.createElement(localName) as HTMLInputElement | HTMLTextAreaElement;
  parent.appendChild(control);
  root.appendChild(parent);
  return {
    traversable, documentImpl, document, parent, control, controlImpl: unwrap<ControlImpl>(control),
    window: project(traversable.activeWindow!) as Window, loop: documentImpl.env.responsibleEventLoop,
  };
}

/** Keep the observer realm active when its target Document loses its browsing context. */
async function createActiveObserver(target: DocumentImpl) {
  // Same-origin Windows share an agent; independent-agent callbacks cannot cross directly.
  const targetEnv = target.getRelevantGlobalObject()!.env;
  const env = targetEnv.userAgent.createWindowEnvironment({
    agent: targetEnv.realm.agent, userAgent: targetEnv.userAgent,
    creationURL: targetEnv.creationURL, origin: targetEnv.origin, parent: null,
    topLevelCreationURL: targetEnv.creationURL, topLevelOrigin: targetEnv.origin,
  });
  const document = env.createDocument();
  document.origin = targetEnv.origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  const traversable = new TopLevelTraversable(DocumentState.create(document));
  const pending = new PageEvaluation(traversable).evaluate(() => {
    const events: unknown[] = [];
    Reflect.set(window, 'selectionEvents', events);
    Reflect.set(window, 'selectionHandler', (event: Event) => { events.push([event.target, event.bubbles]); });
  });
  env.responsibleEventLoop.runTaskTurn();
  await pending;
  return {
    callback: Reflect.get(env.realm.windowProxy.platform, 'selectionHandler') as unknown,
    events: Reflect.get(env.realm.windowProxy.platform, 'selectionEvents') as unknown[],
  };
}

type ControlImpl = HTMLInputElementImpl | HTMLTextAreaElementImpl;
