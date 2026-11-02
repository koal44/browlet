import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation-api/navigate-event';
import { NavigationHistoryEntryImpl } from '../../../src/browlet/browsing/navigation-api/navigation-history-entry';
import { NavigationDestinationImpl } from '../../../src/browlet/browsing/navigation-api/navigation-destination';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/document-state';
import { createSessionHistoryEntry } from '../../../src/browlet/browsing/navigation/session-history';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { ElementImpl } from '../../../src/browlet/dom/nodes/element';
import type { FormDataEntry } from '../../../src/xhr/index';
import { toScalarValueString } from '../../../src/infra/index';
import { createOpaqueOrigin } from '../../../src/url/index';
import { getBindingContext, project, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Traversal navigate-event preparation', () => {
  it('retains the visible entry and its state by session-history identity', async () => {
    const { browser, document, navigation, inner } = await fixture();
    const she = createSessionHistoryEntry(createDocumentState(document));
    she.navigationAPIState = document.env.serializeForStorage({ value: 1 });
    const entry = new NavigationHistoryEntryImpl(she, document.env);
    navigation.entryList.push(entry);
    expect(navigation.fireTraverseNavigateEvent(she)).toBe(false);
    const [type, event, destination, involvement, source, form, filename] = inner.mock.calls[0]!;
    expect([type, involvement, source, form, filename]).toEqual(['traverse', 'none', null, null, null]);
    expect(event.classicHistoryAPIState).toBeNull();
    expect(project(event)).toBeInstanceOf(browser.window.NavigateEvent);
    expect(event.isTrusted).toBe(true);
    expect(destination.entry).toBe(entry);
    expect(destination.urlRecord).toBe(she.url);
    expect(destination.state).toBe(she.navigationAPIState);
    const platform = getBindingContext(document.env.realm).project(NavigationDestinationImpl, destination);
    expect(platform).toBeInstanceOf(browser.window.NavigationDestination);
    expect(destination.getState(document.env)).toEqual({ value: 1 });
    expect(destination.sameDocument).toBe(true);
  });

  it('does not expose state merely because a different record has a matching key and ID', async () => {
    const { document, navigation, inner } = await fixture();
    const she = { ...navigation.currentEntry!.sessionHistoryEntry };
    she.navigationAPIState = document.env.serializeForStorage({ hidden: true });
    navigation.fireTraverseNavigateEvent(she, 'browser UI');
    const [, , destination, involvement] = inner.mock.calls[0]!;
    expect(destination.entry).toBeNull();
    expect(destination.getState(document.env)).toBeNull();
    expect(destination.sameDocument).toBe(true);
    expect(involvement).toBe('browser UI');
  });

  it.each(['other', 'evicted'] as const)('classifies a visible %s Document destination independently of entry visibility', async (kind) => {
    const { document, navigation, inner } = await fixture();
    const other = new Browlet({ route: () => '' });
    const she = createSessionHistoryEntry(createDocumentState(unwrap<DocumentImpl>(other.document)));
    if (kind === 'evicted') she.documentState.document = null;
    she.navigationAPIState = document.env.serializeForStorage('retained state');
    navigation.entryList.push(new NavigationHistoryEntryImpl(she, document.env));
    navigation.fireTraverseNavigateEvent(she, 'activation');
    const destination = inner.mock.calls[0]![2];
    expect(destination.sameDocument).toBe(false);
    expect(destination.getState(document.env)).toBe('retained state');
  });
});

