import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, Navigable, TopLevelTraversable, DocumentState } from '../../../src/browlet/browsing/navigation/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import type { StorageEvent as StorageEventPlatform, Window as WindowPlatform } from '../../../src/browlet/platform';
import type { StorageImpl } from '../../../src/browlet/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML §12.2.1: Storage removal and broadcast', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('removes %s entries through methods and named deletion', async (name) => {
    const browser = await createBrowser();
    const storage = unwrap<StorageImpl>(browser.window[name]);
    storage.map.set('first', '1').set('middle', '').set('last', '3');
    expect(await browser.evaluate((name) => {
      const storage = window[name];
      let conversions = 0;
      const result = storage.removeItem({ toString() { conversions++; return 'middle'; } } as unknown as string);
      const order = [storage.key(0), storage.key(1)];
      const deleted = Reflect.deleteProperty(storage, 'first');
      storage.removeItem('absent');
      return [result, conversions, order, deleted, Object.keys(storage), storage.length, storage.getItem('middle')];
    }, name)).toEqual([undefined, 1, ['first', 'last'], true, ['last'], 1, null]);
    expect([...storage.map]).toEqual([['last', '3']]);
  });

  it.each(['localStorage', 'sessionStorage'] as const)('clears %s through author code without replacing the backing map', async (name) => {
    const browser = await createBrowser();
    const storage = unwrap<StorageImpl>(browser.window[name]);
    const backing = storage.map.backingMap;
    storage.map.set('', '').set('second', 'value');
    expect(await browser.evaluate((name) => {
      const storage = window[name];
      return [storage.clear(), storage.length, storage.getItem(''), Object.keys(storage), storage.clear()];
    }, name)).toEqual([undefined, 0, null, [], undefined]);
    expect(storage.map.backingMap).toBe(backing);
    expect(backing.size).toBe(0);
  });

  it('leaves data intact when conversion or receiver validation fails', async () => {
    const browser = await createBrowser();
    unwrap<StorageImpl>(browser.window.localStorage).map.set('keep', 'value');
    expect(await browser.evaluate(() => {
      /* eslint-disable @typescript-eslint/unbound-method -- Deliberately invoke invalid receivers and missing arguments. */
      const calls = [
        () => { Reflect.apply(Storage.prototype.removeItem, localStorage, []); },
        () => { Reflect.apply(Storage.prototype.removeItem, localStorage, [Symbol()]); },
        () => { Reflect.apply(Storage.prototype.removeItem, {}, ['keep']); },
        () => { Reflect.apply(Storage.prototype.clear, {}, []); },
      ];
      /* eslint-enable @typescript-eslint/unbound-method */
      const failures = calls.map((call) => {
        try { call(); return false; } catch (error) { return error instanceof TypeError; }
      });
      return [failures, localStorage.getItem('keep')];
    })).toEqual([[true, true, true, true], 'value']);
  });

  it('queues local changes only for existing same-origin Storage objects in the same browser', () => {
    const source = createPage(undefined, 'https://example.test/source?x=1#fragment');
    const receiver = createPage(source.env.userAgent);
    const foreign = createPage(source.env.userAgent, 'https://other.test/');
    const independent = createPage();
    const unacquired = createPage(source.env.userAgent);
    const sender = source.window.localStorage;
    const recipient = receiver.window.localStorage;
    // The receiver's session object must not create another local-storage notification.
    void receiver.window.sessionStorage;
    void foreign.window.localStorage;
    void independent.window.localStorage;
    const sourceEvents = collect(source);
    const events = collect(receiver);
    const foreignEvents = collect(foreign);
    const independentEvents = collect(independent);
    const unacquiredEvents = collect(unacquired);
    unwrap<StorageImpl>(sender).map.set('remove', '').set('remaining', 'value');

    sender.removeItem('remove');
    expect(recipient.getItem('remove')).toBeNull();
    expect(events).toEqual([]);
    void unacquired.window.localStorage; // Acquisition after the change does not receive that change.
    source.document.url = parseURL('https://example.test/after').url!;
    sender.removeItem('absent');
    sender.clear();
    sender.clear();
    for (const page of [source, receiver, foreign, independent, unacquired]) page.drain();

    expect(events.map(eventData)).toEqual([
      ['remove', '', null, 'https://example.test/source?x=1#fragment'],
      [null, null, null, 'https://example.test/after'],
    ]);
    for (const event of events) {
      expect(event).toBeInstanceOf(receiver.window.StorageEvent);
      expect(event.storageArea).toBe(recipient);
      expect([event.type, event.isTrusted, event.bubbles, event.cancelable, event.composed])
        .toEqual(['storage', true, false, false, false]);
    }
    expect(unacquiredEvents.map(eventData)).toEqual([[null, null, null, 'https://example.test/after']]);
    expect([sourceEvents, foreignEvents, independentEvents]).toEqual([[], [], []]);
    expect(source.document.sessionStorageHolder).toBeNull();
  });

  it('restricts session notifications to same-origin recipients in the same traversable', () => {
    const source = createPage();
    const child = createPage(source.env.userAgent, 'https://example.test/child', source);
    const otherTab = createPage(source.env.userAgent);
    const foreignChild = createPage(source.env.userAgent, 'https://other.test/', source);
    const sender = source.window.sessionStorage;
    const recipient = child.window.sessionStorage;
    void child.window.localStorage;
    void otherTab.window.sessionStorage;
    void foreignChild.window.sessionStorage;
    unwrap<StorageImpl>(sender).map.set('key', 'old');
    const events = collect(child);
    const otherEvents = collect(otherTab);
    const foreignEvents = collect(foreignChild);
    const sourceEvents = collect(source);
    sender.removeItem('key');
    expect(recipient.length).toBe(0);
    for (const page of [source, child, otherTab, foreignChild]) page.drain();
    expect(events.map(eventData)).toEqual([['key', 'old', null, 'https://example.test/']]);
    expect(events[0]!.storageArea).toBe(recipient);
    expect([otherEvents, foreignEvents, sourceEvents]).toEqual([[], [], []]);
  });

  it('queues local delivery even while the recipient is inactive, then waits for activity', () => {
    const source = createPage();
    const receiver = createPage(source.env.userAgent);
    const sender = source.window.localStorage;
    void receiver.window.localStorage;
    unwrap<StorageImpl>(sender).map.set('key', 'old');
    const events = collect(receiver);
    const context = receiver.document.browsingContext;
    receiver.document.browsingContext = null;
    sender.clear();
    receiver.drain();
    expect(events).toEqual([]);
    receiver.document.browsingContext = context;
    receiver.drain();
    expect(events.map(eventData)).toEqual([[null, null, null, 'https://example.test/']]);
  });

  it('holds a queued session event if its recipient becomes inactive before delivery', () => {
    const source = createPage();
    const child = createPage(source.env.userAgent, 'https://example.test/child', source);
    void child.window.sessionStorage;
    unwrap<StorageImpl>(source.window.sessionStorage).map.set('key', 'old');
    const events = collect(child);
    source.window.sessionStorage.clear();
    const context = child.document.browsingContext;
    child.document.browsingContext = null;
    child.drain();
    expect(events).toEqual([]);
    child.document.browsingContext = context;
    child.drain();
    expect(events).toHaveLength(1);
  });

  it('notifies a retained Storage object after its Document is replaced on a reused Window', async () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    realm.windowImplementation.document.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    const retained = browser.window.localStorage;
    unwrap<StorageImpl>(retained).map.set('key', 'old');
    await browser.navigate('https://example.test/next');
    expect(getRelevantRealm(browser.window)).toBe(realm);
    const current = browser.window.localStorage;
    expect(current).not.toBe(retained);
    Reflect.set(browser.window, 'retainedStorage', retained);
    expect(await browser.evaluate(() => new Promise((resolve) => {
      let returned = false;
      addEventListener('storage', (event) => {
        resolve([returned, event.storageArea === Reflect.get(globalThis, 'retainedStorage'),
          event.storageArea !== localStorage, event.storageArea!.length,
          event.key, event.oldValue, event.newValue, event.url, event instanceof StorageEvent]);
      }, { once: true });
      localStorage.removeItem('key');
      returned = true;
    }))).toEqual([true, true, true, 0, 'key', 'old', null, 'https://example.test/next', true]);
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/');
  return browser;
}

