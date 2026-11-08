import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { HistoryStepResult } from '../../../src/browlet/browsing/navigation/navigable';
import type { SessionHistoryTraversalSteps } from '../../../src/browlet/browsing/navigation/session-history-traversal-queue';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import type { NavigationResultResult } from '../../../src/browlet/platform';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { internalType } from '../../../src/infra/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigation traversal preparation', () => {
  it('resolves the current entry without firing events, taking a snapshot, or registering a tracker', async () => {
    const { browser, navigation: ownerNavigation, activation, queue } = await fixture();
    expect(await browser.evaluate(async () => {
      const entry = navigation.currentEntry!;
      const events: string[] = [];
      navigation.onnavigate = () => { events.push('navigate'); };
      navigation.oncurrententrychange = () => { events.push('currententrychange'); };
      const result = navigation.traverseTo(entry.key, { info: document });
      const [committed, finished] = await Promise.all([result.committed!, result.finished!]);
      return { sameEntry: committed === entry && finished === entry, distinct: result.committed !== result.finished, events };
    })).toEqual({ sameEntry: true, distinct: true, events: [] });
    expect(ownerNavigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
    expect(activation).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it('keeps no-op promises in the borrowed method realm and projects the receiver entry', async () => {
    const { browser } = await fixture();
    const other = new Browlet({ route: () => '' });
    const receiver = browser.window.navigation;
    const methodRealm = getRelevantRealm(other.window);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow the real operation with an explicit receiver.
    const result = Reflect.apply(other.window.Navigation.prototype.traverseTo, receiver, [receiver.currentEntry!.key]);
    expect(result.committed).toBeInstanceOf(methodRealm.NativePromise);
    expect(result.finished).toBeInstanceOf(methodRealm.NativePromise);
    expect(Object.getPrototypeOf(result)).toBe(getRelevantRealm(browser.window).Object.prototype);
    expect(await settle(Promise.all([result.committed!, result.finished!]), unwrap<DocumentImpl>(other.document).env))
      .toEqual([receiver.currentEntry, receiver.currentEntry]);
  });

  it.each(['traverseTo', 'back', 'forward'] as const)('rejects %s with no initialized entries', async (method) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async (method) => {
      const result = method === 'traverseTo' ? navigation.traverseTo('missing') : navigation[method]();
      const settled = await Promise.allSettled([result.committed!, result.finished!]);
      return settled.map((item) => item.status === 'rejected' ? (item.reason as DOMException).name : null);
    }, method)).toEqual(['InvalidStateError', 'InvalidStateError']);
  });

  it.each(['unknown', 'back-boundary', 'forward-boundary'] as const)('rejects %s without scheduling traversal', async (reason) => {
    const { browser, navigation, queue, document, entries } = await fixture();
    if (reason === 'back-boundary') navigation.currentEntryIndex = 0;
    if (reason === 'forward-boundary') navigation.currentEntryIndex = entries.length - 1;
    const result = reason === 'unknown' ? browser.window.navigation.traverseTo('missing')
      : reason === 'back-boundary' ? browser.window.navigation.back() : browser.window.navigation.forward();
    const errors = await rejections(result, document.env);
    expect(errors[0]).toMatchObject({ name: 'InvalidStateError' });
    expect(errors[0]).toBe(errors[1]);
    expect(queue).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'unloading'] as const)('checks %s before no-op success or pending-request reuse', async (reason) => {
    const { browser, navigation, document, entries, queue } = await fixture();
    const platform = browser.window.navigation;
    const key = entries[0]!.navigationAPIKey;
    const tracker = navigation.addUpcomingTraverseMethodTracker(key, 'original');
    if (reason === 'inactive') document.browsingContext = null;
    else document.unloadCounter = 1;
    for (const destination of [key, entries[1]!.navigationAPIKey]) {
      const result = platform.traverseTo(destination);
      expect(result.committed).not.toBe(tracker.committedPromise.backing);
      expect((await rejections(result, document.env))[0]).toMatchObject({ name: 'InvalidStateError' });
    }
    expect(navigation.upcomingTraverseAPIMethodTrackers.get(key)).toBe(tracker);
    expect(queue).not.toHaveBeenCalled();
  });

  it('converts a DOMString key and options before selecting the destination, without serializing info', async () => {
    const { browser, navigation: ownerNavigation, entries } = await fixture();
    // A non-UUID fixture key makes preservation of a lone surrogate observable.
    entries[0]!.navigationAPIKey = '\uD800';
    expect(await browser.evaluate(() => {
      const order: string[] = [];
      const key = { toString() { order.push('key'); return '\uD800'; } };
      const options = { get info() { order.push('info'); return { get unobserved() { throw new Error('must not serialize'); } }; } };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise Web IDL coercion with an explicit receiver.
      Reflect.apply(navigation.traverseTo, navigation, [key, options]);
      return order;
    })).toEqual(['key', 'info']);
    expect(ownerNavigation.upcomingTraverseAPIMethodTrackers.has('\uD800')).toBe(true);
  });

  it('throws conversion failures synchronously', async () => {
    const { browser, queue } = await fixture();
    expect(await browser.evaluate(() => {
      const errors = [[], [Symbol('key')], ['missing', { get info() { throw new TypeError('info'); } }]].map((args) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid inputs still use the projected operation.
        try { Reflect.apply(navigation.traverseTo, navigation, args); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return { errors, lengths: [navigation.traverseTo.length, navigation.back.length, navigation.forward.length] };
    })).toEqual({ errors: [true, true, true], lengths: [1, 0, 0] });
    expect(queue).not.toHaveBeenCalled();
  });

  it('selects back and forward from Navigation entries and does not call an overridden traverseTo', async () => {
    const { browser, navigation: ownerNavigation, entries, queue } = await fixture();
    await browser.evaluate(() => {
      navigation.traverseTo = () => { throw new Error('author override'); };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Null converts to an empty options dictionary.
      Reflect.apply(navigation.back, navigation, [null]);
      navigation.forward();
    });
    expect([...ownerNavigation.upcomingTraverseAPIMethodTrackers.keys()])
      .toEqual([entries[0]!.navigationAPIKey, entries[2]!.navigationAPIKey]);
    expect(queue).toHaveBeenCalledTimes(2);
    expect(ownerNavigation.upcomingTraverseAPIMethodTrackers.get(entries[0]!.navigationAPIKey)!.info).toBeUndefined();
  });

  it('reuses pending promises and first info while still converting later options', async () => {
    const { browser, navigation, entries, queue, activation } = await fixture();
    const firstInfo = {};
    const key = entries[0]!.navigationAPIKey;
    const first = browser.window.navigation.traverseTo(key, { info: firstInfo });
    let reads = 0;
    const second = browser.window.navigation.back({ get info() { reads++; return 'later'; } });
    expect(second).not.toBe(first);
    expect(second.committed).toBe(first.committed);
    expect(second.finished).toBe(first.finished);
    expect(navigation.upcomingTraverseAPIMethodTrackers.get(key)!.info).toBe(firstInfo);
    expect(reads).toBe(1);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(activation).toHaveBeenCalledTimes(1);
  });

  it('resolves the current entry before considering an older upcoming request for that key', async () => {
    const { browser, navigation, document, entries, queue } = await fixture();
    const key = entries[1]!.navigationAPIKey;
    const tracker = navigation.addUpcomingTraverseMethodTracker(key, 'older request');
    const result = browser.window.navigation.traverseTo(key);
    expect(result.committed).not.toBe(tracker.committedPromise.backing);
    expect(await settle(result.finished!, document.env)).toBe(browser.window.navigation.currentEntry);
    expect(navigation.upcomingTraverseAPIMethodTrackers.get(key)).toBe(tracker);
    expect(queue).not.toHaveBeenCalled();
  });

  it('keeps borrowed early failures in the method realm and tracked requests in the receiver realm', async () => {
    const { browser, document, navigation, entries } = await fixture();
    const other = new Browlet({ route: () => '' });
    const methodEnv = unwrap<DocumentImpl>(other.document).env;
    const receiver = browser.window.navigation;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow the projected operation.
    const run = (key: string) => Reflect.apply(other.window.Navigation.prototype.traverseTo, receiver, [key]);
    const early = run('missing');
    expect(early.committed).toBeInstanceOf(methodEnv.realm.NativePromise);
    expect((await rejections(early, methodEnv))[0]).toBeInstanceOf(other.window.DOMException);
    const tracked = run(entries[0]!.navigationAPIKey);
    expect(tracked.committed).toBeInstanceOf(document.env.realm.NativePromise);
    expect(tracked.finished).toBeInstanceOf(document.env.realm.NativePromise);
    expect(Object.getPrototypeOf(tracked)).toBe(document.env.realm.Object.prototype);
    expect(tracked.committed).toBe(navigation.upcomingTraverseAPIMethodTrackers.get(entries[0]!.navigationAPIKey)!.committedPromise.backing);
  });

  it.each(['activation', 'scheduling'] as const)('does not leave a pending request when %s fails before acceptance', async (owner) => {
    const { browser, document, activation, queue, navigation } = await fixture();
    const error = owner === 'activation' ? 'Activation clock failed' : 'Host scheduling failed';
    if (owner === 'activation') {
      activation.mockRestore();
      vi.spyOn(document.env, 'currentHighResolutionTime').mockImplementation(() => { throw new Error(error); });
    } else {
      queue.mockRestore();
      vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation(() => { throw new Error(error); });
    }
    expect(() => browser.window.navigation.back()).toThrow(error);
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
  });
});

describe('queued Navigation traversal work', () => {
  it('reaches the unfinished population after real queued cancellation checks', async () => {
    const { browser, document, queue, apply } = await fixture();
    const turns: (() => void)[] = [];
    vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
    queue.mockRestore();
    apply.mockRestore();
    browser.window.navigation.back();
    expect(turns).toHaveLength(1);
    turns.shift()!();
    await expect.poll(() => turns.length).toBe(1);
    expect(turns.shift()!).toThrow('History-step population and activation is not implemented');
  });

  it('delivers cancellation from actual parallel queue execution to the Navigation owner', async () => {
    const { browser, document, queue, apply, navigation } = await fixture();
    queue.mockRestore();
    apply.mockReturnValue(document.env.userAgent.HostPromise.resolve('canceled-by-beforeunload', internalType<HistoryStepResult>()));
    const errors = await rejections(browser.window.navigation.back(), document.env);
    expect(apply).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).toMatchObject({ name: 'AbortError' });
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
  });

  it('rejects both public promises after a real beforeunload dismissal', async () => {
    const { browser, document, queue, apply, navigation, entries } = await fixture();
    queue.mockRestore();
    apply.mockRestore();
    const state = new DocumentState();
    state.origin = document.origin;
    state.everPopulated = true;
    entries[0]!.documentState = state;
    const userAgent = document.env.userAgent;
    document.getRelevantGlobalObject()!.lastActivationTimestamp = -Infinity;
    browser.window.addEventListener('beforeunload', (event) => { event.preventDefault(); });
    const navigate = vi.fn();
    browser.window.navigation.addEventListener('navigate', navigate);
    vi.spyOn(userAgent, 'shouldShowBeforeUnloadPrompt').mockReturnValue(true);
    vi.spyOn(userAgent, 'webDriverBiDiUserPromptOpened').mockReturnValue('dismiss');

    const errors = await rejections(browser.window.navigation.back(), document.env);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(browser.window.DOMException);
    expect(errors[0]).toMatchObject({ name: 'AbortError' });
    expect(errors[0]).toBe(errors[1]);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
  });

  it('looks up current history at execution, while retaining the earlier source snapshot', async () => {
    const { browser, document, entries, traversable, steps, apply, navigable, activation } = await fixture();
    document.policyContainer.referrerPolicy = 'no-referrer';
    activation.mockReturnValue(true);
    browser.window.navigation.back();
    const previous = entries[0]!;
    const replacement = Object.assign(document.env.createSessionHistoryEntry(previous.url, previous.documentState), previous);
    replacement.step = 17;
    traversable.sessionHistoryEntries[0] = replacement;
    document.policyContainer.referrerPolicy = 'origin';
    activation.mockReturnValue(false);
    steps[0]!();
    const [step, snapshot, initiator, involvement] = apply.mock.calls[0]!;
    expect(step).toBe(17);
    expect(snapshot?.hasTransientActivation).toBe(true);
    expect(snapshot?.fetchClient).toBe(document.env);
    expect(snapshot?.sourcePolicyContainer.referrerPolicy).toBe('no-referrer');
    expect(initiator).toBe(navigable);
    expect(involvement).toBe('none');
  });

  it.each(['missing', 'already-active', 'beforeunload', 'disallowed'] as const)('queues the %s failure in the receiver realm and cleans up its tracker', async (cause) => {
    const fixtureState = await fixture();
    const { browser, document, navigation, entries, steps, apply } = fixtureState;
    const key = entries[0]!.navigationAPIKey;
    const other = new Browlet({ route: () => '' });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Queued failures belong to the receiver even for a borrowed method.
    const result = Reflect.apply(other.window.Navigation.prototype.back, browser.window.navigation, []);
    const settled = rejections(result, document.env);
    setFailure(fixtureState, cause);
    await steps[0]!()?.backing;
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(1);
    expect(document.env.responsibleEventLoop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(1);
    await drain(document.env);
    const errors = await settled;
    expect(errors[0]).toBeInstanceOf(browser.window.DOMException);
    expect(errors[0]).toMatchObject({ name: cause === 'beforeunload' ? 'AbortError' : cause === 'disallowed' ? 'SecurityError' : 'InvalidStateError' });
    expect(errors[0]).toBe(errors[1]);
    expect(navigation.upcomingTraverseAPIMethodTrackers.has(key)).toBe(false);
    if (cause === 'missing' || cause === 'already-active') expect(apply).not.toHaveBeenCalled();
  });

  it.each(['applied', 'canceled-by-navigate'] as const)('leaves %s settlement to the navigation/event owner', async (outcome) => {
    const { browser, navigation, document, entries, steps, apply } = await fixture();
    const result = browser.window.navigation.back();
    apply.mockReturnValue(document.env.userAgent.HostPromise.resolve(outcome, internalType<HistoryStepResult>()));
    let settled = false;
    void result.committed!.then(() => { settled = true; });
    void result.finished!.then(() => { settled = true; });
    await steps[0]!()?.backing;
    await drain(document.env);
    expect(settled).toBe(false);
    expect(navigation.upcomingTraverseAPIMethodTrackers.has(entries[0]!.navigationAPIKey)).toBe(true);
  });

  it('requires history application to enter through the owning traversal queue', async () => {
    const { browser, steps, apply } = await fixture();
    apply.mockRestore();
    browser.window.navigation.back();
    await expect(steps[0]!()?.backing).rejects.toThrow('History application must begin in its session history traversal queue');
  });

  it.each(['missing', 'already-active', 'beforeunload', 'disallowed'] as const)('does not let a delayed %s rejection remove a newer tracker for the same key', async (cause) => {
    const fixtureState = await fixture();
    const { browser, navigation, document, entries, steps } = fixtureState;
    const key = entries[0]!.navigationAPIKey;
    const result = browser.window.navigation.back();
    const errors = rejections(result, document.env);
    setFailure(fixtureState, cause);
    await steps[0]!()?.backing;
    const original = navigation.upcomingTraverseAPIMethodTrackers.get(key)!;
    const reason = new Error('earlier cancellation');
    original.rejectFinished(reason);
    const replacement = navigation.addUpcomingTraverseMethodTracker(key, 'new request');
    await drain(document.env);
    expect(await errors).toEqual([reason, reason]);
    expect(navigation.upcomingTraverseAPIMethodTrackers.get(key) === replacement).toBe(true);
  });

  it.each([false, true])('handles a delayed failure when its tracker is ongoing (%s) instead of upcoming', async (ongoing) => {
    const fixtureState = await fixture();
    const { browser, navigation, document, entries, steps } = fixtureState;
    const key = entries[0]!.navigationAPIKey;
    const result = browser.window.navigation.back();
    const errors = rejections(result, document.env);
    const tracker = navigation.upcomingTraverseAPIMethodTrackers.get(key)!;
    setFailure(fixtureState, 'beforeunload');
    await steps[0]!()?.backing;
    if (ongoing) {
      navigation.upcomingTraverseAPIMethodTrackers.delete(key);
      navigation.ongoingAPIMethodTracker = tracker;
    } else {
      tracker.rejectFinished(new Error('already canceled'));
    }
    await drain(document.env);
    expect((await errors)[0]).toMatchObject(ongoing ? { name: 'AbortError' } : { message: 'already canceled' });
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const window = document.getRelevantGlobalObject()!;
  const navigation = window.navigation;
  const navigable = document.getNodeNavigable()!;
  const traversable = navigable.traversable;
  const current = navigable.activeSessionHistoryEntry;
  const entries = [document.env.createSessionHistoryEntry(document.url, current.documentState), current,
    document.env.createSessionHistoryEntry(document.url, current.documentState)];
  for (const [i, entry] of entries.entries()) entry.step = i;
  // Full history application is unfinished; provide its committed entry records at the owner boundary.
  traversable.sessionHistoryEntries = entries;
  traversable.currentSessionHistoryStep = 1;
  navigation.entryList = [];
  navigation.currentEntryIndex = -1;
  navigation.initializeEntriesForNewDocument(entries, current);
  const activation = vi.spyOn(window, 'hasTransientActivation').mockReturnValue(false);
  const steps: SessionHistoryTraversalSteps[] = [];
  const queue = vi.spyOn(traversable, 'appendSessionHistoryTraversalSteps').mockImplementation((step) => { steps.push(step); });
  const apply = vi.spyOn(traversable, 'applyTraverseHistoryStep')
    .mockReturnValue(document.env.userAgent.HostPromise.resolve('applied', internalType<HistoryStepResult>()));
  return { browser, document, navigation, navigable, traversable, entries, activation, steps, queue, apply };
}

function setFailure(state: Awaited<ReturnType<typeof fixture>>, cause: 'missing' | 'already-active' | 'beforeunload' | 'disallowed'): void {
  if (cause === 'missing') {
    state.traversable.sessionHistoryEntries.shift();
  } else if (cause === 'already-active') {
    state.navigable.activeSessionHistoryEntry = state.entries[0]!;
  } else {
    state.apply.mockReturnValue(state.document.env.userAgent.HostPromise.resolve(
      cause === 'beforeunload' ? 'canceled-by-beforeunload' : 'initiator-disallowed', internalType<HistoryStepResult>(),
    ));
  }
}

function drain(env: BrowletEnvironment): Promise<void> {
  return runInHostTask(() => {
    env.responsibleEventLoop.runTaskTurn();
    env.responsibleEventLoop.performMicrotaskCheckpoint();
  });
}

function settle<T>(promise: Promise<T>, env: BrowletEnvironment): Promise<T> {
  return Promise.all([promise, drain(env)]).then(([value]) => value);
}

async function rejections(result: NavigationResultResult, env: BrowletEnvironment): Promise<unknown[]> {
  const results = await settle(Promise.allSettled([result.committed!, result.finished!]), env);
  return results.map((item) => {
    expect(item.status).toBe('rejected');
    return item.status === 'rejected' ? item.reason as unknown : undefined;
  });
}
