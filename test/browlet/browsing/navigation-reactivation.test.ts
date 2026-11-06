import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { createOpaqueOrigin } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

describe('Navigation entry reactivation', () => {
  it('preserves matching entry identities, creates new ones, and disposes missing entries after pageshow', async () => {
    const { browser, document, navigation, entries } = await fixture();
    const previous = browser.window.navigation.entries();
    const added = document.env.createSessionHistoryEntry(document.url, entries[1]!.documentState);
    const order: unknown[] = [];
    for (const [index, entry] of previous.entries()) {
      entry.ondispose = (event) => {
        order.push({
          dispose: index, index: entry.index, current: browser.window.navigation.currentEntry === previous[1],
          trusted: event.isTrusted, target: event.target === entry, type: event.type,
          flags: [event.bubbles, event.cancelable, event.composed],
        });
      };
    }
    browser.window.addEventListener('pageshow', (event) => {
      order.push({
        pageshow: browser.window.navigation.entries().length,
        current: browser.window.navigation.currentEntry === previous[1],
        persisted: (event as PageTransitionEvent).persisted,
      });
    });
    navigation.updateEntriesForReactivation([entries[1]!, added], entries[1]!);
    const current = browser.window.navigation.entries();
    expect(current[0]).toBe(previous[1]);
    expect(current[1]).not.toBe(previous[0]);
    expect(getRelevantRealm(current[1]!)).toBe(getRelevantRealm(browser.window));
    expect(browser.window.navigation.currentEntry).toBe(previous[1]);
    expect(browser.window.navigation.canGoBack).toBe(false);
    expect(browser.window.navigation.canGoForward).toBe(true);
    expect(order).toEqual([]);
    expect(document.env.responsibleEventLoop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(1);
    // The §7.4 reactivation/pageshow producer is unfinished; deliver its event before the queued task.
    document.getRelevantGlobalObject()!.firePageTransitionEvent('pageshow', true);
    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });
    expect(order).toEqual([
      { pageshow: 2, current: true, persisted: true },
      { dispose: 0, index: -1, current: true, trusted: true, target: true, type: 'dispose', flags: [false, false, false] },
      { dispose: 2, index: -1, current: true, trusted: true, target: true, type: 'dispose', flags: [false, false, false] },
    ]);
  });

  it('matches session-history identity rather than the key or ID', async () => {
    const { browser, navigation, entries, document } = await fixture();
    const old = browser.window.navigation.entries()[0]!;
    let disposed = 0;
    old.ondispose = () => { disposed++; };
    const previous = entries[0]!;
    const replacement = Object.assign(document.env.createSessionHistoryEntry(previous.url, previous.documentState), previous);
    navigation.updateEntriesForReactivation([replacement], replacement);
    expect(browser.window.navigation.currentEntry).not.toBe(old);
    expect(browser.window.navigation.currentEntry!.key).toBe(old.key);
    expect(old.index).toBe(-1);
    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });
    expect(disposed).toBe(1);
  });

  it('does not fire currententrychange or dispose retained entries', async () => {
    const { browser, navigation, entries, document } = await fixture();
    let calls = 0;
    browser.window.navigation.oncurrententrychange = () => { calls++; };
    for (const entry of browser.window.navigation.entries()) entry.ondispose = () => { calls++; };
    const previous = browser.window.navigation.entries();
    navigation.updateEntriesForReactivation(entries, entries[2]!);
    expect(browser.window.navigation.currentEntry).toBe(previous[2]);
    expect(browser.window.navigation.canGoBack).toBe(true);
    expect(browser.window.navigation.canGoForward).toBe(false);
    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });
    expect(calls).toBe(0);
  });

  it.each(['inactive', 'initial', 'opaque'] as const)('leaves a disabled %s entry list alone', async (reason) => {
    const { browser, navigation, entries, document } = await fixture();
    const platform = browser.window.navigation;
    const previous = navigation.entryList;
    if (reason === 'inactive') document.browsingContext = null;
    else if (reason === 'initial') document.isInitialAboutBlank = true;
    else document.origin = createOpaqueOrigin();
    navigation.updateEntriesForReactivation([], entries[0]!);
    expect(navigation.entryList).toBe(previous);
    expect(navigation.currentEntryIndex).toBe(0);
    expect(platform.entries()).toEqual([]);
    expect(document.env.responsibleEventLoop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(0);
  });

  it('holds a queued disposal task while the Document is inactive', async () => {
    const { browser, navigation, entries, document } = await fixture();
    let calls = 0;
    browser.window.navigation.entries()[0]!.ondispose = () => { calls++; };
    navigation.updateEntriesForReactivation([entries[1]!], entries[1]!);
    const context = document.browsingContext;
    document.browsingContext = null;
    await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false); });
    expect(calls).toBe(0);
    expect(document.env.responsibleEventLoop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(1);
    document.browsingContext = context;
    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });
    expect(calls).toBe(1);
  });

  it('keeps the original current entry when serialization changes the list', async () => {
    const { browser, navigation, entries } = await fixture();
    const old = browser.window.navigation.currentEntry!;
    const events: unknown[] = [];
    browser.window.navigation.oncurrententrychange = (event) => {
      events.push({
        from: Reflect.get(event, 'from') === old,
        current: browser.window.navigation.currentEntry === old, state: old.getState() as unknown,
      });
    };
    // Supply the §7.4 history-application effect while serialization is running.
    browser.window.navigation.updateCurrentEntry({
      state: {
        get value() { navigation.updateEntriesForReactivation(entries, entries[1]!); return 'outer'; },
      },
    });
    expect(events).toEqual([{ from: true, current: false, state: { value: 'outer' } }]);
    expect(browser.window.navigation.currentEntry!.getState()).toBeUndefined();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  // Finish loading/Performance delivery before tests advance their own operation by one turn.
  await runInHostTask(() => {
    while (document.env.responsibleEventLoop.runTaskTurn()) { /* Drain loading tasks. */ }
  });
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const current = document.getNodeNavigable()!.activeSessionHistoryEntry;
  const entries = [current,
    document.env.createSessionHistoryEntry(document.url, current.documentState),
    document.env.createSessionHistoryEntry(document.url, current.documentState)];
  // The full history-application producer is unfinished; initialize its record inputs at the owner boundary.
  navigation.entryList = [];
  navigation.currentEntryIndex = -1;
  navigation.initializeEntriesForNewDocument(entries, current);
  return { browser, document, navigation, entries };
}
