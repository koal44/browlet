import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchResponse } from '../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { HTMLDocumentParser } from '../../../../src/browlet/html/parser/html-document-parser';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { Window } from '../../../../src/browlet/platform';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('new-Document history initialization', () => {
  it('keeps parser-script waiters pending until history permits scripts', async () => {
    const { document } = fixture();
    let resumed = false;
    document.waitForScriptsMayRun().observe(() => { resumed = true; }, rejectScriptWait);
    await checkpoint(document);
    expect(resumed).toBe(false);
    document.setReadyToRunScripts();
    expect(resumed).toBe(false);
    await checkpoint(document);
    expect(resumed).toBe(true);
  });

  it.each(['push', 'replace', 'reload', 'traverse'] as const)('initializes %s state and activation before releasing scripts', async (type) => {
    const { document, userAgent, top, previous, target } = fixture();
    const window = document.getRelevantGlobalObject()!;
    const platform = project(window) as Window;
    const order: string[] = [];
    const events: string[] = [];
    platform.addEventListener('popstate', () => { events.push('popstate'); });
    platform.addEventListener('hashchange', () => { events.push('hashchange'); });
    platform.navigation.addEventListener('currententrychange', () => { events.push('entry'); });
    const input: { items: unknown[]; } = { items: [] };
    input.items.push(input);
    target.classicHistoryAPIState = document.env.serializeForStorage(input);
    target.navigationAPIState = document.env.serializeForStorage({ separate: true });
    vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {
      order.push('persisted');
      expect(document.latestEntry).toBe(target);
      expect(platform.history.state).toEqual(input);
      expect(platform.navigation.entries()).toEqual([]);
    });
    const committed = vi.spyOn(userAgent, 'webDriverBiDiNavigationCommitted').mockImplementation(() => {
      order.push('committed');
      expect(platform.navigation.currentEntry!.url).toBe('https://example.test/new#target');
      expect(platform.navigation.currentEntry!.getState()).toEqual({ separate: true });
      expect(platform.navigation.activation!.navigationType).toBe(type);
      expect(platform.navigation.activation!.entry).toBe(platform.navigation.currentEntry);
      expect(platform.navigation.activation!.from!.key).toBe(previous.navigationAPIKey);
    });
    vi.spyOn(document, 'tryToScrollToFragment').mockImplementation(() => { order.push('scroll'); });
    document.waitForScriptsMayRun().observe(() => { order.push('script-1'); }, rejectScriptWait);
    document.waitForScriptsMayRun().observe(() => { order.push('script-2'); }, rejectScriptWait);
    await checkpoint(document);
    expect(order).toEqual([]);

    await inTask(document, () => {
      document.updateForHistoryStepApplication(target, false, 4, 2, type, [previous, target], previous);
      order.push('returned');
      expect(order).toEqual(['persisted', 'committed', 'scroll', 'returned']);
    });
    expect(order).toEqual(['persisted', 'committed', 'scroll', 'returned', 'script-1', 'script-2']);
    expect(committed).toHaveBeenCalledExactlyOnceWith(top, {
      id: 'new-document', status: 'committed', url: document.url,
    });
    expect([platform.history.length, document.history.index]).toEqual([4, 2]);
    const state = platform.history.state as typeof input;
    expect(state).not.toBe(input);
    expect(state.items[0]).toBe(state);
    expect(state).toBeInstanceOf(getRelevantRealm(platform).Object);
    expect(state.items).toBeInstanceOf(getRelevantRealm(platform).Array);
    expect(document.duringLoadingNavigationID).toBe('new-document');
    expect(top.currentSessionHistoryStep).toBe(0);
    expect(events).toEqual([]);
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false);

    document.setReadyToRunScripts();
    document.waitForScriptsMayRun().observe(() => { order.push('late-script'); }, rejectScriptWait);
    await checkpoint(document);
    expect(order.slice(-3)).toEqual(['script-1', 'script-2', 'late-script']);
  });

  it('retains a null history-population ID through the provisional BiDi hook', async () => {
    const { document, target, userAgent, top } = fixture();
    document.duringLoadingNavigationID = null;
    vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {});
    vi.spyOn(document, 'tryToScrollToFragment').mockImplementation(() => {});
    const committed = vi.spyOn(userAgent, 'webDriverBiDiNavigationCommitted');
    await inTask(document, () => document.updateForHistoryStepApplication(target, false, 1, 0, 'traverse', [target]));
    expect(committed).toHaveBeenCalledExactlyOnceWith(top, { id: null, status: 'committed', url: document.url });
    expect(document.duringLoadingNavigationID).toBeNull();
  });

  it('still restores classic state and releases scripts when Navigation entries are disabled', async () => {
    const { document, target, previous } = fixture();
    document.origin = createOpaqueOrigin();
    target.documentState.origin = document.origin;
    target.classicHistoryAPIState = document.env.serializeForStorage({ saved: true });
    vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {});
    vi.spyOn(document, 'tryToScrollToFragment').mockImplementation(() => {});
    let resumed = false;
    document.waitForScriptsMayRun().observe(() => { resumed = true; }, rejectScriptWait);
    await inTask(document, () => document.updateForHistoryStepApplication(target, false, 1, 0, 'push', [target], previous));
    const platform = project(document.getRelevantGlobalObject()!) as Window;
    expect(platform.history.state).toEqual({ saved: true });
    expect(platform.navigation.entries()).toEqual([]);
    expect(platform.navigation.currentEntry).toBeNull();
    expect(platform.navigation.activation).toBeNull();
    expect(resumed).toBe(true);
  });

  it('uses null after failed classic-state deserialization and still initializes Navigation', async () => {
    const { document, target } = fixture();
    vi.spyOn(document.env, 'deserialize').mockImplementation(() => { throw new RangeError('unavailable'); });
    vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {});
    vi.spyOn(document, 'tryToScrollToFragment').mockImplementation(() => {});
    await inTask(document, () => document.updateForHistoryStepApplication(target, false, 1, 0, 'push', [target]));
    expect(document.history.stateValue).toBeNull();
    expect(document.getRelevantGlobalObject()!.navigation.currentEntry!.sessionHistoryEntry).toBe(target);
  });

  it('keeps scripts blocked when persisted-state restoration is unfinished', async () => {
    const { document, target, userAgent } = fixture();
    const initialize = vi.spyOn(document.getRelevantGlobalObject()!.navigation, 'initializeEntriesForNewDocument');
    const committed = vi.spyOn(userAgent, 'webDriverBiDiNavigationCommitted');
    const scroll = vi.spyOn(document, 'tryToScrollToFragment');
    let resumed = false;
    document.waitForScriptsMayRun().observe(() => { resumed = true; }, rejectScriptWait);
    expect(() => document.updateForHistoryStepApplication(target, false, 1, 0, 'push', [target]))
      .toThrow('Session-history scroll restoration is not implemented');
    await checkpoint(document);
    expect(document.latestEntry).toBe(target);
    expect(initialize).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(resumed).toBe(false);
  });

  it('releases scripts after scheduling the fragment attempt, without waiting for scrolling', async () => {
    const { document, target, userAgent } = fixture();
    const wakeups: (() => void)[] = [];
    userAgent.timerHost = {
      scheduleTimeout(_delay, steps) {
        wakeups.push(steps);
        return { remove: () => {} };
      },
    };
    new HTMLDocumentParser(document, () => {});
    vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {});
    vi.spyOn(userAgent, 'isUserInterestedInFragmentScrolling').mockReturnValue(true);
    const scroll = vi.spyOn(document, 'scrollToFragment').mockImplementation(() => {});
    vi.spyOn(document, 'indicatedPart', 'get').mockReturnValue('top');
    const committed = vi.spyOn(userAgent, 'webDriverBiDiNavigationCommitted');
    let resumed = false;
    document.waitForScriptsMayRun().observe(() => { resumed = true; }, rejectScriptWait);
    await inTask(document, () => document.updateForHistoryStepApplication(target, false, 1, 0, 'push', [target]));
    expect(committed).toHaveBeenCalledOnce();
    expect(document.getRelevantGlobalObject()!.navigation.currentEntry!.sessionHistoryEntry).toBe(target);
    expect(resumed).toBe(true);
    expect(wakeups).toHaveLength(1);
    expect(scroll).not.toHaveBeenCalled();
    wakeups[0]!();
    expect(scroll).not.toHaveBeenCalled();
    await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('requires supplied Navigation entries instead of fabricating them for an initial Document', () => {
    const { document, target } = fixture();
    const restore = vi.spyOn(target, 'restorePersistedState');
    expect(() => document.updateForHistoryStepApplication(target, false, 1, 0, 'push'))
      .toThrow('New Document history initialization requires Navigation entries');
    expect(document.latestEntry).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it('requires the new Document to have a node navigable for commit reporting', () => {
    const { document, target, userAgent } = fixture();
    document.browsingContext = null;
    vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {});
    const committed = vi.spyOn(userAgent, 'webDriverBiDiNavigationCommitted');
    expect(() => document.updateForHistoryStepApplication(target, false, 1, 0, 'push', [target]))
      .toThrow('New Document history initialization requires a navigable');
    expect(committed).not.toHaveBeenCalled();
  });
});

/** Create and activate an incoming Document without applying its script-visible history state. */
function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const previous = top.activeSessionHistoryEntry;
  const outgoing = top.activeDocument!;
  outgoing.setURL(parseURL('https://example.test/old').url!);
  outgoing.origin = obtainURLOrigin(outgoing.url);
  outgoing.isInitialAboutBlank = false;
  previous.url = outgoing.url;
  previous.documentState.origin = outgoing.origin;
  outgoing.latestEntry = previous;

  const response = new FetchResponse();
  response.urlList.push(parseURL('https://example.test/new#target').url!);
  const params = top.createNavigationParams(response);
  params.id = 'new-document';
  const document = top.createAndInitializeDocument('html', 'text/html', params);
  const target = top.createHistoryEntry(document, params);
  target.step = 1;
  top.sessionHistoryEntries.push(target);
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry = target;
  document.makeActive();
  return { userAgent, top, previous, target, document };
}

async function checkpoint(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { document.env.responsibleEventLoop.performMicrotaskCheckpoint(); });
}

async function inTask(document: DocumentImpl, steps: () => void): Promise<void> {
  document.env.queueTask('navigation-and-traversal', { run: steps });
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}

function rejectScriptWait(error: unknown): never { throw error; }
