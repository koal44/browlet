import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import { NavigationDestinationImpl } from '../../../src/browlet/browsing/navigation/api/navigation-destination';
import { NavigationPrecommitControllerImpl } from '../../../src/browlet/browsing/navigation/api/navigation-precommit-controller';
import type { NavigateEvent as BrowletNavigateEvent, NavigationPrecommitController } from '../../../src/browlet/platform';
import { getBindingContext, project, unwrap } from '../../support/browlet-binding';

describe('NavigationPrecommitController redirect', () => {
  it('converts the URL and options before parsing against the owner Document base in UTF-8', async () => {
    const { browser, document: ownerDocument, event, controller } = await fixture();
    ownerDocument.encoding = 'windows-1252';
    expect(controller.event).toBe(event);
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller, navigateEventForTest: event } = window as unknown as TestWindow;
      const base = document.createElement('base');
      base.href = '/alternate/';
      document.head.append(base);
      const order: string[] = [];
      const url = { toString() { order.push('url'); return 'next?q=é\uD800'; } };
      const options = {
        get info() { order.push('info'); return document; },
        get history() { order.push('history'); return 'replace'; },
        get state() { order.push('state'); return { get value() { order.push(`data:${event.navigationType}`); return 1; } }; },
      };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise URL coercion with the original receiver.
      Reflect.apply(controller.redirect, controller, [url, options]);
      return { order, url: event.destination.url, info: event.info === document, current: location.href };
    })).toEqual({
      order: ['url', 'info', 'history', 'state', 'data:replace'],
      url: 'https://example.test/alternate/next?q=%C3%A9%EF%BF%BD', info: true,
      current: 'https://example.test/base/current',
    });
    expect(ownerDocument.env.deserialize(event.destination.state)).toEqual({ value: 1 });
  });

  it('preserves omitted options, snapshots state, and retains info and destination identities across redirects', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller, navigateEventForTest: event } = window as unknown as TestWindow;
      const destination = event.destination;
      const state = { value: 1 };
      const info = { arbitrary: document };
      controller.redirect('/one', { history: 'replace', state, info });
      state.value = 2;
      controller.redirect('/two');
      controller.redirect('/three', { info: undefined, state: undefined, history: 'auto' });
      const first = destination.getState() as { value: number; };
      const second: unknown = destination.getState();
      return {
        url: destination.url, type: event.navigationType, state: first, fresh: first !== second,
        cloned: first !== state, info: event.info === info, identity: event.destination === destination,
        key: destination.key, id: destination.id, index: destination.index, sameDocument: destination.sameDocument,
      };
    })).toEqual({
      url: 'https://example.test/three', type: 'replace', state: { value: 1 }, fresh: true,
      cloned: true, info: true, identity: true, key: '', id: '', index: -1, sameDocument: true,
    });
  });

  it('updates the current tracker with the same serialized state and accepts explicit null state/info', async () => {
    const { document, navigation, event, platform } = await fixture();
    const tracker = navigation.setupNavigateReloadMethodTracker(undefined, null);
    navigation.ongoingAPIMethodTracker = tracker;
    platform.redirect('/redirected', { state: null, info: null, history: 'replace' });
    expect(tracker.serializedState).toBe(event.destination.state);
    expect(document.env.deserialize(tracker.serializedState!)).toBeNull();
    expect(event.info).toBeNull();
    expect(event.navigationType).toBe('replace');
    platform.redirect('/again', { history: 'push' });
    expect(event.navigationType).toBe('push');
    expect(tracker.serializedState).toBe(event.destination.state);
  });

  it.each([
    ['http://[', 'SyntaxError'], ['https://elsewhere.test/path', 'SecurityError'],
    ['https://user@example.test/path', 'SecurityError'], ['javascript:1', 'SecurityError'],
  ])('rejects %s before serializing state or changing the request', async (url, name) => {
    const { platform, event } = await fixture();
    const state = event.destination.state;
    const info = event.info;
    let reads = 0;
    expect(() => platform.redirect(url, { history: 'replace', info: 'new', state: { get value() { reads++; return 1; } } }))
      .toThrow(expect.objectContaining({ name }));
    expect(reads).toBe(0);
    expect(event.navigationType).toBe('push');
    expect(event.destination.url).toBe('https://example.test/initial-target');
    expect(event.destination.state).toBe(state);
    expect(event.info).toBe(info);
  });

  it('keeps the new history type but the old URL, state, and info when cloning fails', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller, navigateEventForTest: event } = window as unknown as TestWindow;
      const info: unknown = event.info;
      let duringType: string | undefined;
      let errorName: string | undefined;
      try {
        controller.redirect('/redirected', {
          history: 'replace', info: 'new', state: {
            get value() { duringType = event.navigationType; return () => {}; },
          },
        });
      } catch (error) { errorName = (error as Error).name; }
      return {
        duringType, errorName, type: event.navigationType, url: event.destination.url,
        state: event.destination.getState() as unknown, info: event.info === info,
      };
    })).toEqual({
      duringType: 'replace', errorName: 'DataCloneError', type: 'replace',
      url: 'https://example.test/initial-target', state: { original: true }, info: true,
    });
  });

  it('propagates a state getter exception unchanged', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller } = window as unknown as TestWindow;
      const sentinel = new Error('State getter failed');
      try { controller.redirect('/next', { state: { get value() { throw sentinel; } } }); }
      catch (error) { return error === sentinel; }
      return false;
    })).toBe(true);
  });

  it('preserves nested redirect effects according to HTML step order', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller, navigateEventForTest: event } = window as unknown as TestWindow;
      controller.redirect('/outer', {
        history: 'replace', state: {
          get value() {
            controller.redirect('/inner', { history: 'push', state: { inner: true }, info: 'inner' });
            return 1;
          },
        },
      });
      return { type: event.navigationType, url: event.destination.url, state: event.destination.getState() as unknown, info: event.info as unknown };
    })).toEqual({ type: 'push', url: 'https://example.test/outer', state: { value: 1 }, info: 'inner' });
  });

  it('does not overwrite a replacement navigation tracker created by a state getter', async () => {
    const { document, navigation, platform } = await fixture();
    const oldState = document.env.serializeForStorage({ original: true });
    const original = navigation.setupNavigateReloadMethodTracker(undefined, oldState);
    original.pending = false;
    navigation.ongoingAPIMethodTracker = original;
    const nextState = document.env.serializeForStorage({ replacement: true });
    const replacement = navigation.setupNavigateReloadMethodTracker(undefined, nextState);
    replacement.pending = false;
    platform.redirect('/old-redirect', {
      state: {
        get value() {
          // Navigation/event production is unfinished. Reproduce its tracker replacement at that boundary.
          navigation.ongoingAPIMethodTracker = replacement;
          return 'old';
        },
      },
    });
    expect(navigation.ongoingAPIMethodTracker).toBe(replacement);
    expect(document.env.deserialize(replacement.serializedState!)).toEqual({ replacement: true });
    expect(original.serializedState).toBe(oldState);
  });

  it('does not adopt a tracker created during serialization when the redirect had none', async () => {
    const { document, navigation, event, platform } = await fixture();
    const state = document.env.serializeForStorage({ replacement: true });
    const replacement = navigation.setupNavigateReloadMethodTracker(undefined, state);
    platform.redirect('/old-redirect', {
      state: {
        get value() {
          navigation.ongoingAPIMethodTracker = replacement;
          return 1;
        },
      },
    });
    expect(replacement.serializedState).toBe(state);
    expect(document.env.deserialize(event.destination.state)).toEqual({ value: 1 });
  });

  it('leaves a tracker removed during serialization untouched', async () => {
    const { document, navigation, event, platform } = await fixture();
    const state = document.env.serializeForStorage({ original: true });
    const tracker = navigation.setupNavigateReloadMethodTracker(undefined, state);
    navigation.ongoingAPIMethodTracker = tracker;
    platform.redirect('/old-redirect', {
      state: {
        get value() {
          navigation.ongoingAPIMethodTracker = null;
          return 1;
        },
      },
    });
    expect(navigation.ongoingAPIMethodTracker).toBeNull();
    expect(tracker.serializedState).toBe(state);
    expect(document.env.deserialize(event.destination.state)).toEqual({ value: 1 });
  });

  it.each(['reload', 'traverse'] as const)('rejects %s before parsing or cloning', async (type) => {
    const { event, platform } = await fixture();
    event.navigationType = type;
    let reads = 0;
    expect(() => platform.redirect('http://[', { state: { get value() { reads++; return 1; } } }))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(reads).toBe(0);
  });
});

