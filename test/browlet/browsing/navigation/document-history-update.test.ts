import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { NavigationType } from '../../../../src/browlet/browsing/navigation/api/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { HashChangeEvent, PopStateEvent, Window } from '../../../../src/browlet/platform';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('existing-Document history-step updates', () => {
  it('publishes URL, length, index, and restored state before Navigation and popstate callbacks', async () => {
    const { document, platform, top, target, restore, order, pops, hashes } = fixture();
    const observations: unknown[] = [];
    platform.navigation.addEventListener('currententrychange', () => {
      observations.push({
        url: platform.location.href, base: platform.document.baseURI, length: platform.history.length,
        index: document.history.index, state: platform.history.state as unknown, latest: document.latestEntry === target,
      });
    });
    const input: { items: unknown[]; } = { items: [] };
    input.items.push(input);
    target.classicHistoryAPIState = document.env.serializeForStorage(input);
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 5, 2, 'traverse'));

    const state = platform.history.state as typeof input;
    expect(observations).toEqual([{
      url: 'https://example.test/page#new', base: 'https://example.test/page#new', length: 5, index: 2, state, latest: true,
    }]);
    expect(state).not.toBe(input);
    expect(state.items[0]).toBe(state);
    expect(state).toBeInstanceOf(getRelevantRealm(platform).Object);
    expect(state.items).toBeInstanceOf(getRelevantRealm(platform).Array);
    expect(platform.navigation.currentEntry!.url).toBe('https://example.test/page#new');
    expect(pops).toHaveLength(1);
    expect(pops[0]!.state).toBe(state);
    expect(pops[0]).toBeInstanceOf(platform.PopStateEvent);
    expect(pops[0]!.target).toBe(platform);
    expect([pops[0]!.isTrusted, pops[0]!.bubbles, pops[0]!.cancelable, pops[0]!.composed, pops[0]!.hasUAVisualTransition])
      .toEqual([true, false, false, false, false]);
    expect(order).toEqual(['entry', 'popstate', 'persisted']);
    expect(restore).toHaveBeenCalledOnce();
    expect(hashes).toHaveLength(0);
    expect(top.currentSessionHistoryStep).toBe(0);

    await runTask(document);
    expect(order).toEqual(['entry', 'popstate', 'persisted', 'hashchange']);
    expect(hashes[0]).toBeInstanceOf(platform.HashChangeEvent);
    expect(hashes[0]!.target).toBe(platform);
    expect([hashes[0]!.isTrusted, hashes[0]!.bubbles, hashes[0]!.cancelable, hashes[0]!.composed])
      .toEqual([true, false, false, false]);
    expect([hashes[0]!.oldURL, hashes[0]!.newURL])
      .toEqual(['https://example.test/page#old', 'https://example.test/page#new']);
  });

  it.each(['push', 'replace', 'reload'] as const)('passes the %s type into Navigation entry updates', async (type: NavigationType) => {
    const { document, window, target, pops } = fixture();
    const update = vi.spyOn(window.navigation, 'updateEntriesForSameDocumentNavigation');
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, type));
    expect(update).toHaveBeenCalledExactlyOnceWith(target, type);
    expect(pops).toHaveLength(1);
  });

  it.each([
    ['/page#new', true], ['/other#new', false], ['/page?query#new', false],
    ['/page#old', false], ['/page', true], ['/page#', true],
  ] as const)('applies the fragment-only hashchange test to %s', async (url, expected) => {
    const { document, target, hashes, pops } = fixture(url);
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'traverse'));
    expect(pops).toHaveLength(1);
    expect(hashes).toHaveLength(0);
    if (expected) await runTask(document);
    else expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(hashes).toHaveLength(expected ? 1 : 0);
  });

  it('queues hashchange ahead of timer-task work from popstate, after its microtasks', async () => {
    const { document, platform, target, order } = fixture();
    platform.addEventListener('popstate', () => {
      platform.queueMicrotask(() => { order.push('microtask'); });
      document.env.queueTask('timer', () => { order.push('timer'); });
    });
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'traverse'));
    expect(order.indexOf('microtask')).toBeGreaterThan(order.indexOf('popstate'));
    expect(order).not.toContain('hashchange');
    await runTask(document);
    await runTask(document);
    expect(order.slice(-2)).toEqual(['hashchange', 'timer']);
  });

  it.each(['currententrychange', 'popstate'] as const)('retains later History updates from a %s listener', async (type) => {
    const { document, platform, target, pops, hashes } = fixture();
    const replace = () => { platform.history.replaceState({ nested: true }, '', '#nested'); };
    if (type === 'currententrychange') platform.navigation.addEventListener(type, replace, { once: true });
    else platform.addEventListener(type, replace, { once: true });

    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'traverse'));
    expect(pops).toHaveLength(1);
    expect(pops[0]!.state).toEqual(type === 'currententrychange' ? { nested: true } : { saved: true });
    expect(pops[0]!.state === platform.history.state).toBe(type === 'currententrychange');
    expect(platform.history.state).toEqual({ nested: true });
    expect(platform.location.hash).toBe('#nested');
    expect(document.latestEntry).not.toBe(target);
    expect(platform.navigation.currentEntry!.url).toBe('https://example.test/page#nested');
    await runTask(document);
    expect([hashes[0]!.oldURL, hashes[0]!.newURL])
      .toEqual(['https://example.test/page#old', 'https://example.test/page#new']);
  });

  it('uses null when restoring the selected classic state fails', async () => {
    const { document, platform, target, pops } = fixture('/page');
    const serialized = target.classicHistoryAPIState;
    vi.spyOn(document.env, 'deserialize').mockImplementation(() => { throw new RangeError('unavailable'); });
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'traverse'));
    expect(platform.history.state).toBeNull();
    expect(pops[0]!.state).toBeNull();
    expect(target.classicHistoryAPIState).toBe(serialized);
  });

  it('reconciles unchanged entries without deserialization or duplicate events', async () => {
    const { document, window, platform, target, restore, order } = fixture();
    document.latestEntry = target;
    const cached = document.history.stateValue;
    const deserialize = vi.spyOn(document.env, 'deserialize');
    const update = vi.spyOn(window.navigation, 'updateEntriesForSameDocumentNavigation');
    const reactivate = vi.spyOn(document, 'reactivate');
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 7, 3, null));
    expect([platform.history.length, document.history.index]).toEqual([7, 3]);
    expect(platform.history.state).toBe(cached);
    expect(deserialize).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(reactivate).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('updates reload activation after the entry and state callbacks', async () => {
    const { document, window, target, previous, order } = fixture();
    window.navigation.updateActivation('reload', previous);
    const activation = window.navigation.activation;
    const updateActivation = window.navigation.updateActivation.bind(window.navigation);
    const update = vi.spyOn(window.navigation, 'updateActivation').mockImplementation((...args) => {
      order.push('activation');
      updateActivation(...args);
    });
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'reload', undefined, previous));
    expect(update).toHaveBeenCalledExactlyOnceWith('reload', previous);
    expect(window.navigation.activation).toBe(activation);
    expect(order).toEqual(['entry', 'popstate', 'persisted', 'activation']);
  });

  it.each(['manual', 'intercepted', 'user-scrolled'] as const)('completes history updates when scrolling is %s', async (reason) => {
    const { document, window, target, restore, pops, order } = fixture();
    restore.mockRestore();
    if (reason === 'manual') target.scrollRestorationMode = 'manual';
    else if (reason === 'intercepted') window.navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    else document.hasBeenScrolledByUser = true;
    await inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'traverse'));
    expect(document.latestEntry).toBe(target);
    expect(pops).toHaveLength(1);
    expect(order).toEqual(['entry', 'popstate']);
  });

  it('does not treat missing automatic scroll restoration as successful completion', async () => {
    const { document, window, target, restore, pops } = fixture();
    restore.mockRestore();
    const activation = vi.spyOn(window.navigation, 'updateActivation');
    await expect(inTask(document, () => document.updateForHistoryStepApplication(target, true, 2, 1, 'traverse')))
      .rejects.toThrow('Session-history scroll restoration is not implemented');
    expect(pops).toHaveLength(1);
    expect(activation).not.toHaveBeenCalled();
  });

  it('routes unchanged cached Documents into the explicit reactivation owner', () => {
    const { document, target, previous, order } = fixture();
    document.latestEntry = target;
    const reactivate = vi.spyOn(document, 'reactivate');
    const entries = [previous, target];
    expect(() => document.updateForHistoryStepApplication(target, false, 2, 1, 'traverse', entries))
      .toThrow('Autocomplete-off control reset is not implemented');
    expect(reactivate).toHaveBeenCalledExactlyOnceWith(target, entries, 'traverse', undefined);
    expect(order).toEqual([]);
  });

  it.each(['navigation-type', 'reactivation-entries'] as const)('requires the %s input', (missing) => {
    const { document, target } = fixture();
    if (missing === 'reactivation-entries') document.latestEntry = target;
    expect(() => document.updateForHistoryStepApplication(target, false, 2, 1, null))
      .toThrow(missing === 'navigation-type' ? 'requires a navigation type' : 'requires Navigation entries');
  });
});

