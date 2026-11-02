import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { EventTargetImpl } from '../../../src/browlet/dom/events/index';
import type { AbortSignalImpl } from '../../../src/browlet/dom/abort/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML erasing event listeners and handlers', () => {
  it.each(handlerTargets())('clears $name handlers and allows fresh activation', async ({ create, handlers }) => {
    const browser = await createBrowser();
    const { target, dispose } = await create(browser);
    const implementation = target === browser.window
      ? getRelevantRealm(browser.window).env.window
      : unwrap<EventTargetImpl>(target);
    const trace: string[] = [];
    const callbacks = handlers.map((name) => () => { trace.push(name); });
    try {
      for (const [index, name] of handlers.entries()) {
        Reflect.set(target, name, callbacks[index]);
        target.addEventListener(name.slice(2), () => { trace.push('ordinary'); });
        expect(Reflect.get(target, name)).toBe(callbacks[index]);
        expect(implementation.hasEventListener(name.slice(2))).toBe(true);
      }

      implementation.eraseAllEventListenersAndHandlers();
      for (const name of handlers) {
        expect(Reflect.get(target, name)).toBeNull();
        expect(implementation.hasEventListener(name.slice(2))).toBe(false);
        target.dispatchEvent(new browser.window.Event(name.slice(2)));
      }
      expect(trace).toEqual([]);

      const first = handlers[0]!;
      target.addEventListener(first.slice(2), () => { trace.push('new ordinary'); });
      Reflect.set(target, first, callbacks[0]);
      target.dispatchEvent(new browser.window.Event(first.slice(2)));
      expect(trace).toEqual(['new ordinary', first]);

      implementation.eraseAllEventListenersAndHandlers();
      implementation.eraseAllEventListenersAndHandlers();
      expect(Reflect.get(target, first)).toBeNull();
      expect(implementation.hasEventListener(first.slice(2))).toBe(false);
    } finally {
      dispose?.();
    }
  });

  it('also removes ordinary listeners and abort registrations from a target without handlers', async () => {
    const browser = await createBrowser();
    const target = new browser.window.EventTarget();
    const controller = new browser.window.AbortController();
    const signal = unwrap<AbortSignalImpl>(controller.signal);
    const unregister = vi.spyOn(signal, 'removeAlgorithm');
    const listener = vi.fn();
    target.addEventListener('ready', listener, { signal: controller.signal });
    target.addEventListener('ready', listener, { capture: true, once: true });
    const implementation = unwrap<EventTargetImpl>(target);

    implementation.eraseAllEventListenersAndHandlers();
    target.dispatchEvent(new browser.window.Event('ready'));
    expect(listener).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledOnce();

    // Reusing the callback creates an independent registration without the old signal.
    target.addEventListener('ready', listener);
    controller.abort();
    target.dispatchEvent(new browser.window.Event('ready'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not turn DOM-only listener removal into handler erasure', async () => {
    const browser = await createBrowser();
    const handler = vi.fn();
    browser.window.onstorage = handler;
    const implementation = getRelevantRealm(browser.window).env.window;
    implementation.removeAllEventListeners();
    expect(browser.window.onstorage).toBe(handler);
    browser.window.dispatchEvent(new browser.window.StorageEvent('storage'));
    expect(handler).not.toHaveBeenCalled();

    implementation.eraseAllEventListenersAndHandlers();
    expect(browser.window.onstorage).toBeNull();
    browser.window.onstorage = handler;
    browser.window.dispatchEvent(new browser.window.StorageEvent('storage'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('suppresses removed listeners in an active dispatch and reactivates the handler for the next dispatch', async () => {
    const browser = await createBrowser();
    const target = browser.window;
    const implementation = getRelevantRealm(target).env.window;
    const trace: string[] = [];
    target.addEventListener('storage', () => {
      trace.push('erase');
      implementation.eraseAllEventListenersAndHandlers();
      target.onstorage = () => { trace.push('new handler'); };
      target.addEventListener('storage', () => { trace.push('new ordinary'); });
    });
    target.onstorage = () => { trace.push('old handler'); };
    target.addEventListener('storage', () => { trace.push('old ordinary'); });

    target.dispatchEvent(new target.StorageEvent('storage'));
    expect(trace).toEqual(['erase']);
    target.dispatchEvent(new target.StorageEvent('storage'));
    expect(trace).toEqual(['erase', 'new handler', 'new ordinary']);
  });

  it('finishes the executing handler after erasure without invoking its replacement in that dispatch', async () => {
    const browser = await createBrowser();
    const target = browser.window;
    const implementation = getRelevantRealm(target).env.window;
    const trace: (string | boolean)[] = [];
    target.onstorage = () => {
      trace.push('old handler');
      implementation.eraseAllEventListenersAndHandlers();
      trace.push(target.onstorage === null);
      target.onstorage = () => { trace.push('new handler'); };
      return false;
    };
    target.addEventListener('storage', () => { trace.push('old ordinary'); });

    expect(target.dispatchEvent(new target.StorageEvent('storage', { cancelable: true }))).toBe(false);
    expect(trace).toEqual(['old handler', true]);
    expect(target.dispatchEvent(new target.StorageEvent('storage', { cancelable: true }))).toBe(true);
    expect(trace).toEqual(['old handler', true, 'new handler']);
  });

  it('erases only the supplied target, leaving document.open to select descendants and the Window', async () => {
    const browser = await createBrowser();
    const window = browser.window;
    const document = window.document;
    const element = document.createElement('div');
    document.body!.append(element);
    const shadow = element.attachShadow({ mode: 'open' });
    const listener = vi.fn();
    document.onreadystatechange = listener;
    window.onstorage = listener;
    shadow.onslotchange = listener;
    element.addEventListener('ready', listener);

    unwrap<EventTargetImpl>(document).eraseAllEventListenersAndHandlers();
    expect(document.onreadystatechange).toBeNull();
    expect(window.onstorage).toBe(listener);
    expect(shadow.onslotchange).toBe(listener);
    document.dispatchEvent(new window.Event('readystatechange'));
    element.dispatchEvent(new window.Event('ready'));
    shadow.dispatchEvent(new window.Event('slotchange'));
    window.dispatchEvent(new window.StorageEvent('storage'));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/');
  return browser;
}

function handlerTargets(): HandlerTargetCase[] {
  return [
    { name: 'Window', handlers: ['onclick', 'onerror', 'onbeforeunload', 'onstorage'], create: (browser) => ({ target: browser.window }) },
    { name: 'HTMLElement', handlers: ['onclick', 'onerror'], create: (browser) => ({ target: browser.window.document.createElement('div') }) },
    { name: 'Document', handlers: ['onreadystatechange'], create: (browser) => ({ target: browser.window.document }) },
    {
      name: 'ShadowRoot', handlers: ['onslotchange'],
      create: (browser) => ({ target: browser.window.document.createElement('div').attachShadow({ mode: 'open' }) }),
    },
    { name: 'AbortSignal', handlers: ['onabort'], create: (browser) => ({ target: new browser.window.AbortController().signal }) },
    {
      name: 'FileReader', handlers: ['onloadstart', 'onprogress', 'onload', 'onabort', 'onerror', 'onloadend'],
      create: (browser) => ({ target: new browser.window.FileReader() }),
    },
    {
      name: 'BroadcastChannel', handlers: ['onmessage', 'onmessageerror'],
      create(browser) {
        const target = new browser.window.BroadcastChannel('erase-handlers');
        return { target, dispose: () => { target.close(); } };
      },
    },
    {
      name: 'EventSource', handlers: ['onopen', 'onmessage', 'onerror'],
      create(browser) {
        const target = new browser.window.EventSource('/events');
        target.close();
        return { target };
      },
    },
    {
      name: 'MessagePort', handlers: ['onmessage', 'onmessageerror'],
      create(browser) {
        const channel = new browser.window.MessageChannel();
        return { target: channel.port1, dispose() { channel.port1.close(); channel.port2.close(); } };
      },
    },
    {
      name: 'Navigation', handlers: ['onnavigate', 'onnavigatesuccess', 'onnavigateerror', 'oncurrententrychange'],
      create: (browser) => ({ target: browser.window.navigation }),
    },
    {
      name: 'NavigationHistoryEntry', handlers: ['ondispose'],
      create: (browser) => ({ target: browser.window.navigation.currentEntry! }),
    },
    {
      name: 'PermissionStatus', handlers: ['onchange'],
      create: async (browser) => ({ target: await browser.window.navigator.permissions.query({ name: 'persistent-storage' }) }),
    },
  ];
}

type HandlerTargetCase = {
  name: string;
  handlers: string[];
  create: (browser: Browlet) => HandlerTargetFixture | Promise<HandlerTargetFixture>;
};

type HandlerTargetFixture = {
  target: EventTarget;
  dispose?: () => void;
};
