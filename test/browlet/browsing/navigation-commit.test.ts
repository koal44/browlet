import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { NavigateEvent as BrowletNavigateEvent } from '../../../src/browlet/platform';
import { NavigationCurrentEntryChangeEventImpl } from '../../../src/browlet/browsing/navigation/events/navigation-current-entry-change-event';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import { NavigationHistoryEntryImpl } from '../../../src/browlet/browsing/navigation/api/navigation-history-entry';
import type { NavigationType } from '../../../src/browlet/browsing/navigation/api/navigation';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { SessionHistoryTraversalSteps } from '../../../src/browlet/browsing/navigation/session-history-traversal-queue';
import { idlType } from '../../../src/web-idl/core/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigate-event commit coordination', () => {
  it.each(['push', 'replace'] as const)('passes the current %s destination and classic state to history before settling committed', async (type) => {
    const { browser, document, navigation, event, tracker, loop } = await fixture(type);
    const destination = document.env.parseHTMLURL('/redirected')!;
    event.destination.urlRecord = destination;
    const classicState = document.env.serializeForStorage({ classic: true });
    event.classicHistoryAPIState = classicState;
    const transition = navigation.transition!;
    const order: string[] = [];
    transition.committed.observe(() => { order.push('committed'); }, () => { order.push('rejected'); });
    transition.finished.observe(() => { order.push('finished'); }, () => { order.push('rejected'); });
    const update = vi.spyOn(document, 'updateURLAndHistory').mockImplementation(() => {
      expect(event.interceptionState).toBe('committed');
      expect(loop.runningExecutionContext).toBe(document.env.realmExecutionContext);
      order.push('history');
    });
    await runInHostTask(() => { event.commit(tracker); });
    await expect.poll(() => order).toEqual(['history', 'committed']);
    expect(update).toHaveBeenCalledExactlyOnceWith(destination, classicState, type);
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
    expect(navigation.transition).toBe(transition);
    expect(loop.executionContextStack).toEqual([]);
    expect(browser.window.location.href).toBe('https://example.test/current');
  });

  it('reloads the active entry rather than the current traversal entry, without a URL update', async () => {
    const { document, navigation, navigable, event, tracker } = await fixture('reload');
    const active = navigable.activeSessionHistoryEntry;
    navigable.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(active.url, active.documentState);
    const update = vi.spyOn(navigation, 'updateEntriesForSameDocumentNavigation').mockImplementation(() => {});
    const urlUpdate = vi.spyOn(document, 'updateURLAndHistory');
    event.commit(tracker);
    expect(update).toHaveBeenCalledExactlyOnceWith(active, 'reload');
    expect(urlUpdate).not.toHaveBeenCalled();
    expect(event.interceptionState).toBe('committed');
  });

  it.each([false, true])('queues intercepted traversal with userInitiated=%s and suppresses ordinary scroll restoration', async (userInitiated) => {
    const { navigation, navigable, event, tracker, loop } = await fixture('traverse');
    event.userInitiated = userInitiated;
    let queued!: SessionHistoryTraversalSteps;
    const enqueue = vi.spyOn(navigable.traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => {
      expect(event.interceptionState).toBe('committed');
      expect(navigation.suppressNormalScrollRestorationDuringOngoingNavigation).toBe(true);
      queued = steps;
    });
    const resume = vi.spyOn(navigable.traversable, 'resumeTraverseHistoryStep').mockImplementation(() => {
      expect(loop.executionContextStack).toEqual([]);
    });
    event.commit(tracker);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
    queued();
    expect(resume).toHaveBeenCalledExactlyOnceWith(7, userInitiated ? 'activation' : 'none');
  });

  it.each([false, true])('keeps only same-document method trackers registered (sameDocument=%s)', async (sameDocument) => {
    const { document, navigation, event, tracker, loop } = await fixture('push', false, sameDocument);
    const update = vi.spyOn(document, 'updateURLAndHistory');
    const outcomes: string[] = [];
    tracker.committedPromise.observe(() => { outcomes.push('committed'); }, () => { outcomes.push('rejected'); });
    tracker.finishedPromise.observe(() => { outcomes.push('finished'); }, () => { outcomes.push('rejected'); });
    event.commit(tracker);
    expect(update).not.toHaveBeenCalled();
    expect(event.interceptionState).toBe('none');
    expect(navigation.transition).toBeNull();
    expect(navigation.ongoingAPIMethodTracker).toBe(sameDocument ? tracker : null);
    expect(loop.executionContextStack).toEqual([]);
    await runInHostTask(() => {});
    expect(outcomes).toEqual([]);
  });

  it('retains tracking when interception turns a cross-document destination into a same-document result', async () => {
    const { document, navigation, event, tracker } = await fixture('push', true, false);
    vi.spyOn(document, 'updateURLAndHistory').mockImplementation(() => {});
    event.commit(tracker);
    expect(event.destination.sameDocument).toBe(false);
    expect(event.interceptionState).toBe('committed');
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
  });

  it('invalidates the retained controller when real precommit fulfillment advances the event to committed', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/current');
    vi.spyOn(unwrap<DocumentImpl>(browser.document), 'updateURLAndHistory').mockImplementation(() => {});
    expect(await browser.evaluate(async () => {
      let controller!: NavigationPrecommitController;
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ precommitHandler(value) { controller = value; } });
      }, { once: true });
      history.pushState(null, '', '#target');
      await navigation.transition!.committed;
      return [() => controller.redirect('#later'), () => controller.addHandler(() => {})].map((operation) => {
        try { operation(); return 'returned'; }
        catch (error) { return error instanceof DOMException ? error.name : 'wrong realm'; }
      });
    })).toEqual(['InvalidStateError', 'InvalidStateError']);
  });

  it('holds the owner script context through author callbacks and settles the transition after the update returns', async () => {
    const { browser, document, navigation: sourceNavigation, event, tracker, loop, realm } = await fixture();
    const order: string[] = [];
    Reflect.set(realm.globalObject, 'commitOrder', order);
    await browser.evaluate(() => {
      const order = Reflect.get(globalThis, 'commitOrder') as string[];
      navigation.addEventListener('currententrychange', () => {
        order.push('entry');
        queueMicrotask(() => { order.push('entry microtask'); });
        void navigation.transition!.committed.then(() => { order.push('transition committed'); });
      }, { once: true });
    });
    vi.spyOn(document, 'updateURLAndHistory').mockImplementation(() => {
      sourceNavigation.fireEvent('currententrychange', NavigationCurrentEntryChangeEventImpl, (baseEvent) => {
        const change = baseEvent as NavigationCurrentEntryChangeEventImpl;
        change.navigationType = 'push';
        change.from = sourceNavigation.currentEntry!;
      });
      expect(loop.runningExecutionContext).toBe(document.env.realmExecutionContext);
      order.push('history returned');
    });
    await runInHostTask(() => { event.commit(tracker); });
    await expect.poll(() => order).toEqual(['entry', 'history returned', 'entry microtask', 'transition committed']);
    expect(loop.executionContextStack).toEqual([]);
  });

  it('does not resolve a replacement transition that is still waiting for precommit', async () => {
    const { browser, document, navigation: sourceNavigation, event, tracker } = await fixture();
    const original = sourceNavigation.transition!;
    const settled: string[] = [];
    original.committed.observe(() => { settled.push('original fulfilled'); }, () => { settled.push('original rejected'); });
    await browser.evaluate(() => {
      navigation.addEventListener('currententrychange', () => {
        navigation.addEventListener('navigate', (next) => {
          next.intercept({ precommitHandler: () => new Promise<void>(() => {}) });
        }, { once: true });
        history.pushState(null, '', '#replacement');
      }, { once: true });
    });
    vi.spyOn(document, 'updateURLAndHistory').mockImplementation(() => {
      sourceNavigation.fireEvent('currententrychange', NavigationCurrentEntryChangeEventImpl, (baseEvent) => {
        const change = baseEvent as NavigationCurrentEntryChangeEventImpl;
        change.navigationType = 'push';
        change.from = sourceNavigation.currentEntry!;
      });
      sourceNavigation.transition!.committed.observe(() => { settled.push('replacement fulfilled'); }, () => { settled.push('replacement rejected'); });
    });
    await runInHostTask(() => { event.commit(tracker); });
    await expect.poll(() => settled).toEqual(['original rejected']);
    expect(sourceNavigation.transition).not.toBe(original);
    expect(sourceNavigation.ongoingNavigateEvent!.interceptionState).toBe('intercepted');
    expect(event.signal.aborted).toBe(true);
  });

  it('retains the history-update dependency and unwinds script preparation on failure', async () => {
    const { navigation, event, tracker, loop } = await fixture('push');
    const transition = navigation.transition!;
    const resolve = vi.spyOn(transition, 'resolveCommitted');
    expect(() => event.commit(tracker)).toThrow('URL and history updates are not implemented');
    expect(event.interceptionState).toBe('committed');
    expect(loop.executionContextStack).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
  });

  it('queues traversal resumption after unwinding script preparation and reaches its unfinished owner', async () => {
    const { document, event, tracker, loop } = await fixture('traverse');
    let queued!: () => void;
    vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { queued = steps; });
    event.commit(tracker);
    expect(event.interceptionState).toBe('committed');
    expect(loop.executionContextStack).toEqual([]);
    expect(queued).toBeTypeOf('function');
    expect(queued).toThrow('Resuming an intercepted history traversal is not implemented');
  });

  it('connects reload to real entry updates and handlers while intercepted finishing remains explicit', async () => {
    const { browser, document, navigation, event, tracker } = await fixture('reload');
    const current = browser.window.navigation.currentEntry;
    const pending = document.env.InternalPromise.withResolvers(idlType.undefined);
    event.navigationHandlerList.push(() => pending.promise);
    const changes: unknown[] = [];
    browser.window.navigation.oncurrententrychange = (change) => { changes.push(Reflect.get(change, 'navigationType')); };
    event.commit(tracker);
    expect(changes).toEqual(['reload']);
    expect(browser.window.navigation.currentEntry).toBe(current);
    expect(tracker.committedToEntry).toBe(navigation.currentEntry);
    expect(event.interceptionState).toBe('committed');
    expect(() => event.finish(true)).toThrow('Navigation focus reset requires autofocus and focusing steps');
  });

  it.each(['inactive', 'aborted'] as const)('ignores %s events before preparing script or updating history', async (condition) => {
    const { document, event, tracker, loop } = await fixture();
    if (condition === 'inactive') document.browsingContext = null;
    else event.abortController!.abort('obsolete');
    const prepare = vi.spyOn(loop, 'prepareToRunScript');
    const update = vi.spyOn(document, 'updateURLAndHistory');
    event.commit(tracker);
    expect(prepare).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(event.interceptionState).toBe('intercepted');
  });
});

