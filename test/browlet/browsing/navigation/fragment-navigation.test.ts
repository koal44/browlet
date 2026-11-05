import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { DocumentState, SessionHistoryEntry } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/element';
import type { NavigateEvent as BrowletNavigateEvent } from '../../../../src/browlet/platform';
import { createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('fragment navigation', () => {
  it('lets a projected Location hash change be canceled before changing its Document or history', async () => {
    const { browser, document, navigable, update, scroll, turns } = await fixture();
    const original = navigable.activeSessionHistoryEntry;
    expect(await browser.evaluate(() => {
      let flags;
      navigation.addEventListener('navigate', (event) => {
        flags = {
          sameDocument: event.destination.sameDocument, hashChange: event.hashChange,
          canIntercept: event.canIntercept, cancelable: event.cancelable, type: event.navigationType,
        };
        event.preventDefault();
      }, { once: true });
      location.hash = 'target';
      return { flags, hash: location.hash };
    })).toEqual({
      flags: { sameDocument: true, hashChange: true, canIntercept: true, cancelable: true, type: 'push' }, hash: '#before',
    });
    expect(document.url).toBe(original.url);
    expect(navigable.activeSessionHistoryEntry).toBe(original);
    expect(navigable.currentSessionHistoryEntry).toBe(original);
    expect(update).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);
  });

  it('forwards Navigation.navigate info, state, and tracker promises through the fragment branch', async () => {
    const { browser, update, navigation: navigationImpl, turns } = await fixture();
    expect(await browser.evaluate(async () => {
      const info = { source: 'fragment' };
      let sameInfo = false;
      let state: unknown;
      navigation.addEventListener('navigate', (event) => {
        sameInfo = event.info === info;
        state = event.destination.getState();
        event.preventDefault();
      }, { once: true });
      const result = navigation.navigate('#target', { info, state: { supplied: true } });
      const rejected = await Promise.all([result.committed!, result.finished!].map((promise) => promise.then(
        () => false, (reason) => reason instanceof DOMException && reason.name === 'AbortError',
      )));
      return { sameInfo, state, rejected };
    })).toEqual({ sameInfo: true, state: { supplied: true }, rejected: [true, true] });
    expect(navigationImpl.ongoingAPIMethodTracker).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);
  });

  it('settles the tracked fragment result when the Document owner applies its Navigation entry', async () => {
    const { browser, navigation: navigationImpl, update } = await fixture();
    // Exercise the real tracker/entry integration while the rest of Document history application is unfinished.
    update.mockImplementation((entry) => { navigationImpl.updateEntriesForSameDocumentNavigation(entry, 'push'); });
    expect(await browser.evaluate(async () => {
      const { committed, finished } = navigation.navigate('#target', { state: { saved: true } });
      const [first, last] = await Promise.all([committed!, finished!]);
      const state: unknown = last.getState();
      return { sameEntry: first === last && last === navigation.currentEntry, state, hash: location.hash };
    })).toEqual({ sameEntry: true, state: { saved: true }, hash: '#target' });
    expect(navigationImpl.ongoingAPIMethodTracker).toBeNull();
  });

  it('preserves an intercepted fragment and its tracked results until a later navigation aborts it', async () => {
    const { browser, navigation: navigationImpl, navigable, update, scroll, turns } = await fixture();
    expect(await browser.evaluate(() => {
      const info = { source: 'interception' };
      let retained!: NavigateEvent;
      navigation.addEventListener('navigate', (event) => {
        retained = event;
        event.intercept({ precommitHandler: () => new Promise(() => {}) });
      }, { once: true });
      const result = navigation.navigate('#intercepted', { info });
      Reflect.set(globalThis, 'fragmentRequest', { event: retained, result });
      return { aborted: retained.signal.aborted, sameInfo: retained.info === info, hash: location.hash };
    })).toEqual({ aborted: false, sameInfo: true, hash: '#before' });
    expect(navigable.ongoingNavigation).toMatch(/^[\da-f-]{36}$/);
    expect(navigationImpl.ongoingAPIMethodTracker?.pending).toBe(false);
    expect(navigationImpl.ongoingNavigateEvent?.signal.aborted).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);

    expect(await browser.evaluate(async () => {
      const retained = Reflect.get(globalThis, 'fragmentRequest') as { event: NavigateEvent; result: NavigationResult; };
      navigation.addEventListener('navigate', (event) => event.preventDefault(), { once: true });
      const next = navigation.navigate('#canceled');
      const outcomes = await Promise.all([
        retained.result.committed!, retained.result.finished!, next.committed!, next.finished!,
      ].map((promise) => promise.then(() => 'fulfilled', (error: DOMException) => error.name)));
      return { aborted: retained.event.signal.aborted, outcomes };
    })).toEqual({ aborted: true, outcomes: ['AbortError', 'AbortError', 'AbortError', 'AbortError'] });
    expect(navigationImpl.ongoingNavigateEvent).toBeNull();
  });

  it('inherits Navigation state captured before the navigate listener and discards classic History state', async () => {
    const { browser, document, navigable, url } = await fixture();
    const original = navigable.activeSessionHistoryEntry;
    original.navigationAPIState = document.env.serializeForStorage({ inherited: true });
    original.classicHistoryAPIState = document.env.serializeForStorage({ classic: true });
    document.history.stateValue = { classic: true };
    let destinationState: unknown;
    browser.window.navigation.addEventListener('navigate', (event) => {
      destinationState = (event as BrowletNavigateEvent).destination.getState();
      browser.window.navigation.updateCurrentEntry({ state: { changed: true } });
    }, { once: true });

    navigable.navigateToFragment(url, 'push', 'none', null, null, 'fragment');

    const entry = navigable.activeSessionHistoryEntry;
    expect(destinationState).toEqual({ inherited: true });
    expect(document.env.deserialize(entry.navigationAPIState)).toEqual({ inherited: true });
    expect(document.env.deserialize(original.navigationAPIState)).toEqual({ changed: true });
    expect(document.env.deserialize(entry.classicHistoryAPIState)).toBeNull();
    expect(document.history.stateValue).toBeNull();
  });

  it.each([undefined, null, { provided: true }])('uses supplied serialized state (%s), including undefined and null', async (state) => {
    const { browser, document, navigable, url } = await fixture();
    navigable.activeSessionHistoryEntry.navigationAPIState = document.env.serializeForStorage({ inherited: true });
    const serialized = document.env.serializeForStorage(state);
    let destinationState: unknown;
    browser.window.navigation.addEventListener('navigate', (event) => { destinationState = (event as BrowletNavigateEvent).destination.getState(); });

    navigable.navigateToFragment(url, 'push', 'none', null, serialized, 'fragment');

    expect(destinationState).toEqual(state);
    expect(navigable.activeSessionHistoryEntry.navigationAPIState).toBe(serialized);
  });

  it.each(['push', 'replace'] as const)('publishes a %s entry and supplies length before index to Document history application', async (handling) => {
    const { document, navigable, traversable, update, url } = await fixture();
    const original = navigable.activeSessionHistoryEntry;
    original.scrollRestorationMode = 'manual';
    document.history.index = 2;
    document.history.lengthValue = 7;
    const originalStep = traversable.currentSessionHistoryStep;

    navigable.navigateToFragment(url, handling, 'none', null, null, 'fragment');

    const entry = navigable.activeSessionHistoryEntry;
    expect(entry).not.toBe(original);
    expect(entry.documentState).toBe(original.documentState);
    expect(entry.scrollRestorationMode).toBe('manual');
    expect(entry.step).toBe('pending');
    expect(entry.navigationAPIKey === original.navigationAPIKey).toBe(handling === 'replace');
    expect(entry.navigationAPIID).not.toBe(original.navigationAPIID);
    expect(document.url).toBe(url);
    expect(document.latestEntry).toBe(original); // The unfinished Document operation owns latestEntry.
    expect(update).toHaveBeenCalledExactlyOnceWith(entry, true, handling === 'push' ? 4 : 7, handling === 'push' ? 3 : 2, handling);
    expect(navigable.currentSessionHistoryEntry).toBe(original);
    expect(traversable.currentSessionHistoryStep).toBe(originalStep);
    expect(navigable.getSessionHistoryEntries()).not.toContain(entry);
  });

  it('selects Document state, scroll mode, and replacement key after navigate listeners run', async () => {
    const { browser, document, navigable, url } = await fixture();
    const replacement = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));
    replacement.scrollRestorationMode = 'manual';
    browser.window.navigation.addEventListener('navigate', () => { navigable.activeSessionHistoryEntry = replacement; });

    navigable.navigateToFragment(url, 'replace', 'none', null, null, 'fragment');

    expect(navigable.activeSessionHistoryEntry.documentState).toBe(replacement.documentState);
    expect(navigable.activeSessionHistoryEntry.scrollRestorationMode).toBe('manual');
    expect(navigable.activeSessionHistoryEntry.navigationAPIKey).toBe(replacement.navigationAPIKey);
  });

  it('passes sourceElement and user involvement through the real navigate event', async () => {
    const { browser, navigable, url } = await fixture();
    const source = browser.document.createElement('a');
    let flags;
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      flags = { source: event.sourceElement === source, initiated: event.userInitiated, type: event.navigationType };
    });

    navigable.navigateToFragment(url, 'replace', 'activation', unwrap<ElementImpl>(source), null, 'fragment');

    expect(flags).toEqual({ source: true, initiated: true, type: 'replace' });
  });

  it.each(['initial', 'opaque'] as const)('prepares the entry without dispatch when Navigation events are disabled (%s)', async (kind) => {
    const { browser, document, navigable, update, url } = await fixture();
    if (kind === 'initial') document.isInitialAboutBlank = true;
    else document.origin = createOpaqueOrigin();
    const listener = vi.fn();
    browser.window.navigation.addEventListener('navigate', listener);

    navigable.navigateToFragment(url, 'replace', 'none', null, null, 'fragment');

    expect(listener).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    expect(document.url).toBe(url);
  });

  it.each(['push', 'replace'] as const)('orders synchronous work and tagged %s finalization before the BiDi completion hook', async (handling) => {
    const { document, navigable, traversable, update, scroll, finalize, notify, turns, url } = await fixture();
    const previous = navigable.activeSessionHistoryEntry;
    const order: string[] = [];
    update.mockImplementation(() => { order.push('document'); });
    scroll.mockImplementation(() => { order.push('scroll'); });
    finalize.mockImplementation(() => { order.push('finalize'); });
    notify.mockImplementation(() => { order.push('bidi'); });

    navigable.navigateToFragment(url, handling, 'activation', null, null, 'fragment-id');

    const entry = navigable.activeSessionHistoryEntry;
    expect(order).toEqual(['document', 'scroll']);
    expect(turns).toHaveLength(1);
    expect([...traversable.sessionHistoryTraversalQueue.algorithmSet][0]?.targetNavigable).toBe(navigable);
    turns.shift()!();
    expect(order).toEqual(['document', 'scroll', 'finalize', 'bidi']);
    expect(finalize).toHaveBeenCalledExactlyOnceWith(navigable, entry, handling === 'replace' ? previous : null, handling, 'activation');
    expect(notify).toHaveBeenCalledExactlyOnceWith(navigable, { id: 'fragment-id', url, status: 'complete' });
    expect(document.url).toBe(url);
  });

  it.each(['push', 'replace'] as const)('reconciles a fragment push followed by %s through the real finalizer', async (handling) => {
    const { document, navigable, traversable, finalize, notify, turns, url } = await fixture();
    const previous = navigable.activeSessionHistoryEntry;
    finalize.mockRestore();
    vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation((step) => {
      traversable.currentSessionHistoryStep = step;
    });
    navigable.navigateToFragment(url, 'push', 'none', null, null, 'first');
    const first = navigable.activeSessionHistoryEntry;
    const secondURL = { ...url, fragment: 'second' };
    navigable.navigateToFragment(secondURL, handling, 'none', null, null, 'second');
    const second = navigable.activeSessionHistoryEntry;

    expect(notify).not.toHaveBeenCalled();
    turns.shift()!();

    expect(traversable.sessionHistoryEntries).toEqual(handling === 'push' ? [previous, first, second] : [previous, second]);
    expect(second.step).toBe(handling === 'push' ? 2 : 1);
    expect(navigable.activeSessionHistoryEntry).toBe(second);
    expect(document.url).toBe(secondURL);
    expect(notify).toHaveBeenNthCalledWith(1, navigable, { id: 'first', url, status: 'complete' });
    expect(notify).toHaveBeenNthCalledWith(2, navigable, { id: 'second', url: secondURL, status: 'complete' });
  });

  it('does not report automation completion when same-document history application is still unfinished', async () => {
    const { navigable, finalize, notify, turns, url } = await fixture();
    finalize.mockRestore();
    navigable.navigateToFragment(url, 'push', 'none', null, null, 'fragment');

    expect(() => turns.shift()!()).toThrow('Same-document history-step application is not implemented');
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops at persisted-state restoration before fragment scrolling or queueing completion', async () => {
    const { navigable, update, scroll, turns, url } = await fixture();
    update.mockRestore();

    expect(() => navigable.navigateToFragment(url, 'push', 'none', null, null, 'fragment'))
      .toThrow('Session-history scroll restoration is not implemented');
    expect(scroll).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);
  });

  it('delivers popstate and hashchange from Location.hash through the real Document update', async () => {
    const { browser, update, scroll, turns } = await fixture();
    update.mockRestore();
    vi.spyOn(SessionHistoryEntry.prototype, 'restorePersistedState').mockImplementation(() => {});
    const result = await browser.evaluate(async () => {
      const order: string[] = [];
      let popState: unknown;
      const changed = new Promise<HashChangeEvent>((resolve) => {
        addEventListener('hashchange', (event) => { order.push('hashchange'); resolve(event); }, { once: true });
      });
      navigation.addEventListener('currententrychange', () => { order.push('entry'); }, { once: true });
      addEventListener('popstate', (event) => {
        order.push('popstate');
        popState = {
          state: event.state as unknown, same: event.state === history.state, trusted: event.isTrusted,
          target: event.target === window, url: location.href,
        };
      }, { once: true });
      location.hash = 'target';
      order.push('returned');
      const event = await changed;
      return { order, popState, hash: { oldURL: event.oldURL, newURL: event.newURL, trusted: event.isTrusted, target: event.target === window } };
    });
    expect(result).toEqual({
      order: ['entry', 'popstate', 'returned', 'hashchange'],
      popState: { state: null, same: true, trusted: true, target: true, url: 'https://example.test/page#target' },
      hash: { oldURL: 'https://example.test/page#before', newURL: 'https://example.test/page#target', trusted: true, target: true },
    });
    expect(scroll).toHaveBeenCalledOnce();
    expect(turns).toHaveLength(1);
  });

  it('stops at the existing scrolling dependency before queueing completion', async () => {
    const { document, navigable, scroll, turns, url } = await fixture();
    const target = document.createElement('div');
    target.id = 'target';
    document.body!.appendChild(target);
    scroll.mockRestore();

    expect(() => navigable.navigateToFragment(url, 'push', 'none', null, null, 'fragment'))
      .toThrow('Fragment target revealing, scrolling, and focusing are not implemented');
    expect(document.targetElement).toBe(target);
    expect(turns).toHaveLength(0);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/page#before');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  const traversable = navigable.traversable;
  const navigation = document.getRelevantGlobalObject()!.navigation;
  // Supply unfinished owners at their operation boundaries; event dispatch, entry creation, and the queue remain real.
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  const update = vi.spyOn(document, 'updateForHistoryStepApplication').mockImplementation(() => {});
  const scroll = vi.spyOn(document, 'scrollToFragment').mockImplementation(() => {});
  const finalize = vi.spyOn(traversable, 'finalizeSameDocumentNavigation').mockImplementation(() => {});
  const notify = vi.spyOn(document.env.userAgent, 'webDriverBiDiFragmentNavigated');
  const turns: (() => void)[] = [];
  vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  const url = parseURL('https://example.test/page#target').url!;
  return { browser, document, navigable, traversable, navigation, update, scroll, finalize, notify, turns, url };
}
