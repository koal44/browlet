import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationHistoryEntryImpl, type NavigationType } from '../../../../src/browlet/browsing/navigation/api/index';
import type { SessionHistoryEntry } from '../../../../src/browlet/browsing/navigation/state/index';
import type { WindowImpl } from '../../../../src/browlet/browsing/window/index';
import type { PageSwapEvent, Window } from '../../../../src/browlet/platform';
import { ViewTransitionImpl } from '../../../../src/browlet/rendering/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('trusted pageswap production', () => {
  it.each(['push', 'replace'] as const)('exposes the actual %s destination in the outgoing realm', async (type) => {
    const { window, platform, navigation, target, events } = fixture();
    target.navigationAPIState = window.env.serializeForStorage({ destination: true });
    const current = platform.navigation.currentEntry;
    const activation = platform.navigation.activation;
    const entryList = [...navigation.entryList];
    const handler = vi.fn();
    platform.onpageswap = handler;

    await fire(window, target, type);

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(handler).toHaveBeenCalledExactlyOnceWith(event);
    expect(event).toBeInstanceOf(platform.PageSwapEvent);
    expect(event.target).toBe(platform);
    expect([event.isTrusted, event.bubbles, event.cancelable, event.composed]).toEqual([true, false, false, false]);
    expect(event.viewTransition).toBeNull();
    expect(event.activation).toBeInstanceOf(platform.NavigationActivation);
    expect(event.activation!.from).toBe(current);
    expect(event.activation!.navigationType).toBe(type);
    expect(event.activation).not.toBe(activation);
    const destination = event.activation!.entry;
    expect(destination).toBeInstanceOf(platform.NavigationHistoryEntry);
    expect(getRelevantRealm(destination)).toBe(window.env.realm);
    expect(getRelevantRealm(event.activation!)).toBe(window.env.realm);
    expect(destination.url).toBe(serializeURL(target.url));
    expect(destination.key).toBe(target.navigationAPIKey);
    expect(destination.id).toBe(target.navigationAPIID);
    expect(destination.getState()).toEqual({ destination: true });
    expect([destination.index, destination.sameDocument]).toEqual([-1, false]);
    expect(navigation.entryList).toEqual(entryList);
    expect(platform.navigation.currentEntry).toBe(current);
    expect(platform.navigation.activation).toBe(activation);
  });

  it('reuses the outgoing current entry for reload, independently of the new Document entry', async () => {
    const { window, platform, target, events } = fixture();
    const current = platform.navigation.currentEntry;
    await fire(window, target, 'reload');
    expect(events[0]!.activation!.entry).toBe(current);
    expect(events[0]!.activation!.from).toBe(current);
    expect(events[0]!.activation!.entry.key).not.toBe(target.navigationAPIKey);
  });

  it('finds the existing traversal entry by session-history identity, not a duplicate key', async () => {
    const { window, platform, navigation, target, events } = fixture(true);
    const existing = platform.navigation.entries()[0]!;
    const duplicate = window.env.createSessionHistoryEntry(target.url, target.documentState);
    duplicate.navigationAPIKey = target.navigationAPIKey;
    duplicate.navigationAPIID = target.navigationAPIID;
    // The first list entry now has the same exposed identifiers but a different history identity.
    navigation.entryList.unshift(new NavigationHistoryEntryImpl(duplicate, window.env));
    navigation.currentEntryIndex++;
    await fire(window, target, 'traverse');
    expect(events[0]!.activation!.entry).toBe(existing);
    expect(events[0]!.activation!.entry.index).toBe(1);
  });

  it.each(['foreign-origin', 'opaque-origin', 'cross-origin-redirect'] as const)('hides activation for %s', async (kind) => {
    const { window, document, target, events } = fixture();
    if (kind === 'foreign-origin') target.document!.origin = obtainURLOrigin(parseURL('https://other.test/').url!);
    else if (kind === 'opaque-origin') target.document!.origin = createOpaqueOrigin();
    else target.document!.wasCreatedViaCrossOriginRedirects = true;
    const transition = new ViewTransitionImpl(document, window.env);
    await fire(window, target, 'push', transition);
    expect(events[0]!.activation).toBeNull();
    expect(events[0]!.viewTransition).toBe(project(transition));
  });

  it('ignores document.domain relaxation when comparing destination and displayed origins', async () => {
    const { window, document, target, events } = fixture();
    const sourceOrigin = obtainURLOrigin(parseURL('https://a.example.test/').url!);
    const targetOrigin = obtainURLOrigin(parseURL('https://b.example.test/').url!);
    if (sourceOrigin.kind !== 'tuple' || targetOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    sourceOrigin.domain = targetOrigin.domain = parseURL('https://example.test/').url!.host;
    document.origin = sourceOrigin;
    target.document!.origin = targetOrigin;
    await fire(window, target, 'push');
    expect(events[0]!.activation).toBeNull();
  });

  it('allows a previously activated same-origin target despite its earlier cross-origin redirect', async () => {
    const { window, platform, target, events } = fixture(true);
    target.document!.wasCreatedViaCrossOriginRedirects = true;
    target.document!.latestEntry = target;
    await fire(window, target, 'traverse');
    expect(events[0]!.activation!.entry).toBe(platform.navigation.entries()[0]);
  });

  it('keeps a foreign target hidden even when it was previously activated', async () => {
    const { window, target, events } = fixture(true);
    target.document!.origin = obtainURLOrigin(parseURL('https://other.test/').url!);
    target.document!.latestEntry = target;
    await fire(window, target, 'traverse');
    expect(events[0]!.activation).toBeNull();
  });

  it('allows a null predecessor when leaving the initial about:blank Document', async () => {
    const { window, document, navigation, target, events } = fixture();
    document.isInitialAboutBlank = true;
    navigation.entryList = [];
    navigation.currentEntryIndex = -1;
    await fire(window, target, 'replace');
    expect(events[0]!.activation!.from).toBeNull();
    expect(events[0]!.activation!.entry).not.toBeNull();
  });

  it('requires the displayed Window event loop rather than any running Agent task', async () => {
    const { window, target, events } = fixture();
    expect(() => window.firePageSwapEvent(target, 'push', null)).toThrow('displayed Document\'s event loop');
    const otherWindow = target.document!.getRelevantGlobalObject()!;
    await expect(inTask(otherWindow, () => window.firePageSwapEvent(target, 'push', null))).rejects.toThrow('displayed Document\'s event loop');
    expect(events).toHaveLength(0);
  });

  it.each(['missing-document', 'missing-traversal-entry', 'missing-reload-entry'] as const)('rejects %s before dispatch', async (kind) => {
    const { window, document, target, events } = fixture();
    if (kind === 'missing-document') target.documentState.document = null;
    if (kind === 'missing-reload-entry') document.isInitialAboutBlank = true;
    const type = kind === 'missing-traversal-entry' ? 'traverse' : kind === 'missing-reload-entry' ? 'reload' : 'push';
    await expect(fire(window, target, type)).rejects.toThrow(kind === 'missing-document' ? 'populated destination' : 'existing reload or traversal entry');
    expect(events).toHaveLength(0);
  });
});