describe('NavigationPrecommitController validation and handler addition', () => {
  it('rejects invalid arguments at the binding boundary before checking interception state', async () => {
    const { browser, event } = await fixture();
    event.interceptionState = 'finished';
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller } = window as unknown as TestWindow;
      const badRedirect = [[], [Symbol('url')], ['/next', { history: 'invalid' }]].map((args) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid Web IDL arguments with the original receiver.
        try { Reflect.apply(controller.redirect, controller, args); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      const badHandler = [[], [null], [{}]].map((args) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid Web IDL callback inputs.
        try { Reflect.apply(controller.addHandler, controller, args); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return [...badRedirect, ...badHandler];
    })).toEqual(Array<boolean>(6).fill(true));
  });

  it.each(['committed', 'scrolled', 'finished'] as const)('rejects both methods once %s', async (state) => {
    const { event, platform } = await fixture();
    event.interceptionState = state;
    expect(() => platform.redirect('http://[')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => platform.addHandler(() => {})).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(event.navigationHandlerList).toHaveLength(0);
  });

  it('checks trust before cancellation and interception state', async () => {
    const { event, platform } = await fixture();
    event.interceptionState = 'finished';
    event.defaultPrevented = true;
    event.isTrusted = false;
    expect(() => platform.redirect('/next')).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(() => platform.addHandler(() => {})).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    event.isTrusted = true;
    event.interceptionState = 'intercepted';
    expect(() => platform.redirect('/next')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => platform.addHandler(() => {})).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('checks its retained owner Document activity before trust, including with borrowed methods', async () => {
    const { browser, event, platform } = await fixture();
    event.isTrusted = false;
    await browser.navigate('https://example.test/replacement');
    const methods = browser.window.NavigationPrecommitController.prototype;
    expect(() => methods.redirect.call(platform, '/next')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => methods.addHandler.call(platform, () => {})).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('uses the receiver base and method exception realm when operations are borrowed', async () => {
    const { browser, event, platform } = await fixture();
    const foreign = new Browlet({ route: () => '' });
    await foreign.navigate('https://foreign.test/base');
    const methods = foreign.window.NavigationPrecommitController.prototype;
    methods.redirect.call(platform, 'relative');
    expect(event.destination.url).toBe('https://example.test/base/relative');
    methods.addHandler.call(platform, () => {});
    expect(event.navigationHandlerList).toHaveLength(1);
    let failure: unknown;
    try { methods.redirect.call(platform, 'http://['); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(foreign.window.DOMException);
    expect(failure).not.toBeInstanceOf(browser.window.DOMException);
    try { methods.redirect.call(platform, '/next', { state: () => {} }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ name: 'DataCloneError' });
    expect(failure).toBeInstanceOf(foreign.window.DOMException);
  });

  it('appends converted handlers without calling them and does not require dispatch or a push navigation', async () => {
    const { browser, event } = await fixture();
    event.navigationType = 'traverse';
    event.canIntercept = false;
    event.cancelable = false;
    expect(await browser.evaluate(() => {
      const { controllerForTest: controller } = window as unknown as TestWindow;
      let calls = 0;
      const handler = () => { calls++; };
      controller.addHandler(handler);
      controller.addHandler(handler);
      return calls;
    })).toBe(0);
    expect(event.navigationHandlerList).toHaveLength(2);
    expect(event.interceptionState).toBe('intercepted');
  });
});

type TestWindow = { controllerForTest: NavigationPrecommitController; navigateEventForTest: BrowletNavigateEvent; };

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/base/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  // Supply the unfinished trusted event/precommit production, retaining real bindings and dispatch.
  const event = document.env.createEvent(NavigateEventImpl);
  event.type = 'navigate';
  event.canIntercept = true;
  event.cancelable = true;
  event.destination = new NavigationDestinationImpl(
    document.env.parseHTMLURL('/initial-target')!, null, document.env.serializeForStorage({ original: true }), true, document.env,
  );
  event.signal = document.env.createAbortController().signal;
  event.info = { original: true };
  const platformEvent = project(event) as BrowletNavigateEvent;
  navigation.addEventListener('navigate', () => { platformEvent.intercept(); }, { capture: false, once: true });
  navigation.dispatch(event);
  expect(event.interceptionState).toBe('intercepted');
  navigation.ongoingNavigateEvent = event;
  const controller = new NavigationPrecommitControllerImpl(event, document.env);
  const platform = getBindingContext(document.env.realm).project(NavigationPrecommitControllerImpl, controller) as NavigationPrecommitController;
  Reflect.set(browser.window, 'controllerForTest', platform);
  Reflect.set(browser.window, 'navigateEventForTest', platformEvent);
  return { browser, document, navigation, event, platformEvent, controller, platform };
}
