import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { NavigationAPIMethodTracker } from '../../../src/browlet/browsing/navigation/api/method-tracker';
import type { NavigationResultResult } from '../../../src/browlet/platform';
import { serializeURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigation.navigate preparation', () => {
  it('converts URL and options before serializing, then forwards receiver-owned state and info', async () => {
    const { browser, document: ownerDocument, navigate } = await fixture();
    expect(await browser.evaluate(() => {
      const order: string[] = [];
      const url = { toString() { order.push('url'); return '../next?q=é\uD800'; } };
      const options = {
        get history() { order.push('history'); return 'push'; },
        get info() { order.push('info'); return document; },
        get state() { order.push('state'); return { get value() { order.push('data'); return 1; } }; },
      };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise Web IDL coercion with an explicit receiver.
      Reflect.apply(navigation.navigate, navigation, [url, options]);
      return order;
    })).toEqual(['url', 'info', 'history', 'state', 'data']);
    const [url, source, options] = navigate.mock.calls[0]!;
    expect(serializeURL(url)).toBe('https://example.test/next?q=%C3%A9%EF%BF%BD');
    expect(source).toBe(ownerDocument);
    expect(options!.historyHandling).toBe('push');
    expect(ownerDocument.env.deserialize(options!.navigationAPIState!)).toEqual({ value: 1 });
    expect(options!.apiMethodTracker!.info).toBe(browser.document);
    expect(options!.apiMethodTracker!.serializedState).toBe(options!.navigationAPIState);
    expect(navigate.mock.calls[0]![3]).toBe(ownerDocument.env);
  });

  it('defaults history to auto and keeps API URL parsing in UTF-8 with the receiver base', async () => {
    const { browser, document: ownerDocument, navigate } = await fixture();
    ownerDocument.encoding = 'windows-1252';
    await browser.evaluate(() => {
      const base = document.createElement('base');
      base.href = 'https://example.test/alternate/';
      document.head.append(base);
      navigation.navigate('next?q=é');
    });
    expect(serializeURL(navigate.mock.calls[0]![0])).toBe('https://example.test/alternate/next?q=%C3%A9');
    const options = navigate.mock.calls[0]![2]!;
    expect(options.historyHandling).toBe('auto');
    expect(ownerDocument.env.deserialize(options.navigationAPIState!)).toBeUndefined();
  });

  it('throws conversion failures synchronously instead of returning rejected result promises', async () => {
    const { browser, navigate } = await fixture();
    expect(await browser.evaluate(() => {
      const fail = (args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid inputs still go through the real binding.
        try { Reflect.apply(navigation.navigate, navigation, args); } catch (error) { return error instanceof TypeError; }
        return false;
      };
      return [fail([]), fail([Symbol('url')]), fail(['/next', { history: 'other' }]), navigation.navigate.length];
    })).toEqual([true, true, true, 1]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([['http://[', 'SyntaxError'], ['javascript:1', 'NotSupportedError']])(
    'rejects %s before serialization with two distinct promises and one error', async (url, name) => {
      const { browser, navigate } = await fixture();
      expect(await browser.evaluate(async (url) => {
        let reads = 0;
        const result = navigation.navigate(url, { state: { get value() { reads++; return 1; } } });
        const results = await Promise.allSettled([result.committed!, result.finished!]);
        const reasons = results.map((item) => item.status === 'rejected' ? item.reason as DOMException : null);
        return {
          names: reasons.map((error) => error?.name), sameError: reasons[0] === reasons[1],
          distinctPromises: result.committed !== result.finished, reads,
        };
      }, url)).toEqual({ names: [name, name], sameError: true, distinctPromises: true, reads: 0 });
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('rejects push from initial about:blank before reading serialized state', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      let reads = 0;
      const result = navigation.navigate('https://example.test/', {
        history: 'push', state: { get value() { reads++; return 1; } },
      });
      const results = await Promise.allSettled([result.committed!, result.finished!]);
      return { reads, names: results.map((item) => item.status === 'rejected' ? (item.reason as DOMException).name : null) };
    })).toEqual({ reads: 0, names: ['NotSupportedError', 'NotSupportedError'] });
  });

  it('implements the shared must-replace predicate independently of loading and URL equality', async () => {
    const { document } = await fixture();
    expect(document.navigationMustBeReplace(document.env.parseHTMLURL('javascript:1')!)).toBe(true);
    expect(document.navigationMustBeReplace(document.url)).toBe(false);
    document.completelyLoadedTime = null;
    expect(document.navigationMustBeReplace(document.env.parseHTMLURL('https://example.test/next')!)).toBe(false);
    document.isInitialAboutBlank = true;
    expect(document.navigationMustBeReplace(document.url)).toBe(true);
  });

  it('retains the explicit navigation dependency for a valid request', async () => {
    const { browser, navigate } = await fixture();
    navigate.mockRestore();
    expect(() => browser.window.navigation.navigate('/next')).toThrow('Window transient activation is not implemented');
  });
});

