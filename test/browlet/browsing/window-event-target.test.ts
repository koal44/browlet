import { expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, TopLevelTraversable, DocumentState } from '../../../src/browlet/browsing/navigation/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// Chromium, Firefox, and WebKit return true for a live Window. This covers the identity used by
// unhandledrejection, independently of the native rejection hook.
it('exposes Window event targets as the public WindowProxy identity', async () => {
  const browser = new Browlet({ route: () => '', reporting: false });
  const same = await browser.evaluate(() => {
    let result = false;
    addEventListener('test', (event) => { result = event.target === window; }, { once: true });
    dispatchEvent(new Event('test'));
    return result;
  });
  expect(same).toBe(true);
});

it('exposes WindowProxy for currentTarget, srcElement, the composed path, and function listeners', async () => {
  const browser = new Browlet({ route: () => '', reporting: false });
  expect(await browser.evaluate(() => {
    const event = new Event('test');
    let during;
    window.addEventListener('test', function(this: Window, received) {
      during = {
        sameEvent: received === event,
        currentTarget: received.currentTarget === window,
        srcElement: received.srcElement === window,
        path: received.composedPath().length === 1 && received.composedPath()[0] === window,
        receiver: this === window,
      };
    }, { once: true });
    window.dispatchEvent(event);
    return { during, currentTarget: event.currentTarget, path: event.composedPath() };
  })).toEqual({
    during: { sameEvent: true, currentTarget: true, srcElement: true, path: true, receiver: true },
    currentTarget: null, path: [],
  });
});

it('preserves a Document target while projecting its Window listener and path entry', async () => {
  const browser = new Browlet({ route: () => '', reporting: false });
  expect(await browser.evaluate(() => {
    let result;
    window.addEventListener('test', function(this: Window, event) {
      result = {
        target: event.target === document,
        currentTarget: event.currentTarget === window,
        receiver: this === window,
        path: event.composedPath().at(-1) === window,
      };
    }, { once: true });
    document.dispatchEvent(new Event('test', { bubbles: true }));
    return result;
  })).toEqual({ target: true, currentTarget: true, receiver: true, path: true });
});

it('selects the target WindowProxy when a listener belongs to another realm', async () => {
  const caller = new Browlet({ route: () => '', reporting: false });
  await caller.navigate('https://example.test/caller');
  const peer = createSiblingWindow(caller);
  const { env, windowProxy } = getRelevantRealm(peer);
  const document = env.window.document;
  document.browsingContext = new BrowsingContext(windowProxy);
  new TopLevelTraversable(DocumentState.create(document));
  document.makeActive();
  Reflect.set(caller.window, 'peerWindow', peer);
  expect(await caller.evaluate(() => {
    const peer = Reflect.get(window, 'peerWindow') as Window;
    let result;
    peer.addEventListener('test', function(this: Window, event) {
      result = {
        target: event.target === peer,
        currentTarget: event.currentTarget === peer,
        receiver: this === peer,
        path: event.composedPath()[0] === peer,
        eventRealm: event instanceof Event,
      };
    }, { once: true });
    peer.dispatchEvent(new Event('test'));
    return result;
  })).toEqual({ target: true, currentTarget: true, receiver: true, path: true, eventRealm: true });
});

it('preserves object-listener receivers and ordinary EventTarget identity', async () => {
  const browser = new Browlet({ route: () => '', reporting: false });
  expect(await browser.evaluate(() => {
    let objectReceiver = false;
    const listener = { handleEvent() { objectReceiver = this === listener; } };
    window.addEventListener('object', listener, { once: true });
    window.dispatchEvent(new Event('object'));
    const target = new EventTarget();
    let ordinaryTarget;
    target.addEventListener('test', function(this: EventTarget, event) {
      ordinaryTarget = {
        target: event.target === target,
        currentTarget: event.currentTarget === target,
        path: event.composedPath()[0] === target,
        receiver: this === target,
      };
    });
    target.dispatchEvent(new Event('test'));
    return { objectReceiver, ordinaryTarget };
  })).toEqual({
    objectReceiver: true,
    ordinaryTarget: { target: true, currentTarget: true, path: true, receiver: true },
  });
});

it.each([false, true])('returns null for a replaced Window target (read before navigation: %s)', async (readBefore) => {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/before');
  const oldRealm = getRelevantRealm(browser.document);
  const oldDocument = browser.document;
  await browser.evaluate((readBefore) => {
    const event = new Event('retained');
    window.dispatchEvent(event);
    Reflect.set(window, 'retainedEvent', event);
    if (readBefore) Reflect.set(window, 'savedTarget', event.target);
  }, readBefore);
  const event = Reflect.get(browser.window, 'retainedEvent') as Event;
  const savedTarget: unknown = Reflect.get(browser.window, 'savedTarget');

  await browser.navigate('https://example.test/after');
  Reflect.set(browser.window, 'retainedEvent', event);
  Reflect.set(browser.window, 'savedTarget', savedTarget);
  expect(await browser.evaluate((readBefore) => {
    const event = Reflect.get(window, 'retainedEvent') as Event;
    return {
      target: event.target === null,
      srcElement: event.srcElement === null,
      currentTarget: event.currentTarget === null,
      path: event.composedPath().length === 0,
      savedTarget: !readBefore || Reflect.get(window, 'savedTarget') === window,
    };
  }, readBefore)).toEqual({ target: true, srcElement: true, currentTarget: true, path: true, savedTarget: true });
  // Public conversion must not replace the original Window's internal property store.
  expect(Reflect.get(oldRealm.globalObject, 'document')).toBe(oldDocument);
  expect(Reflect.get(oldRealm.globalObject, 'retainedEvent')).toBe(event);
});

it('retains WindowProxy when its Window loses its browsing context without replacement', async () => {
  const browser = new Browlet({ route: () => '', reporting: false });
  const proxy = browser.window;
  await browser.evaluate(() => {
    const event = new Event('retained');
    window.dispatchEvent(event);
    Reflect.set(window, 'retainedEvent', event);
  });
  const event = Reflect.get(browser.window, 'retainedEvent') as Event;
  getRelevantRealm(browser.document).windowImplementation.document.browsingContext = null;
  expect(event.target === proxy).toBe(true);
  expect(event.srcElement === proxy).toBe(true);
});
