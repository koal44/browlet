import { createReactions } from './implementation-fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { browletBindings, getRelevantRealm } from '../../../src/browlet/bindings';
import * as scheduling from '../../../src/browlet/integration/scripting';
import {
  createPromiseReactions, type InternalPromise, type PromiseReactions,
} from '../../../src/js-engine/index';
import { ReadableStreamImpl } from '../../../src/streams/readable-stream';
import { ReadableStreamDefaultControllerImpl } from '../../../src/streams/readable-stream-default-controller';
import {
  ReadableStreamDefaultReaderImpl, readableStreamReadResultIDL,
  type ReadableStreamReadResult,
} from '../../../src/streams/readable-stream-default-reader';
import {
  arg, defineCallbackFunction, defineInterface, impl, op, promise, reference,
} from '../../../src/web-idl/declaration/index';
import { createBindings } from '../../../src/web-idl/registration';

afterEach(() => { vi.restoreAllMocks(); });

describe('stream read Promise boundaries', () => {
  it.each(['chunk', 'close', 'error', 'released'] as const)(
    'projects a borrowed read on %s in the receiver queue', (mode) => {
      const { first, second } = createFixture();
      const read = Reflect.get(second.reader, 'read') as CallableFunction;
      if (mode === 'released') first.implementation.releaseLock();
      const result = Reflect.apply(read, first.reader, []) as Promise<unknown>;
      const trace = observe(first, result);
      settle(first, mode);

      expect(trace).toEqual([]);
      second.realm.agent.eventLoop.performMicrotaskCheckpoint();
      expect(trace).toEqual([]);
      first.realm.agent.eventLoop.performMicrotaskCheckpoint();
      expect(trace).toHaveLength(1);
      if (mode === 'released') expect(trace[0]).toBeInstanceOf(first.realm.intrinsics.typeError);
      else expectResult(first, trace[0], mode);
    },
  );

  it.each(['consume', 'invoke'] as const)(
    'imports a real stream read through %s without crossing independent queues', (method) => {
      const { first, second } = createFixture();
      const bindings = createBindings([consumerIDL, callbackIDL, readableStreamReadResultIDL]);
      const entries = [first, second].map((fixture) => {
        const consumer = new ReadConsumerImpl(createPromiseReactions(fixture.realm));
        const object = bindings.register(fixture.realm).context.project(ReadConsumerImpl, consumer);
        fixture.browlet.expose('reader', fixture.reader);
        const callback = fixture.realm.evaluate('() => reader.read()', 'read-callback.js') as () => Promise<unknown>;
        const argument = method === 'invoke' ? callback : callback();
        const result = Reflect.apply(Reflect.get(object, method) as CallableFunction, object, [argument]) as Promise<unknown>;
        return { consumer, trace: observe(fixture, result) };
      });
      const [a, b] = entries;
      if (!a || !b) throw new Error('Missing test reader');
      settle(first, 'chunk');
      settle(second, 'error');
      expect(a.trace).toEqual([]);
      expect(b.trace).toEqual([]);

      second.realm.agent.eventLoop.performMicrotaskCheckpoint();
      expect(a.trace).toEqual([]);
      expect(b.trace).toEqual([second.failure]);
      expect(b.consumer.received).toBeUndefined();
      first.realm.agent.eventLoop.performMicrotaskCheckpoint();
      expect(a.trace).toHaveLength(1);
      expectResult(first, a.trace[0], 'chunk');
      expect(a.consumer.received).toEqual({ value: 'chunk', done: false });
      expect(a.consumer.received).not.toBe(a.trace[0]);
    },
  );
});

function createFixture() {
  // Checkpoints are controlled here; scheduled host turns must not run them early.
  vi.spyOn(scheduling, 'requestNodeEventLoopTurn').mockImplementation(() => {});
  return { first: createReader(), second: createReader() };
}

function createReader() {
  const browlet = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(browlet.window);
  const stream = new ReadableStreamImpl({}, {}, createReactions());
  const controller = ReadableStreamImpl.getController(stream);
  if (!(controller instanceof ReadableStreamDefaultControllerImpl)) throw new Error('Expected a default controller');
  const implementation = stream.getReader();
  const reader = browletBindings.forRealm(realm).context.project(ReadableStreamDefaultReaderImpl, implementation);
  const failure = new realm.intrinsics.typeError('source failed');
  return { browlet, realm, controller, implementation, reader, failure };
}

type ReaderFixture = ReturnType<typeof createReader>;

function observe(fixture: ReaderFixture, result: Promise<unknown>): unknown[] {
  expect(result).toBeInstanceOf(fixture.realm.intrinsics.promise.constructor);
  const trace: unknown[] = [];
  const record = fixture.realm.createFunction(
    (_receiver, [value]) => { trace.push(value); }, { name: 'record', length: 1 },
  );
  Reflect.apply(fixture.realm.intrinsics.promise.then, result, [record, record]);
  return trace;
}

function settle(fixture: ReaderFixture, mode: 'chunk' | 'close' | 'error' | 'released'): void {
  if (mode === 'chunk') fixture.controller.enqueue('chunk');
  else if (mode === 'close') fixture.controller.close();
  else if (mode === 'error') fixture.controller.error(fixture.failure);
}

function expectResult(fixture: ReaderFixture, result: unknown, mode: 'chunk' | 'close' | 'error'): void {
  if (mode === 'error') {
    expect(result).toBe(fixture.failure);
  } else {
    expect(result).toEqual({ value: mode === 'chunk' ? 'chunk' : undefined, done: mode === 'close' });
    expect(Object.getPrototypeOf(result)).toBe(fixture.realm.intrinsics.objectPrototype);
  }
}

// A test consumer exercises the shared argument/callback adapter with real reads.
// Streams' underlying-source callback bindings are a separate unfinished path.
class ReadConsumerImpl {
  received: ReadableStreamReadResult | undefined;

  constructor(private readonly reactions: PromiseReactions) {}

  consume(result: InternalPromise<ReadableStreamReadResult>): InternalPromise<ReadableStreamReadResult> {
    return result.map((value) => { this.received = value; return value; }, this.reactions);
  }

  invoke(callback: () => InternalPromise<ReadableStreamReadResult>): InternalPromise<ReadableStreamReadResult> {
    return this.consume(callback());
  }
}

// callback ReadCallback = Promise<ReadableStreamReadResult>();
const resultType = promise(reference('ReadableStreamReadResult'));
const callbackIDL = defineCallbackFunction({ name: 'ReadCallback', returns: resultType, arguments: [] });
// interface ReadConsumer {
//   Promise<ReadableStreamReadResult> consume(Promise<ReadableStreamReadResult> result);
//   Promise<ReadableStreamReadResult> invoke(ReadCallback callback);
// };
const consumerIDL = defineInterface({
  name: 'ReadConsumer', exposed: '*', implementation: impl(ReadConsumerImpl),
  members: [
    op('consume', resultType, [arg('result', resultType)]),
    op('invoke', resultType, [arg('callback', reference('ReadCallback'))]),
  ],
});