/** Compose a real active Document; its caller has selected the entry but has not updated script-visible state. */
function fixture(path = '/page#new') {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const document = top.activeDocument!;
  document.setURL(parseURL('https://example.test/page#old').url!);
  document.origin = obtainURLOrigin(document.url);
  document.isInitialAboutBlank = false;
  const previous = top.activeSessionHistoryEntry;
  previous.url = document.url;
  previous.documentState.origin = document.origin;
  const target = document.env.createSessionHistoryEntry(parseURL(`https://example.test${path}`).url!, previous.documentState);
  target.classicHistoryAPIState = document.env.serializeForStorage({ saved: true });
  top.sessionHistoryEntries.push(target);
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry = target;
  document.latestEntry = previous;
  document.history.stateValue = document.env.deserialize(document.env.serializeForStorage({ old: true }));
  const window = document.getRelevantGlobalObject()!;
  window.navigation.initializeEntriesForNewDocument([previous, target], previous);
  const platform = project(window) as Window;
  const order: string[] = [];
  const pops: PopStateEvent[] = [];
  const hashes: HashChangeEvent[] = [];
  platform.navigation.addEventListener('currententrychange', () => { order.push('entry'); });
  platform.addEventListener('popstate', (event) => { order.push('popstate'); pops.push(event as PopStateEvent); });
  platform.addEventListener('hashchange', (event) => { order.push('hashchange'); hashes.push(event as HashChangeEvent); });
  const restore = vi.spyOn(target, 'restorePersistedState').mockImplementation(() => { order.push('persisted'); });
  const turns: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { document, window, platform, top, previous, target, restore, order, pops, hashes, turns };
}

async function inTask(document: DocumentImpl, steps: () => void): Promise<void> {
  document.env.queueTask('navigation-and-traversal', steps);
  await runTask(document);
}

async function runTask(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