describe('Push/replace/reload navigate-event preparation', () => {
  it.each(['push', 'replace', 'reload'] as const)('prepares %s defaults in the owner realm', async (type) => {
    const { browser, document, navigation, inner } = await fixture();
    const url = document.env.parseHTMLURL('/next')!;
    expect(navigation.firePushReplaceReloadNavigateEvent(type, url, false)).toBe(false);
    const [actualType, event, destination, involvement, source, form, filename, tracker] = inner.mock.calls[0]!;
    expect([actualType, involvement, source, form, filename, tracker]).toEqual([type, 'none', null, null, null, null]);
    expect(project(event)).toBeInstanceOf(browser.window.NavigateEvent);
    expect(event.classicHistoryAPIState).toBeNull();
    expect(destination.env).toBe(document.env);
    expect(destination.urlRecord).toBe(url);
    expect(destination.entry).toBeNull();
    expect(destination.sameDocument).toBe(false);
    expect(destination.getState(document.env)).toBeNull();
  });

  it('passes both serialized states, source, form entries, and the pending tracker without copying them', async () => {
    const { browser, document, navigation, inner } = await fixture();
    const source = unwrap<ElementImpl>(browser.document.createElement('form'));
    const entries: FormDataEntry[] = [[toScalarValueString('name'), toScalarValueString('value')]];
    const state = document.env.serializeForStorage({ navigation: true });
    const classicState = document.env.serializeForStorage({ history: true });
    const tracker = navigation.setupNavigateReloadMethodTracker({ info: true }, state);
    inner.mockReturnValue(true);
    expect(navigation.firePushReplaceReloadNavigateEvent('replace', document.url, true, {
      userInvolvement: 'activation', sourceElement: source, formDataEntryList: entries,
      navigationAPIState: state, classicHistoryAPIState: classicState, apiMethodTracker: tracker,
    })).toBe(true);
    const [, event, destination, involvement, actualSource, actualEntries, filename, actualTracker] = inner.mock.calls[0]!;
    expect(event.classicHistoryAPIState).toBe(classicState);
    expect(destination.state).toBe(state);
    expect(destination.sameDocument).toBe(true);
    expect([involvement, filename]).toEqual(['activation', null]);
    expect(actualSource).toBe(source);
    expect(actualEntries).toBe(entries);
    expect(actualTracker).toBe(tracker);
    expect(tracker.pending).toBe(true);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
  });

  it('aborts reentrant ongoing events before preparing the replacement', async () => {
    const { browser, navigation, startOngoing, inner } = await fixture();
    const first = startOngoing();
    let second: NavigateEventImpl | undefined;
    const order: string[] = [];
    browser.window.navigation.addEventListener('navigateerror', () => {
      order.push('abort');
      if (second === undefined) second = startOngoing();
    });
    inner.mockImplementation(() => { order.push('prepare'); return false; });
    await browser.evaluate(() => { history.pushState({ value: 1 }, '', '#next'); });
    expect(order).toEqual(['abort', 'abort', 'prepare']);
    expect(first.signal.aborted).toBe(true);
    expect(second!.signal.aborted).toBe(true);
    expect(navigation.ongoingNavigateEvent).toBeNull();
  });

  it('rechecks activity after abort listeners and discards the supplied pending tracker', async () => {
    const { browser, document, navigation, startOngoing, inner } = await fixture();
    startOngoing();
    const tracker = navigation.setupNavigateReloadMethodTracker(undefined, null);
    browser.window.navigation.addEventListener('navigateerror', () => { document.browsingContext = null; });
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.url, true, { apiMethodTracker: tracker })).toBe(false);
    expect(tracker.pending).toBe(false);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(inner).not.toHaveBeenCalled();
  });

  it.each(['pushState', 'replaceState'] as const)('connects History.%s through abortion to the prepared event', async (method) => {
    const { browser, document, navigation, startOngoing, inner } = await fixture();
    const active = startOngoing();
    const order: string[] = [];
    browser.window.navigation.addEventListener('navigateerror', () => { order.push('abort'); });
    inner.mockImplementation(() => { order.push('prepare'); return true; });
    const update = vi.spyOn(document, 'updateURLAndHistory').mockImplementation(() => { order.push('update'); });
    await browser.evaluate((method) => { history[method]({ value: 2 }, '', '#target'); }, method);
    expect(order).toEqual(['abort', 'prepare', 'update']);
    expect(active.signal.aborted).toBe(true);
    const [type, event, destination] = inner.mock.calls[0]!;
    expect(type).toBe(method === 'pushState' ? 'push' : 'replace');
    expect(destination.url).toBe('https://example.test/current#target');
    expect(destination.sameDocument).toBe(true);
    expect(destination.getState(document.env)).toBeNull();
    expect(document.env.deserialize(event.classicHistoryAPIState!)).toEqual({ value: 2 });
    expect(update).toHaveBeenCalledOnce();
    expect(navigation.ongoingNavigateEvent).toBeNull();
  });
});

