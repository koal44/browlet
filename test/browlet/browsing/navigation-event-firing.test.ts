import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import { NavigationHistoryEntryImpl } from '../../../src/browlet/browsing/navigation/api/navigation-history-entry';
import { BrowsingContext, createDocumentState, createSessionHistoryEntry, Navigable } from '../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { ElementImpl } from '../../../src/browlet/dom/nodes/element';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { NavigateEvent as BrowletNavigateEvent } from '../../../src/browlet/platform';
import { toScalarValueString } from '../../../src/infra/index';
import type { FormDataEntry } from '../../../src/xhr/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigate-event dispatch and cancellation', () => {
  it.each(['pushState', 'replaceState'] as const)('allows an author to cancel History.%s without updating the URL or state', async (method) => {
    const { browser } = await fixture();
    expect(await browser.evaluate((method) => {
      const order: string[] = [];
      let captured!: NavigateEvent;
      let data: unknown;
      navigation.addEventListener('navigate', (event) => {
        captured = event;
        order.push('navigate');
        data = {
          realm: event instanceof NavigateEvent && event.destination instanceof NavigationDestination && event.signal instanceof AbortSignal,
          target: event.target === navigation && event.currentTarget === navigation, trusted: event.isTrusted,
          type: event.navigationType, cancelable: event.cancelable, canIntercept: event.canIntercept,
          hashChange: event.hashChange, userInitiated: event.userInitiated, visual: event.hasUAVisualTransition,
          url: event.destination.url, sameDocument: event.destination.sameDocument, state: event.destination.getState() as unknown,
          form: event.formData, download: event.downloadRequest, info: event.info as unknown, source: event.sourceElement,
        };
        event.signal.addEventListener('abort', () => { order.push('abort'); });
        event.preventDefault();
      }, { once: true });
      navigation.addEventListener('navigateerror', () => { order.push('error'); }, { once: true });
      history[method]({ history: true }, '', '#target');
      order.push('returned');
      return {
        data, order, href: location.href, state: history.state as unknown,
        aborted: captured.signal.aborted, reason: (captured.signal.reason as DOMException).name,
      };
    }, method)).toEqual({
      data: {
        realm: true, target: true, trusted: true, type: method === 'pushState' ? 'push' : 'replace',
        cancelable: true, canIntercept: true, hashChange: false, userInitiated: false, visual: false,
        url: 'https://example.test/current#target', sameDocument: true, state: null,
        form: null, download: null, info: undefined, source: null,
      },
      order: ['navigate', 'abort', 'error', 'returned'], href: 'https://example.test/current', state: null,
      aborted: true, reason: 'AbortError',
    });
  });

  it.each([
    ['#next', true, false, true], ['#', true, false, true], ['/current', true, false, false],
    ['?query#next', true, false, false], ['/different#next', true, false, false],
    ['#next', false, false, false], ['#next', true, true, false],
  ] as const)('classifies hash changes for %s, same-document %s, History state %s', async (url, sameDocument, classic, expected) => {
    const { browser, document, navigation } = await fixture();
    let hashChange: boolean | undefined;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      hashChange = event.hashChange;
      event.preventDefault();
    });
    navigation.firePushReplaceReloadNavigateEvent('push', document.env.parseHTMLURL(url)!, sameDocument,
      classic ? { classicHistoryAPIState: document.env.serializeForStorage(undefined) } : {});
    expect(hashChange).toBe(expected);
  });

  it('exposes the owner-realm FormData, source, signal, tracker info and state before cancellation', async () => {
    const { browser, document, navigation } = await fixture();
    const source = unwrap<ElementImpl>(browser.document.createElement('form'));
    const entries: FormDataEntry[] = [[toScalarValueString('field'), toScalarValueString('value')]];
    const info = { arbitrary: source };
    const state = document.env.serializeForStorage({ navigation: true });
    const tracker = navigation.setupNavigateReloadMethodTracker(info, state);
    const settled = Promise.allSettled([tracker.committedPromise.backing, tracker.finishedPromise.backing]);
    navigation.focusChangedDuringOngoingNavigation = true;
    navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    const observed: unknown[] = [];
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      observed.push(event.info === info, event.formData instanceof browser.window.FormData,
        event.signal instanceof browser.window.AbortSignal, unwrap(event.sourceElement!) === source,
        event.userInitiated, event.formData!.get('field'), event.destination.getState());
      observed.push(navigation.ongoingAPIMethodTracker === tracker, tracker.pending,
        navigation.focusChangedDuringOngoingNavigation, navigation.suppressNormalScrollRestorationDuringOngoingNavigation);
      event.formData!.append('added', 'entry');
      event.preventDefault();
    });
    expect(navigation.firePushReplaceReloadNavigateEvent('replace', document.url, true, {
      userInvolvement: 'activation', sourceElement: source, formDataEntryList: entries, navigationAPIState: state, apiMethodTracker: tracker,
    })).toBe(false);
    expect(observed).toEqual([true, true, true, true, true, 'value', { navigation: true }, true, false, false, false]);
    expect(entries).toEqual([['field', 'value'], ['added', 'entry']]);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    const outcomes = await settle(settled, browser);
    expect(outcomes.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    for (const outcome of outcomes) {
      expect(outcome.status === 'rejected' && outcome.reason instanceof browser.window.DOMException).toBe(true);
    }
  });

  it('permits cancellation but denies interception for a cross-origin push', async () => {
    const { browser, document, navigation } = await fixture();
    let observation: unknown;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      let failure: unknown;
      try { event.intercept(); } catch (error) { failure = error; }
      observation = [event.canIntercept, event.cancelable, failure instanceof browser.window.DOMException,
        (failure as DOMException).name];
      event.preventDefault();
    });
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.env.parseHTMLURL('https://other.test/')!, false)).toBe(false);
    expect(observation).toEqual([false, true, true, 'SecurityError']);
  });

  it.each([
    ['same', 'none', false, true, true], ['same', 'browser UI', false, false, true],
    ['same', 'browser UI', true, true, true], ['other', 'activation', true, false, false],
    ['child', 'none', true, false, true],
  ] as const)('classifies %s traversal with %s involvement and activation %s', async (kind, involvement, activated, cancelable, interceptable) => {
    const { browser, document, window, navigation, navigable } = await fixture();
    vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => {});
    if (kind === 'child') {
      const parent = await fixture();
      const container = parent.document.createElement('iframe') as HTMLIFrameElementImpl;
      parent.document.body!.appendChild(container);
      document.browsingContext = new BrowsingContext(window.env.realm.windowProxy);
      document.makeActive();
      container.contentNavigable = new Navigable(createDocumentState(document), parent.navigable);
    }
    if (activated) window.lastActivationTimestamp = 12;
    const state = kind === 'other' ? createDocumentState(null) : createDocumentState(document);
    const she = { ...navigable.activeSessionHistoryEntry, documentState: state };
    let observed: unknown;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      observed = [event.cancelable, event.canIntercept, event.userInitiated];
      event.preventDefault();
    });
    expect(navigation.fireTraverseNavigateEvent(she, involvement)).toBe(!cancelable);
    expect(observed).toEqual([cancelable, interceptable, involvement !== 'none']);
    expect(window.hasHistoryActionActivation()).toBe(activated && !cancelable);
  });

  it('selects only the destination traversal tracker and rejects it on cancellation', async () => {
    const { browser, document, navigation, navigable } = await fixture();
    const she = createSessionHistoryEntry(createDocumentState(document));
    navigation.entryList.push(new NavigationHistoryEntryImpl(she, document.env));
    const tracker = navigation.addUpcomingTraverseMethodTracker(she.navigationAPIKey, 'destination-info');
    const other = navigation.addUpcomingTraverseMethodTracker(navigable.activeSessionHistoryEntry.navigationAPIKey, 'other-info');
    const results = Promise.allSettled([tracker.committedPromise.backing, tracker.finishedPromise.backing]);
    let observed: unknown;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      observed = [event.info, navigation.ongoingAPIMethodTracker === tracker,
        navigation.upcomingTraverseAPIMethodTrackers.has(she.navigationAPIKey)];
      event.preventDefault();
    });
    expect(navigation.fireTraverseNavigateEvent(she)).toBe(false);
    expect(observed).toEqual(['destination-info', true, false]);
    expect(navigation.upcomingTraverseAPIMethodTrackers.get(other.key!)).toBe(other);
    expect((await settle(results, browser)).map((result) => result.status)).toEqual(['rejected', 'rejected']);
  });

  it('leaves a replacement event alone when nested dispatch already aborted the original', async () => {
    const { browser, document, navigation } = await fixture();
    vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => {});
    let original!: BrowletNavigateEvent;
    let replacement!: BrowletNavigateEvent;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      original = baseEvent as BrowletNavigateEvent;
      browser.window.navigation.addEventListener('navigate', (nested) => {
        replacement = nested as BrowletNavigateEvent;
        replacement.intercept();
      }, { once: true });
      navigation.firePushReplaceReloadNavigateEvent('replace', document.env.parseHTMLURL('/replacement')!, true);
    }, { once: true });
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.url, true)).toBe(false);
    expect(original.signal.aborted).toBe(true);
    expect(replacement.signal.aborted).toBe(false);
    expect(navigation.ongoingNavigateEvent).toBe(unwrap(replacement));
    expect(navigation.transition!.to).toBe(unwrap(replacement.destination));
  });

  it('creates an intercepted transition after dispatch and reaches the explicit history update boundary', async () => {
    const { browser, document, navigation } = await fixture();
    let transitionDuringDispatch: unknown;
    let destination: unknown;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      transitionDuringDispatch = browser.window.navigation.transition;
      destination = event.destination;
      event.intercept();
    });
    expect(() => navigation.firePushReplaceReloadNavigateEvent('push', document.url, true)).toThrow('URL and history updates are not implemented');
    expect(transitionDuringDispatch).toBeNull();
    const transition = browser.window.navigation.transition!;
    expect(transition).toBeInstanceOf(browser.window.NavigationTransition);
    expect(transition.to).toBe(destination);
    expect(transition.committed).toBeInstanceOf(getRelevantRealm(browser.window).NativePromise);
    expect(transition.finished).toBeInstanceOf(getRelevantRealm(browser.window).NativePromise);
    expect(navigation.ongoingNavigateEvent!.interceptionState).toBe('committed');
  });

  it('delivers the precommit controller after dispatch while a handler keeps commit pending', async () => {
    const { browser, document, navigation } = await fixture();
    const handler = vi.fn(() => new Promise<void>(() => {}));
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      (baseEvent as BrowletNavigateEvent).intercept({ precommitHandler: handler });
    });
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.url, true)).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]).toHaveLength(1);
    expect(navigation.transition).not.toBeNull();
  });

  it('aborts an ongoing navigation before a canceled download dispatches', async () => {
    const { browser, document, navigation } = await fixture();
    const order: string[] = [];
    // Commit is still unfinished; exercise the real event producer and its retained intercepted event.
    const commit = vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => {});
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      event.intercept();
      event.signal.addEventListener('abort', () => { order.push('abort original'); });
    }, { once: true });
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.env.parseHTMLURL('/pending')!, true)).toBe(false);
    const original = navigation.ongoingNavigateEvent!;
    commit.mockRestore();
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      order.push('download');
      expect(original.signal.aborted).toBe(true);
      event.preventDefault();
    }, { once: true });
    expect(navigation.fireDownloadRequestNavigateEvent(document.env.parseHTMLURL('/file')!, 'none', null, '')).toBe(false);
    expect(order).toEqual(['abort original', 'download']);
    expect(navigation.ongoingNavigateEvent).toBeNull();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const window = document.getRelevantGlobalObject()!;
  return { browser, document, window, navigation: window.navigation, navigable: document.getNodeNavigable()! };
}

function settle<T>(promise: Promise<T>, browser: Browlet): Promise<T> {
  const checkpoint = runInHostTask(() => { getRelevantRealm(browser.window).agent.eventLoop.performMicrotaskCheckpoint(); });
  return Promise.all([promise, checkpoint]).then(([value]) => value);
}
