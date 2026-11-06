import { EventEmitter, once } from 'node:events';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { threadId } from 'node:worker_threads';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  JSMessageChannel, JSMessagePort, JSThread,
  type JSMessagePortHandle, type JSThreadProtocol, type JSTransferable,
} from '../../src/js-engine/index';

const ports = new Set<JSMessagePort<TestMessage>>();
const threads = new Set<JSThread<ChannelThreadProtocol>>();

beforeAll(() => {
  JSThread.initialize(pathToFileURL(resolve(__dirname, 'fixtures/message-channel.cjs')).href, () => {
    throw new Error('The parent must not run child initialization');
  });
});

afterEach(async () => {
  for (const port of ports) port.close();
  ports.clear();
  await Promise.all([...threads].map((thread) => thread.terminate()));
  threads.clear();
});

describe('Native channel transport', { timeout: 30_000 }, () => {
  it('keeps queued messages when a local receiver stops and later resumes', async () => {
    const { port1, port2 } = channel();
    const first = collect(port2, 1);
    port1.send({ value: 1 });
    expect(await first.done).toEqual([{ value: 1 }]);
    first.stop();

    port1.send({ value: 2 });
    port1.send({ value: 3 });
    await setImmediate();
    await setImmediate();
    expect(first.messages).toEqual([{ value: 1 }]);

    const resumed = collect(port2, 2);
    expect(await resumed.done).toEqual([{ value: 2 }, { value: 3 }]);
  });

  it('moves a queued endpoint in startup data and leaves its old owner detached', async () => {
    const { port1, port2 } = channel();
    const replies = collect(port1, 3);
    port1.send({ value: 1 });
    port1.send({ value: 2 });
    const worker = spawn({ role: 'echo', port: port2.handle }, [port2.handle]);
    const ready = await worker.ready;
    const workerId = ready.threadId;
    expect(workerId).not.toBe(threadId);

    port2.close();
    port1.send({ value: 3 });
    expect(await replies.done).toEqual([
      { value: 1, threadId: workerId },
      { value: 2, threadId: workerId },
      { value: 3, threadId: workerId },
    ]);
  });

  it('transfers an endpoint to a running thread and returns it with its pending queue', async () => {
    const { port1, port2 } = channel();
    const worker = spawn({ role: 'echo' });
    await worker.ready;
    port1.send({ value: 'before transport' });
    const reply = worker.nextMessage();
    worker.thread.send({ type: 'return-port', port: port2.handle }, [port2.handle]);
    port1.send({ value: 'during transport' });
    const returned = await reply;
    if (returned.type !== 'port') throw new Error('Expected the returned endpoint');

    const received = new JSMessagePort<TestMessage>(returned.port);
    ports.add(received);
    const messages = collect(received, 3);
    port1.send({ value: 'after transport' });
    expect(await messages.done).toEqual([
      { value: 'before transport' }, { value: 'during transport' }, { value: 'after transport' },
    ]);
  });

  it('removes the old receiver before moving a previously active endpoint again', async () => {
    const { port1, port2 } = channel();
    const worker = spawn({ role: 'echo', port: port2.handle }, [port2.handle]);
    await worker.ready;
    const first = collect(port1, 1);
    port1.send({ value: 'echo' });
    expect((await first.done)[0]).toMatchObject({ value: 'echo' });
    first.stop();
    const returned = worker.nextMessage();
    worker.thread.send({ type: 'release' });
    const reply = await returned;
    if (reply.type !== 'port') throw new Error('Expected the returned endpoint');
    const received = new JSMessagePort<TestMessage>(reply.port);
    ports.add(received);

    const messages = collect(received, 1);
    port1.send({ value: 'new owner' });
    expect(await messages.done).toEqual([{ value: 'new owner' }]);
    expect(first.messages).toHaveLength(1);
  });

  it('moves a nested endpoint and ArrayBuffer through an independent native channel', async () => {
    const transport = channel();
    const worker = spawn({ role: 'echo', port: transport.port2.handle }, [transport.port2.handle]);
    await worker.ready;
    const nested = channel();
    const buffer = new ArrayBuffer(3);
    new Uint8Array(buffer).set([4, 5, 6]);
    nested.port1.send({ value: 'queued on the nested channel' });
    const replies = collect(transport.port1, 1);
    transport.port1.send({ value: 'resources', port: nested.port2.handle, buffer }, [nested.port2.handle, buffer]);
    expect(buffer.byteLength).toBe(0);
    const [reply] = await replies.done;
    expect([...new Uint8Array(reply!.buffer!)]).toEqual([4, 5, 6]);
    const received = new JSMessagePort<TestMessage>(reply!.port!);
    ports.add(received);
    expect(await collect(received, 1).done).toEqual([{ value: 'queued on the nested channel' }]);
  });

  it('connects two worker isolates directly without relaying their channel messages through the creator', async () => {
    const { port1, port2 } = channel();
    const echo = spawn({ role: 'echo', port: port1.handle }, [port1.handle]);
    const relay = spawn({ role: 'relay', port: port2.handle }, [port2.handle]);
    const echoReady = await echo.ready;
    await relay.ready;
    port1.close();
    port2.close();
    const result = relay.nextMessage();
    relay.thread.send({ type: 'send', message: { value: 'from the other isolate' } });
    expect(await result).toEqual({
      type: 'received', message: {
        value: 'from the other isolate', threadId: echoReady.threadId,
      },
    });
  });

  it('keeps endpoint ownership when native serialization rejects a send', async () => {
    const worker = spawn({ role: 'echo' });
    await worker.ready;
    const { port1, port2 } = channel();
    const messages = collect(port2, 1);
    expect(() => worker.thread.send({
      type: 'send', message: { value: () => 'not cloneable', port: port2.handle },
    }, [port2.handle])).toThrow();
    port1.send({ value: 'still owned here' });
    expect(await messages.done).toEqual([{ value: 'still owned here' }]);
  });

  it('delivers an already-posted message before reporting the peer close', async () => {
    const { port1, port2 } = channel();
    const events: unknown[] = [];
    const closed = Promise.withResolvers<void>();
    port1.listen({
      onMessage(message) { events.push(message.value); },
      onClose() { events.push('closed'); closed.resolve(); },
    });
    const worker = spawn({ role: 'echo', port: port2.handle }, [port2.handle]);
    await worker.ready;
    worker.thread.send({ type: 'send-and-close', message: { value: 'sent before close' } });
    await closed.promise;
    expect(events).toEqual(['sent before close', 'closed']);
  });

  it.each(['close', 'terminate'] as const)('reports peer closure after %s in another isolate', async (action) => {
    const { port1, port2 } = channel();
    const closed = Promise.withResolvers<void>();
    port1.listen({ onMessage() {}, onClose: () => closed.resolve() });
    const worker = spawn({ role: 'echo', port: port2.handle }, [port2.handle]);
    await worker.ready;
    if (action === 'close') worker.thread.send({ type: 'close' });
    else await worker.thread.terminate();
    await closed.promise;
  });
});

