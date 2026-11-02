import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { NavigationType } from '../../../src/browlet/browsing/navigation-api/navigation';
import { NavigationTransitionImpl } from '../../../src/browlet/browsing/navigation-api/navigation-transition';
import { NavigationDestinationImpl } from '../../../src/browlet/browsing/navigation-api/navigation-destination';
import { NavigationHistoryEntryImpl } from '../../../src/browlet/browsing/navigation-api/navigation-history-entry';
import { createSessionHistoryEntry, createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { NavigationTransition as BrowletNavigationTransition } from '../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigation transitions', () => {
  it('initializes transition to null and exposes nonconstructible transition and destination interfaces', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const illegalConstructors = [NavigationTransition, NavigationDestination].map((constructor) => {
        try { Reflect.construct(constructor, []); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return { transition: navigation.transition, illegalConstructors };
    })).toEqual({ transition: null, illegalConstructors: [true, true] });
  });

  it.each(['push', 'replace', 'reload', 'traverse'] as const)('retains %s endpoints and stable owner-realm promises', async (type) => {
    const { browser } = await fixture(type);
    expect(await browser.evaluate(() => {
      // TypeScript's lib.dom has not added NavigationTransition.to yet.
      const transition = navigation.transition! as BrowletNavigationTransition;
      return {
        type: transition.navigationType,
        branded: transition instanceof NavigationTransition,
        fromSame: transition.from === navigation.currentEntry,
        toSame: transition.to === (navigation.transition! as BrowletNavigationTransition).to,
        destinationBranded: transition.to instanceof NavigationDestination,
        stable: transition.committed === transition.committed && transition.finished === transition.finished,
        distinct: transition.committed !== transition.finished,
        realm: transition.committed instanceof Promise && transition.finished instanceof Promise,
        tag: Object.prototype.toString.call(transition),
      };
    })).toEqual({
      type, branded: true, fromSame: true, toSame: true, destinationBranded: true,
      stable: true, distinct: true, realm: true, tag: '[object NavigationTransition]',
    });
  });

  it('makes the transition and its attributes readonly and checks getter receivers', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(async () => {
      const transition = navigation.transition!;
      const names = ['navigationType', 'from', 'to', 'committed', 'finished'];
      const writable = names.map((name) => Reflect.set(transition, name, null));
      const branded = await Promise.all(names.map(async (name) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Test each getter with an invalid receiver.
        const getter = Object.getOwnPropertyDescriptor(NavigationTransition.prototype, name)!.get!;
        // Web IDL turns failures of promise-valued getters into rejections.
        try { await Reflect.apply(getter, {}, []); } catch (error) { return error instanceof TypeError; }
        return false;
      }));
      return { writable: [Reflect.set(navigation, 'transition', null), ...writable], branded };
    })).toEqual({ writable: Array<boolean>(6).fill(false), branded: Array<boolean>(5).fill(true) });
  });

  it('keeps endpoints and promises in the receiver realm when getters are borrowed', async () => {
    const { browser } = await fixture();
    const other = new Browlet({ route: () => '' });
    const transition = browser.window.navigation.transition!;
    const ownerRealm = getRelevantRealm(browser.window);
    const methodRealm = getRelevantRealm(other.window);
    for (const name of ['from', 'to', 'committed', 'finished'] as const) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise a foreign getter with an explicit receiver.
      const getter = Object.getOwnPropertyDescriptor(other.window.NavigationTransition.prototype, name)!.get!;
      const value: unknown = Reflect.apply(getter, transition, []);
      expect(value).toBe(transition[name]);
      expect(value).toBeInstanceOf(ownerRealm.Object);
      expect(value).not.toBeInstanceOf(methodRealm.Object);
      if (name === 'committed' || name === 'finished') {
        const rejected = Reflect.apply(getter, {}, []) as Promise<unknown>;
        expect(rejected).toBeInstanceOf(methodRealm.NativePromise);
        await expect(settle(rejected, other)).rejects.toBeInstanceOf(methodRealm.TypeError);
      } else {
        expect(() => { Reflect.apply(getter, {}, []); }).toThrow(methodRealm.TypeError);
      }
    }
  });

  it('settles commit and completion independently with undefined', async () => {
    const { browser, transition } = await fixture();
    const platform = browser.window.navigation.transition!;
    let completed = false;
    void platform.finished.then(() => { completed = true; });
    transition.resolveCommitted();
    expect(await settle(platform.committed, browser)).toBeUndefined();
    expect(completed).toBe(false);
    transition.resolveFinished();
    expect(await settle(platform.finished, browser)).toBeUndefined();
    expect(completed).toBe(true);
  });

  it('marks both promises handled and preserves an abort reason before commit', async () => {
    const { browser, transition } = await fixture();
    const platform = browser.window.navigation.transition!;
    const reason = await browser.evaluate(() => new Error('aborted before commit'));
    transition.reject(reason);
    // Leave both author promises unobserved through a task turn; neither may report an unhandled rejection.
    await checkpoint(browser);
    const results = await settle(Promise.allSettled([platform.committed, platform.finished]), browser);
    expect(results).toEqual([{ status: 'rejected', reason }, { status: 'rejected', reason }]);
  });

  it('preserves a fulfilled commit when later completion fails', async () => {
    const { browser, transition } = await fixture();
    const platform = browser.window.navigation.transition!;
    transition.resolveCommitted();
    expect(await settle(platform.committed, browser)).toBeUndefined();
    const reason = await browser.evaluate(() => new DOMException('handler failed', 'AbortError'));
    transition.reject(reason);
    expect(await settle(Promise.allSettled([platform.committed, platform.finished]), browser)).toEqual([
      { status: 'fulfilled', value: undefined }, { status: 'rejected', reason },
    ]);
  });

  it('retains a cleared transition and its original endpoints without activity gating', async () => {
    const { browser, document, ownerNavigation, transition } = await fixture();
    const navigation = browser.window.navigation;
    const platform = navigation.transition!;
    const from = platform.from;
    const to = platform.to;
    ownerNavigation.transition = null;
    document.browsingContext = null;
    expect(navigation.transition).toBeNull();
    expect(platform.from).toBe(from);
    expect(platform.to).toBe(to);
    expect(platform.navigationType).toBe('push');
    transition.resolveCommitted();
    transition.resolveFinished();
    expect(await settle(Promise.all([platform.committed, platform.finished]), browser)).toEqual([undefined, undefined]);
  });
});

