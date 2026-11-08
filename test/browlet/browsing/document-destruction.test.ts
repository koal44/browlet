import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserAgent } from '../../../src/browlet/user-agent';
import { EventSourceImpl } from '../../../src/browlet/communication/event-source';
import { MessageChannelImpl } from '../../../src/browlet/communication/message-channel';
import { getRelevantRealm } from '../../support/browlet-binding';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import { PageEvaluation } from '../../../src/browlet/automation/evaluation';
import { ReportingObserverImpl } from '../../../src/browlet/reporting/observer';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { navigationAndTraversalTaskSource, networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { HTMLDocumentParser } from '../../../src/browlet/html/parser/html-document-parser';
import { Duration } from '../../../src/timing/clock';
import { BlobImpl } from '../../../src/file/blob';
import { parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => vi.restoreAllMocks());

describe('Document destruction', () => {
  it.each(['destroy', 'abort'] as const)('requires the owning event-loop task for %s', (operation) => {
    const { document } = createDocument();
    expect(() => document[operation]()).toThrow('requires a task on its owning event loop');
  });

  it('retains blocking reasons when a document becomes unsalvageable', () => {
    const { document } = createDocument();
    expect(document.salvageable).toBe(true);
    document.makeUnsalvageable('fetch');
    document.makeUnsalvageable('parser-aborted');
    expect(document.salvageable).toBe(false);
    expect([...document.bfcacheBlockingDetails]).toEqual([{ reason: 'fetch' }, { reason: 'parser-aborted' }]);
  });

  it('releases global Reporting state without clearing a different global', () => {
    const first = createDocument();
    const second = createDocument();
    const observer = new ReportingObserverImpl(vi.fn(), { buffered: false }, first.env);
    observer.observe();
    first.global.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://reports.test/').url!));
    first.global.queueReport('coep', 'default', corpBody);
    second.global.queueReport('coep', 'default', corpBody);

    first.global.clearReportingState();

    expect(first.global.reportingEndpoints).toEqual([]);
    expect(first.global.reports).toEqual([]);
    expect(first.global.reportBuffer).toEqual([]);
    expect(first.global.reportingObservers.size).toBe(0);
    expect(observer.takeRecords()).toEqual([]);
    expect(second.global.reports).toHaveLength(1);
    expect(second.global.reportBuffer).toHaveLength(1);
  });

  it('destroys an active document and cancels its queued reports and tasks', () => {
    const { document, traversable, env, global } = createDocument();
    const eventLoop = env.responsibleEventLoop;
    const observerCallback = vi.fn();
    const networkingCallback = vi.fn();
    const observer = new ReportingObserverImpl(observerCallback, { buffered: false }, env);
    observer.observe();
    env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    global.queueReport('coep', 'default', corpBody);
    env.realm.queueGlobalTask(networkingTaskSource, networkingCallback);

    eventLoop.runTaskTurn();

    expect(document.browsingContext).toBeNull();
    expect(traversable.activeDocument).toBeNull();
    expect(document.isFullyActive()).toBe(false);
    expect(global.reportingObservers.size).toBe(0);
    expect(global.reportBuffer).toEqual([]);
    expect(global.reports).toEqual([]);
    expect([...eventLoop.getTaskQueues()].every((queue) => queue.size === 0)).toBe(true);
    expect(observerCallback).not.toHaveBeenCalled();
    expect(networkingCallback).not.toHaveBeenCalled();
  });

  it('destroys a retained history Document without clearing the currently displayed Document', () => {
    const { traversable, retired, firstEntry, current, currentEntry } = createHistoryDocuments();
    const loop = retired.env.responsibleEventLoop;
    let failure: unknown;

    expect(retired.getNodeNavigable()).toBeNull();
    // Destruction must execute on the retained Document's loop without requiring full activity.
    loop.queueTask(navigationAndTraversalTaskSource, null, () => {
      try { retired.destroy(); } catch (error) { failure = error; }
    });
    loop.runTaskTurn();

    expect(failure).toBeUndefined();
    expect(retired.browsingContext).toBeNull();
    expect(firstEntry.document).toBeNull();
    expect(traversable.activeDocument).toBe(current);
    expect(currentEntry.document).toBe(current);
    expect(current.isFullyActive()).toBe(true);
  });

  it('clears shared retained state even when the latest entry now references a replacement state', () => {
    const { traversable, retired, firstEntry, current, currentEntry } = createHistoryDocuments();
    const retainedEntry = retired.env.createSessionHistoryEntry(firstEntry.url, firstEntry.documentState);
    traversable.sessionHistoryEntries.unshift(retainedEntry);
    // A redirected reload can replace an entry's state while an earlier entry still retains the old Document.
    firstEntry.documentState = currentEntry.documentState;
    const loop = retired.env.responsibleEventLoop;
    let failure: unknown;
    loop.queueTask(navigationAndTraversalTaskSource, null, () => {
      try { retired.destroy(); } catch (error) { failure = error; }
    });
    loop.runTaskTurn();

    expect(failure).toBeUndefined();
    expect(retainedEntry.document).toBeNull();
    expect(firstEntry.document).toBe(current);
    expect(currentEntry.document).toBe(current);
  });

  it('preserves the displayed page\'s evaluation and tasks when destroying a retained Document', () => {
    const { traversable, retired, current } = createHistoryDocuments();
    const evaluation = new PageEvaluation(traversable);
    const changed = vi.spyOn(evaluation, 'activeDocumentChanged');
    const retainedWork = vi.fn();
    const discarded = vi.fn();
    const currentWork = vi.fn();
    const loop = retired.env.responsibleEventLoop;
    let failure: unknown;
    loop.queueTask(navigationAndTraversalTaskSource, null, () => {
      try { retired.destroy(); } catch (error) { failure = error; }
    });
    retired.env.queueTask('network', retainedWork, { discardSteps: discarded });
    current.env.queueTask('network', currentWork);
    loop.runTaskTurn();
    current.env.responsibleEventLoop.runTaskTurn();

    expect(failure).toBeUndefined();
    expect(retainedWork).not.toHaveBeenCalled();
    expect(discarded).toHaveBeenCalledExactlyOnceWith();
    expect(currentWork).toHaveBeenCalledExactlyOnceWith();
    expect(changed).not.toHaveBeenCalled();
    expect(current.env.userAgent.pageEvaluations.get(traversable)?.has(evaluation)).toBe(true);
  });

  it('clears a retained child history without clearing the parent or the replacement child', () => {
    const { traversable, document: parent } = createDocument(createManualUserAgent());
    const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
    const [, retired] = BrowsingContext.create(parent, container, parent.browsingContext!.group!);
    const child = new Navigable(DocumentState.create(retired), traversable);
    container.contentNavigable = child;
    parent.body!.appendChild(container);
    const firstEntry = child.activeSessionHistoryEntry;
    const params = child.createNavigationParamsFromSource(parseURL('https://child.test/next').url!);
    const current = child.createAndInitializeDocument('html', 'text/html', params);
    const currentEntry = child.createHistoryEntry(current, params);
    child.currentSessionHistoryEntry = child.activeSessionHistoryEntry = currentEntry;
    current.makeActive();
    traversable.activeSessionHistoryEntry.documentState.nestedHistories.push({
      id: child.id, entries: [firstEntry, currentEntry],
    });
    const loop = retired.env.responsibleEventLoop;
    let failure: unknown;
    loop.queueTask(navigationAndTraversalTaskSource, null, () => {
      try { retired.destroy(); } catch (error) { failure = error; }
    });
    loop.runTaskTurn();

    expect(failure).toBeUndefined();
    expect(firstEntry.document).toBeNull();
    expect(child.activeDocument).toBe(current);
    expect(current.isFullyActive()).toBe(true);
    expect(traversable.activeDocument).toBe(parent);
    expect(container.contentNavigable).toBe(child);
  });

  it('clears a selected entry before activation without disturbing the active Document', () => {
    const { traversable, current } = createHistoryDocuments();
    const params = traversable.createNavigationParamsFromSource(parseURL('https://example.test/pending').url!);
    const pending = traversable.createAndInitializeDocument('html', 'text/html', params);
    const pendingEntry = traversable.createHistoryEntry(pending, params);
    traversable.currentSessionHistoryEntry = pendingEntry;
    const loop = pending.env.responsibleEventLoop;
    let failure: unknown;
    loop.queueTask(navigationAndTraversalTaskSource, null, () => {
      try { pending.destroy(); } catch (error) { failure = error; }
    });
    loop.runTaskTurn();

    expect(failure).toBeUndefined();
    expect(pending.latestEntry).toBeNull();
    expect(pendingEntry.document).toBeNull();
    expect(pending.browsingContext).toBeNull();
    expect(traversable.activeDocument).toBe(current);
    expect(current.isFullyActive()).toBe(true);
  });

  it('clears the last committed state after its entry has been pruned from history', () => {
    const { traversable, retired, firstEntry, currentEntry } = createHistoryDocuments();
    traversable.sessionHistoryEntries = [currentEntry];
    const loop = retired.env.responsibleEventLoop;
    let failure: unknown;
    loop.queueTask(navigationAndTraversalTaskSource, null, () => {
      try { retired.destroy(); } catch (error) { failure = error; }
    });
    loop.runTaskTurn();

    expect(failure).toBeUndefined();
    expect(retired.latestEntry).toBe(firstEntry);
    expect(firstEntry.document).toBeNull();
    expect(traversable.sessionHistoryEntries).toEqual([currentEntry]);
    expect(currentEntry.document).not.toBeNull();
  });

  it('runs registered cleanup and removes only this document from worker ownership', () => {
    const { document, env, global } = createDocument();
    const otherDocument = createDocument().document;
    const channel = new MessageChannelImpl(env);
    const disentangle = vi.spyOn(channel.port1, 'disentangle');
    const makeDisappear = vi.fn();
    const cleanup = vi.fn();
    const source = new EventSourceImpl('data:text/event-stream,', { withCredentials: false }, env);
    const close = vi.spyOn(source, 'close');
    const terminate = vi.fn();
    const ownerSet = new Set([document, otherDocument]);
    global.webSockets.push({ makeDisappear });
    global.webTransports.push({ cleanup });
    document.ownedWorkers.push({ ownerSet });
    document.workletGlobalScopes.push({ terminate });

    env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    env.responsibleEventLoop.runTaskTurn();

    for (const operation of [disentangle, makeDisappear, cleanup, close, terminate]) {
      expect(operation).toHaveBeenCalledExactlyOnceWith();
    }
    expect(ownerSet).toEqual(new Set([otherDocument]));
    expect([...document.bfcacheBlockingDetails]).toEqual([{ reason: 'websocket' }]);
    expect(otherDocument.browsingContext).not.toBeNull();
  });

  it('unblocks connected elements when destroying their browsing context', () => {
    const { document, env } = createDocument();
    document.body!.remove();
    const script = document.head!.appendChild(document.createElement('script'));
    script.blockRendering();
    vi.spyOn(env, 'currentHighResolutionTime').mockReturnValue(new Duration(0));
    expect(script.isRenderBlocking()).toBe(true);

    env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    env.responsibleEventLoop.runTaskTurn();

    expect(document.browsingContext).toBeNull();
    expect(script.isConnected).toBe(true);
    expect(document.renderBlockingElements.size).toBe(0);
  });

  it('revokes only the destroyed document\'s Blob URLs from the shared user-agent store', () => {
    const userAgent = new UserAgent();
    const first = createDocument(userAgent);
    const second = createDocument(userAgent);
    const blob = new BlobImpl(['data'], {}, first.env);
    const store = userAgent.blobURLStore;
    const firstURL = parseURL(store.add(blob, first.env)).url!;
    const secondURL = parseURL(store.add(blob, second.env)).url!;
    expect(store.resolve(firstURL)).not.toBeNull();
    expect(store.resolve(secondURL)).not.toBeNull();

    first.env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { first.document.destroy(); });
    first.env.responsibleEventLoop.runTaskTurn();

    expect(store.resolve(firstURL)).toBeNull();
    expect(store.resolve(secondURL)!.obtainObject(second.env)).toBe(blob);
  });

  it('aborts a registered parser and reports the canceled navigation without destroying the document', () => {
    const { document, traversable, env } = createDocument();
    const abort = vi.spyOn(new HTMLDocumentParser(document, () => {}), 'abort');
    const notifyAborted = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationAborted');
    document.duringLoadingNavigationID = 'navigation-1';

    env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.abort(); });
    env.responsibleEventLoop.runTaskTurn();

    expect(abort).toHaveBeenCalledExactlyOnceWith();
    expect(notifyAborted).toHaveBeenCalledExactlyOnceWith(traversable, {
      id: 'navigation-1', status: 'canceled', url: document.url,
    });
    expect(document.duringLoadingNavigationID).toBeNull();
    expect(document.activeParserWasAborted).toBe(true);
    expect(document.salvageable).toBe(false);
    expect([...document.bfcacheBlockingDetails]).toEqual([{ reason: 'parser-aborted' }]);
    expect(traversable.activeDocument).toBe(document);
    expect(document.browsingContext).not.toBeNull();
  });
});

function createDocument(userAgent: UserAgent = new UserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument!;
  const env = getRelevantRealm(document).env;
  return { document, traversable, env, global: env.getWindowOrWorkerGlobalScopeMixin() };
}

function createHistoryDocuments() {
  const { traversable } = createDocument(createManualUserAgent());
  const firstParams = traversable.createNavigationParamsFromSource(parseURL('https://example.test/first').url!);
  const retired = traversable.createAndInitializeDocument('html', 'text/html', firstParams);
  const firstEntry = traversable.createHistoryEntry(retired, firstParams);
  traversable.finalizeCrossDocumentNavigation('replace', firstParams.userInvolvement, firstEntry);
  const nextParams = traversable.createNavigationParamsFromSource(parseURL('https://example.test/next').url!);
  const current = traversable.createAndInitializeDocument('html', 'text/html', nextParams);
  const currentEntry = traversable.createHistoryEntry(current, nextParams);
  traversable.finalizeCrossDocumentNavigation('push', nextParams.userInvolvement, currentEntry);
  return { traversable, retired, firstEntry, current, currentEntry };
}

const corpBody = {
  type: 'corp', blockedURL: 'https://resource.test/', destination: 'script', disposition: 'enforce',
};
