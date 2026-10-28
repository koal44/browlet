import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { MessageEventImpl, MessagePortImpl } from '../../../src/browlet/communication/index';
import type { EventTargetImpl } from '../../../src/browlet/dom/events/index';
import { ServiceWorkerImpl } from '../../../src/browlet/workers/index';
import type { MessageEvent, MessagePort, ServiceWorker } from '../../../src/browlet/platform';
import type { StampedPlatformObject } from '../../../src/web-idl/index';
import { createOpaqueOrigin } from '../../../src/url/index';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('MessageEvent (§9.1)', () => {
  it('constructs default event data and a stable frozen ports array in its realm', () => {
    const { window } = new Browlet({ route: () => '' });
    const event = new window.MessageEvent('message');
    expect(event).toBeInstanceOf(window.Event);
    expect(event.type).toBe('message');
    expect(event.data).toBeNull();
    expect(event.origin).toBe('');
    expect(event.lastEventId).toBe('');
    expect(event.source).toBeNull();
    expect(event.ports).toEqual([]);
    expect(Object.isFrozen(event.ports)).toBe(true);
    expect(Object.getPrototypeOf(event.ports)).toBe((Reflect.get(window, 'Array') as ArrayConstructor).prototype);
    expect(event.ports).toBe(event.ports);
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
    expect(event.composed).toBe(false);
    expect(event.isTrusted).toBe(false);
    expect(() => { Reflect.construct(window.MessageEvent, []); }).toThrow(Reflect.get(window, 'TypeError'));
  });

  it('retains payload identity and applies the declared string and dictionary conversions', () => {
    const { window } = new Browlet({ route: () => '' });
    const payload = { child: {} };
    const event = new window.MessageEvent('message', {
      data: payload, origin: 'not a URL\ud800', lastEventId: '\ud800',
      source: window, bubbles: true, cancelable: true, composed: true,
    });
    expect(event.data).toBe(payload);
    expect(event.origin).toBe('not a URL\ufffd');
    expect(event.lastEventId).toBe('\ud800');
    expect(event.source).toBe(window);
    expect([event.bubbles, event.cancelable, event.composed]).toEqual([true, true, true]);
    expect(new window.MessageEvent('message', { data: undefined }).data).toBeNull();
    expect(new window.MessageEvent('message', { data: false }).data).toBe(false);
    const token = Symbol('payload');
    expect(new window.MessageEvent('message', { data: token }).data).toBe(token);
    const fromNull = Reflect.construct(window.MessageEvent, ['message', null]) as MessageEvent;
    expect(fromNull.data).toBeNull();
  });

  it('preserves an undefined payload initialized before trusted delivery', () => {
    const { window } = new Browlet({ route: () => '' });
    const target = new window.EventTarget();
    const received: MessageEvent[] = [];
    target.addEventListener('message', (event) => {
      received.push(event as MessageEvent);
    });

    unwrap<EventTargetImpl>(target).fireEvent('message', MessageEventImpl, (event) => {
      const message = event as MessageEventImpl;
      expect(message.data).toBeNull();
      message.data = undefined;
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(window.MessageEvent);
    expect(received[0]!.isTrusted).toBe(true);
    expect(received[0]!.data).toBeUndefined();
  });

  it('validates source and ports against their interface identities', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test');
    const { window } = browser;
    const binding = getBindingContext(getRelevantRealm(browser.document));
    const port = binding.project(MessagePortImpl, new MessagePortImpl(binding.getEnvironment())) as StampedPlatformObject<MessagePort>;
    const worker = binding.project(ServiceWorkerImpl, new ServiceWorkerImpl(binding.getEnvironment())) as StampedPlatformObject<ServiceWorker>;
    for (const source of [window, port, worker]) {
      const event = new window.MessageEvent('message', { source });
      expect(event.source).toBe(source);
    }
    for (const source of [{}, new window.EventTarget(), 1]) {
      expect(() => { Reflect.construct(window.MessageEvent, ['message', { source }]); }).toThrow(Reflect.get(window, 'TypeError'));
    }
    for (const ports of [[{}], [worker], [window], null, {}]) {
      expect(() => { Reflect.construct(window.MessageEvent, ['message', { ports }]); }).toThrow(Reflect.get(window, 'TypeError'));
    }
    expect(() => { Reflect.construct(window.MessagePort as unknown as new () => MessagePort, []); }).toThrow(Reflect.get(window, 'TypeError'));
    expect(() => { Reflect.construct(window.ServiceWorker as unknown as new () => ServiceWorker, []); }).toThrow(Reflect.get(window, 'TypeError'));
  });

  it('snapshots ordered ports without transferring them and preserves their own realm identities', () => {
    const target = new Browlet({ route: () => '' });
    const sender = new Browlet({ route: () => '' });
    const binding = getBindingContext(getRelevantRealm(sender.document));
    const port = binding.project(MessagePortImpl, new MessagePortImpl(binding.getEnvironment())) as StampedPlatformObject<MessagePort>;
    const ports: MessagePort[] = [port, port];
    const event = new target.window.MessageEvent('message', { source: sender.window, ports });
    ports.length = 0;
    expect(event.source).toBe(sender.window);
    expect(event.ports).toEqual([port, port]);
    expect(event.ports[0]).toBe(port);
    expect(port).toBeInstanceOf(sender.window.MessagePort);
    expect(Object.getPrototypeOf(event.ports)).toBe((Reflect.get(target.window, 'Array') as ArrayConstructor).prototype);
    expect(Object.isFrozen(event.ports)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrowing the getter across realms is the behavior under test.
    const borrowed = Object.getOwnPropertyDescriptor(sender.window.MessageEvent.prototype, 'ports')!.get!;
    expect(borrowed.call(event)).toBe(event.ports);
    expect(() => { borrowed.call({}); }).toThrow(Reflect.get(sender.window, 'TypeError'));
    const fromIterable = new target.window.MessageEvent('message', { ports: new Set([port]) });
    expect(fromIterable.ports).toEqual([port]);
  });

  it('keeps native port snapshots separate from caller arrays and projects newly allocated ports', () => {
    const browser = new Browlet({ route: () => '' });
    const binding = getBindingContext(getRelevantRealm(browser.document));
    const port = new MessagePortImpl(binding.getEnvironment());
    const ports = [port];
    const implementation = new MessageEventImpl('message', { ports });
    ports.length = 0;
    const event = binding.project(MessageEventImpl, implementation) as StampedPlatformObject<MessageEvent>;
    expect(event.ports).toHaveLength(1);
    expect(event.ports[0]).toBeInstanceOf(browser.window.MessagePort);
    expect(unwrap(event.ports[0]!)).toBe(port);
    expect(Object.isFrozen(event.ports)).toBe(true);
  });

  it('reinitializes an idle event while preserving timestamp, composed, and old port snapshots', () => {
    const browser = new Browlet({ route: () => '' });
    const { window } = browser;
    const binding = getBindingContext(getRelevantRealm(browser.document));
    const port = binding.project(MessagePortImpl, new MessagePortImpl(binding.getEnvironment())) as StampedPlatformObject<MessagePort>;
    const event = new window.MessageEvent('before', {
      bubbles: true, cancelable: true, composed: true, source: window, ports: [port],
    });
    const previousPorts = event.ports;
    const timeStamp = event.timeStamp;
    window.document.dispatchEvent(event);
    event.preventDefault();
    event.stopImmediatePropagation();
    unwrap<MessageEventImpl>(event).isTrusted = true;
    event.initMessageEvent('after', false, false, 0, 'literal origin', 'id', port, [port, port]);
    expect(event.type).toBe('after');
    expect(event.data).toBe(0);
    expect(event.origin).toBe('literal origin');
    expect(event.lastEventId).toBe('id');
    expect(event.source).toBe(port);
    expect(event.ports).toEqual([port, port]);
    expect(event.ports).not.toBe(previousPorts);
    expect(previousPorts).toEqual([port]);
    expect(event.target).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelBubble).toBe(false);
    expect(event.isTrusted).toBe(false);
    expect(event.composed).toBe(true);
    expect(event.timeStamp).toBe(timeStamp);
    event.initMessageEvent('defaults');
    expect(event.data).toBeNull();
    expect(event.origin).toBe('');
    expect(event.lastEventId).toBe('');
    expect(event.source).toBeNull();
    expect(event.ports).toEqual([]);
    expect(Object.isFrozen(event.ports)).toBe(true);
  });

  it('ignores legacy initialization during dispatch but still performs Web IDL conversion', async () => {
    const browser = new Browlet({ route: () => '' });
    const result = await browser.evaluate(() => {
      const event = new window.MessageEvent('before', { data: 1, origin: 'sender', cancelable: true });
      const originalPorts = event.ports;
      let converted = false;
      window.document.addEventListener('before', () => {
        event.preventDefault();
        const type = { toString() { converted = true; return 'after'; } };
        Reflect.apply(Reflect.get(event, 'initMessageEvent'), event, [type, false, false, 2, 'different']);
      });
      window.document.dispatchEvent(event);
      const data: unknown = event.data;
      return [converted, event.type, data, event.origin, event.defaultPrevented, event.ports === originalPorts];
    });
    expect(result).toEqual([true, 'before', 1, 'sender', true, true]);
  });

  it('supports the DOM legacy factory and requires initialization before dispatch', () => {
    const { window } = new Browlet({ route: () => '' });
    const event = window.document.createEvent('mEsSaGeEvEnT') as StampedPlatformObject<MessageEvent>;
    expect(event).toBeInstanceOf(window.MessageEvent);
    expect(event.type).toBe('');
    expect(event.data).toBeNull();
    expect(event.ports).toEqual([]);
    expect(() => window.document.dispatchEvent(event)).toThrow(window.DOMException);
    event.initMessageEvent('message');
    expect(window.document.dispatchEvent(event)).toBe(true);
  });

  it('retains internal origin records and replaces them with literal strings on reinitialization', () => {
    const browser = new Browlet({ route: () => '' });
    const binding = getBindingContext(getRelevantRealm(browser.document));
    const origin = createOpaqueOrigin();
    const implementation = new MessageEventImpl('message', {}, 0, origin);
    const event = binding.project(MessageEventImpl, implementation) as StampedPlatformObject<MessageEvent>;
    expect(event.origin).toBe('null');
    expect(implementation.extractOrigin()).toBe(origin);
    expect(browser.window.Origin.from(event).opaque).toBe(true);
    event.initMessageEvent('message', false, false, null, 'https://example.test');
    expect(implementation.extractOrigin()).toBeNull();
    expect(event.origin).toBe('https://example.test');
    expect(() => browser.window.Origin.from(event)).toThrow(Reflect.get(browser.window, 'TypeError'));
  });
});
