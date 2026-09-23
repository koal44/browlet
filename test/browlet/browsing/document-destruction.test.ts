import { describe, expect, it, vi } from 'vitest';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { createNewTopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import { ReportingObserverImpl } from '../../../src/browlet/reporting/observer';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { navigationAndTraversalTaskSource, networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { monotonicClock, UnsafeMoment } from '../../../src/browlet/performance/clock';
import { requestNodeEventLoopTurn } from '../../../src/browlet/integration/scripting';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createMicrotaskQueue } from '../../../src/js-engine/index';
import { parseURL } from '../../../src/url/index';

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
    const observer = new ReportingObserverImpl(vi.fn(), { buffered: false }, first.environment);
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
    const { document, traversable, environment, global } = createDocument();
    const eventLoop = environment.responsibleEventLoop;
    const observerCallback = vi.fn();
    const networkingCallback = vi.fn();
    const observer = new ReportingObserverImpl(observerCallback, { buffered: false }, environment);
    observer.observe();
    environment.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    global.queueReport('coep', 'default', corpBody);
    environment.realm.queueGlobalTask(networkingTaskSource, networkingCallback);

    eventLoop.runTaskTurn({
      createMicrotaskQueue,
      requestEventLoopTurn: requestNodeEventLoopTurn,
      unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
    });

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

  it('runs registered cleanup and removes only this document from worker ownership', () => {
    const { document, environment, global } = createDocument();
    const otherDocument = createDocument().document;
    const disentangle = vi.fn();
    const makeDisappear = vi.fn();
    const cleanup = vi.fn();
    const close = vi.fn();
    const terminate = vi.fn();
    const ownerSet = new Set([document, otherDocument]);
    global.messagePorts.push({ disentangle });
    global.webSockets.push({ makeDisappear });
    global.webTransports.push({ cleanup });
    global.eventSources.push({ close });
    document.ownedWorkers.push({ ownerSet });
    document.workletGlobalScopes.push({ terminate });

    environment.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    environment.responsibleEventLoop.runTaskTurn(eventLoopOptions);

    for (const operation of [disentangle, makeDisappear, cleanup, close, terminate]) {
      expect(operation).toHaveBeenCalledExactlyOnceWith();
    }
    expect(ownerSet).toEqual(new Set([otherDocument]));
    expect([...document.bfcacheBlockingDetails]).toEqual([{ reason: 'websocket' }]);
    expect(otherDocument.browsingContext).not.toBeNull();
  });

  it('aborts a registered parser and reports the canceled navigation without destroying the document', () => {
    const { document, traversable, environment } = createDocument();
    const abort = vi.fn();
    const notifyAborted = vi.spyOn(environment.userAgent, 'webDriverBiDiNavigationAborted');
    document.activeParser = { abort };
    document.duringLoadingNavigationID = 'navigation-1';

    environment.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.abort(); });
    environment.responsibleEventLoop.runTaskTurn(eventLoopOptions);

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

function createDocument() {
  const traversable = createNewTopLevelTraversable(new UserAgent(), null, '');
  const document = traversable.activeDocument!;
  const environment = getRelevantRealm(document).environment;
  return { document, traversable, environment, global: environment.getWindowOrWorkerGlobalScopeMixin() };
}

const corpBody = {
  type: 'corp', blockedURL: 'https://resource.test/', destination: 'script', disposition: 'enforce',
};

const eventLoopOptions = {
  createMicrotaskQueue,
  requestEventLoopTurn: requestNodeEventLoopTurn,
  unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
};