describe('Navigation destinations', () => {
  it('exposes the serialized URL, original document classification, and null-entry metadata', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const destination = (navigation.transition! as BrowletNavigationTransition).to;
      return {
        url: destination.url, key: destination.key, id: destination.id,
        index: destination.index, sameDocument: destination.sameDocument,
        tag: Object.prototype.toString.call(destination),
      };
    })).toEqual({
      url: 'https://example.test/next?q=%C3%A9#target', key: '', id: '', index: -1,
      sameDocument: false, tag: '[object NavigationDestination]',
    });
  });

  it('reads live traversal-entry metadata through its implementation rather than author overrides', async () => {
    const { browser, document, ownerNavigation, destination } = await fixture('traverse');
    const entry = browser.window.navigation.currentEntry!;
    const expected = { key: entry.key, id: entry.id, index: entry.index };
    Object.defineProperties(entry, { key: { value: 'shadow' }, id: { value: 'shadow' }, index: { value: 100 } });
    const platform = browser.window.navigation.transition!.to;
    expect({ key: platform.key, id: platform.id, index: platform.index }).toEqual(expected);
    const preceding = createSessionHistoryEntry(createDocumentState(document));
    ownerNavigation.entryList.unshift(new NavigationHistoryEntryImpl(preceding, ownerNavigation.env));
    expect(platform.index).toBe(1);
    ownerNavigation.entryList = [];
    expect(platform.index).toBe(-1);
    expect(platform.key).toBe(expected.key);
    destination.entry = null;
    expect({ key: platform.key, id: platform.id, index: platform.index }).toEqual({ key: '', id: '', index: -1 });
  });

  it('returns fresh cyclic state graphs in the method realm, independently of later entry state', async () => {
    const { browser, document, destination, ownerNavigation } = await fixture('traverse');
    const state: { items: number[]; self?: unknown; } = { items: [1] };
    state.self = state;
    destination.state = document.env.serializeForStorage(state);
    state.items.push(2);
    ownerNavigation.currentEntry!.sessionHistoryEntry.navigationAPIState = document.env.serializeForStorage('later');
    expect(await browser.evaluate(() => {
      const destination = (navigation.transition! as BrowletNavigationTransition).to;
      const first = destination.getState() as { items: number[]; self: unknown; };
      const second = destination.getState() as typeof first;
      first.items.push(3);
      return {
        realm: first instanceof Object && first.items instanceof Array,
        fresh: first !== second && first.items !== second.items,
        cycles: first.self === first && second.self === second, items: second.items,
      };
    })).toEqual({ realm: true, fresh: true, cycles: true, items: [1] });
  });

  it('uses a borrowed state method realm and keeps state available after the source becomes inactive', async () => {
    const { browser, document } = await fixture('traverse');
    const other = new Browlet({ route: () => '' });
    const destination = browser.window.navigation.transition!.to;
    const url = destination.url;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise borrowing with an explicit foreign receiver.
    const method = other.window.NavigationDestination.prototype.getState;
    const before: unknown = Reflect.apply(method, destination, []);
    expect(before).toBeInstanceOf(getRelevantRealm(other.window).Object);
    expect(before).not.toBeInstanceOf(getRelevantRealm(browser.window).Object);
    document.browsingContext = null;
    expect(Reflect.apply(method, destination, [])).toEqual({ items: [1] });
    expect({ key: destination.key, id: destination.id, index: destination.index }).toEqual({ key: '', id: '', index: -1 });
    expect(destination.url).toBe(url);
    expect(destination.sameDocument).toBe(true);
    expect(() => { Reflect.apply(method, {}, []); }).toThrow(getRelevantRealm(other.window).TypeError);
  });

  it('reflects producer updates to URL and serialized state while retaining the original document classification', async () => {
    const { browser, document, destination } = await fixture();
    const platform = browser.window.navigation.transition!.to;
    // Precommit redirect/update algorithms are not implemented; supply their resulting fields directly.
    destination.urlRecord = document.env.parseHTMLURL('/redirected')!;
    destination.state = document.env.serializeForStorage(undefined);
    expect(platform.url).toBe('https://example.test/redirected');
    expect(platform.getState()).toBeUndefined();
    expect(platform.sameDocument).toBe(false);
    expect(browser.window.navigation.transition!.to).toBe(platform);
  });

  it('propagates deserialization failures from the selected method environment', async () => {
    const { browser, document } = await fixture();
    const reason = await browser.evaluate(() => new RangeError('deserialization failed'));
    vi.spyOn(document.env, 'deserialize').mockImplementation(() => { throw reason; });
    expect(() => { browser.window.navigation.transition!.to.getState(); }).toThrow(reason);
  });
});

async function fixture(type: NavigationType = 'push') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const ownerNavigation = document.getRelevantGlobalObject()!.navigation;
  // Navigate-event firing is unfinished. Supply its retained values at that producer boundary;
  // all observable getters, state reads, promise projection, and realm checks use real bindings.
  const destination = new NavigationDestinationImpl(
    document.env.parseHTMLURL('https://example.test/next?q=é#target')!,
    type === 'traverse' ? ownerNavigation.currentEntry : null,
    document.env.serializeForStorage({ items: [1] }), type === 'traverse', document.env,
  );
  const transition = new NavigationTransitionImpl(type, ownerNavigation.currentEntry!, destination, document.env);
  ownerNavigation.transition = transition;
  return { browser, document, ownerNavigation, transition, destination };
}

function checkpoint(browser: Browlet): Promise<void> {
  return runInHostTask(() => { getRelevantRealm(browser.document).agent.eventLoop.performMicrotaskCheckpoint(); });
}

function settle<T>(promise: Promise<T>, browser: Browlet): Promise<T> {
  return Promise.all([promise, checkpoint(browser)]).then(([value]) => value);
}