describe('Download navigate-event preparation', () => {
  it('keeps an empty filename distinct from no download after aborting the previous event', async () => {
    const { browser, document, navigation, inner, startOngoing } = await fixture();
    const previous = startOngoing();
    const source = unwrap<ElementImpl>(browser.document.createElement('a'));
    const url = document.env.parseHTMLURL('/download')!;
    expect(navigation.fireDownloadRequestNavigateEvent(url, 'activation', source, '')).toBe(false);
    const [type, event, destination, involvement, actualSource, entries, filename] = inner.mock.calls[0]!;
    expect([type, involvement, entries, filename]).toEqual(['push', 'activation', null, '']);
    expect(actualSource).toBe(source);
    expect(event.classicHistoryAPIState).toBeNull();
    expect(destination.urlRecord).toBe(url);
    expect(destination.entry).toBeNull();
    expect(destination.getState(document.env)).toBeNull();
    expect(destination.sameDocument).toBe(false);
    expect(previous.signal.aborted).toBe(true);
    expect(navigation.ongoingNavigateEvent).toBeNull();
  });
});

describe('Navigate-event firing boundaries', () => {
  it.each(['initial', 'opaque'] as const)('allows %s Documents without dispatch or tracker acceptance', async (kind) => {
    const { browser, document, navigation, inner } = await fixture();
    inner.mockRestore();
    const tracker = navigation.setupNavigateReloadMethodTracker(undefined, null);
    expect(tracker.pending).toBe(true);
    if (kind === 'initial') document.isInitialAboutBlank = true;
    else document.origin = createOpaqueOrigin();
    const listener = vi.fn();
    browser.window.navigation.addEventListener('navigate', listener);
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.url, true, { apiMethodTracker: tracker })).toBe(true);
    expect(navigation.fireTraverseNavigateEvent(navigation.entryList[0]!.sessionHistoryEntry)).toBe(true);
    expect(navigation.fireDownloadRequestNavigateEvent(document.url, 'none', null, 'file')).toBe(true);
    expect(tracker.pending).toBe(false);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(navigation.ongoingNavigateEvent).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispatches enabled events and leaves un-intercepted same-document effects to the caller', async () => {
    const { browser, document, navigation, inner } = await fixture();
    inner.mockRestore();
    const listener = vi.fn();
    browser.window.navigation.addEventListener('navigate', listener);
    const tracker = navigation.setupNavigateReloadMethodTracker(undefined, null);
    expect(navigation.firePushReplaceReloadNavigateEvent('push', document.url, true, { apiMethodTracker: tracker })).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(tracker.pending).toBe(false);
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
    expect(navigation.ongoingNavigateEvent).not.toBeNull();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  // Observe the unfinished shared firing boundary without manufacturing event dispatch or completion.
  const inner = vi.spyOn(navigation, 'innerNavigateEventFiring').mockReturnValue(false);
  const startOngoing = () => {
    const event = document.env.createEvent(NavigateEventImpl) as NavigateEventImpl;
    const controller = document.env.createAbortController();
    event.abortController = controller;
    event.signal = controller.signal;
    navigation.ongoingNavigateEvent = event;
    return event;
  };
  return { browser, document, navigation, inner, startOngoing };
}