async function fixture(type: NavigationType = 'push', intercept = true, sameDocument = true) {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const navigable = document.getNodeNavigable()!;
  const destination = type === 'traverse' ? document.env.createSessionHistoryEntry(document.url, DocumentState.create(document)) : null;
  if (destination !== null) destination.step = 7;
  const tracker = destination === null
    ? navigation.setupNavigateReloadMethodTracker(undefined, null)
    : navigation.addUpcomingTraverseMethodTracker(destination.navigationAPIKey, undefined);
  tracker.committedPromise.observe(() => {}, () => {});
  browser.window.navigation.addEventListener('navigate', (event) => {
    if (intercept) (event as BrowletNavigateEvent).intercept();
  }, { once: true });
  // Run real preparation/dispatch; hold only commit so each test controls its entry point.
  const commit = vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => {});
  if (destination !== null) {
    navigation.entryList.push(new NavigationHistoryEntryImpl(destination, document.env));
    navigation.fireTraverseNavigateEvent(destination);
  } else {
    navigation.firePushReplaceReloadNavigateEvent(type, document.env.parseHTMLURL('/destination')!, sameDocument, { apiMethodTracker: tracker });
  }
  commit.mockRestore();
  const event = navigation.ongoingNavigateEvent!;
  const realm = getRelevantRealm(browser.window);
  return { browser, document, navigation, navigable, event, tracker, realm, loop: realm.agent.eventLoop };
}