/** Compose two real Window realms; history application has not made the destination active in the outgoing context. */
function fixture(traversal = false) {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const destination = TopLevelTraversable.create(userAgent, null, '');
  for (const [navigable, path] of [[top, 'source'], [destination, 'destination']] as const) {
    const document = navigable.activeDocument!;
    document.setURL(parseURL(`https://example.test/${path}`).url!);
    document.origin = obtainURLOrigin(document.url);
    document.isInitialAboutBlank = false;
    navigable.activeSessionHistoryEntry.url = document.url;
    navigable.activeSessionHistoryEntry.documentState.origin = document.origin;
  }
  const document = top.activeDocument!;
  const window = document.getRelevantGlobalObject()!;
  const navigation = window.navigation;
  const target = destination.activeSessionHistoryEntry;
  navigation.initializeEntriesForNewDocument(
    traversal ? [target, top.activeSessionHistoryEntry] : [top.activeSessionHistoryEntry], top.activeSessionHistoryEntry,
  );
  navigation.updateActivation('reload', top.activeSessionHistoryEntry);
  const platform = project(window) as Window;
  const events: PageSwapEvent[] = [];
  platform.addEventListener('pageswap', (event) => { events.push(event as PageSwapEvent); });
  return { window, platform, document, navigation, target, events };
}

async function fire(window: WindowImpl, target: SessionHistoryEntry, type: NavigationType, transition: ViewTransitionImpl | null = null): Promise<void> {
  await inTask(window, () => window.firePageSwapEvent(target, type, transition));
}

/** Run the producer on the real task owner while retaining thrown failures for the test. */
async function inTask(window: WindowImpl, steps: () => void): Promise<void> {
  const failures: unknown[] = [];
  window.env.queueTask('navigation-and-traversal', () => {
    try { steps(); } catch (error) { failures.push(error); }
  });
  await runInHostTask(() => { expect(window.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
  if (failures.length !== 0) throw failures[0];
}
