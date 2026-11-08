import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type NavigableContainer } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLIFrameElement, Window } from '../../../../src/browlet/platform';
import { taskSources } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchResponse } from '../../../../src/fetch/index';
import { UnsafeMoment, wallClock } from '../../../../src/timing/index';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('completely finishing Document loading', () => {
  it('records completion independently of readiness, Window load, and top-level rendering', () => {
    const userAgent = createManualUserAgent();
    const top = TopLevelTraversable.create(userAgent, null, 'completion');
    const document = top.activeDocument!;
    const readiness = document.currentDocumentReadiness;
    const events = vi.spyOn(document, 'fireEvent');
    vi.spyOn(wallClock, 'unsafeCurrentTime').mockReturnValue(new UnsafeMoment(wallClock, 50_000));
    document.completelyLoadedTime = null;

    document.completelyFinishLoading();

    expect(document.completelyLoadedTime).toBe(50_000);
    expect(document.currentDocumentReadiness).toBe(readiness);
    expect(events).not.toHaveBeenCalled();
    expect([...document.env.responsibleEventLoop.getTaskQueue(taskSources['dom-manipulation'])]).toEqual([]);
  });

  it('rejects completion without a browsing context before recording a time', () => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, 'completion');
    const document = top.activeDocument!.env.createDocument();
    expect(() => document.completelyFinishLoading()).toThrow('A completely loaded Document needs a browsing context');
    expect(document.completelyLoadedTime).toBeNull();
  });

  it('does not queue the initial about:blank notification before a container association exists', () => {
    const top = TopLevelTraversable.create(createManualUserAgent(), null, 'completion');
    const parent = top.activeDocument!;
    const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
    const load = vi.spyOn(container, 'runLoadEventSteps');
    const [, initial] = BrowsingContext.create(parent, container, top.activeBrowsingContext!.group!);
    expect(initial.getNodeNavigable()).toBeNull();
    expect(initial.completelyLoadedTime).not.toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect([...parent.env.responsibleEventLoop.getTaskQueue(taskSources['dom-manipulation'])]).toEqual([]);
  });

  it.each(['frame', 'object', 'embed'] as const)('queues a trusted load event on the %s container', (tag) => {
    const { container, document, parent } = childFixture(tag);
    const loop = parent.env.responsibleEventLoop;
    const events: unknown[] = [];
    container.addEventListener('load', (event) => {
      expect(loop.currentlyRunningTask?.source).toBe(taskSources['dom-manipulation']);
      events.push([event.type, event.target, event.isTrusted, event.bubbles, event.cancelable]);
    });

    document.completelyFinishLoading();

    expect(events).toEqual([]);
    expect([...loop.getTaskQueue(taskSources['dom-manipulation'])]).toHaveLength(1);
    expect(loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([['load', container, true, false, false]]);
  });

  it('delivers an iframe event on the parent loop and checks current policy attributes after handlers', () => {
    const { iframe, document, parent } = iframeFixture();
    const parentLoop = parent.env.responsibleEventLoop;
    expect(document.env.responsibleEventLoop).not.toBe(parentLoop);
    const window = parent.env.realm.globalObject as Window;
    const platform = window.document.body!.firstElementChild as HTMLIFrameElement;
    const check = vi.spyOn(iframe, 'checkPotentialPermissionsPolicyViolation');
    const listener = vi.fn((event: Event) => {
      expect(document.iframeLoadInProgress).toBe(true);
      expect(parentLoop.currentlyRunningTask?.source).toBe(taskSources['dom-manipulation']);
      expect(event.target).toBe(platform);
      expect([event.isTrusted, event.bubbles, event.cancelable]).toEqual([true, false, false]);
      platform.setAttribute('allow', 'deferred-fetch *');
      platform.setAttribute('src', 'https://changed.test/after-handler');
    });
    platform.addEventListener('load', listener);

    document.completelyFinishLoading();

    expect(listener).not.toHaveBeenCalled();
    expect(document.iframeLoadInProgress).toBe(false);
    expect([...document.env.responsibleEventLoop.getTaskQueue(taskSources['dom-manipulation'])]).toEqual([]);
    expect(parentLoop.runTaskTurn()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledExactlyOnceWith('deferred-fetch *', 'https://changed.test/after-handler');
    expect(check.mock.invocationCallOrder[0]).toBeGreaterThan(listener.mock.invocationCallOrder[0]!);
    expect(document.iframeLoadInProgress).toBe(false);
  });

  it('honors the mute flag before timing, event dispatch, and potential reports', () => {
    const { iframe, document, parent } = iframeFixture();
    document.muteIframeLoad = true;
    iframe.pendingResourceTimingStartTime = 12;
    const event = vi.spyOn(iframe, 'fireEvent');
    const policy = vi.spyOn(iframe, 'checkPotentialPermissionsPolicyViolation');
    document.completelyFinishLoading();
    expect(parent.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(document.completelyLoadedTime).not.toBeNull();
    expect(event).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
    expect(iframe.pendingResourceTimingStartTime).toBe(12);
    expect(document.iframeLoadInProgress).toBe(false);
  });

  it('keeps pending fallback timing explicit instead of losing a measurement or dispatching early', () => {
    const { iframe, document, parent } = iframeFixture();
    iframe.pendingResourceTimingStartTime = 12;
    const event = vi.spyOn(iframe, 'fireEvent');
    document.completelyFinishLoading();
    expect(() => parent.env.responsibleEventLoop.runTaskTurn()).toThrow('Iframe fallback resource timing is not implemented');
    expect(event).not.toHaveBeenCalled();
    expect(iframe.pendingResourceTimingStartTime).toBe(12);
    expect(document.iframeLoadInProgress).toBe(false);
  });

  it('requires a live child for the iframe-specific operation', () => {
    const { iframe } = iframeFixture();
    iframe.contentNavigable = null;
    expect(() => iframe.runLoadEventSteps()).toThrow('Iframe load event steps require an active child Document');
  });

  it('clears the progress flag even if the policy-reporting owner fails', () => {
    const { iframe, document } = iframeFixture();
    vi.spyOn(iframe, 'checkPotentialPermissionsPolicyViolation').mockImplementation(() => { throw new Error('report failure'); });
    expect(() => iframe.runLoadEventSteps()).toThrow('report failure');
    expect(document.iframeLoadInProgress).toBe(false);
  });

  it('keeps the child Window load event separate from the queued iframe event', () => {
    const { iframe, document, parent } = iframeFixture();
    const order: string[] = [];
    const window = document.env.realm.globalObject as Window;
    window.addEventListener('load', () => { order.push('window'); });
    iframe.addEventListener('load', () => { order.push('iframe'); });
    document.finishLoading();
    expect(order).toEqual(['window']);
    expect(document.readyState).toBe('complete');
    expect(document.completelyLoadedTime).not.toBeNull();
    expect(parent.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(order).toEqual(['window', 'iframe']);
  });

  it('discards the container task if its owning Document is destroyed first', () => {
    const { iframe, document, parent } = iframeFixture();
    const event = vi.spyOn(iframe, 'runLoadEventSteps');
    parent.env.queueTask('network', () => { parent.destroy(); });
    document.completelyFinishLoading();
    const loop = parent.env.responsibleEventLoop;
    expect(loop.runTaskTurn()).toBe(true);
    expect([...loop.getTaskQueue(taskSources['dom-manipulation'])]).toEqual([]);
    expect(event).not.toHaveBeenCalled();
  });

  it('delivers through the automatic loop without a rendering host or a manual checkpoint', async () => {
    const { iframe, document } = iframeFixture(new UserAgent());
    const loaded = new Promise<void>((resolve) => { iframe.addEventListener('load', () => { resolve(); }); });
    document.completelyFinishLoading();
    await loaded;
    expect(document.completelyLoadedTime).not.toBeNull();
    await expect.poll(() => document.iframeLoadInProgress).toBe(false);
  });
});

/** Supply the child association while automatic container insertion/loading remains unfinished. */
function childFixture(tag: 'iframe' | 'frame' | 'object' | 'embed', userAgent = createManualUserAgent()) {
  const top = TopLevelTraversable.create(userAgent, null, 'completion');
  const parent = top.activeDocument!;
  const container = parent.createElement(tag) as NavigableContainer;
  const [, initial] = BrowsingContext.create(
    parent, container instanceof HTMLIFrameElementImpl ? container : null, top.activeBrowsingContext!.group!,
  );
  const navigable = new Navigable(DocumentState.create(initial), top);
  container.contentNavigable = navigable;
  parent.body!.appendChild(container);
  const response = new FetchResponse();
  response.urlList.push(parent.env.parseURL('https://child.test/document')!);
  // Non-iframe startup/sandbox selection is a separate unfinished owner; supply its captured inputs here.
  const params = navigable.createNavigationParams(response, { sandboxingFlags: new SandboxingFlagSet(), iframeReferrerPolicy: '' });
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const entry = navigable.createHistoryEntry(document, params);
  navigable.currentSessionHistoryEntry = navigable.activeSessionHistoryEntry = entry;
  document.makeActive();
  return { userAgent, top, parent, container, navigable, document };
}

function iframeFixture(userAgent = createManualUserAgent()) {
  const state = childFixture('iframe', userAgent);
  return { ...state, iframe: state.container as HTMLIFrameElementImpl };
}