interface TestMessage {
  value: unknown;
  threadId?: number;
  port?: JSMessagePortHandle;
  buffer?: ArrayBuffer;
}

interface ChannelThreadProtocol extends JSThreadProtocol {
  startup: { role: 'echo' | 'relay'; port?: JSMessagePortHandle; };
  toThread:
    | { type: 'return-port'; port: JSMessagePortHandle; }
    | { type: 'send' | 'send-and-close'; message: TestMessage; }
    | { type: 'release' | 'close'; };
  fromThread:
    | { type: 'ready'; threadId: number; }
    | { type: 'received'; message: TestMessage; }
    | { type: 'port'; port: JSMessagePortHandle; }
    | { type: 'closed'; };
}

function channel(): JSMessageChannel<TestMessage> {
  const result = new JSMessageChannel<TestMessage>();
  ports.add(result.port1);
  ports.add(result.port2);
  return result;
}

function collect(port: JSMessagePort<TestMessage>, count: number) {
  const messages: TestMessage[] = [];
  const received = Promise.withResolvers<TestMessage[]>();
  const stop = port.listen({
    onMessage(message) {
      messages.push(message);
      if (messages.length === count) received.resolve(messages);
    },
    onMessageError: received.reject,
  });
  return { messages, done: received.promise, stop };
}

function spawn(data: ChannelThreadProtocol['startup'], transferList: JSTransferable[] = []) {
  const messages = new EventEmitter();
  const nextMessage = async (): Promise<ChannelThreadProtocol['fromThread']> =>
    (await once(messages, 'message'))[0] as ChannelThreadProtocol['fromThread'];
  const ready = nextMessage().then((message) => {
    if (message.type !== 'ready') throw new Error('Expected thread readiness');
    return message;
  });
  const thread = new JSThread<ChannelThreadProtocol>(data, (message) => { messages.emit('message', message); }, transferList);
  threads.add(thread);
  return { thread, ready, nextMessage };
}
