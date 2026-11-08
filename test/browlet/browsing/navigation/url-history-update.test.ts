import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLIFrameElement as BrowletHTMLIFrameElement } from '../../../../src/browlet/platform';
import { parseURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('non-fragment synchronous navigation', () => {
  it('preserves the legacy load type across pushState and replaceState', async () => {
    const { browser, document } = await fixture();
    document.legacyNavigationType = 'reload';
    expect(await browser.evaluate(() => {
      history.pushState(null, '', '/pushed');
      const pushed = performance.navigation.type;
      history.replaceState(null, '', '/replaced');
      return [pushed, performance.navigation.type];
    })).toEqual([1, 1]);
  });

  it('commits projected pushes and replacements synchronously without history events or fetching', async () => {
    const { browser, document, navigable, route, turns } = await fixture();
    const initial = navigable.activeSessionHistoryEntry;
    const applyDocument = vi.spyOn(document, 'updateForHistoryStepApplication');
    const result = await browser.evaluate(() => {
      const initial = navigation.currentEntry!;
      const length = history.length;
      const index = initial.index;
      const changes: unknown[] = [];
      const events: string[] = [];
      addEventListener('hashchange', () => { events.push('hashchange'); });
      addEventListener('popstate', () => { events.push('popstate'); });
      navigation.updateCurrentEntry({ state: { old: true } });
      history.scrollRestoration = 'manual';
      navigation.addEventListener('currententrychange', (event) => {
        changes.push({ type: event.navigationType, url: location.href, state: history.state as unknown, length: history.length - length });
      });
      const input = { items: [1] };
      history.pushState(input, '', '/pushed#one');
      input.items.push(2);
      const pushed = navigation.currentEntry!;
      const push = {
        cloned: history.state !== input, state: history.state as unknown, stable: history.state === history.state,
        key: pushed.key !== initial.key, id: pushed.id !== initial.id, index: pushed.index - index,
        navigationState: pushed.getState() as unknown, scroll: history.scrollRestoration, base: document.baseURI,
      };
      history.replaceState(null, '', '/replaced#two');
      const replaced = navigation.currentEntry!;
      return { push, replace: { key: replaced.key === pushed.key, id: replaced.id !== pushed.id, index: replaced.index - index }, changes, events };
    });
    expect(result).toEqual({
      push: {
        cloned: true, state: { items: [1] }, stable: true, key: true, id: true, index: 1,
        navigationState: undefined, scroll: 'manual', base: 'https://example.test/pushed#one',
      },
      replace: { key: true, id: true, index: 1 },
      changes: [
        { type: 'push', url: 'https://example.test/pushed#one', state: { items: [1] }, length: 1 },
        { type: 'replace', url: 'https://example.test/replaced#two', state: null, length: 1 },
      ],
      events: [],
    });
    const active = navigable.activeSessionHistoryEntry;
    expect(document.latestEntry).toBe(active);
    expect(active.documentState).toBe(initial.documentState);
    expect(active.persistedUserState).toBe(initial.persistedUserState);
    expect(active.step).toBe('pending');
    expect(document.history.index).toBe(1);
    expect(document.history.lengthValue).toBe(2);
    expect(document.env.deserialize(active.classicHistoryAPIState)).toBeNull();
    expect(navigable.currentSessionHistoryEntry).toBe(initial);
    expect(navigable.getSessionHistoryEntries()).toEqual([initial]);
    expect(applyDocument).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledOnce();
    expect(turns).toHaveLength(1);
  });

  it('preserves omitted classic state and its cached object, but clears explicitly serialized null', async () => {
    const { browser, document, navigable } = await fixture();
    await browser.evaluate(() => { history.replaceState({ saved: true }, ''); });
    const previous = navigable.activeSessionHistoryEntry;
    const state = browser.window.history.state as { saved: boolean; unsaved?: boolean; };
    Reflect.set(state, 'unsaved', true);
    const restore = vi.spyOn(document, 'restoreHistoryObjectState');

    document.updateURLAndHistory(parseURL('https://example.test/omitted').url!);

    expect(restore).not.toHaveBeenCalled();
    expect(browser.window.history.state).toBe(state);
    expect(navigable.activeSessionHistoryEntry.classicHistoryAPIState).toBe(previous.classicHistoryAPIState);
    expect(navigable.activeSessionHistoryEntry.navigationAPIKey).toBe(previous.navigationAPIKey);
    expect(navigable.activeSessionHistoryEntry.navigationAPIID).not.toBe(previous.navigationAPIID);
    expect(document.history.lengthValue).toBe(1);
    const serializedNull = document.env.serializeForStorage(null);
    document.updateURLAndHistory(document.url, serializedNull);
    expect(restore).toHaveBeenCalledOnce();
    expect(browser.window.history.state).toBeNull();
    expect(navigable.activeSessionHistoryEntry.classicHistoryAPIState).toBe(serializedNull);
  });

  it('restores cloned state in the receiver Document realm even for a borrowed History method', async () => {
    const first = await fixture();
    const second = await fixture();
    const input: { items: unknown[]; } = { items: [] };
    input.items.push(input);
    first.browser.window.History.prototype.pushState.call(second.browser.window.history, input, '', '/borrowed');
    const state = second.browser.window.history.state as typeof input;
    expect(state).not.toBe(input);
    expect(state.items[0]).toBe(state);
    expect(state).toBeInstanceOf(getRelevantRealm(second.browser.window).Object);
    expect(state.items).toBeInstanceOf(getRelevantRealm(second.browser.window).Array);
    expect(state).not.toBeInstanceOf(getRelevantRealm(first.browser.window).Object);
    expect(first.browser.window.history.state).toBeNull();
    expect(second.browser.window.location.pathname).toBe('/borrowed');
  });

  it('catches any state-deserialization failure without changing the serialized entry', async () => {
    const { document, navigable } = await fixture();
    const entry = navigable.activeSessionHistoryEntry;
    entry.classicHistoryAPIState = document.env.serializeForStorage({ saved: true });
    const serialized = entry.classicHistoryAPIState;
    document.history.stateValue = 'previous';
    const deserialize = vi.spyOn(document.env, 'deserialize').mockImplementation(() => { throw new RangeError('unavailable'); });
    document.restoreHistoryObjectState(entry);
    expect(document.history.stateValue).toBeNull();
    expect(entry.classicHistoryAPIState).toBe(serialized);
    deserialize.mockRestore();
    document.restoreHistoryObjectState(entry);
    expect(document.history.stateValue).toEqual({ saved: true });
  });

  it('replaces both initial about:blank pushes while Navigation entries remain disabled', async () => {
    const { browser, document, navigable, turns } = await fixture();
    const container = document.createElement('iframe') as HTMLIFrameElementImpl;
    const [, childDocument] = BrowsingContext.create(document, container, navigable.activeBrowsingContext!.group!);
    const child = new Navigable(DocumentState.create(childDocument), navigable);
    container.contentNavigable = child;
    document.body!.appendChild(container);
    const initial = child.activeSessionHistoryEntry;
    initial.step = 0;
    navigable.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [initial] });
    const length = childDocument.history.lengthValue;
    const index = childDocument.history.index;
    expect(await browser.evaluate(() => {
      const child = (document.querySelector('iframe') as unknown as BrowletHTMLIFrameElement).contentWindow!;
      child.history.pushState('first', '', 'about:blank#first');
      child.history.pushState('second', '', 'about:blank#second');
      return { state: child.history.state as unknown, href: child.location.href, entry: child.navigation.currentEntry };
    })).toEqual({ state: 'second', href: 'about:blank#second', entry: null });
    expect(childDocument.isInitialAboutBlank).toBe(true);
    expect(childDocument.history.lengthValue).toBe(length);
    expect(childDocument.history.index).toBe(index);
    expect(child.activeSessionHistoryEntry.navigationAPIKey).toBe(initial.navigationAPIKey);
    const apply = vi.spyOn(navigable.traversable, 'applyPushOrReplaceHistoryStep').mockImplementation(() => {});
    turns.shift()!();
    expect(child.getSessionHistoryEntries()).toEqual([child.activeSessionHistoryEntry]);
    expect(apply.mock.calls.map((call) => call[1])).toEqual(['replace', 'replace']);
  });

  it.each(['push', 'replace'] as const)('clears classic state during an intercepted Navigation %s without losing API state', async (historyHandling) => {
    const { browser, document } = await fixture();
    // Navigation admission still needs §6.4 transient activation; the history commit and handlers are real.
    vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
    expect(await browser.evaluate(async (historyHandling) => {
      history.replaceState({ classic: true }, '');
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ focusReset: 'manual', scroll: 'manual' });
      }, { once: true });
      const result = navigation.navigate('/intercepted', { history: historyHandling, state: { api: true } });
      const synchronousState: unknown = history.state;
      const committed = await result.committed;
      const finished = await result.finished;
      return {
        synchronousState, state: history.state as unknown, api: navigation.currentEntry!.getState() as unknown,
        sameEntry: committed === finished && finished === navigation.currentEntry, url: location.href,
      };
    }, historyHandling)).toEqual({ synchronousState: null, state: null, api: { api: true }, sameEntry: true, url: 'https://example.test/intercepted' });
    expect(document.env.responsibleEventLoop.executionContextStack).toEqual([]);
  });

  it.each(['pushState', 'replaceState'] as const)('finalizes a reentrant %s after its pending predecessor', async (method) => {
    const { browser, document, navigable, traversable, turns } = await fixture();
    const initial = navigable.activeSessionHistoryEntry;
    // Only the later §7.4.6 application is supplied; entry insertion and the traversal queue are real.
    const apply = vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation((step) => {
      traversable.currentSessionHistoryStep = step;
    });
    const bidi = vi.spyOn(document.env.userAgent, 'webDriverBiDiHistoryUpdated');
    const changes = await browser.evaluate((method) => {
      const changes: string[] = [];
      navigation.addEventListener('currententrychange', () => { changes.push(location.pathname); });
      navigation.addEventListener('currententrychange', () => { history[method]('inner', '', '/inner'); }, { once: true });
      history.pushState('outer', '', '/outer');
      return changes;
    }, method);
    expect(changes).toEqual(['/outer', '/inner']);
    expect(browser.window.history.state).toBe('inner');
    expect(navigable.getSessionHistoryEntries()).toEqual([initial]);
    expect(bidi).not.toHaveBeenCalled();

    turns.shift()!();

    const entries = navigable.getSessionHistoryEntries();
    expect(entries.map((entry) => entry.url.path)).toEqual(method === 'pushState'
      ? [['start'], ['outer'], ['inner']] : [['start'], ['inner']]);
    expect(entries.map((entry) => entry.step)).toEqual(method === 'pushState' ? [0, 1, 2] : [0, 1]);
    expect(entries.at(-1)).toBe(navigable.activeSessionHistoryEntry);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(bidi).toHaveBeenCalledTimes(2);
    expect(bidi.mock.invocationCallOrder[0]).toBeGreaterThan(apply.mock.invocationCallOrder[0]!);
    expect(bidi.mock.invocationCallOrder[1]).toBeGreaterThan(apply.mock.invocationCallOrder[1]!);
  });

  it('queues a replacement before a disposed-entry listener pushes another entry', async () => {
    const { browser, traversable, turns } = await fixture();
    vi.spyOn(traversable, 'applyPushOrReplaceHistoryStep').mockImplementation((step) => {
      traversable.currentSessionHistoryStep = step;
    });
    await browser.evaluate(() => {
      navigation.currentEntry!.addEventListener('dispose', () => { history.pushState('inner', '', '/inner'); }, { once: true });
      history.replaceState('outer', '', '/outer');
    });
    turns.shift()!();
    expect(traversable.sessionHistoryEntries.map((entry) => entry.url.path)).toEqual([['outer'], ['inner']]);
    expect(traversable.sessionHistoryEntries.map((entry) => entry.step)).toEqual([0, 1]);
  });

  it('retains queued history application as a throwing dependency before BiDi delivery', async () => {
    const { browser, document, navigable, traversable, turns } = await fixture();
    const initial = navigable.currentSessionHistoryEntry;
    const bidi = vi.spyOn(document.env.userAgent, 'webDriverBiDiHistoryUpdated');
    await browser.evaluate(() => { history.pushState('committed', '', '/next'); });
    const active = navigable.activeSessionHistoryEntry;
    expect(browser.window.location.href).toBe('https://example.test/next');
    expect(() => turns.shift()!()).toThrow('Same-document history-step application is not implemented');
    expect(navigable.getSessionHistoryEntries()).toEqual([initial, active]);
    expect(navigable.currentSessionHistoryEntry).toBe(initial);
    expect(traversable.currentSessionHistoryStep).toBe(0);
    expect(bidi).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const route = vi.fn(() => '');
  const browser = new Browlet({ route });
  await browser.navigate('https://example.test/start');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  const traversable = navigable.traversable;
  const turns: (() => void)[] = [];
  vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { browser, document, navigable, traversable, turns, route };
}
