import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { PageEvaluation } from '../../../src/browlet/automation/evaluation';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createSessionHistoryEntry } from '../../../src/browlet/browsing/navigation/state/index';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { idlType } from '../../../src/web-idl/core/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { createSiblingWindow } from '../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigate-event postcommit execution', () => {
  it('disposes entries before invoking handlers with the Web IDL receiver and no aggregate Promise hop', async () => {
    const { browser, finish } = await fixture();
    expect(await browser.evaluate(async () => {
      const order: string[] = [];
      let undefinedReceiver = false;
      let captured!: NavigateEvent;
      const complete = new Promise<void>((resolve) => {
        navigation.addEventListener('navigatesuccess', () => { order.push('success'); resolve(); }, { once: true });
      });
      navigation.currentEntry!.ondispose = () => {
        order.push('dispose');
        queueMicrotask(() => { order.push('dispose microtask'); });
      };
      navigation.oncurrententrychange = () => {
        order.push('change');
        queueMicrotask(() => { order.push('change microtask'); });
      };
      navigation.addEventListener('navigate', (event) => {
        captured = event;
        event.intercept({
          focusReset: 'manual', scroll: 'manual',
          handler: function(this: unknown) {
            'use strict';
            undefinedReceiver = this === undefined;
            order.push('handler');
            queueMicrotask(() => { order.push('handler microtask'); });
          },
        });
      }, { once: true });
      history.replaceState(null, '', '#destination');
      order.push('returned');
      queueMicrotask(() => { order.push('after request'); });
      await complete;
      let finishedScroll = 'returned';
      try { captured.scroll(); }
      catch (error) { finishedScroll = error instanceof DOMException ? error.name : 'wrong realm'; }
      return { order, receiver: undefinedReceiver, transition: navigation.transition, finishedScroll };
    })).toEqual({
      order: ['change', 'dispose', 'handler', 'returned', 'change microtask', 'dispose microtask', 'handler microtask', 'success', 'after request'],
      receiver: true, transition: null, finishedScroll: 'InvalidStateError',
    });
    expect(finish).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('completes a nonintercepted event asynchronously even without handlers', async () => {
    const { browser, finish } = await fixture();
    finish.mockRestore();
    expect(await browser.evaluate(async () => {
      const order: string[] = [];
      let event!: NavigateEvent;
      const completed = new Promise<void>((resolve) => {
        navigation.onnavigatesuccess = () => { order.push('success'); resolve(); };
      });
      navigation.onnavigate = (value) => { event = value; };
      navigation.oncurrententrychange = () => {
        order.push('change');
        queueMicrotask(() => { order.push('change microtask'); });
      };
      history.pushState(null, '', '#destination');
      order.push('returned');
      queueMicrotask(() => { order.push('after request'); });
      await completed;
      return { order, aborted: event.signal.aborted };
    })).toEqual({ order: ['change', 'returned', 'change microtask', 'success', 'after request'], aborted: false });
  });

  it('settles the original transition without finishing or clearing a replacement started by navigatesuccess', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(async () => {
      let original!: NavigationTransition;
      let replacement!: NavigationTransition;
      let replacementFinished = false;
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ focusReset: 'manual', scroll: 'manual', handler() {} });
      }, { once: true });
      navigation.addEventListener('navigatesuccess', () => {
        original = navigation.transition!;
        navigation.addEventListener('navigate', (event) => {
          event.intercept({ precommitHandler: () => new Promise<void>(() => {}) });
        }, { once: true });
        history.pushState(null, '', '#replacement');
        replacement = navigation.transition!;
        void replacement.finished.then(() => { replacementFinished = true; });
      }, { once: true });
      history.pushState(null, '', '#original');
      const transition = navigation.transition!;
      await transition.finished;
      return {
        original: original === transition,
        replacementRetained: navigation.transition === replacement, replacementFinished,
      };
    })).toEqual({ original: true, replacementRetained: true, replacementFinished: false });
  });

  it('waits for all handlers before resolving the captured method tracker and reporting success', async () => {
    const { browser, document, navigation: sourceNavigation, finish, realm } = await fixture();
    await browser.evaluate(() => {
      navigation.addEventListener('navigate', (event) => {
        event.intercept({
          focusReset: 'manual', scroll: 'manual',
          handler: () => new Promise<void>((resolve) => { Reflect.set(globalThis, 'resolveFirst', resolve); }),
        });
        event.intercept({ handler: () => new Promise<void>((resolve) => { Reflect.set(globalThis, 'resolveSecond', resolve); }) });
      }, { once: true });
    });
    const tracker = sourceNavigation.setupNavigateReloadMethodTracker(undefined, document.env.serializeForStorage({ saved: true }));
    const outcomes: string[] = [];
    tracker.committedPromise.observe(() => { outcomes.push('committed'); }, () => { outcomes.push('commit rejected'); });
    tracker.finishedPromise.observe((entry) => {
      expect(entry).toBe(tracker.committedToEntry);
      outcomes.push('finished');
    }, () => { outcomes.push('finish rejected'); });
    browser.window.navigation.onnavigatesuccess = () => {
      expect(sourceNavigation.ongoingAPIMethodTracker).toBeNull();
      outcomes.push('success');
    };
    await runInHostTask(() => {
      sourceNavigation.firePushReplaceReloadNavigateEvent('push', document.env.parseHTMLURL('#target')!, true, { apiMethodTracker: tracker });
    });
    await expect.poll(() => outcomes).toEqual(['committed']);
    expect(browser.window.navigation.currentEntry!.getState()).toEqual({ saved: true });
    await browser.evaluate(() => { (Reflect.get(globalThis, 'resolveFirst') as () => void)(); });
    expect(finish).not.toHaveBeenCalled();
    expect(sourceNavigation.ongoingAPIMethodTracker).toBe(tracker);
    await browser.evaluate(() => { (Reflect.get(globalThis, 'resolveSecond') as () => void)(); });
    await expect.poll(() => outcomes).toEqual(['committed', 'success', 'finished']);
    expect(finish).toHaveBeenCalledExactlyOnceWith(true);
    expect(sourceNavigation.ongoingNavigateEvent).toBeNull();
    expect(realm.agent.eventLoop.executionContextStack).toEqual([]);
  });

  it('invokes every handler, then delivers a thrown reason through finishing and abortion once', async () => {
    const { browser, finish } = await fixture();
    expect(await browser.evaluate(async () => {
      const order: string[] = [];
      const reason = new Error('postcommit failed');
      let captured!: NavigateEvent;
      const failed = new Promise<boolean>((resolve) => {
        navigation.onnavigateerror = (event) => {
          order.push('error');
          resolve(event.error === reason && captured.signal.reason === reason);
        };
      });
      navigation.addEventListener('navigate', (event) => {
        captured = event;
        event.signal.addEventListener('abort', () => { order.push('abort'); });
        event.intercept({ focusReset: 'manual', scroll: 'manual', handler() { order.push('first'); throw reason; } });
        event.intercept({ handler() { order.push('second'); return Promise.reject(new Error('later')); } });
      }, { once: true });
      history.pushState(null, '', '#target');
      const transition = navigation.transition!;
      order.push('returned');
      queueMicrotask(() => { order.push('after request'); });
      const sameReason = await failed;
      const results = await Promise.allSettled([transition.committed, transition.finished]);
      return { order, sameReason, results: results.map((result) => result.status), transition: navigation.transition };
    })).toEqual({
      order: ['first', 'second', 'returned', 'after request', 'abort', 'error'],
      sameReason: true, results: ['fulfilled', 'rejected'], transition: null,
    });
    expect(finish).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(['currententrychange', 'dispose'] as const)('runs the captured handlers after %s starts a replacement, but ignores their completion', async (callback) => {
    const { browser, finish } = await fixture();
    expect(await browser.evaluate((callback) => {
      const observations: boolean[] = [];
      Reflect.set(globalThis, 'postcommitObservations', observations);
      const startReplacement = () => {
        navigation.addEventListener('navigate', (event) => {
          event.intercept({ precommitHandler: () => new Promise<void>(() => {}) });
        }, { once: true });
        history.pushState(null, '', '#replacement');
      };
      if (callback === 'currententrychange') navigation.addEventListener('currententrychange', startReplacement, { once: true });
      else navigation.currentEntry!.ondispose = startReplacement;
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ focusReset: 'manual', scroll: 'manual', handler() { observations.push(event.signal.aborted); } });
      }, { once: true });
      history.replaceState(null, '', '#original');
      return observations;
    }, callback)).toEqual([true]);
    expect(finish).not.toHaveBeenCalled();
  });

  it('observes a handler Promise from another Window in the same Agent', async () => {
    const { browser, realm, finish } = await fixture();
    const siblingRealm = getRelevantRealm(createSiblingWindow(browser));
    const otherDocument = siblingRealm.env.getAssociatedDocument()!;
    // Child/auxiliary creation is unfinished; provide its activity relationship.
    otherDocument.browsingContext = new BrowsingContext(siblingRealm.windowProxy);
    otherDocument.makeActive();
    const foreign = new PageEvaluation(new TopLevelTraversable(createDocumentState(otherDocument)));
    expect(siblingRealm.agent).toBe(realm.agent);
    Reflect.set(siblingRealm.globalObject, 'ownerNavigation', browser.window.navigation);
    const result = { called: false, succeeded: false };
    Reflect.set(siblingRealm.globalObject, 'postcommitResult', result);
    await foreign.evaluate(() => {
      const owner = Reflect.get(globalThis, 'ownerNavigation') as Navigation;
      const result = Reflect.get(globalThis, 'postcommitResult') as { called: boolean; succeeded: boolean; };
      owner.addEventListener('navigate', (event) => {
        event.intercept({ focusReset: 'manual', scroll: 'manual', handler() { result.called = true; return Promise.resolve(); } });
      }, { once: true });
      owner.addEventListener('navigatesuccess', () => { result.succeeded = true; }, { once: true });
    });
    await browser.evaluate(() => { history.pushState(null, '', '#target'); });
    await expect.poll(() => result).toEqual({ called: true, succeeded: true });
    expect(finish).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each(['fulfill', 'reject'] as const)('delivers %s through the supported host bridge while idle', async (outcome) => {
    const { browser, finish } = await fixture();
    const pending = Promise.withResolvers<void>();
    await browser.exposeFunction('postcommitPending', () => pending.promise);
    const results: unknown[] = [];
    browser.window.navigation.onnavigatesuccess = () => { results.push('success'); };
    browser.window.navigation.onnavigateerror = (event) => { results.push(Reflect.get(event, 'error')); };
    await browser.evaluate(() => {
      navigation.addEventListener('navigate', (event) => {
        event.intercept({
          focusReset: 'manual', scroll: 'manual',
          handler: () => (Reflect.get(globalThis, 'postcommitPending') as () => Promise<void>)(),
        });
      }, { once: true });
      history.pushState(null, '', '#target');
    });
    if (outcome === 'fulfill') pending.resolve();
    else pending.reject('postcommit rejected');
    // Inspect only host-visible data; evaluation or a manual checkpoint would hide a missed wake-up.
    await expect.poll(() => results, { timeout: 1500 }).toEqual([outcome === 'fulfill' ? 'success' : 'postcommit rejected']);
    expect(finish).toHaveBeenCalledExactlyOnceWith(outcome === 'fulfill');
  });

  it.each(['fulfill', 'reject'] as const)('ignores %s completion after the owning Document becomes inactive', async (outcome) => {
    const { browser, document, finish } = await fixture();
    const pending = document.env.InternalPromise.withResolvers(idlType.undefined);
    // Converted handler behavior is exercised above; control only settlement here.
    browser.window.navigation.addEventListener('navigate', (event) => {
      unwrap<NavigateEventImpl>(event).intercept({ focusReset: 'manual', scroll: 'manual', handler: () => pending.promise });
    }, { once: true });
    browser.window.history.pushState(null, '', '#target');
    document.browsingContext = null;
    await runInHostTask(() => {
      if (outcome === 'fulfill') pending.resolve(undefined);
      else pending.reject('obsolete');
    });
    expect(finish).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const navigable = document.getNodeNavigable()!;
  // Supply the still-unfinished §7.4 URL/history effect; entry updates and callbacks remain real.
  vi.spyOn(document, 'updateURLAndHistory').mockImplementation((url, _state, type = 'push') => {
    const entry = createSessionHistoryEntry({ ...navigable.activeSessionHistoryEntry.documentState, document });
    entry.url = url;
    navigable.activeSessionHistoryEntry = entry;
    navigation.updateEntriesForSameDocumentNavigation(entry, type);
  });
  // Manual policies avoid missing visual effects; observe the real finishing operation.
  const finish = vi.spyOn(NavigateEventImpl.prototype, 'finish');
  return { browser, document, navigation, finish, realm: getRelevantRealm(browser.window) };
}
