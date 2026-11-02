import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import { NavigationDestinationImpl } from '../../../src/browlet/browsing/navigation/api/navigation-destination';
import { NavigationTransitionImpl } from '../../../src/browlet/browsing/navigation/api/navigation-transition';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import type { NavigateEvent as BrowletNavigateEvent, NavigationTransition as BrowletNavigationTransition } from '../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('NavigateEvent construction', () => {
  it('converts its required dictionary, inherits Event flags, and defaults optional attributes', async () => {
    const { browser, start } = await fixture();
    start();
    expect(await browser.evaluate(() => {
      const destination = (navigation.transition! as BrowletNavigationTransition).to;
      const signal = new AbortController().signal;
      const event = new NavigateEvent('navigate', { destination, signal, bubbles: true, cancelable: true });
      return {
        type: event.type, event: event instanceof Event, navigateEvent: event instanceof NavigateEvent,
        bubbles: event.bubbles, cancelable: event.cancelable, trusted: event.isTrusted,
        navigationType: event.navigationType, destination: event.destination === destination,
        signal: event.signal === signal, canIntercept: event.canIntercept, userInitiated: event.userInitiated,
        hashChange: event.hashChange, formData: event.formData, downloadRequest: event.downloadRequest,
        info: event.info as unknown, visual: event.hasUAVisualTransition, source: event.sourceElement,
        tag: Object.prototype.toString.call(event),
      };
    })).toEqual({
      type: 'navigate', event: true, navigateEvent: true, bubbles: true, cancelable: true, trusted: false,
      navigationType: 'push', destination: true, signal: true, canIntercept: false, userInitiated: false,
      hashChange: false, formData: null, downloadRequest: null, info: undefined, visual: false, source: null,
      tag: '[object NavigateEvent]',
    });
  });

  it('retains interface-valued inputs and info identity while applying dictionary conversion', async () => {
    const { browser, start } = await fixture();
    start();
    expect(await browser.evaluate(() => {
      const destination = (navigation.transition! as BrowletNavigationTransition).to;
      const signal = new AbortController().signal;
      const formData = new FormData();
      const sourceElement = document.createElement('a');
      const info = { value: 1 };
      const event = new NavigateEvent('navigate', {
        destination, signal, navigationType: 'replace', canIntercept: true, userInitiated: true,
        hashChange: true, formData, downloadRequest: 'file.txt', info, hasUAVisualTransition: true, sourceElement,
      });
      const readonly = ['navigationType', 'destination', 'canIntercept', 'userInitiated', 'hashChange',
        'signal', 'formData', 'downloadRequest', 'info', 'hasUAVisualTransition', 'sourceElement']
        .every((name) => !Reflect.set(event, name, null));
      return {
        navigationType: event.navigationType, canIntercept: event.canIntercept, userInitiated: event.userInitiated,
        hashChange: event.hashChange, visual: event.hasUAVisualTransition, download: event.downloadRequest,
        identities: event.formData === formData && event.sourceElement === sourceElement && event.info === info,
        readonly,
      };
    })).toEqual({
      navigationType: 'replace', canIntercept: true, userInitiated: true, hashChange: true,
      visual: true, download: 'file.txt', identities: true, readonly: true,
    });
  });

  it('checks required members, interface brands, enum values, and getter receivers', async () => {
    const { browser, start } = await fixture();
    start();
    expect(await browser.evaluate(() => {
      const destination = (navigation.transition! as BrowletNavigationTransition).to;
      const signal = new AbortController().signal;
      const invalid = [undefined, {}, { destination }, { signal }, { destination: {}, signal },
        { destination, signal: {} }, { destination, signal, navigationType: 'invalid' }];
      const constructors = invalid.map((init) => {
        try { Reflect.construct(NavigateEvent, ['navigate', init]); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid receiver for the generated getter.
      const getter = Object.getOwnPropertyDescriptor(NavigateEvent.prototype, 'destination')!.get!;
      let receiver = false;
      try { Reflect.apply(getter, {}, []); } catch (error) { receiver = error instanceof TypeError; }
      return { constructors, receiver };
    })).toEqual({ constructors: Array<boolean>(7).fill(true), receiver: true });
  });

  it('preserves foreign destination/signal identity without manufacturing an internal controller', async () => {
    const { browser, start } = await fixture();
    const { platform } = start();
    const other = new Browlet({ route: () => '' });
    const event = new other.window.NavigateEvent('navigate', { destination: platform.destination, signal: platform.signal });
    expect(event).toBeInstanceOf(other.window.NavigateEvent);
    expect(event).not.toBeInstanceOf(browser.window.NavigateEvent);
    expect(event.destination).toBe(platform.destination);
    expect(event.signal).toBe(platform.signal);
    expect(unwrap<NavigateEventImpl>(event).abortController).toBeNull();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow a getter across realms.
    const getter = Object.getOwnPropertyDescriptor(browser.window.NavigateEvent.prototype, 'signal')!.get!;
    expect(Reflect.apply(getter, event, [])).toBe(platform.signal);
  });
});

describe('Navigation cancellation', () => {
  it('resets flags, aborts the signal, fires a trusted error, and rejects all unfinished results with one owner-realm error', async () => {
    const { browser, navigation, start } = await fixture();
    const active = start();
    const foreign = new Browlet({ route: () => '' });
    const order: string[] = [];
    const errors: ErrorEvent[] = [];
    active.platform.signal.addEventListener('abort', () => {
      order.push('signal');
      expect(navigation.ongoingNavigateEvent).toBeNull();
      expect(navigation.focusChangedDuringOngoingNavigation).toBe(false);
      expect(navigation.suppressNormalScrollRestorationDuringOngoingNavigation).toBe(false);
    });
    browser.window.navigation.onnavigateerror = (event) => { errors.push(event as ErrorEvent); order.push('error'); };
    browser.window.navigation.onnavigatesuccess = () => { order.push('success'); };
    navigation.abortOngoingNavigation();
    const reason: unknown = active.platform.signal.reason;
    expect(reason).toBeInstanceOf(browser.window.DOMException);
    expect(reason).not.toBeInstanceOf(foreign.window.DOMException);
    expect(reason).toMatchObject({ name: 'AbortError' });
    expect(order).toEqual(['signal', 'error']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(browser.window.ErrorEvent);
    expect(errors[0]).toMatchObject({ isTrusted: true, bubbles: false, cancelable: false, error: reason });
    expect(errors[0]!.target).toBe(browser.window.navigation);
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(navigation.transition).toBeNull();
    expect(active.event.defaultPrevented).toBe(false);
    expect(await settle(active.settled, browser)).toEqual(Array.from({ length: 4 }, () => ({ status: 'rejected', reason })));
  });

  it('internally cancels a noncancelable navigate event only while it is dispatching', async () => {
    const { browser, navigation, start } = await fixture();
    const active = start();
    browser.window.navigation.addEventListener('navigate', (event) => {
      expect(event.cancelable).toBe(false);
      navigation.abortOngoingNavigation();
      expect(event.defaultPrevented).toBe(true);
    });
    expect(navigation.dispatch(active.event)).toBe(false);
    expect(active.platform.defaultPrevented).toBe(true);
    await settle(active.settled, browser);
  });

  it('retains a supplied foreign error and leaves fulfilled commit promises intact', async () => {
    const { browser, navigation, start } = await fixture();
    const active = start();
    const other = new Browlet({ route: () => '' });
    const reason = new other.window.DOMException('superseded', 'AbortError');
    active.tracker.notifyCommittedToEntry(navigation.currentEntry!);
    active.transition.resolveCommitted();
    navigation.abortOngoingNavigation(reason);
    expect(active.platform.signal.reason).toBe(reason);
    expect(await settle(active.settled, browser)).toEqual([
      { status: 'fulfilled', value: browser.window.navigation.currentEntry }, { status: 'rejected', reason },
      { status: 'fulfilled', value: undefined }, { status: 'rejected', reason },
    ]);
  });

  it('delivers arbitrary rejection values without looking up an author-shadowed window.navigation', async () => {
    const { browser, navigation, start } = await fixture();
    const active = start();
    const events: ErrorEvent[] = [];
    browser.window.navigation.addEventListener('navigateerror', (event) => { events.push(event as ErrorEvent); });
    Object.defineProperty(browser.window, 'navigation', { value: {}, configurable: true });
    const reason = { toString: () => { throw new Error('unprintable'); } };
    active.event.abort(reason);
    expect(events[0]).toMatchObject({ error: reason, message: 'Unknown error', filename: '', lineno: 0, colno: 0 });
    expect(active.platform.signal.reason).toBe(reason);
    expect(navigation.ongoingNavigateEvent).toBeNull();
    expect(await settle(active.settled, browser)).toEqual(Array.from({ length: 4 }, () => ({ status: 'rejected', reason })));
  });

  it('still delivers navigateerror without an API tracker or intercepted transition', async () => {
    const { browser, navigation, start } = await fixture();
    const active = start();
    // A navigation not initiated through Navigation methods need not own either record.
    navigation.ongoingAPIMethodTracker = null;
    navigation.transition = null;
    let error: unknown;
    browser.window.navigation.onnavigateerror = (event) => { error = (event as ErrorEvent).error; };
    navigation.abortOngoingNavigation();
    expect(error).toBe(active.platform.signal.reason);
    expect(active.platform.signal.aborted).toBe(true);
  });

  it('preserves undefined rejection data while AbortSignal supplies its own default reason', async () => {
    const { browser, start } = await fixture();
    const active = start();
    const events: ErrorEvent[] = [];
    browser.window.navigation.addEventListener('navigateerror', (event) => { events.push(event as ErrorEvent); });
    active.event.abort(undefined);
    expect(events[0]!.error).toBeUndefined();
    expect(active.platform.signal.reason).toBeInstanceOf(browser.window.DOMException);
    expect(active.platform.signal.reason).toMatchObject({ name: 'AbortError' });
    expect(await settle(active.settled, browser)).toEqual(Array.from({ length: 4 }, () => ({ status: 'rejected', reason: undefined })));
  });

  it.each(['signal', 'error', 'diagnostics'] as const)('protects a new navigation started by %s callbacks from the old cleanup', async (boundary) => {
    const { browser, navigation, start } = await fixture();
    const active = start();
    let replacement: ReturnType<typeof start> | undefined;
    const reenter = () => { replacement = start(); };
    const reason = { toString: () => { if (boundary === 'diagnostics') reenter(); return 'failed'; } };
    if (boundary === 'signal') active.platform.signal.addEventListener('abort', reenter, { once: true });
    if (boundary === 'error') browser.window.navigation.addEventListener('navigateerror', reenter, { once: true });
    active.event.abort(reason);
    expect(replacement).toBeDefined();
    expect(navigation.ongoingNavigateEvent === replacement!.event, 'replacement event survives').toBe(true);
    expect(navigation.ongoingAPIMethodTracker === replacement!.tracker, 'replacement tracker survives').toBe(true);
    expect(navigation.transition === replacement!.transition, 'replacement transition survives').toBe(true);
    expect(replacement!.platform.signal.aborted).toBe(false);
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(true);
    expect(navigation.suppressNormalScrollRestorationDuringOngoingNavigation).toBe(true);
    expect(await settle(active.settled, browser)).toEqual(Array.from({ length: 4 }, () => ({ status: 'rejected', reason })));
    replacement!.tracker.notifyCommittedToEntry(navigation.currentEntry!);
    replacement!.tracker.resolveFinished();
    replacement!.transition.resolveCommitted();
    replacement!.transition.resolveFinished();
    expect((await settle(replacement!.settled, browser)).map((result) => result.status)).toEqual(Array<string>(4).fill('fulfilled'));
  });
});

describe('Navigable abortion notifications', () => {
  it('runs synchronously on the supplied owner loop without queuing another task', async () => {
    const { browser, document, navigation, navigable, start } = await fixture();
    const active = start();
    const loop = document.env.responsibleEventLoop;
    const order: string[] = [];
    active.platform.signal.addEventListener('abort', () => { order.push('signal'); });
    browser.window.navigation.addEventListener('navigateerror', () => { order.push('error'); });
    await runInHostTask(() => {
      document.env.queueTask('navigation-and-traversal', () => {
        navigable.informNavigationAPIAboutAbortingNavigation(loop);
        order.push('returned');
        expect(navigation.ongoingNavigateEvent).toBeNull();
        expect(loop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(0);
      });
      loop.runTaskTurn();
    });
    expect(order).toEqual(['signal', 'error', 'returned']);
    expect((await settle(active.settled, browser)).every((result) => result.status === 'rejected')).toBe(true);
  });

  it('keeps same-loop notification synchronous after a checkpoint clears the current task', async () => {
    const { browser, document, navigable, start } = await fixture();
    const active = start();
    const loop = document.env.responsibleEventLoop;
    await runInHostTask(() => {
      document.env.queueTask('navigation-and-traversal', () => {
        loop.queueMicrotask(() => {});
        loop.performMicrotaskCheckpoint();
        expect(loop.currentlyRunningTask).toBeNull();
        navigable.informNavigationAPIAboutAbortingNavigation(loop);
        expect(active.platform.signal.aborted).toBe(true);
        expect(loop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(0);
      });
      loop.runTaskTurn();
    });
    await settle(active.settled, browser);
  });

  it.each(['parallel', 'other-loop'] as const)('queues %s notification on the active Window and uses its current event at delivery', async (caller) => {
    const { browser, document, navigation, navigable, start } = await fixture();
    const original = start();
    const other = new Browlet({ route: () => '' });
    const callerLoop = caller === 'parallel' ? null : getRelevantRealm(other.window).agent.eventLoop;
    const loop = document.env.responsibleEventLoop;
    navigable.informNavigationAPIAboutAbortingNavigation(callerLoop);
    expect(original.platform.signal.aborted).toBe(false);
    const tasks = [...loop.getTaskQueue(navigationAndTraversalTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document === document).toBe(true);
    navigation.abortOngoingNavigation();
    const replacement = start();
    expect(replacement.platform.signal.aborted).toBe(false);
    await runInHostTask(() => { loop.runTaskTurn(); });
    expect(replacement.platform.signal.aborted).toBe(true);
    expect(navigation.ongoingNavigateEvent).toBeNull();
    await settle(Promise.all([original.settled, replacement.settled]), browser);
  });

  it.each(['signal', 'error'] as const)('also aborts a navigation started by the %s listener', async (boundary) => {
    const { browser, document, navigation, navigable, start } = await fixture();
    const first = start();
    let replacement: ReturnType<typeof start> | undefined;
    const restart = () => { replacement = start(); };
    if (boundary === 'signal') first.platform.signal.addEventListener('abort', restart, { once: true });
    else browser.window.navigation.addEventListener('navigateerror', restart, { once: true });
    const errors: unknown[] = [];
    browser.window.navigation.addEventListener('navigateerror', (event) => { errors.push((event as ErrorEvent).error); });
    const loop = document.env.responsibleEventLoop;
    await runInHostTask(() => {
      document.env.queueTask('navigation-and-traversal', () => { navigable.informNavigationAPIAboutAbortingNavigation(loop); });
      loop.runTaskTurn();
    });
    expect(replacement).toBeDefined();
    expect(first.platform.signal.aborted).toBe(true);
    expect(replacement!.platform.signal.aborted).toBe(true);
    expect(errors).toHaveLength(2);
    expect(errors[0]).not.toBe(errors[1]);
    expect(errors.every((error) => error instanceof browser.window.DOMException)).toBe(true);
    expect(navigation.ongoingNavigateEvent).toBeNull();
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(navigation.transition).toBeNull();
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(false);
    expect(navigation.suppressNormalScrollRestorationDuringOngoingNavigation).toBe(false);
    for (const results of await settle(Promise.all([first.settled, replacement!.settled]), browser)) {
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
    }
  });

  it('does nothing after the selected Navigation has no ongoing event', async () => {
    const { browser, document, navigable } = await fixture();
    const errors = vi.fn();
    browser.window.navigation.addEventListener('navigateerror', errors);
    const loop = document.env.responsibleEventLoop;
    await runInHostTask(() => {
      document.env.queueTask('navigation-and-traversal', () => {
        navigable.informNavigationAPIAboutAbortingNavigation(loop);
        navigable.informNavigationAPIAboutAbortingNavigation(loop);
      });
      loop.runTaskTurn();
    });
    expect(errors).not.toHaveBeenCalled();
    expect(loop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(0);
  });

  it('keeps queued notification gated by its associated Document activity', async () => {
    const { browser, document, navigable, start } = await fixture();
    const active = start();
    const loop = document.env.responsibleEventLoop;
    navigable.informNavigationAPIAboutAbortingNavigation(null);
    const context = document.browsingContext;
    document.browsingContext = null;
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(false); });
    expect(active.platform.signal.aborted).toBe(false);
    expect(loop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(1);
    document.browsingContext = context;
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(active.platform.signal.aborted).toBe(true);
    await settle(active.settled, browser);
  });
});

describe('Child-destruction Navigation notifications', () => {
  it('rejects each pending traversal with its own owner-realm AbortError and leaves other Navigations alone', async () => {
    const { browser, document, navigation, navigable } = await fixture();
    const other = await fixture();
    const first = navigation.addUpcomingTraverseMethodTracker('first', undefined);
    const second = navigation.addUpcomingTraverseMethodTracker('second', undefined);
    const untouched = other.navigation.addUpcomingTraverseMethodTracker('first', undefined);
    const results = Promise.allSettled([
      first.committedPromise.backing, first.finishedPromise.backing, second.committedPromise.backing, second.finishedPromise.backing,
    ]);
    const loop = document.env.responsibleEventLoop;
    await runInHostTask(() => {
      document.env.queueTask('navigation-and-traversal', () => { navigable.informNavigationAPIAboutChildNavigableDestruction(loop); });
      loop.runTaskTurn();
    });
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
    expect(other.navigation.upcomingTraverseAPIMethodTrackers.get('first') === untouched).toBe(true);
    const settled = await settle(results, browser);
    expect(settled.map((result) => result.status)).toEqual(Array<string>(4).fill('rejected'));
    const reasons = settled.map((result) => result.status === 'rejected' ? result.reason as unknown : undefined);
    expect(reasons[0]).toBe(reasons[1]);
    expect(reasons[2]).toBe(reasons[3]);
    expect(reasons[0]).not.toBe(reasons[2]);
    expect(reasons.every((reason) => reason instanceof browser.window.DOMException)).toBe(true);
    expect(reasons.every((reason) => !(reason instanceof other.browser.window.DOMException))).toBe(true);
    expect(reasons[0]).toMatchObject({ name: 'AbortError' });
    expect(reasons[2]).toMatchObject({ name: 'AbortError' });
  });

  it('takes the pending-traversal snapshot after abortion callbacks have updated it', async () => {
    const { browser, document, navigation, navigable, start } = await fixture();
    const active = start();
    const completed = navigation.addUpcomingTraverseMethodTracker('completed', undefined);
    const completedResults = Promise.allSettled([completed.committedPromise.backing, completed.finishedPromise.backing]);
    let addedResults: Promise<PromiseSettledResult<unknown>[]> | undefined;
    browser.window.navigation.addEventListener('navigateerror', () => {
      completed.notifyCommittedToEntry(navigation.currentEntry!);
      completed.resolveFinished();
      const added = navigation.addUpcomingTraverseMethodTracker('added', undefined);
      addedResults = Promise.allSettled([added.committedPromise.backing, added.finishedPromise.backing]);
    }, { once: true });
    const loop = document.env.responsibleEventLoop;
    await runInHostTask(() => {
      document.env.queueTask('navigation-and-traversal', () => { navigable.informNavigationAPIAboutChildNavigableDestruction(loop); });
      loop.runTaskTurn();
    });
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
    expect((await settle(completedResults, browser)).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await settle(addedResults!, browser)).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    await settle(active.settled, browser);
  });

  it('rejects pending traversals immediately when ongoing-event abortion must be queued', async () => {
    const { browser, document, navigation, navigable, start } = await fixture();
    const active = start();
    const pending = navigation.addUpcomingTraverseMethodTracker('pending', undefined);
    const results = Promise.allSettled([pending.committedPromise.backing, pending.finishedPromise.backing]);
    const errors = vi.fn();
    browser.window.navigation.addEventListener('navigateerror', errors);
    navigable.informNavigationAPIAboutChildNavigableDestruction(null);
    expect(navigation.upcomingTraverseAPIMethodTrackers.size).toBe(0);
    expect(active.platform.signal.aborted).toBe(false);
    expect(errors).not.toHaveBeenCalled();
    const loop = document.env.responsibleEventLoop;
    expect(loop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(1);
    await runInHostTask(() => { loop.runTaskTurn(); });
    expect(active.platform.signal.aborted).toBe(true);
    expect(errors).toHaveBeenCalledOnce();
    expect((await settle(results, browser)).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    await settle(active.settled, browser);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  // Navigate-event production is unfinished. Supply its objects/acceptance at that boundary;
  // cancellation, event dispatch, promise settlement, and projection use their real owners.
  vi.spyOn(document.getNodeNavigable()!, 'navigate').mockImplementation((_url, _source, options) => {
    const tracker = options!.apiMethodTracker!;
    tracker.pending = false;
    navigation.ongoingAPIMethodTracker = tracker;
  });
  const start = () => {
    const result = browser.window.navigation.navigate('/next');
    const tracker = navigation.ongoingAPIMethodTracker!;
    const destination = new NavigationDestinationImpl(
      document.env.parseHTMLURL('/next')!, null, document.env.serializeForStorage(undefined), true, document.env,
    );
    const transition = new NavigationTransitionImpl('push', navigation.currentEntry!, destination, document.env);
    navigation.transition = transition;
    const controller = document.env.createAbortController();
    const event = document.env.createEvent(NavigateEventImpl) as NavigateEventImpl;
    event.type = 'navigate';
    event.destination = destination;
    event.signal = controller.signal;
    event.abortController = controller;
    navigation.ongoingNavigateEvent = event;
    navigation.focusChangedDuringOngoingNavigation = true;
    navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    const platform = project(event) as BrowletNavigateEvent;
    const platformTransition = browser.window.navigation.transition!;
    const settled = Promise.allSettled([result.committed!, result.finished!, platformTransition.committed, platformTransition.finished]);
    return { result, tracker, event, platform, transition, settled };
  };
  return { browser, document, navigation, navigable: document.getNodeNavigable()!, start };
}

function settle<T>(promise: Promise<T>, browser: Browlet): Promise<T> {
  const checkpoint = runInHostTask(() => { getRelevantRealm(browser.document).agent.eventLoop.performMicrotaskCheckpoint(); });
  return Promise.all([promise, checkpoint]).then(([value]) => value);
}
