import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createWindowEnvironment } from '../../../src/browlet/bindings';
import { BrowsingContext, TopLevelTraversable, createDocumentState } from '../../../src/browlet/browsing/navigation/index';
import { BroadcastChannelImpl } from '../../../src/browlet/communication/index';
import type { BroadcastChannel, MessageEvent } from '../../../src/browlet/platform';
import { AgentCluster, WindowAgent } from '../../../src/browlet/scripting/agents';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../src/url/index';
import { createManualEventLoop } from '../../support/browlet-agent';
import { getBindingContext } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('BroadcastChannel (§9.5)', () => {
  it('broadcasts asynchronously through author code with MessageEvent defaults', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const result = await browser.evaluate(() => new Promise((resolve) => {
      const sender = new BroadcastChannel('news');
      const receiver = new BroadcastChannel('news');
      const payload = { items: [1] };
      let returned = false;
      let echoed = false;
      sender.onmessage = () => { echoed = true; };
      receiver.onmessage = (event) => {
        sender.close();
        receiver.close();
        resolve([
          returned, echoed, event.data, event.data !== payload, event.isTrusted,
          event.origin, event.source, event.lastEventId, event.bubbles, event.cancelable,
          event.ports.length, Object.isFrozen(event.ports), event.target === receiver,
          event instanceof MessageEvent, Object.getPrototypeOf(event.data) === Object.prototype,
        ]);
      };
      sender.postMessage(payload);
      payload.items.push(2);
      returned = true;
    }));
    expect(result).toEqual([
      true, false, { items: [1] }, true, true, 'https://example.test', null, '', false, false,
      0, true, true, true, true,
    ]);
  });

  it('converts the required name through Web IDL and exposes a readonly attribute', async () => {
    const browser = new Browlet({ route: () => '' });
    const result = await browser.evaluate(() => {
      let conversions = 0;
      const channel = new BroadcastChannel({ toString() { conversions++; return 'news'; } } as unknown as string);
      const failures: string[] = [];
      for (const args of [[], [Symbol()]]) {
        try { Reflect.construct(BroadcastChannel, args); }
        catch (error) { failures.push((error as Error).name); }
      }
      const details = [
        channel.name, conversions, channel instanceof EventTarget,
        channel.onmessage, channel.onmessageerror, Reflect.set(channel, 'name', 'other'), failures,
      ];
      channel.close();
      return details;
    });
    expect(result).toEqual(['news', 1, true, null, null, false, ['TypeError', 'TypeError']]);
  });

  it.each(['', 'News', '雪\u0000'])('matches the exact channel name %j and excludes the sender', (name) => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel(name);
    const receiver = new page.window.BroadcastChannel(name);
    const other = new page.window.BroadcastChannel(`${name}x`);
    const ownEvents = collect(sender);
    const events = collect(receiver);
    const otherEvents = collect(other);
    sender.postMessage(undefined);
    page.drain();
    expect(ownEvents).toEqual([]);
    expect(otherEvents).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBeUndefined();
  });

  it('routes across unrelated same-origin Windows on their own agents', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent, 'https://example.test/a');
    const b = createWindow(userAgent, 'https://example.test/b');
    const c = createWindow(userAgent, 'https://example.test/c');
    const sender = new a.window.BroadcastChannel('news');
    const bEvents = collect(new b.window.BroadcastChannel('news'));
    const cEvents = collect(new c.window.BroadcastChannel('news'));
    sender.postMessage({ list: [1] });
    a.drain();
    expect(bEvents).toEqual([]);
    expect(cEvents).toEqual([]);
    b.drain();
    expect(bEvents).toHaveLength(1);
    expect(cEvents).toEqual([]);
    (bEvents[0]!.data as { list: number[]; }).list.push(2);
    c.drain();
    expect(cEvents[0]!.data).toEqual({ list: [1] });
    expect(Object.getPrototypeOf(bEvents[0]!.data)).toBe(b.env.realm.Object.prototype);
    expect(Object.getPrototypeOf(cEvents[0]!.data)).toBe(c.env.realm.Object.prototype);
    expect(bEvents[0]).toBeInstanceOf(b.window.MessageEvent);
    expect(cEvents[0]).toBeInstanceOf(c.window.MessageEvent);
  });

  it.each(['http://example.test/', 'https://elsewhere.test/', 'https://example.test:8443/'])(
    'does not broadcast across storage keys to %s', (url) => {
      const userAgent = new UserAgent();
      const sender = createWindow(userAgent);
      const other = createWindow(userAgent, url);
      const events = collect(new other.window.BroadcastChannel('news'));
      new sender.window.BroadcastChannel('news').postMessage('private');
      other.drain();
      expect(events).toEqual([]);
    },
  );

  it('keeps separate UserAgents isolated even with matching origins and names', () => {
    const a = createWindow();
    const b = createWindow();
    const events = collect(new b.window.BroadcastChannel('news'));
    new a.window.BroadcastChannel('news').postMessage('private');
    b.drain();
    expect(events).toEqual([]);
  });

  it('uses non-storage keys when storage is disabled', () => {
    const page = createWindow();
    page.env.userAgent.storageEnabled = false;
    const events = collect(new page.window.BroadcastChannel('news'));
    new page.window.BroadcastChannel('news').postMessage('available');
    page.drain();
    expect(events.map((event): unknown => event.data)).toEqual(['available']);
  });

  it('compares opaque origins by identity and reports null as the origin string', () => {
    const userAgent = new UserAgent();
    const origin = createOpaqueOrigin();
    const a = createWindow(userAgent, 'data:,a', undefined, origin);
    const b = createWindow(userAgent, 'data:,b', undefined, origin);
    const other = createWindow(userAgent, 'data:,other');
    const events = collect(new b.window.BroadcastChannel('news'));
    const otherEvents = collect(new other.window.BroadcastChannel('news'));
    new a.window.BroadcastChannel('news').postMessage('shared origin');
    b.drain();
    other.drain();
    expect(events.map((event): unknown => [event.data, event.origin])).toEqual([['shared origin', 'null']]);
    expect(otherEvents).toEqual([]);
  });

  it('does not substitute document.domain relaxation for storage-key equality', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent, 'https://a.example.test/');
    const b = createWindow(userAgent, 'https://b.example.test/');
    if (a.document.origin.kind !== 'tuple' || b.document.origin.kind !== 'tuple') throw new Error('Tuple origins required');
    a.document.origin.domain = { kind: 'domain', value: 'example.test' };
    b.document.origin.domain = { kind: 'domain', value: 'example.test' };
    const events = collect(new b.window.BroadcastChannel('news'));
    new a.window.BroadcastChannel('news').postMessage('private');
    b.drain();
    expect(events).toEqual([]);
  });

  it('uses the channel owner when postMessage is borrowed from another realm', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent);
    const b = createWindow(userAgent, 'https://other.test/');
    const sender = new a.window.BroadcastChannel('news');
    const events = collect(new a.window.BroadcastChannel('news'));
    b.window.BroadcastChannel.prototype.postMessage.call(sender, 'owner');
    a.drain();
    expect(events.map((event): unknown => [event.data, event.origin])).toEqual([['owner', 'https://example.test']]);
  });

  it('serializes once and selects destinations after serialization, before delivery', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    const first = collect(new page.window.BroadcastChannel('news'));
    let during: MessageEvent[] = [];
    let reads = 0;
    sender.postMessage({
      get value() {
        reads++;
        during = collect(new page.window.BroadcastChannel('news'));
        return 1;
      },
    });
    const late = collect(new page.window.BroadcastChannel('news'));
    expect(reads).toBe(1);
    expect(first).toEqual([]);
    page.drain();
    expect(reads).toBe(1);
    expect(first[0]!.data).toEqual({ value: 1 });
    expect(during[0]!.data).toEqual({ value: 1 });
    expect(late).toEqual([]);
  });

  it('keeps creation order within an agent regardless of listener-registration order', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent);
    const b = createWindow(userAgent, 'https://example.test/b', a.env.realm.agent);
    const sender = new a.window.BroadcastChannel('news');
    const first = new b.window.BroadcastChannel('news');
    const second = new a.window.BroadcastChannel('news');
    const trace: unknown[] = [];
    second.onmessage = (event) => { trace.push(['second', (event as MessageEvent).data]); };
    first.onmessage = (event) => { trace.push(['first', (event as MessageEvent).data]); };
    sender.postMessage(1);
    sender.postMessage(2);
    a.drain();
    expect(trace).toEqual([['first', 1], ['second', 1], ['first', 2], ['second', 2]]);
  });

  it('performs a microtask checkpoint between broadcast deliveries', async () => {
    const browser = new Browlet({ route: () => '' });
    const result = await browser.evaluate(() => new Promise((resolve) => {
      const sender = new BroadcastChannel('news');
      const first = new BroadcastChannel('news');
      const second = new BroadcastChannel('news');
      const trace: string[] = [];
      first.onmessage = () => {
        trace.push('first');
        queueMicrotask(() => { trace.push('microtask'); });
      };
      second.onmessage = () => {
        trace.push('second');
        for (const channel of [sender, first, second]) channel.close();
        resolve(trace);
      };
      sender.postMessage('go');
    }));
    expect(result).toEqual(['first', 'microtask', 'second']);
  });

  it('reports cloning failures even without recipients, and cannot transfer ports', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    expect(() => sender.postMessage(() => {})).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    const { port1, port2 } = new page.window.MessageChannel();
    expect(() => sender.postMessage(port1)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    port1.close();
    port2.close();
  });

  it('clones ArrayBuffers without detaching them, ignoring an extra transfer argument', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    const events = collect(new page.window.BroadcastChannel('news'));
    const buffer = new ArrayBuffer(2);
    new Uint8Array(buffer).set([3, 7]);
    Reflect.apply(sender.postMessage.bind(sender), null, [buffer, [buffer]]);
    expect(buffer.byteLength).toBe(2);
    page.drain();
    const received = events[0]!.data as ArrayBuffer;
    expect(received).not.toBe(buffer);
    expect([...new Uint8Array(received)]).toEqual([3, 7]);
  });

  it('throws for a closed eligible sender before serializing', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    const read = vi.fn(() => 1);
    sender.close();
    sender.close();
    expect(() => sender.postMessage({ get value() { return read(); } })).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores an inactive sender before both the closed check and serialization', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    const events = collect(new page.window.BroadcastChannel('news'));
    const read = vi.fn(() => 1);
    page.document.browsingContext = null;
    sender.postMessage({ get value() { return read(); } });
    sender.close();
    expect(() => sender.postMessage(() => {})).not.toThrow();
    expect(read).not.toHaveBeenCalled();
    page.drain();
    expect(events).toEqual([]);
  });

  it('excludes inactive recipients when selecting destinations', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent);
    const b = createWindow(userAgent);
    const sender = new a.window.BroadcastChannel('news');
    const events = collect(new b.window.BroadcastChannel('news'));
    const context = b.document.browsingContext;
    b.document.browsingContext = null;
    sender.postMessage('excluded');
    b.document.browsingContext = context;
    b.drain();
    expect(events).toEqual([]);
    sender.postMessage('included');
    b.drain();
    expect(events.map((event): unknown => event.data)).toEqual(['included']);
  });

  it('holds an already queued delivery while its destination Document is inactive', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent);
    const b = createWindow(userAgent);
    const events = collect(new b.window.BroadcastChannel('news'));
    new a.window.BroadcastChannel('news').postMessage('pending');
    const context = b.document.browsingContext;
    b.document.browsingContext = null;
    b.drain();
    expect(events).toEqual([]);
    b.document.browsingContext = context;
    b.drain();
    expect(events.map((event): unknown => event.data)).toEqual(['pending']);
  });

  it('drops queued delivery to a closed channel, including closure by an earlier recipient', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    const first = new page.window.BroadcastChannel('news');
    const second = new page.window.BroadcastChannel('news');
    const closed = new page.window.BroadcastChannel('news');
    const secondEvents = collect(second);
    const closedEvents = collect(closed);
    first.onmessage = () => { second.close(); };
    sender.postMessage('pending');
    closed.close();
    page.drain();
    expect(secondEvents).toEqual([]);
    expect(closedEvents).toEqual([]);
  });

  it('does not cancel messages when the sender closes during or after serialization', () => {
    const page = createWindow();
    const sender = new page.window.BroadcastChannel('news');
    const events = collect(new page.window.BroadcastChannel('news'));
    sender.postMessage({ get value() { sender.close(); return 1; } });
    sender.close();
    page.drain();
    expect(events[0]!.data).toEqual({ value: 1 });
  });

  it('reports reconstruction failure to that recipient without disrupting other recipients', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent);
    const b = createWindow(userAgent);
    const c = createWindow(userAgent);
    const sender = new a.window.BroadcastChannel('news');
    const receiver = new b.window.BroadcastChannel('news');
    const errors: MessageEvent[] = [];
    receiver.onmessageerror = (event) => { errors.push(event as MessageEvent); };
    const bEvents = collect(receiver);
    const cEvents = collect(new c.window.BroadcastChannel('news'));
    vi.spyOn(b.env, 'deserialize').mockImplementationOnce(() => { throw new Error('reconstruction failed'); });
    sender.postMessage(1);
    sender.postMessage(2);
    b.drain();
    c.drain();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(b.window.MessageEvent);
    expect(errors[0]).toMatchObject({ type: 'messageerror', origin: 'https://example.test', data: null, source: null, isTrusted: true });
    expect(errors[0]!.ports).toEqual([]);
    expect(Object.isFrozen(errors[0]!.ports)).toBe(true);
    expect(bEvents.map((event): unknown => event.data)).toEqual([2]);
    expect(cEvents.map((event): unknown => event.data)).toEqual([1, 2]);
  });

  it('retains only open listening channels, covering handlers, once, abort, and removal', () => {
    const page = createWindow();
    const channel = new page.window.BroadcastChannel('news');
    const binding = getBindingContext(page.env.realm);
    const implementation = binding.unwrap(channel, BroadcastChannelImpl)!;
    const retained = page.env.getWindowOrWorkerGlobalScopeMixin().broadcastChannels;
    const listener = () => {};
    expect(retained.has(implementation)).toBe(false);
    channel.addEventListener('unrelated', listener);
    expect(retained.has(implementation)).toBe(false);
    channel.onmessageerror = listener;
    expect(retained.has(implementation)).toBe(true);
    channel.onmessage = listener;
    channel.onmessageerror = null;
    expect(retained.has(implementation)).toBe(true);
    channel.onmessage = null;
    expect(retained.has(implementation)).toBe(false);

    channel.addEventListener('message', listener, { once: true });
    channel.dispatchEvent(new page.window.MessageEvent('message'));
    expect(retained.has(implementation)).toBe(false);
    const controller = new page.window.AbortController();
    channel.addEventListener('messageerror', listener, { signal: controller.signal });
    expect(retained.has(implementation)).toBe(true);
    controller.abort();
    expect(retained.has(implementation)).toBe(false);
    channel.addEventListener('message', listener);
    channel.removeEventListener('message', listener);
    expect(retained.has(implementation)).toBe(false);
    channel.onmessage = listener;
    channel.close();
    channel.addEventListener('messageerror', listener);
    expect(retained.has(implementation)).toBe(false);
    expect([...page.env.userAgent.broadcastChannels.values()]).not.toContain(implementation);
  });

  it('removes queued delivery when the receiving Document is destroyed', () => {
    const userAgent = new UserAgent();
    const a = createWindow(userAgent);
    const b = createWindow(userAgent);
    const sender = new a.window.BroadcastChannel('news');
    const events = collect(new b.window.BroadcastChannel('news'));
    b.env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { b.document.destroy(); });
    sender.postMessage('pending');
    b.drain();
    sender.postMessage('after destruction');
    b.drain();
    expect(events).toEqual([]);
    expect(b.document.browsingContext).toBeNull();
  });
});

function collect(channel: BroadcastChannel): MessageEvent[] {
  const events: MessageEvent[] = [];
  channel.onmessage = (event) => { events.push(event as MessageEvent); };
  return events;
}

/** Real Window bindings, with explicit UserAgent ownership and manual task turns. */
function createWindow(
  userAgent = new UserAgent(), url = 'https://example.test/',
  agent = new WindowAgent(createManualEventLoop()), originOverride?: Origin,
) {
  if (agent.agentCluster === null) new AgentCluster().add(agent);
  const creationURL = parseURL(url).url!;
  const origin = originOverride ?? obtainURLOrigin(creationURL);
  const env = createWindowEnvironment({
    userAgent, agent, creationURL, origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: origin,
  });
  const document = env.createDocument();
  document.url = creationURL;
  document.origin = origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  env.realm.windowProxy.setAssociatedWindow(env.realm.globalObject);
  const navigable = new TopLevelTraversable(createDocumentState(document));
  env.markExecutionReady();
  return {
    env, window: env.realm.windowProxy.platform, document, navigable,
    drain() { while (agent.eventLoop.runTaskTurn()) { /* Drain runnable tasks. */ } },
  };
}
