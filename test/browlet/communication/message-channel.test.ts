import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createWindowEnvironment } from '../../../src/browlet/bindings';
import { BrowsingContext, TopLevelTraversable, createDocumentState } from '../../../src/browlet/browsing/navigation/index';
import { WindowImpl } from '../../../src/browlet/browsing/window/index';
import { MessageChannelImpl } from '../../../src/browlet/communication/index';
import type { MessageEvent, MessagePort, Window } from '../../../src/browlet/platform';
import { AgentCluster, WindowAgent } from '../../../src/browlet/scripting/agents';
import { UserAgent } from '../../../src/browlet/user-agent';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import type { StampedPlatformObject } from '../../../src/web-idl/index';
import { createManualEventLoop } from '../../support/browlet-agent';
import { getBindingContext } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('MessageChannel and MessagePort (§9.4)', () => {
  it('exchanges cloned messages asynchronously through the page API', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const result = await browser.evaluate(() => new Promise((resolve) => {
      const channel = new MessageChannel();
      const payload = { list: [1] };
      let returned = false;
      channel.port2.onmessage = (event) => {
        const data = event.data as typeof payload;
        channel.port2.postMessage([
          returned, data.list, data !== payload, event.isTrusted,
          event.origin, event.source, event.lastEventId, event.bubbles, event.cancelable,
          event.ports.length, Object.isFrozen(event.ports), event.target === channel.port2,
          event instanceof MessageEvent,
        ]);
      };
      channel.port1.onmessage = (event) => {
        channel.port1.close();
        channel.port2.close();
        resolve(event.data);
      };
      channel.port1.postMessage(payload);
      payload.list.push(2);
      returned = true;
    }));
    expect(result).toEqual([true, [1], true, true, '', null, '', false, false, 0, true, true, true]);
  });

  it('creates stable, distinct EventTarget ports with no public port constructor', () => {
    const { window } = createWindow();
    const channel = new window.MessageChannel();
    expect(channel.port1).toBe(channel.port1);
    expect(channel.port1).not.toBe(channel.port2);
    expect(channel.port1).toBeInstanceOf(window.MessagePort);
    expect(channel.port1).toBeInstanceOf(window.EventTarget);
    expect(channel.port1.onmessage).toBeNull();
    expect(channel.port1.onmessageerror).toBeNull();
    expect(Reflect.set(channel, 'port1', channel.port2)).toBe(false);
    expect(() => Reflect.construct(window.MessagePort as unknown as new () => MessagePort, [])).toThrow();
  });

  it('retains messages until start, without treating addEventListener as start', () => {
    const page = createWindow();
    const channel = new page.window.MessageChannel();
    const received = collect(channel.port2);
    channel.port1.postMessage(undefined);
    channel.port1.postMessage('second');
    page.drain();
    expect(received).toEqual([]);
    channel.port2.start();
    channel.port2.start();
    page.drain();
    expect(received.map((event): unknown => event.data)).toEqual([undefined, 'second']);
  });

  it('starts when onmessage is assigned null, but not when onmessageerror is assigned', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    const received = collect(port2);
    port2.onmessageerror = () => {};
    port1.postMessage('waiting');
    page.drain();
    expect(received).toEqual([]);
    port2.onmessage = null;
    page.drain();
    expect(received[0]!.data).toBe('waiting');
  });

  it('preserves send order across unshipped ports even when started in reverse order', () => {
    const page = createWindow();
    const first = new page.window.MessageChannel();
    const second = new page.window.MessageChannel();
    const values: unknown[] = [];
    for (const port of [first.port2, second.port2]) {
      port.addEventListener('message', (event) => { values.push((event as MessageEvent).data); });
    }
    first.port1.postMessage('first');
    second.port1.postMessage('second');
    first.port1.postMessage('third');
    second.port2.start();
    first.port2.start();
    page.drain();
    expect(values).toEqual(['first', 'second', 'third']);
  });

  it('lets enabled ports run past a disabled port on the shared queue', () => {
    const page = createWindow();
    const disabled = new page.window.MessageChannel();
    const enabled = new page.window.MessageChannel();
    const received = collect(enabled.port2);
    disabled.port1.postMessage('blocked');
    enabled.port1.postMessage('ready');
    enabled.port2.start();
    page.drain();
    expect(received[0]!.data).toBe('ready');
  });

  it('performs a microtask checkpoint between message deliveries', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const values = await browser.evaluate(() => new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      const trace: unknown[] = [];
      port2.onmessage = (event) => {
        trace.push(event.data);
        if (event.data === 1) {
          void Promise.resolve().then(() => { trace.push('microtask'); });
        } else {
          port1.close();
          port2.close();
          resolve(trace);
        }
      };
      port1.postMessage(1);
      port1.postMessage(2);
    }));
    expect(values).toEqual([1, 'microtask', 2]);
  });

  it.each(['sequence', 'dictionary'] as const)('transfers a buffer with the %s overload', (overload) => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    const received = collect(port2);
    port2.start();
    const buffer = new ArrayBuffer(3);
    new Uint8Array(buffer).set([1, 2, 3]);
    if (overload === 'sequence') port1.postMessage(buffer, [buffer]);
    else port1.postMessage(buffer, { transfer: [buffer] });
    expect(buffer.byteLength).toBe(0);
    page.drain();
    expect([...new Uint8Array(received[0]!.data as ArrayBuffer)]).toEqual([1, 2, 3]);
    expect(Object.getPrototypeOf(received[0]!.data)).toBe(page.env.realm.ArrayBuffer.prototype);
  });

  it('preserves channel connectivity and queued data across a transfer to another agent', () => {
    const sender = createWindow();
    const receiver = createWindow();
    const { port1, port2 } = new sender.window.MessageChannel();
    const oldMessages = collect(port2);
    port2.start();
    port1.postMessage('before');
    const record = sender.env.serializeWithTransfer(port2, [port2]);
    port1.postMessage('in flight');
    const moved = receiver.env.deserializeWithTransfer(record).deserialized as MessagePort;
    const received = collect(moved);
    sender.drain();
    receiver.drain();
    expect(oldMessages).toEqual([]);
    expect(received).toEqual([]);
    expect(moved).toBeInstanceOf(receiver.window.MessagePort);
    port1.postMessage('after');
    moved.start();
    sender.drain();
    expect(received).toEqual([]);
    receiver.drain();
    expect(received.map((event): unknown => event.data)).toEqual(['before', 'in flight', 'after']);
    const reply = collect(port1);
    port1.start();
    moved.postMessage('reply');
    receiver.drain();
    expect(reply).toEqual([]);
    sender.drain();
    expect(reply[0]!.data).toBe('reply');
  });

  it('reassociates transferred tasks with the receiving document', () => {
    const sender = createWindow();
    const receiver = createWindow();
    const { port1, port2 } = new sender.window.MessageChannel();
    port1.postMessage({ nested: [1] });
    const moved = receiver.env.deserializeWithTransfer(sender.env.serializeWithTransfer(port2, [port2])).deserialized as MessagePort;
    const received = collect(moved);
    sender.document.browsingContext = null;
    moved.start();
    receiver.drain();
    expect(received).toHaveLength(1);
    expect(Object.getPrototypeOf(received[0]!.data)).toBe(receiver.env.realm.Object.prototype);
    expect(received[0]).toBeInstanceOf(receiver.window.MessageEvent);
  });

  it('closing the original port during transfer cannot close the transferred endpoint', () => {
    const sender = createWindow();
    const receiver = createWindow();
    const { port1, port2 } = new sender.window.MessageChannel();
    const record = sender.env.serializeWithTransfer(port2, [port2]);
    port2.close();
    const moved = receiver.env.deserializeWithTransfer(record).deserialized as MessagePort;
    const received = collect(moved);
    moved.start();
    port1.postMessage('still connected');
    receiver.drain();
    expect(received.map((event): unknown => event.data)).toEqual(['still connected']);
  });

  it('stops the original port from sending or receiving while transfer is in flight', () => {
    const sender = createWindow();
    const receiver = createWindow();
    const { port1, port2 } = new sender.window.MessageChannel();
    const replies = collect(port1);
    const original = collect(port2);
    port1.start();
    port2.start();
    port1.postMessage('queued');
    const record = sender.env.serializeWithTransfer(port2, [port2]);
    port2.postMessage('detached');
    port1.postMessage('in flight');
    sender.drain();
    expect(original).toEqual([]);
    expect(replies).toEqual([]);
    const moved = receiver.env.deserializeWithTransfer(record).deserialized as MessagePort;
    const received = collect(moved);
    moved.start();
    receiver.drain();
    expect(received.map((event): unknown => event.data)).toEqual(['queued', 'in flight']);
  });

  it('gates port tasks on the receiving document being fully active', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    const received = collect(port2);
    port2.start();
    port1.postMessage('waiting');
    const context = page.document.browsingContext;
    page.document.browsingContext = null;
    page.drain();
    expect(received).toEqual([]);
    page.document.browsingContext = context;
    page.drain();
    expect(received[0]!.data).toBe('waiting');
  });

  it('transfers ports through a port, preserving data/ports identity and list order', () => {
    const page = createWindow();
    const transport = new page.window.MessageChannel();
    const first = new page.window.MessageChannel();
    const second = new page.window.MessageChannel();
    const received = collect(transport.port2);
    transport.port2.start();
    transport.port1.postMessage({ first: first.port2, second: second.port2 }, [second.port2, first.port2]);
    page.drain();
    const event = received[0]!;
    const data = event.data as { first: MessagePort; second: MessagePort; };
    expect(event.ports).toEqual([data.second, data.first]);
    expect(Object.isFrozen(event.ports)).toBe(true);
    const messages = collect(data.first);
    data.first.start();
    first.port1.postMessage('connected');
    page.drain();
    expect(messages[0]!.data).toBe('connected');
  });

  it('transfers both ends of a channel together', () => {
    const sender = createWindow();
    const receiver = createWindow();
    const { port1, port2 } = new sender.window.MessageChannel();
    const record = sender.env.serializeWithTransfer([port1, port2], [port1, port2]);
    const [first, second] = receiver.env.deserializeWithTransfer(record).deserialized as [MessagePort, MessagePort];
    const received = collect(second);
    second.start();
    first.postMessage('still paired');
    receiver.drain();
    expect(received.map((event): unknown => event.data)).toEqual(['still paired']);
  });

  it('moves queued messages through repeated transfers before delivery', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    port1.postMessage('first');
    const intermediate = page.env.clone(port2, [port2]) as MessagePort;
    port1.postMessage('second');
    const finalPort = page.env.clone(intermediate, [intermediate]) as MessagePort;
    const received = collect(finalPort);
    finalPort.start();
    page.drain();
    expect(received.map((event): unknown => event.data)).toEqual(['first', 'second']);
  });

  it('rejects transferring the source before serializing the payload', () => {
    const page = createWindow();
    const { port1 } = new page.window.MessageChannel();
    const read = vi.fn(() => 1);
    expect(() => port1.postMessage({ get value() { return read(); } }, [port1]))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(read).not.toHaveBeenCalled();
    expect(() => page.env.clone(port1, [port1])).not.toThrow();
  });

  it('rejects duplicate ports and uncloneable data without detaching the port', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    expect(() => page.env.clone(null, [port2, port2])).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => page.env.clone(() => {}, [port2])).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => port1.postMessage(port2)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    const received = collect(port2);
    port2.start();
    port1.postMessage('not detached');
    page.drain();
    expect(received[0]!.data).toBe('not detached');
  });

  it('discards a message transferring its destination, but still transfers other objects', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    const received = collect(port2);
    port2.start();
    const buffer = new ArrayBuffer(1);
    port1.postMessage(null, [port2, buffer]);
    page.drain();
    expect(buffer.byteLength).toBe(0);
    expect(received).toEqual([]);
    expect(() => page.env.clone(port2, [port2])).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
  });

  it('closes idempotently while retaining messages already queued', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    const received = collect(port2);
    port1.postMessage('already queued');
    port2.close();
    port2.close();
    port1.postMessage('disconnected');
    port2.start();
    page.drain();
    expect(received.map((event): unknown => event.data)).toEqual(['already queued']);
    expect(() => page.env.clone(port2, [port2])).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(page.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.size).toBe(0);
  });

  it('still serializes and transfers when the channel is disconnected', () => {
    const page = createWindow();
    const { port1 } = new page.window.MessageChannel();
    port1.close();
    expect(() => port1.postMessage(() => {})).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    const buffer = new ArrayBuffer(2);
    port1.postMessage(buffer, [buffer]);
    expect(buffer.byteLength).toBe(0);
  });

  it('fires messageerror on reconstruction failure and continues with the next message', () => {
    const page = createWindow();
    const { port1, port2 } = new page.window.MessageChannel();
    const events: MessageEvent[] = [];
    port2.onmessageerror = (event) => { events.push(event as MessageEvent); };
    port2.onmessage = (event) => { events.push(event as MessageEvent); };
    port1.postMessage('bad');
    port1.postMessage('good');
    vi.spyOn(page.env, 'deserializeWithTransfer').mockImplementationOnce(() => { throw new Error('unavailable interface'); });
    page.drain();
    expect(events.map((event): unknown[] => [event.type, event.isTrusted, event.data, event.origin, event.source, event.ports.length]))
      .toEqual([['messageerror', true, null, '', null, 0], ['message', true, 'good', '', null, 0]]);
  });

  it('retains entangled ports for document cleanup and releases both ends on disentanglement', () => {
    const page = createWindow();
    const channel = new MessageChannelImpl(page.env);
    const ports = page.env.getWindowOrWorkerGlobalScopeMixin().messagePorts;
    expect([...ports]).toEqual([channel.port1, channel.port2]);
    channel.port1.disentangle();
    expect(ports.size).toBe(0);
  });
});

function collect(port: MessagePort): MessageEvent[] {
  const events: MessageEvent[] = [];
  port.addEventListener('message', (event) => { events.push(event as MessageEvent); });
  return events;
}

/** Real realm, document, and binding ownership with manual task turns. */
function createWindow() {
  const agent = new WindowAgent(createManualEventLoop());
  new AgentCluster().add(agent);
  const creationURL = parseURL('https://example.test/').url!;
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
  return {
    env, window: env.realm.windowProxy.platform, document, navigable,
    drain() { while (agent.eventLoop.runTaskTurn()) { /* Drain runnable tasks. */ } },
  };
}