describe.each(['navigate', 'reload'] as const)('Navigation.%s shared preparation', (method) => {
  it('returns serialization failures without navigating or replacing their identity', async () => {
    const { browser, navigate, reload } = await fixture();
    const sentinel = new RangeError('state getter');
    const options = { state: { get value() { throw sentinel; } } };
    const result = method === 'navigate' ? browser.window.navigation.navigate('/next', options) : browser.window.navigation.reload(options);
    expect(await rejectionReasons(result, browser)).toEqual([sentinel, sentinel]);
    const uncloneable = { state: () => {} };
    const cloneResult = method === 'navigate' ? browser.window.navigation.navigate('/next', uncloneable) : browser.window.navigation.reload(uncloneable);
    expect((await rejectionReasons(cloneResult, browser))[0]).toMatchObject({ name: 'DataCloneError' });
    expect(navigate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'unloading', 'detached-by-getter'] as const)('checks %s after serialization', async (reason) => {
    const { browser, document, navigate, reload } = await fixture();
    const platform = browser.window.navigation;
    if (reason === 'inactive') document.browsingContext = null;
    if (reason === 'unloading') document.unloadCounter = 1;
    let reads = 0;
    const options = {
      state: {
        get value() {
          reads++;
          if (reason === 'detached-by-getter') document.browsingContext = null;
          return 1;
        },
      },
    };
    const result = method === 'navigate' ? platform.navigate('/next', options) : platform.reload(options);
    expect((await rejectionReasons(result, browser))[0]).toMatchObject({ name: 'InvalidStateError' });
    expect(reads).toBe(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('selects method-realm early errors and receiver-realm tracked promises when borrowed', async () => {
    const { browser, document, navigation } = await fixture();
    const other = new Browlet({ route: () => '' });
    const receiver = browser.window.navigation;
    const methodRealm = getRelevantRealm(other.window);
    const receiverRealm = getRelevantRealm(browser.window);
    const run = (options: object) => Reflect.apply(other.window.Navigation.prototype[method], receiver,
      method === 'navigate' ? ['/next', options] : [options]) as NavigationResultResult;
    const result = run({});
    const tracker = navigation.ongoingAPIMethodTracker!;
    expect(result.committed).toBeInstanceOf(receiverRealm.NativePromise);
    expect(result.finished).toBeInstanceOf(receiverRealm.NativePromise);
    expect(Object.getPrototypeOf(result)).toBe(receiverRealm.Object.prototype);
    const entry = navigation.currentEntry!;
    tracker.notifyCommittedToEntry(entry);
    tracker.resolveFinished();
    expect(await settle(result.committed!, browser)).toBe(receiver.currentEntry);
    expect(await settle(result.finished!, browser)).toBe(receiver.currentEntry);
    const cloneErrors = await rejectionReasons(run({ state: () => {} }), other);
    expect(cloneErrors[0]).toBeInstanceOf(other.window.DOMException);
    expect(cloneErrors[0]).toMatchObject({ name: 'DataCloneError' });
    expect(cloneErrors[0]).toBe(cloneErrors[1]);
    document.browsingContext = null;
    const errorResult = run({});
    expect(errorResult.committed).toBeInstanceOf(methodRealm.NativePromise);
    expect(errorResult.finished).toBeInstanceOf(methodRealm.NativePromise);
    expect(Object.getPrototypeOf(errorResult)).toBe(receiverRealm.Object.prototype);
    const errors = await rejectionReasons(errorResult, other);
    expect(errors[0]).toBeInstanceOf(other.window.DOMException);
    expect(errors[0]).toBe(errors[1]);
  });
});

describe('Navigation.reload preparation', () => {
  it.each(['omitted', 'undefined', 'null'] as const)('keeps stored state for %s options', async (kind) => {
    const { browser, navigation, reload } = await fixture();
    browser.window.navigation.updateCurrentEntry({ state: { saved: true } });
    const state = navigation.currentEntry!.sessionHistoryEntry.navigationAPIState;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Check the actual binding's optional/null dictionary rules.
    Reflect.apply(browser.window.navigation.reload, browser.window.navigation, kind === 'omitted' ? [] : [kind === 'null' ? null : undefined]);
    expect(reload.mock.calls[0]![0]!.navigationAPIState).toBe(state);
  });

  it('distinguishes an undefined state member from null and preserves info identity', async () => {
    const { browser, navigation, reload, document } = await fixture();
    browser.window.navigation.updateCurrentEntry({ state: 'saved' });
    const saved = navigation.currentEntry!.sessionHistoryEntry.navigationAPIState;
    const info = {};
    browser.window.navigation.reload({ state: undefined, info });
    expect(reload.mock.calls[0]![0]!.navigationAPIState).toBe(saved);
    expect(reload.mock.calls[0]![0]!.apiMethodTracker!.info).toBe(info);
    browser.window.navigation.reload({ state: null });
    expect(document.env.deserialize(reload.mock.calls[1]![0]!.navigationAPIState!)).toBeNull();
  });

  it('retains the explicit reload dependency for a valid request', async () => {
    const { browser, reload } = await fixture();
    reload.mockRestore();
    expect(() => browser.window.navigation.reload()).toThrow('Navigable reload coordination is not implemented');
  });
});

describe('Navigation method trackers', () => {
  it('stores commit state before reactions, then finishes with the committed entry and cleans up', async () => {
    const { browser, navigation, document } = await fixture();
    const info = {};
    const result = browser.window.navigation.navigate('/next', { state: { saved: true }, info });
    const tracker = navigation.ongoingAPIMethodTracker!;
    expect(tracker.key).toBeNull();
    expect(tracker.info).toBe(info);
    expect(tracker.committedToEntry).toBeNull();
    const order: string[] = [];
    void result.committed!.then(() => { order.push('committed'); });
    void result.finished!.then(() => { order.push('finished'); });
    const entry = navigation.currentEntry!;
    const platformEntry = browser.window.navigation.currentEntry;
    tracker.notifyCommittedToEntry(entry);
    expect(document.env.deserialize(entry.sessionHistoryEntry.navigationAPIState)).toEqual({ saved: true });
    expect(tracker.serializedState).toBeNull();
    expect(order).toEqual([]);
    await settle(result.committed!, browser);
    expect(order).toEqual(['committed']);
    expect(navigation.ongoingAPIMethodTracker).toBe(tracker);
    const next = document.env.createSessionHistoryEntry(document.url, entry.sessionHistoryEntry.documentState);
    navigation.updateEntriesForReactivation([entry.sessionHistoryEntry, next], next);
    expect(browser.window.navigation.currentEntry).not.toBe(platformEntry);
    tracker.resolveFinished();
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(await settle(result.finished!, browser)).toBe(platformEntry);
    expect(order).toEqual(['committed', 'finished']);
  });

  it('rejects both results before commit with the same exception', async () => {
    const { browser, navigation } = await fixture();
    const result = browser.window.navigation.navigate('/next');
    const tracker = navigation.ongoingAPIMethodTracker!;
    const reasons = rejectionReasons(result, browser);
    const error = new Error('aborted');
    tracker.rejectFinished(error);
    expect(await reasons).toEqual([error, error]);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
  });

  it('leaves committed fulfilled when completion rejects, without an unhandled finished rejection', async () => {
    const { browser, navigation } = await fixture();
    const result = browser.window.navigation.navigate('/next');
    const tracker = navigation.ongoingAPIMethodTracker!;
    const entry = navigation.currentEntry!;
    tracker.notifyCommittedToEntry(entry);
    await settle(result.committed!, browser);
    const error = new Error('handler failed');
    tracker.rejectFinished(error);
    // finished is intentionally unobserved through a task turn; Vitest would report an unhandled rejection.
    await runInHostTask(() => { navigation.env.responsibleEventLoop.performMicrotaskCheckpoint(); });
    await expect(settle(result.finished!, browser)).rejects.toBe(error);
    expect(await settle(result.committed!, browser)).toBe(browser.window.navigation.currentEntry);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
  });

  it('returns fresh AbortError results if navigate-event firing never accepts the tracker', async () => {
    const { browser, navigate } = await fixture();
    navigate.mockImplementation(() => {});
    const result = browser.window.navigation.navigate('/blocked');
    const tracker = navigate.mock.calls[0]![2]!.apiMethodTracker!;
    expect(tracker.pending).toBe(true);
    expect(result.committed).not.toBe(tracker.committedPromise.backing);
    expect(result.finished).not.toBe(tracker.finishedPromise.backing);
    const errors = await rejectionReasons(result, browser);
    expect(errors[0]).toMatchObject({ name: 'AbortError' });
    expect(errors[0]).toBe(errors[1]);
  });

  it('creates non-pending trackers for disabled entries but leaves their promises unsettled', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const navigation = document.getRelevantGlobalObject()!.navigation;
    const navigate = vi.spyOn(document.getNodeNavigable()!, 'navigate').mockImplementation(() => {});
    const result = browser.window.navigation.navigate('https://example.test/');
    const tracker = navigate.mock.calls[0]![2]!.apiMethodTracker!;
    expect(tracker.pending).toBe(false);
    expect(result.committed).toBe(tracker.committedPromise.backing);
    expect(result.finished).toBe(tracker.finishedPromise.backing);
    let settled = false;
    void result.committed!.then(() => { settled = true; });
    void result.finished!.then(() => { settled = true; });
    await runInHostTask(() => { navigation.env.responsibleEventLoop.performMicrotaskCheckpoint(); });
    expect(settled).toBe(false);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
  });

  it('registers upcoming traversals, preserves entry state, and removes only their registration', async () => {
    const { browser, navigation, document } = await fixture();
    const entry = navigation.currentEntry!;
    const state = entry.sessionHistoryEntry.navigationAPIState;
    const first = navigation.addUpcomingTraverseMethodTracker('one', { info: 1 });
    const second = navigation.addUpcomingTraverseMethodTracker('two', { info: 2 });
    const ongoing = navigation.setupNavigateReloadMethodTracker(undefined, null);
    navigation.ongoingAPIMethodTracker = ongoing;
    expect([...navigation.upcomingTraverseAPIMethodTrackers.keys()]).toEqual(['one', 'two']);
    expect(first.pending).toBe(false);
    expect(first.serializedState).toBeNull();
    const result = navigation.getMethodTrackerResult(first, document.env);
    expect(result.committed).toBe(first.committedPromise);
    first.notifyCommittedToEntry(entry);
    first.resolveFinished();
    expect(entry.sessionHistoryEntry.navigationAPIState).toBe(state);
    expect([...navigation.upcomingTraverseAPIMethodTrackers.keys()]).toEqual(['two']);
    expect(navigation.upcomingTraverseAPIMethodTrackers.get('two')).toBe(second);
    expect(navigation.ongoingAPIMethodTracker).toBe(ongoing);
    expect(await settle(result.committed.backing, browser)).toBe(browser.window.navigation.currentEntry);
    expect(await settle(result.finished.backing, browser)).toBe(browser.window.navigation.currentEntry);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/base/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const navigable = document.getNodeNavigable()!;
  // Full navigation/event firing is unfinished; model acceptance only at that owner boundary.
  const accept = (tracker: NavigationAPIMethodTracker) => {
    tracker.pending = false;
    navigation.ongoingAPIMethodTracker = tracker;
  };
  const navigate = vi.spyOn(navigable, 'navigate').mockImplementation((_url, _source, options) => { accept(options!.apiMethodTracker!); });
  const reload = vi.spyOn(navigable, 'reload').mockImplementation((options) => { accept(options!.apiMethodTracker!); });
  return { browser, document, navigation, navigate, reload };
}

async function rejectionReasons(result: NavigationResultResult, browser: Browlet): Promise<unknown[]> {
  const results = await settle(Promise.allSettled([result.committed!, result.finished!]), browser);
  return results.map((item) => {
    expect(item.status).toBe('rejected');
    return item.status === 'rejected' ? item.reason as unknown : undefined;
  });
}

function settle<T>(promise: Promise<T>, browser: Browlet): Promise<T> {
  // Direct implementation fixtures settle outside an HTML task; drive the owning Window's queue.
  const checkpoint = runInHostTask(() => { getRelevantRealm(browser.document).agent.eventLoop.performMicrotaskCheckpoint(); });
  return Promise.all([promise, checkpoint]).then(([value]) => value);
}
