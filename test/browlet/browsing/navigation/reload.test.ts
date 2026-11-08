import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { type HistoryStepResult } from '../../../../src/browlet/browsing/navigation/traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { NavigateEvent as BrowletNavigateEvent } from '../../../../src/browlet/platform';
import { internalType } from '../../../../src/infra/index';
import { createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('reload coordination', () => {
  it.each(['location', 'history', 'navigation'] as const)('allows cancellation through the projected %s entry point', async (source) => {
    const { browser, navigable, apply, turns } = await fixture();
    const entry = navigable.activeSessionHistoryEntry;
    expect(await browser.evaluate(async (source) => {
      navigation.updateCurrentEntry({ state: { saved: true } });
      let observed;
      navigation.addEventListener('navigate', (event) => {
        const state: unknown = event.destination.getState();
        observed = {
          type: event.navigationType, sameDocument: event.destination.sameDocument,
          url: event.destination.url, state,
          cancelable: event.cancelable, canIntercept: event.canIntercept,
          hashChange: event.hashChange, userInitiated: event.userInitiated, trusted: event.isTrusted,
        };
        event.preventDefault();
      }, { once: true });
      let rejected: boolean[] = [];
      if (source === 'location') {
        location.reload();
      } else if (source === 'history') {
        history.go(0);
      } else {
        const result = navigation.reload();
        rejected = await Promise.all([result.committed!, result.finished!].map((promise) => promise.then(
          () => false, (error) => error instanceof DOMException && error.name === 'AbortError',
        )));
      }
      return { observed, rejected };
    }, source)).toEqual({
      observed: {
        type: 'reload', sameDocument: false, url: 'https://example.test/current#part', state: { saved: true },
        cancelable: true, canIntercept: true, hashChange: false, userInitiated: false, trusted: true,
      },
      rejected: source === 'navigation' ? [true, true] : [],
    });
    expect(entry.documentState.reloadPending).toBe(false);
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(apply).not.toHaveBeenCalled();
    expect(turns).toHaveLength(0);
  });

  it('carries Navigation.reload state and info through real event cancellation and tracker cleanup', async () => {
    const { browser, navigation: navigationImpl, apply } = await fixture();
    expect(await browser.evaluate(async () => {
      navigation.updateCurrentEntry({ state: { previous: true } });
      const info = {};
      let observed;
      navigation.addEventListener('navigate', (event) => {
        const state: unknown = event.destination.getState();
        observed = { state, sameInfo: event.info === info };
        event.preventDefault();
      }, { once: true });
      const result = navigation.reload({ state: { replacement: true }, info });
      const rejected = await Promise.all([result.committed!, result.finished!].map((promise) => promise.then(
        () => false, (error) => error instanceof DOMException && error.name === 'AbortError',
      )));
      const retainedState: unknown = navigation.currentEntry!.getState();
      return { observed, rejected, retainedState };
    })).toEqual({
      observed: { state: { replacement: true }, sameInfo: true }, rejected: [true, true], retainedState: { previous: true },
    });
    expect(navigationImpl.ongoingAPIMethodTracker).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('dispatches before marking reload pending, then queues the accepted reload on the traversable', async () => {
    const { browser, navigable, traversable, apply, turns } = await fixture();
    const state = navigable.activeSessionHistoryEntry.documentState;
    const pendingDuringEvent: boolean[] = [];
    browser.window.navigation.addEventListener('navigate', () => { pendingDuringEvent.push(state.reloadPending); });

    expect(await browser.evaluate(() => location.reload())).toBeUndefined();

    expect(pendingDuringEvent).toEqual([false]);
    expect(state.reloadPending).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(turns).toHaveLength(1);
    expect([...traversable.sessionHistoryTraversalQueue.algorithmSet][0]?.targetNavigable).toBeUndefined();
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith('none');
  });

  it('retains a pending precommit interception without scheduling a cross-document reload', async () => {
    const { browser, navigable, navigation: navigationImpl, turns } = await fixture();
    await browser.evaluate(() => {
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ precommitHandler: () => new Promise<void>(() => {}) });
      }, { once: true });
      location.reload();
    });
    expect(navigationImpl.ongoingNavigateEvent!.interceptionState).toBe('intercepted');
    expect(navigationImpl.transition!.navigationType).toBe('reload');
    expect(navigable.activeSessionHistoryEntry.documentState.reloadPending).toBe(false);
    expect(turns).toHaveLength(0);
  });

  it.each(['omitted', 'undefined', 'supplied'] as const)('selects %s serialized state from the active entry', async (kind) => {
    const { browser, document, navigable, navigation } = await fixture();
    const active = navigable.activeSessionHistoryEntry;
    active.navigationAPIState = document.env.serializeForStorage({ saved: true });
    const supplied = document.env.serializeForStorage(null);
    navigable.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(parseURL('https://example.test/other').url!, DocumentState.create(document));
    const fire = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent');
    const events: BrowletNavigateEvent[] = [];
    browser.window.navigation.addEventListener('navigate', (event) => {
      events.push(event as BrowletNavigateEvent);
      event.preventDefault();
    });

    navigable.reload(kind === 'omitted' ? {} : { navigationAPIState: kind === 'undefined' ? undefined : supplied });

    expect(fire).toHaveBeenCalledExactlyOnceWith('reload', active.url, false, {
      navigationAPIState: kind === 'supplied' ? supplied : active.navigationAPIState,
      userInvolvement: 'none', apiMethodTracker: undefined,
    });
    expect(events[0]!.destination.getState()).toEqual(kind === 'supplied' ? null : { saved: true });
    expect(active.documentState.reloadPending).toBe(false);
  });

  it('skips the early navigate event for browser UI and preserves that involvement in queued work', async () => {
    const { navigable, navigation, apply, turns } = await fixture();
    const fire = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent');
    navigable.reload({ userInvolvement: 'browser UI' });
    expect(fire).not.toHaveBeenCalled();
    expect(navigable.activeSessionHistoryEntry.documentState.reloadPending).toBe(true);
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith('browser UI');
  });

  it('marks activation-initiated events and forwards involvement after dispatch', async () => {
    const { browser, navigable, apply, turns } = await fixture();
    const events: boolean[] = [];
    browser.window.navigation.addEventListener('navigate', (event) => { events.push((event as BrowletNavigateEvent).userInitiated); });
    navigable.reload({ userInvolvement: 'activation' });
    expect(events).toEqual([true]);
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith('activation');
  });

  it.each(['initial-about:blank', 'opaque-origin'] as const)('continues when Navigation entries/events are disabled for %s', async (kind) => {
    const { browser, document, navigable, apply, turns } = await fixture();
    if (kind === 'initial-about:blank') document.isInitialAboutBlank = true;
    else document.origin = createOpaqueOrigin();
    const event = vi.fn();
    browser.window.navigation.addEventListener('navigate', event);
    navigable.reload();
    expect(event).not.toHaveBeenCalled();
    expect(navigable.activeSessionHistoryEntry.documentState.reloadPending).toBe(true);
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith('none');
  });

  it('marks only the child state while scheduling through the top-level traversal queue', async () => {
    const { document, traversable, apply, turns } = await fixture();
    const frame = document.createElement('iframe') as HTMLIFrameElementImpl;
    document.body!.appendChild(frame);
    const [, childDocument] = BrowsingContext.create(document, frame, traversable.activeBrowsingContext!.group!);
    const child = new Navigable(DocumentState.create(childDocument), traversable);
    frame.contentNavigable = child;

    child.reload();

    expect(child.activeSessionHistoryEntry.documentState.reloadPending).toBe(true);
    expect(traversable.activeSessionHistoryEntry.documentState.reloadPending).toBe(false);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(apply).toHaveBeenCalledExactlyOnceWith('none');
  });

  it('reaches the explicit population dependency after queued cancellation checks', async () => {
    const { browser, navigable, apply, turns } = await fixture();
    apply.mockRestore();
    expect(await browser.evaluate(() => location.reload())).toBeUndefined();
    expect(navigable.activeSessionHistoryEntry.documentState.reloadPending).toBe(true);
    turns.shift()!();
    await expect.poll(() => turns.length).toBe(1);
    expect(turns.shift()!).toThrow('History-step population and activation is not implemented');
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current#part');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  const traversable = navigable.traversable;
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const apply = vi.spyOn(traversable, 'applyReloadHistoryStep')
    .mockReturnValue(document.env.userAgent.HostPromise.resolve('applied', internalType<HistoryStepResult>()));
  const turns: (() => void)[] = [];
  vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  return { browser, document, navigable, traversable, navigation, apply, turns };
}
