/* eslint-disable @typescript-eslint/unbound-method -- Tests invoke borrowed methods with an explicit receiver. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createWindowEnvironment } from '../../../src/browlet/bindings';
import { BrowsingContext, TopLevelTraversable, createDocumentState } from '../../../src/browlet/browsing/navigation/index';
import { WindowImpl } from '../../../src/browlet/browsing/window/index';
import type { MessageEvent, Window } from '../../../src/browlet/platform';
import { AgentCluster, WindowAgent } from '../../../src/browlet/scripting/agents';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../src/url/index';
import type { StampedPlatformObject } from '../../../src/web-idl/index';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Window.postMessage (§9.3)', () => {
  it('delivers a trusted event asynchronously from page code', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const result = await browser.evaluate(() => new Promise((resolve) => {
      let returned = false;
      window.addEventListener('message', (event) => {
        const message = event as MessageEvent;
        resolve([
          returned, message.data, message.origin, message.source === window,
          message.isTrusted, message.bubbles, message.cancelable, message.lastEventId,
          message.ports.length, Object.isFrozen(message.ports),
        ]);
      }, { once: true });
      window.postMessage(undefined);
      returned = true;
    }));
    expect(result).toEqual([true, undefined, 'https://example.test', true, true, false, false, '', 0, true]);
  });

  it('serializes immediately, delivers in order, and reconstructs in the receiver realm', () => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    const payload: { list: number[]; self?: object; } = { list: [1] };
    payload.self = payload;
    const blob = new sender.window.Blob(['hello']);
    sender.run(() => {
      target.window.postMessage({ payload, blob }, '*');
      target.window.postMessage('second', { targetOrigin: '*' });
    });
    payload.list.push(2);
    expect(target.events).toEqual([]);
    target.drain();
    expect(target.events).toHaveLength(2);
    const event = target.events[0]!;
    const data = event.data as { payload: typeof payload; blob: Blob; };
    expect(event).toBeInstanceOf(target.window.MessageEvent);
    expect(event.source).toBe(sender.window);
    expect(event.origin).toBe('https://a.example.test');
    expect(data.payload.list).toEqual([1]);
    expect(data.payload.self).toBe(data.payload);
    expect(data.blob).not.toBe(blob);
    expect(data.blob).toBeInstanceOf(target.window.Blob);
    expect(Object.getPrototypeOf(data.payload)).toBe(target.env.realm.Object.prototype);
    expect(Object.getPrototypeOf(data.payload.list)).toBe(target.env.realm.Array.prototype);
    expect(Object.getPrototypeOf(event.ports)).toBe(target.env.realm.Array.prototype);
    expect(target.events[1]!.data).toBe('second');
  });

  it('supports both overloads, dictionary defaults, and a URL origin without its path', () => {
    const sender = createWindow('https://same.test/from');
    const target = createWindow('https://same.test/to', sender.agent);
    sender.run(() => {
      target.window.postMessage('omitted');
      target.window.postMessage('undefined', undefined);
      target.window.postMessage('dictionary', {});
      Reflect.apply(target.window.postMessage, target.window, ['null dictionary', null]);
      target.window.postMessage('slash', '/');
      target.window.postMessage('explicit', 'https://same.test:443/path?query#fragment');
    });
    target.drain();
    expect(target.events.map((event): unknown => event.data)).toEqual([
      'omitted', 'undefined', 'dictionary', 'null dictionary', 'slash', 'explicit',
    ]);
  });

  it('discards origin mismatches and does not use document.domain for matching', () => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    // Domain relaxation does not change the origin tuple used by postMessage.
    if (sender.document.origin.kind === 'tuple') sender.document.origin.domain = { kind: 'domain', value: 'example.test' };
    if (target.document.origin.kind === 'tuple') target.document.origin.domain = { kind: 'domain', value: 'example.test' };
    sender.run(() => {
      target.window.postMessage('default');
      target.window.postMessage('wrong port', 'https://b.example.test:444');
      target.window.postMessage('wrong scheme', 'http://b.example.test');
      target.window.postMessage('wildcard', '*');
    });
    target.drain();
    expect(target.events.map((event): unknown => event.data)).toEqual(['wildcard']);
    expect(target.events[0]!.origin).toBe('https://a.example.test');
  });

  it('matches opaque origins by identity for slash, not by their null serialization', () => {
    const sender = createWindow('about:blank');
    const target = createWindow('about:blank', sender.agent);
    sender.run(() => {
      sender.window.postMessage('self');
      target.window.postMessage('other opaque');
      target.window.postMessage('parsed opaque', 'data:text/plain,hello');
      target.window.postMessage('wildcard', '*');
    });
    target.drain();
    expect(sender.events.map((event): unknown => event.data)).toEqual(['self']);
    expect(target.events.map((event): unknown => event.data)).toEqual(['wildcard']);
    expect(target.events[0]!.origin).toBe('null');
  });

  it('validates targetOrigin before serializing or detaching', () => {
    const sender = createWindow('https://sender.test/');
    const read = vi.fn(() => 1);
    const payload = { get value() { return read(); } };
    const buffer = new ArrayBuffer(3);
    sender.run(() => {
      for (const targetOrigin of ['null', '', '/relative', 'http://[']) {
        expect(() => sender.window.postMessage(payload, targetOrigin, [buffer]))
          .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
      }
      expect(() => { Reflect.apply(sender.window.postMessage, sender.window, []); })
        .toThrow(Reflect.get(sender.window, 'TypeError'));
    });
    expect(read).not.toHaveBeenCalled();
    expect(buffer.byteLength).toBe(3);
    sender.drain();
    expect(sender.events).toEqual([]);
  });

  it('does Web IDL dictionary conversion before reading the message graph', () => {
    const sender = createWindow('https://sender.test/');
    const order: string[] = [];
    const options = {
      get targetOrigin() { order.push('targetOrigin'); return '*'; },
      get transfer() { order.push('transfer'); return []; },
    };
    sender.run(() => sender.window.postMessage({ get value() { order.push('message'); return 1; } }, options));
    // Inherited dictionary members are converted before the derived members.
    expect(order).toEqual(['transfer', 'targetOrigin', 'message']);
  });

  it.each(['string', 'dictionary'] as const)('transfers ArrayBuffers through the %s overload', (overload) => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const view = new Uint8Array(buffer);
    sender.run(() => {
      if (overload === 'string') target.window.postMessage({ buffer, view }, '*', [buffer]);
      else target.window.postMessage({ buffer, view }, { targetOrigin: '*', transfer: [buffer] });
    });
    expect(buffer.byteLength).toBe(0);
    target.drain();
    const event = target.events[0]!;
    const data = event.data as { buffer: ArrayBuffer; view: Uint8Array; };
    expect(data.view.buffer).toBe(data.buffer);
    expect([...data.view]).toEqual([1, 2, 3]);
    expect(Object.getPrototypeOf(data.buffer)).toBe(target.env.realm.ArrayBuffer.prototype);
    expect(event.ports).toEqual([]);
  });

  it('still serializes and transfers before discarding an origin mismatch', () => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    const buffer = new ArrayBuffer(4);
    sender.run(() => {
      target.window.postMessage(buffer, { transfer: [buffer] });
      expect(() => target.window.postMessage(() => {}, '/'))
        .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    });
    expect(buffer.byteLength).toBe(0);
    target.drain();
    expect(target.events).toEqual([]);
  });

  it('rejects duplicate transfers without detaching', () => {
    const sender = createWindow('https://sender.test/');
    const buffer = new ArrayBuffer(4);
    sender.run(() => {
      expect(() => sender.window.postMessage(null, '*', [buffer, buffer]))
        .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    });
    expect(buffer.byteLength).toBe(4);
    expect(sender.events).toEqual([]);
  });

  it('delivers transferred ports with matching payload identity and a working connection', () => {
    const sender = createWindow('https://sender.test/');
    const receiver = createWindow('https://receiver.test/', sender.agent);
    const { port1, port2 } = new sender.window.MessageChannel();
    port1.postMessage('queued before transfer');
    sender.run(() => receiver.window.postMessage({ port: port2 }, '*', [port2]));
    receiver.drain();
    const event = receiver.events[0]!;
    const port = event.ports[0]!;
    expect((event.data as { port: unknown; }).port).toBe(port);
    expect(port).toBeInstanceOf(receiver.window.MessagePort);
    const messages: unknown[] = [];
    port.onmessage = (event) => { messages.push((event as MessageEvent).data); };
    port1.postMessage('after transfer');
    receiver.drain();
    expect(messages).toEqual(['queued before transfer', 'after transfer']);
  });

  it('queues on the receiving agent when a sender-realm method is borrowed', () => {
    const sender = createWindow('https://sender.test/');
    const target = createWindow('https://target.test/');
    sender.run(() => sender.window.postMessage.call(target.window, 'across agents', { targetOrigin: '*' }));
    sender.drain();
    expect(target.events).toEqual([]);
    target.drain();
    expect(target.events[0]!.data).toBe('across agents');
    expect(target.events[0]!.source).toBe(sender.window);
  });

  it('fires messageerror on a receiving-cluster rejection and continues with later messages', () => {
    const sender = createWindow('https://sender.test/');
    const target = createWindow('https://target.test/');
    // Supply the serialization capability directly; Window isolation-policy
    // setup is separate, unfinished work. Cluster rejection itself is real.
    sender.env.realm.crossOriginIsolated = true;
    sender.run(() => {
      sender.window.postMessage.call(target.window, new SharedArrayBuffer(4), { targetOrigin: '*' });
      sender.window.postMessage.call(target.window, 'next', { targetOrigin: '*' });
    });
    target.drain();
    expect(target.events.map((event) => event.type)).toEqual(['messageerror', 'message']);
    const error = target.events[0]!;
    expect(error.data).toBeNull();
    expect(error.source).toBe(sender.window);
    expect(error.origin).toBe('https://sender.test');
    expect(error.isTrusted).toBe(true);
    expect(error.ports).toEqual([]);
    expect(Object.isFrozen(error.ports)).toBe(true);
    expect(target.events[1]!.data).toBe('next');
  });

  it('checks the receiving document origin when the task runs', () => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    sender.run(() => target.window.postMessage('before', 'https://b.example.test'));
    target.document.origin = createOpaqueOrigin();
    target.drain();
    expect(target.events).toEqual([]);
  });

  it('does not deliver while the receiving document is inactive', () => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    sender.run(() => target.window.postMessage('pending', '*'));
    const entry = target.navigable.activeSessionHistoryEntry;
    target.navigable.activeSessionHistoryEntry = {
      ...entry, documentState: { ...entry.documentState, document: null },
    };
    target.drain();
    expect(target.events).toEqual([]);
    target.navigable.activeSessionHistoryEntry = entry;
    target.drain();
    expect(target.events.map((event): unknown => event.data)).toEqual(['pending']);
  });

  it('uses the backup incumbent for a bound built-in event listener', () => {
    const sender = createWindow('https://a.example.test/');
    const target = createWindow('https://b.example.test/', sender.agent);
    const trigger = new sender.window.EventTarget();
    const postMessage = target.window.postMessage as (message: unknown, targetOrigin: string, transfer: object[]) => void;
    sender.run(() => trigger.addEventListener('send', postMessage.bind(target.window, 'bound', '*', [])));
    target.run(() => trigger.dispatchEvent(new sender.window.Event('send')));
    target.drain();
    expect(target.events[0]!.source).toBe(sender.window);
    expect(target.events[0]!.origin).toBe('https://a.example.test');
  });

  it('does not retarget a queued message to a newly navigated Window', () => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const original = traversable.activeWindow!;
    const proxy = original.getWindowProxy().platform;
    const events: MessageEvent[] = [];
    proxy.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    original.env.responsibleEventLoop.runScriptEvaluation(original.env, () => proxy.postMessage('old', '*'));

    const next = navigate(traversable, 'https://new.test/');
    expect(next.getWindowProxy().platform).toBe(proxy);
    proxy.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    while (original.env.responsibleEventLoop.runTaskTurn()) { /* Drain runnable tasks. */ }
    while (next.env.responsibleEventLoop.runTaskTurn()) { /* Drain runnable tasks. */ }
    expect(events).toEqual([]);

    next.env.responsibleEventLoop.runScriptEvaluation(next.env, () => proxy.postMessage('new'));
    while (next.env.responsibleEventLoop.runTaskTurn()) { /* Drain runnable tasks. */ }
    expect(events.map((event): unknown => event.data)).toEqual(['new']);
  });

  it('retains the sender WindowProxy and sending Window origin across sender navigation', () => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const sender = navigate(traversable, 'https://sender.test/');
    const target = createWindow('https://target.test/');
    const proxy = sender.getWindowProxy().platform;
    sender.env.responsibleEventLoop.runScriptEvaluation(sender.env, () => {
      proxy.postMessage.call(target.window, 'before navigation', { targetOrigin: '*' });
    });
    const next = navigate(traversable, 'https://elsewhere.test/');
    target.drain();
    expect(target.events[0]!.source).toBe(proxy);
    expect(target.events[0]!.source).toBe(next.getWindowProxy().platform);
    expect(target.events[0]!.origin).toBe('https://sender.test');
  });

  it.fails('attributes A calling a B-authored function posting to C to B', () => {
    const a = createWindow('https://example.test/a');
    const b = createWindow('https://example.test/b', a.agent);
    const c = createWindow('https://example.test/c', a.agent);
    // Expected failure by agreement: this low-level realm-evaluation fixture
    // receives A as event.source. It calls real Web IDL postMessage, but its
    // translation of the HTML execution path and B expectation still need review.
    // Binding supplies C's method environment; the modeled script entry remains A.
    // Revisit author -> Binding -> incumbent propagation before any runtime change.
    const send = b.env.realm.evaluate('(target) => target.postMessage("from B", "*")', 'b.js');
    Reflect.set(a.env.realm.globalObject, 'send', send);
    Reflect.set(a.env.realm.globalObject, 'target', c.window);
    a.env.realm.evaluate('send(target)', 'a.js');
    c.drain();
    expect(c.events[0]!.source === b.window, 'event.source must be B, not the outer A entry').toBe(true);
    expect(c.events[0]!.origin).toBe('https://example.test');
  });
});