/** Compose real browsing records while iframe and auxiliary-window creation remain unfinished. */
function createPage(
  userAgent = createManualUserAgent(), url = 'https://example.test/',
  parent: { navigable: Navigable; window: WindowPlatform; } | null = null,
) {
  const [, document] = BrowsingContext.createTopLevel(userAgent);
  document.url = parseURL(url).url!;
  document.origin = obtainURLOrigin(document.url);
  const state = DocumentState.create(document);
  const navigable = parent === null ? new TopLevelTraversable(state) : new Navigable(state, parent.navigable);
  if (parent !== null) {
    const frame = unwrap<HTMLIFrameElementImpl>(parent.window.document.createElement('iframe'));
    frame.contentNavigable = navigable;
  }
  const window = navigable.activeWindowProxy.platform;
  const env = getRelevantRealm(window).env;
  return {
    window, env, document, navigable,
    drain() { while (env.realm.agent.eventLoop.runTaskTurn()) { /* Drain runnable tasks. */ } },
  };
}

function collect(page: ReturnType<typeof createPage>): StorageEventPlatform[] {
  const events: StorageEventPlatform[] = [];
  page.window.addEventListener('storage', (event) => { events.push(event as StorageEventPlatform); });
  return events;
}

function eventData(event: StorageEventPlatform) {
  return [event.key, event.oldValue, event.newValue, event.url];
}
