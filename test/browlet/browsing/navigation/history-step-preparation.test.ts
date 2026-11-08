import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import {
  Navigable, TopLevelTraversable, type ChangingNavigableContinuationState, type NavigationRequest,
} from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { Window } from '../../../../src/browlet/platform';
import { FetchHeaders } from '../../../../src/fetch/index';
import { internalType } from '../../../../src/infra/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('changing history-entry preparation', () => {
  it('reads entries on the destination task and returns an update-only continuation for an already advanced entry', async () => {
    const { top, document, target, source, ready, turns } = fixture();
    const load = vi.spyOn(top, 'populateHistoryEntryDocument');
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    expect(ready).not.toHaveBeenCalled();
    target.documentState.document = document;
    target.documentState.everPopulated = false;
    top.activeSessionHistoryEntry = target;
    await runTask(document);
    expect(ready).toHaveBeenCalledExactlyOnceWith({ displayedDocument: document, targetEntry: target, navigable: top, updateOnly: true });
    expect(failed).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);
  });

  it.each(['reload', 'traverse', 'replace', 'push'] as const)('checks the %s precondition before population', async (type) => {
    const { top, document, target, source, ready, turns } = fixture();
    target.documentState.everPopulated = type !== 'traverse';
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', type, ready, failed);
    await runTask(document);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0]![0]).toHaveProperty('message', expect.stringContaining('History'));
    expect(ready).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);
  });

  it('prepares a retained Document without population or activation', async () => {
    const { top, document, displayed, target, source, ready } = fixture();
    const [, retained] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    retained.origin = document.origin;
    target.documentState.document = retained;
    const state = target.classicHistoryAPIState;
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument');
    top.prepareHistoryStep(top, source, 'activation', 'traverse', ready);
    await runTask(document);
    expect(ready).toHaveBeenCalledExactlyOnceWith({ displayedDocument: document, targetEntry: target, navigable: top, updateOnly: false });
    expect(populate).not.toHaveBeenCalled();
    expect(target.classicHistoryAPIState).toBe(state);
    expect(target.documentState.navigableTargetName).toBe('retained-name');
    expect(top.activeSessionHistoryEntry).toBe(displayed);
    expect(top.currentSessionHistoryEntry).toBe(target);
    expect(top.currentSessionHistoryStep).toBe(4);
  });

  it.each(['push', 'replace'] as const)('accepts a prepared new Document at the specified %s step', async (type) => {
    const { top, document, displayed, target, source, ready } = fixture();
    assert(displayed.step !== 'pending');
    target.step = displayed.step + (type === 'push' ? 1 : 0);
    target.documentState.everPopulated = false;
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    target.documentState.document = loaded;
    top.prepareHistoryStep(top, source, 'none', type, ready);
    await runTask(document);
    expect(ready).toHaveBeenCalledOnce();
    expect(ready.mock.calls[0]![0].updateOnly).toBe(false);
    expect(top.activeSessionHistoryEntry).toBe(displayed);
  });

  it.each(['same-origin', 'foreign-origin', 'unknown-origin'] as const)('fires the child traverse event only for matching retained origins: %s', async (origin) => {
    const { top, document: parentDocument, source } = fixture();
    const child = createChild(top);
    const document = child.activeDocument!;
    const target = document.env.createSessionHistoryEntry(parseURL('https://example.test/child-old').url!, child.activeSessionHistoryEntry.documentState);
    target.step = 0;
    target.documentState.everPopulated = true;
    if (origin !== 'same-origin') {
      target.documentState = Object.assign(new DocumentState(), {
        document, everPopulated: true, origin: origin === 'foreign-origin' ? createOpaqueOrigin() : null,
      });
    }
    child.currentSessionHistoryEntry = target;
    const navigation = child.activeWindow!.navigation;
    navigation.initializeEntriesForNewDocument([target, child.activeSessionHistoryEntry], child.activeSessionHistoryEntry);
    const seen: string[] = [];
    const platform = project(child.activeWindow!) as Window;
    platform.navigation.addEventListener('navigate', (event) => {
      seen.push(event.type);
      expect(document.env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      expect(parentDocument.env.responsibleEventLoop.currentlyRunningTask).toBeNull();
      expect(event.isTrusted).toBe(true);
    });
    const ready = vi.fn<(continuation: ChangingNavigableContinuationState) => void>();
    child.prepareHistoryStep(top, source, 'none', 'traverse', ready);
    expect(parentDocument.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    await runTask(document);
    expect(seen).toEqual(origin === 'same-origin' ? ['navigate'] : []);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('captures the old origin before a child traverse listener changes retained metadata', async () => {
    const { top, source, ready } = fixture();
    const child = createChild(top);
    const document = child.activeDocument!;
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    loaded.origin = createOpaqueOrigin();
    const state = Object.assign(new DocumentState(), { document: loaded, everPopulated: true, origin: document.origin });
    const target = document.env.createSessionHistoryEntry(document.url, state);
    target.step = 0;
    target.classicHistoryAPIState = document.env.serializeForStorage('old origin state');
    child.currentSessionHistoryEntry = target;
    const window = child.activeWindow!;
    window.navigation.initializeEntriesForNewDocument([target, child.activeSessionHistoryEntry], child.activeSessionHistoryEntry);
    const listener = vi.fn(() => { state.origin = loaded.origin; });
    (project(window) as Window).navigation.addEventListener('navigate', listener);
    child.prepareHistoryStep(top, source, 'none', 'traverse', ready);
    await runTask(document);
    expect(listener).toHaveBeenCalledOnce();
    expect(target.classicHistoryAPIState).toEqual(document.env.serializeForStorage(null));
    expect(ready).toHaveBeenCalledOnce();
  });

  it.each([
    { child: false, auxiliary: false, opener: false, expectedName: '' },
    { child: false, auxiliary: true, opener: true, expectedName: 'retained-name' },
    { child: false, auxiliary: true, opener: false, expectedName: '' },
    { child: true, auxiliary: false, opener: false, expectedName: 'retained-name' },
  ])('clears classic state after an origin change, preserving the name only for children or live auxiliary openers ($child/$auxiliary/$opener)', async (options) => {
    const state = fixture();
    const { top, source, ready } = state;
    const navigable = options.child ? createChild(top) : top;
    const document = navigable.activeDocument!;
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    loaded.origin = createOpaqueOrigin();
    const context = loaded.browsingContext!;
    context.isAuxiliary = options.auxiliary;
    context.openerBrowsingContext = options.opener ? document.browsingContext : null;
    const target = options.child ? document.env.createSessionHistoryEntry(document.url, new DocumentState()) : state.target;
    target.documentState.document = loaded;
    target.documentState.origin = document.origin;
    target.documentState.everPopulated = true;
    target.documentState.navigableTargetName = 'retained-name';
    target.classicHistoryAPIState = document.env.serializeForStorage({ retained: true });
    const navigationState = target.navigationAPIState;
    navigable.currentSessionHistoryEntry = target;
    // The child event is covered above; this case isolates the populated continuation's origin rules.
    if (options.child) vi.spyOn(navigable.activeWindow!.navigation, 'fireTraverseNavigateEvent').mockReturnValue(true);
    navigable.prepareHistoryStep(top, source, 'none', 'traverse', ready);
    await runTask(document);
    expect(ready).toHaveBeenCalledOnce();
    expect(target.classicHistoryAPIState).toEqual(document.env.serializeForStorage(null));
    expect(target.navigationAPIState).toBe(navigationState);
    expect(target.documentState.navigableTargetName).toBe(options.expectedName);
  });
});

describe('history population input and completion handoff', () => {
  it.each([false, true])('captures reload/POST inputs until request construction (reload: %s)', async (reload) => {
    const { top, document, displayed, target: previous, source, ready, turns } = fixture();
    const target = reload ? displayed : previous;
    top.currentSessionHistoryEntry = target;
    target.documentState.reloadPending = reload;
    const requests: NavigationRequest[] = [];
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation((entry, timing, capturedSource, _, involvement, options) => {
      expect(timing).toBe(reload ? 'reload' : 'back_forward');
      expect(capturedSource).toBe(source);
      expect(involvement).toBe('browser UI');
      expect(options?.allowPOST).toBe(reload);
      requests.push(entry.createNavigationRequest(top, capturedSource, document.env));
    });
    top.prepareHistoryStep(top, source, 'browser UI', reload ? 'reload' : 'traverse', ready);
    await runTask(document);
    expect(populate).not.toHaveBeenCalled();
    expect(target.documentState.reloadPending).toBe(reload);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(requests[0]).toMatchObject({ reloadNavigation: reload, historyNavigation: !reload });
    expect(target.documentState.reloadPending).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    populate.mock.calls[0]![5]!.completionSteps!();
    expect(ready).not.toHaveBeenCalled();
    await runTask(document);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('takes a target-specific source snapshot when the traversal has no initiating source', async () => {
    const { top, document, ready, turns } = fixture();
    vi.spyOn(top.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation(() => {});
    top.prepareHistoryStep(top, null, 'browser UI', 'traverse', ready);
    await runTask(document);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    const captured = populate.mock.calls[0]![2];
    expect(captured.fetchClient).toBe(document.env);
    expect(captured.hasTransientActivation).toBe(false);
    expect(captured.sourcePolicyContainer).not.toBe(document.policyContainer);
  });

  it('retains the displayed Document when reload population overwrites its shared state', async () => {
    const { top, document, displayed, source, ready, turns } = fixture();
    top.currentSessionHistoryEntry = displayed;
    displayed.documentState.reloadPending = true;
    const [, replacement] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    replacement.origin = document.origin;
    replacement.browsingContext!.setNavigable(top);
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation((entry) => { entry.documentState.document = replacement; });
    top.prepareHistoryStep(top, source, 'none', 'reload', ready);
    await runTask(document);
    turns.shift()!();
    expect(top.activeDocument).toBe(replacement);
    populate.mock.calls[0]![5]!.completionSteps!();
    await runTask(replacement);
    expect(ready).toHaveBeenCalledExactlyOnceWith({ displayedDocument: document, targetEntry: displayed, navigable: top, updateOnly: false });
  });

  it('keeps non-displayable results update-only without clearing retained state or name', async () => {
    const { top, document, target, source, ready, turns } = fixture();
    const classicState = target.classicHistoryAPIState = document.env.serializeForStorage({ retained: true });
    const populate = vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation(() => {});
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready);
    await runTask(document);
    turns.shift()!();
    populate.mock.calls[0]![5]!.completionSteps!();
    await runTask(document);
    expect(ready).toHaveBeenCalledExactlyOnceWith({ displayedDocument: document, targetEntry: target, navigable: top, updateOnly: true });
    expect(target.classicHistoryAPIState).toBe(classicState);
    expect(target.documentState.navigableTargetName).toBe('retained-name');
    expect(top.activeDocument).toBe(document);
  });

  it('allows real Fetch to replay POST with the reload flag, then delivers a 204 continuation', async () => {
    const { top, document, displayed, source, ready, turns, userAgent } = fixture();
    top.currentSessionHistoryEntry = displayed;
    displayed.documentState.reloadPending = true;
    displayed.documentState.resource = { requestBody: new TextEncoder().encode('value=retained'), requestContentType: 'application/x-www-form-urlencoded' };
    const requests: NavigationRequest[] = [];
    const create = displayed.createNavigationRequest.bind(displayed);
    vi.spyOn(displayed, 'createNavigationRequest').mockImplementation((...args) => {
      const request = create(...args);
      requests.push(request);
      return request;
    });
    const transport = mockHTTPTransport(userAgent, (_, listener) => { listener.onHeaders(204, 'No Content', new FetchHeaders(), true); listener.onEnd(); });
    top.prepareHistoryStep(top, source, 'none', 'reload', ready);
    await runTask(document);
    await expect.poll(async () => {
      while (turns.length !== 0) turns.shift()!();
      await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });
      return ready.mock.calls.length;
    }).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
    expect(requests[0]).toMatchObject({ method: 'POST', reloadNavigation: true, historyNavigation: false, webDriverNavigationId: null });
    expect(displayed.documentState.reloadPending).toBe(false);
    expect(top.activeDocument).toBe(document);
    expect(ready.mock.calls[0]![0].displayedDocument).toBe(document);
  });
});

describe('history preparation failure delivery', () => {
  it('notifies its waiting operation when Document destruction discards preparation', async () => {
    const { top, document, source, ready } = fixture();
    const failed = vi.fn();
    document.env.queueTask('navigation-and-traversal', { run: () => { document.destroy(); } });
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    await runTask(document);
    expect(document.browsingContext).toBeNull();
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'History preparation task was discarded' }));
    expect(ready).not.toHaveBeenCalled();
  });

  it('notifies its waiting operation when the post-population task is discarded', async () => {
    const { top, document, source, ready, turns } = fixture();
    vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation((_entry, _timing, _source, _target, _involvement, options) => {
      options!.completionSteps!();
    });
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    await runTask(document);
    document.env.queueTask('navigation-and-traversal', { run: () => { document.destroy(); } });
    turns.shift()!();
    await runTask(document);
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'History preparation task was discarded' }));
    expect(ready).not.toHaveBeenCalled();
  });

  it('forwards removal of a queued Fetch response without delivering a ready continuation', async () => {
    const { top, document, source, ready, turns, userAgent } = fixture();
    const pending = userAgent.HostPromise.withResolvers(internalType<NavigationParams | null | undefined>());
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const queued = vi.spyOn(document.env, 'queueTask');
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    await runTask(document);
    turns.shift()!();
    document.env.queueTask('navigation-and-traversal', { run: () => { document.destroy(); } });
    pending.resolve(undefined);
    await expect.poll(() => queued.mock.calls.length).toBe(3);
    await runTask(document);
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'History population task was discarded' }));
    expect(ready).not.toHaveBeenCalled();
  });

  it('leaves a retained inactive Document waiting until reactivation, without treating inactivity as discard', async () => {
    const { top, document, displayed, source, ready } = fixture();
    top.currentSessionHistoryEntry = displayed;
    const failed = vi.fn();
    const active = vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(failed).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    active.mockRestore();
    await runTask(document);
    expect(ready).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it('releases a waiting traversal queue when destruction removes its preparation task', async () => {
    const { top, document, source, turns, userAgent } = fixture();
    const pending = userAgent.HostPromise.withResolvers(internalType<ChangingNavigableContinuationState>());
    const result = Promise.withResolvers<ChangingNavigableContinuationState>();
    document.env.queueTask('navigation-and-traversal', { run: () => { document.destroy(); } });
    top.appendSessionHistoryTraversalSteps(() => {
      top.prepareHistoryStep(top, source, 'none', 'traverse', pending.resolve, pending.reject);
      return pending.promise.then(result.resolve, result.reject, internalType<void>());
    });
    const later = vi.fn();
    top.appendSessionHistoryTraversalSteps(later);
    const rejected = expect(result.promise).rejects.toThrow('History preparation task was discarded');
    turns.shift()!();
    expect(later).not.toHaveBeenCalled();
    await runTask(document);
    await rejected;
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
    expect(document.browsingContext).toBeNull();
  });

  it('retains the task exception when no waiting operation takes responsibility', async () => {
    const { top, document, target, source, ready } = fixture();
    target.documentState.everPopulated = false;
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready);
    await runInHostTask(() => { expect(() => document.env.responsibleEventLoop.runTaskTurn()).toThrow('previously populated'); });
    expect(ready).not.toHaveBeenCalled();
  });

  it('forwards parallel request-construction failure once and clears the captured reload flag', async () => {
    const { top, document, displayed, source, ready, turns } = fixture();
    top.currentSessionHistoryEntry = displayed;
    displayed.documentState.reloadPending = true;
    const failure = new Error('request construction failed');
    vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation(() => { throw failure; });
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'reload', ready, failed);
    await runTask(document);
    turns.shift()!();
    expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(displayed.documentState.reloadPending).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    expect(top.activeDocument).toBe(document);
  });

  it('forwards Fetch rejection through population without delivering a ready continuation', async () => {
    const { top, document, source, ready, turns, userAgent } = fixture();
    const failure = new Error('Fetch preparation failed');
    const pending = userAgent.HostPromise.withResolvers(internalType<NavigationParams | null | undefined>());
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    await runTask(document);
    turns.shift()!();
    pending.reject(failure);
    await expect.poll(() => turns.length).toBe(1);
    expect(failed).not.toHaveBeenCalled();
    turns.shift()!();
    expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(ready).not.toHaveBeenCalled();
  });

  it('forwards failure to queue a fetched response after its active Window disappears', async () => {
    const { top, document, displayed, source, ready, turns, userAgent } = fixture();
    const pending = userAgent.HostPromise.withResolvers(internalType<NavigationParams | null | undefined>());
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    await runTask(document);
    turns.shift()!();
    displayed.documentState.document = null;
    pending.resolve(null);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'History population requires an active Window' }));
    expect(ready).not.toHaveBeenCalled();
  });

  it('forwards post-population history-state failure without calling completion', async () => {
    const { top, document, target, source, ready, turns } = fixture();
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    loaded.origin = createOpaqueOrigin();
    vi.spyOn(top, 'populateHistoryEntryDocument').mockImplementation((entry, _timing, _source, _target, _involvement, options) => {
      entry.documentState.document = loaded;
      options!.completionSteps!();
    });
    const failure = new Error('history-state serialization failed');
    vi.spyOn(document.env, 'serializeForStorage').mockImplementation(() => { throw failure; });
    const failed = vi.fn();
    top.prepareHistoryStep(top, source, 'none', 'traverse', ready, failed);
    await runTask(document);
    turns.shift()!();
    await runTask(document);
    expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(ready).not.toHaveBeenCalled();
    expect(top.currentSessionHistoryEntry).toBe(target);
    expect(top.activeDocument).toBe(document);
  });

  it('releases a waiting traversal queue on failure without also reporting it on the Document task', async () => {
    const { top, document, target, source, turns, userAgent } = fixture();
    target.documentState.everPopulated = false;
    const pending = userAgent.HostPromise.withResolvers(internalType<ChangingNavigableContinuationState>());
    const result = Promise.withResolvers<ChangingNavigableContinuationState>();
    top.appendSessionHistoryTraversalSteps(() => {
      top.prepareHistoryStep(top, source, 'none', 'traverse', pending.resolve, pending.reject);
      return pending.promise.then(result.resolve, result.reject, internalType<void>());
    });
    const later = vi.fn();
    top.appendSessionHistoryTraversalSteps(later);
    const rejected = expect(result.promise).rejects.toThrow('previously populated');
    turns.shift()!();
    expect(later).not.toHaveBeenCalled();
    await runTask(document);
    await rejected;
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(later).toHaveBeenCalledOnce();
    expect(top.activeDocument).toBe(document);
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const document = top.activeDocument!;
  document.setURL(parseURL('https://example.test/current').url!);
  document.origin = obtainURLOrigin(document.url);
  document.isInitialAboutBlank = false;
  const displayed = top.activeSessionHistoryEntry;
  displayed.url = document.url;
  displayed.step = top.currentSessionHistoryStep = 4;
  displayed.documentState.origin = document.origin;
  displayed.documentState.everPopulated = true;
  const state = new DocumentState();
  state.origin = document.origin;
  state.everPopulated = true;
  state.navigableTargetName = 'retained-name';
  const target = document.env.createSessionHistoryEntry(parseURL('https://example.test/previous').url!, state);
  target.step = 0;
  top.sessionHistoryEntries.unshift(target);
  top.currentSessionHistoryEntry = target;
  top.ongoingNavigation = 'traversal';
  const source = new SourceSnapshotParams(null);
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  const ready = vi.fn<(continuation: ChangingNavigableContinuationState) => void>();
  return { userAgent, top, document, displayed, target, source, turns, ready };
}

function createChild(parent: Navigable): Navigable {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe');
  assert(container.isNavigableContainer());
  owner.body!.appendChild(container);
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  document.setURL(owner.url);
  document.origin = owner.origin;
  document.isInitialAboutBlank = false;
  const child = new Navigable(DocumentState.create(document), parent);
  container.contentNavigable = child;
  child.activeSessionHistoryEntry.step = 4;
  child.activeSessionHistoryEntry.documentState.origin = document.origin;
  parent.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [child.currentSessionHistoryEntry] });
  return child;
}

async function runTask(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