/** Real Window bindings and document activity, with task turns controlled by the test. */
function createWindow(url: string, agent = new WindowAgent(createManualEventLoop())) {
  if (agent.agentCluster === null) new AgentCluster().add(agent);
  const { url: creationURL } = parseURL(url);
  if (creationURL === null) throw new Error(`Invalid fixture URL: ${url}`);
  const origin = obtainURLOrigin(creationURL);
  const env = createWindowEnvironment({
    userAgent: new UserAgent(), agent, creationURL, origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: origin,
  });
  const document = env.createDocument();
  document.url = creationURL;
  document.origin = origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  const binding = getBindingContext(env.realm);
  env.realm.windowProxy.setAssociatedWindow(binding.project(WindowImpl, env.window) as StampedPlatformObject<Window>);
  const navigable = new TopLevelTraversable(createDocumentState(document));
  env.markExecutionReady();
  const window = env.realm.windowProxy.platform;
  const events: MessageEvent[] = [];
  for (const type of ['message', 'messageerror']) {
    window.addEventListener(type, (event) => { events.push(event as MessageEvent); });
  }
  return {
    env, window, document, navigable, agent, events,
    run<T>(steps: () => T): T { return agent.eventLoop.runScriptEvaluation(env, steps); },
    drain() { while (agent.eventLoop.runTaskTurn()) { /* Drain runnable tasks. */ } },
  };
}

/** Use the existing top-level navigation path without running the target's queued messages. */
function navigate(traversable: TopLevelTraversable, url: string): WindowImpl {
  const { url: record } = parseURL(url);
  if (record === null) throw new Error(`Invalid fixture URL: ${url}`);
  const params = traversable.createNavigationParamsFromSource(record);
  const document = traversable.createAndInitializeDocument('html', 'text/html', params);
  const entry = traversable.createHistoryEntry(document, params);
  traversable.finalizeCrossDocumentNavigation('replace', 'none', entry);
  return traversable.activeWindow!;
}
