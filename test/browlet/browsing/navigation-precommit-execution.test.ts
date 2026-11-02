import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { PageEvaluation } from '../../../src/browlet/automation/evaluation';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation-api/navigate-event';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigate-event precommit execution', () => {
  it('runs all handlers after dispatch and preserves Web IDL rejection timing and the original reason', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(async () => {
      const order: string[] = [];
      const reason = new Error('precommit failed');
      let captured!: NavigateEvent;
      let controller!: NavigationPrecommitController;
      let transition!: NavigationTransition;
      let observations: unknown;
      const failed = new Promise<void>((resolve) => {
        navigation.addEventListener('navigateerror', (event) => {
          order.push('error');
          observations = { error: event.error === reason, signal: captured.signal.reason === reason };
          resolve();
        }, { once: true });
      });
      navigation.addEventListener('navigate', (event) => {
        captured = event;
        order.push('navigate');
        event.signal.addEventListener('abort', () => { order.push('abort'); });
        event.intercept({
          precommitHandler: function(this: unknown, value) {
            'use strict';
            controller = value;
            order.push('first');
            if (this !== undefined) throw new Error('Expected the specified undefined callback receiver');
            if (!(value instanceof NavigationPrecommitController)) throw new Error('Wrong controller realm');
            transition = navigation.transition!;
            queueMicrotask(() => { order.push('queued in first'); });
            throw reason;
          },
        });
        event.intercept({
          precommitHandler(value) {
            order.push(value === controller ? 'second' : 'different controller');
          }, handler() { order.push('postcommit'); },
        });
        order.push('listener end');
      }, { once: true });
      history.pushState({ classic: true }, '', '#target');
      order.push('returned');
      queueMicrotask(() => { order.push('queued after request'); });
      await failed;
      const outcomes = await Promise.allSettled([transition.committed, transition.finished]);
      return {
        order, observations, rejections: outcomes.map((value) => value.status === 'rejected' && value.reason === reason),
        current: location.href, state: history.state as unknown, transition: navigation.transition,
      };
    })).toEqual({
      order: ['navigate', 'listener end', 'first', 'second', 'returned', 'queued in first', 'queued after request', 'abort', 'error'],
      observations: { error: true, signal: true }, rejections: [true, true],
      current: 'https://example.test/current', state: null, transition: null,
    });
  });

  it('hands immediate fulfillment to commit without an aggregate Promise reaction', async () => {
    const { browser, realm } = await fixture();
    const order: string[] = [];
    Reflect.set(realm.globalObject, 'precommitOrder', order);
    // Observe the real handoff while URL/history commit remains unfinished.
    const commit = vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => { order.push('commit'); });
    await browser.evaluate(() => {
      const order = Reflect.get(globalThis, 'precommitOrder') as string[];
      navigation.addEventListener('navigate', (event) => {
        event.intercept({
          precommitHandler() {
            order.push('handler');
            queueMicrotask(() => { order.push('queued in handler'); });
          },
        });
      }, { once: true });
      history.pushState(null, '', '#target');
      order.push('returned');
      queueMicrotask(() => { order.push('queued after request'); });
    });
    await expect.poll(() => commit.mock.calls.length).toBe(1);
    expect(commit).toHaveBeenCalledWith(null);
    expect(order).toEqual(['handler', 'returned', 'queued in handler', 'commit', 'queued after request']);
  });

  it('waits for every handler and delivers one controller before handing the captured tracker to commit', async () => {
    const { browser, document, navigation: sourceNavigation, realm } = await fixture();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    await browser.exposeFunction('firstPrecommit', () => first.promise);
    await browser.exposeFunction('secondPrecommit', () => second.promise);
    const commit = vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => {});
    const controllers: unknown[] = [];
    Reflect.set(realm.globalObject, 'precommitControllers', controllers);
    await browser.evaluate(() => {
      const controllers = Reflect.get(globalThis, 'precommitControllers') as NavigationPrecommitController[];
      navigation.addEventListener('navigate', (event) => {
        event.intercept({
          precommitHandler(controller) {
            controllers.push(controller);
            return (Reflect.get(globalThis, 'firstPrecommit') as () => Promise<void>)();
          },
        });
        event.intercept({
          precommitHandler(controller) {
            controllers.push(controller);
            return (Reflect.get(globalThis, 'secondPrecommit') as () => Promise<void>)();
          },
        });
      }, { once: true });
    });
    const tracker = sourceNavigation.setupNavigateReloadMethodTracker('info', null);
    expect(sourceNavigation.firePushReplaceReloadNavigateEvent('push', document.url, true, { apiMethodTracker: tracker })).toBe(false);
    expect(controllers).toHaveLength(2);
    expect(controllers[0]).toBe(controllers[1]);
    expect(controllers[0]).toBeInstanceOf(browser.window.NavigationPrecommitController);
    expect(commit).not.toHaveBeenCalled();
    second.resolve();
    // A later host turn provides time for fulfillment without driving an HTML checkpoint.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(commit).not.toHaveBeenCalled();
    first.resolve();
    await expect.poll(() => commit.mock.calls.length).toBe(1);
    expect(commit).toHaveBeenCalledWith(tracker);
  });

  it('processes only the first rejection when multiple handlers fail', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(async () => {
      const failures: unknown[] = [];
      navigation.addEventListener('navigateerror', (event) => { failures.push((event.error as Error).message); });
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ precommitHandler: () => Promise.reject(new Error('first')) });
        event.intercept({ precommitHandler: () => Promise.reject(new Error('second')) });
      }, { once: true });
      history.pushState(null, '', '#target');
      const transition = navigation.transition!;
      const outcomes = await Promise.allSettled([transition.committed, transition.finished]);
      return { failures, outcomes: outcomes.map((outcome) => outcome.status === 'rejected' ? (outcome.reason as Error).message : 'fulfilled') };
    })).toEqual({ failures: ['first'], outcomes: ['first', 'first'] });
  });

  it('delivers the owner controller to another Window in the same Agent and redirects the retained destination', async () => {
    const { browser, realm, navigation: sourceNavigation } = await fixture();
    const siblingRealm = getRelevantRealm(createSiblingWindow(browser));
    const otherDocument = siblingRealm.env.getAssociatedDocument()!;
    // Auxiliary/iframe creation is unfinished; provide its existing activity relationship.
    otherDocument.browsingContext = new BrowsingContext(siblingRealm.windowProxy);
    const traversable = new TopLevelTraversable(createDocumentState(otherDocument));
    const foreign = { realm: siblingRealm, browser: new PageEvaluation(traversable) };
    expect(foreign.realm.agent).toBe(realm.agent);
    const result = { owner: false, foreign: true, receiver: false, error: undefined as unknown, path: '', state: null as unknown };
    Reflect.set(foreign.realm.globalObject, 'ownerNavigation', browser.window.navigation);
    Reflect.set(foreign.realm.globalObject, 'ownerController', browser.window.NavigationPrecommitController);
    Reflect.set(foreign.realm.globalObject, 'precommitResult', result);
    await foreign.browser.evaluate(() => {
      const owner = Reflect.get(globalThis, 'ownerNavigation') as Navigation;
      const constructor = Reflect.get(globalThis, 'ownerController') as typeof NavigationPrecommitController;
      const result = Reflect.get(globalThis, 'precommitResult') as {
        owner: boolean; foreign: boolean; receiver: boolean; error: unknown; path: string; state: unknown;
      };
      owner.addEventListener('navigateerror', (event) => { result.error = (event.error as Error).message; });
      owner.addEventListener('navigate', (event) => {
        event.intercept({
          precommitHandler: function(this: unknown, controller) {
            'use strict';
            result.owner = controller instanceof constructor;
            result.foreign = controller instanceof NavigationPrecommitController;
            result.receiver = this === undefined;
            controller.redirect('redirected', { state: { redirected: true }, history: 'replace' });
            result.path = event.destination.url;
            result.state = event.destination.getState();
            return Promise.reject(new Error('foreign callback failure'));
          },
        });
      }, { once: true });
    });
    await browser.evaluate(() => { history.pushState(null, '', '#target'); });
    expect(result).toMatchObject({ owner: true, foreign: false, receiver: true, path: 'https://example.test/redirected' });
    await expect.poll(() => result.error).toBe('foreign callback failure');
    expect(result).toEqual({
      owner: true, foreign: false, receiver: true, error: 'foreign callback failure',
      path: 'https://example.test/redirected', state: { redirected: true },
    });
    expect(sourceNavigation.ongoingNavigateEvent).toBeNull();
    expect(browser.window.location.href).toBe('https://example.test/current');
  });

  it.each(['fulfillment', 'rejection'] as const)('delivers %s through the supported host bridge while idle', async (outcome) => {
    const context = await pendingFixture();
    const commit = outcome === 'fulfillment' ? vi.spyOn(NavigateEventImpl.prototype, 'commit').mockImplementation(() => {}) : undefined;
    const event = await startPending(context);
    const reason = 'idle precommit rejection';
    if (outcome === 'fulfillment') context.pending.resolve();
    else context.pending.reject(reason);
    // Only inspect host-visible data; evaluation or a forced checkpoint would hide a missed wake-up.
    await expect.poll(() => commit?.mock.calls.length ?? context.errors.length, { timeout: 1500 }).toBe(1);
    if (outcome === 'rejection') {
      expect(context.errors).toEqual([reason]);
      expect(event.signal.aborted).toBe(true);
      expect(event.signal.reason).toBe(reason);
      expect(context.navigation.ongoingAPIMethodTracker).toBeNull();
      expect(context.navigation.transition).toBeNull();
    }
    expect(context.browser.window.location.href).toBe('https://example.test/current');
  });

  it.each(['fulfillment', 'rejection'] as const)('ignores late %s after a replacement navigation aborts the original', async (outcome) => {
    const context = await pendingFixture();
    const original = await startPending(context);
    const completion = vi.spyOn(original, outcome === 'fulfillment' ? 'commit' : 'processHandlerFailure');
    await context.browser.evaluate(() => {
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ precommitHandler: () => new Promise<void>(() => {}) });
      }, { once: true });
      history.replaceState(null, '', '#replacement');
    });
    const replacement = context.navigation.ongoingNavigateEvent!;
    const transition = context.navigation.transition;
    expect(replacement).not.toBe(original);
    expect(original.signal.aborted).toBe(true);
    expect(context.errors).toHaveLength(1);
    if (outcome === 'fulfillment') context.pending.resolve();
    else context.pending.reject('obsolete failure');
    await expect.poll(() => completion.mock.calls.length).toBe(1);
    expect(context.errors).toHaveLength(1);
    expect(replacement.signal.aborted).toBe(false);
    expect(context.navigation.ongoingNavigateEvent).toBe(replacement);
    expect(context.navigation.transition).toBe(transition);
  });

  it('ignores completion for an inactive Document and leaves postcommit finishing explicit', async () => {
    const context = await pendingFixture();
    const event = await startPending(context);
    event.interceptionState = 'committed';
    expect(() => event.processHandlerFailure('postcommit failure')).toThrow('Navigation focus reset requires autofocus and focusing steps');
    expect(event.signal.aborted).toBe(false);
    event.interceptionState = 'intercepted';
    await context.browser.navigate('https://example.test/replacement');
    expect(context.document.isFullyActive()).toBe(false);
    // Document teardown's automatic abort producer is separate work; these operations must still guard activity.
    expect(() => event.commit(null)).not.toThrow();
    expect(() => event.processHandlerFailure('inactive failure')).not.toThrow();
    expect(context.errors).toHaveLength(0);
    expect(event.signal.aborted).toBe(false);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const window = document.getRelevantGlobalObject()!;
  return { browser, document, window, navigation: window.navigation, realm: getRelevantRealm(browser.window) };
}

async function pendingFixture() {
  const context = await fixture();
  const pending = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  Reflect.set(context.realm.globalObject, 'precommitErrors', errors);
  await context.browser.exposeFunction('pendingPrecommit', () => pending.promise);
  return { ...context, pending, errors };
}

async function startPending(context: Awaited<ReturnType<typeof pendingFixture>>) {
  await context.browser.evaluate(() => {
    const errors = Reflect.get(globalThis, 'precommitErrors') as unknown[];
    navigation.addEventListener('navigateerror', (event) => { errors.push(event.error); });
    navigation.addEventListener('navigate', (event) => {
      event.intercept({ precommitHandler: () => (Reflect.get(globalThis, 'pendingPrecommit') as () => Promise<void>)() });
    }, { once: true });
    history.pushState(null, '', '#target');
  });
  return context.navigation.ongoingNavigateEvent!;
}
