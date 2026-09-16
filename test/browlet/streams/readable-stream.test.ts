import { createRuntime } from '../../js-engine/runtime-fixture';
import type { PromiseValue } from '../../../src/js-engine/promises';
import { endOfIteration } from '../../../src/web-idl/index';
import { createWritableStream, observe } from './implementation-fixture';
import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { AbortSignalImpl } from '../../../src/browlet/dom/abort/abort-signal';
import { getBindingContext, getRelevantRealm } from '../../../src/browlet/bindings';
import {
  ReadableStreamDefaultControllerImpl, type ReadableByteStreamControllerImpl,
  ReadableStreamImpl,
} from '../../../src/streams/index';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

describe('ordinary readable-stream implementation', () => {
  it('creates a stream from an acquired async iterator', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const values = ['first', 'second'];
    const stream = ReadableStreamImpl.from({
      next: () => promises.resolve(values.shift() ?? endOfIteration),
      return: () => promises.resolve(),
    }, runtime);
    const reader = stream.getReader({});

    await expect(observe(reader.read())).resolves
      .toEqual(readResult('first', false));
    await expect(observe(reader.read())).resolves
      .toEqual(readResult('second', false));
    await expect(observe(reader.read())).resolves
      .toEqual(readResult(undefined, true));
  });

  it('delivers enqueued chunks and then observes close', async () => {
    const { controller, stream } = createReadableStream();
    const reader = stream.getReader({});

    const chunk = observe(reader.read());
    controller.enqueue('chunk');
    await expect(chunk).resolves.toEqual(readResult('chunk', false));

    controller.close();
    await expect(observe(reader.read())).resolves
      .toEqual(readResult(undefined, true));
    await expect(observe(reader.closed)).resolves.toBeUndefined();
  });

  it('accepts arbitrary JavaScript values from other specifications', async () => {
    const { stream } = createReadableStream();
    const reader = stream.getReader({});

    stream.enqueueChunk('chunk');

    await expect(observe(reader.read())).resolves
      .toEqual(readResult('chunk', false));
  });

  it('locks a stream until its reader is released', () => {
    const { stream } = createReadableStream();
    const reader = stream.getReader({});

    expect(stream.locked).toBe(true);
    expect(() => stream.getReader({})).toThrow(/already been locked/u);

    reader.releaseLock();
    expect(stream.locked).toBe(false);
    expect(() => stream.getReader({})).not.toThrow();
  });

  it('forwards cancellation to the underlying source', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const cancel = vi.fn(() => promises.resolve(undefined));
    const { stream } = createReadableStream({ cancel });

    await expect(observe(stream.cancel('finished'))).resolves
      .toBeUndefined();
    expect(cancel).toHaveBeenCalledWith('finished');
  });

  it('pipes chunks to a writable stream and propagates close', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const source = new ReadableStreamImpl({}, {}, runtime);
    const controller = requireDefaultController(
      source.state.controller,
    );
    const write = vi.fn(() => promises.resolve(undefined));
    const close = vi.fn(() => promises.resolve(undefined));
    const destination = createWritableStream({ close, write });
    const piping = source.pipeTo(destination, defaultPipeOptions);

    controller.enqueue('first');
    controller.enqueue('second');
    controller.close();

    await expect(observe(piping)).resolves.toBeUndefined();
    expect(write.mock.calls).toEqual([
      ['first', expect.any(Object)],
      ['second', expect.any(Object)],
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });

  it('aborts both sides of a pipe when its signal aborts', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const cancel = vi.fn(() => promises.resolve(undefined));
    const abort = vi.fn(() => promises.resolve(undefined));
    const source = new ReadableStreamImpl({ cancel }, {}, runtime);
    const destination = createWritableStream({ abort });
    const signal = new TestAbortSignal();
    const piping = source.pipeTo(destination, {
      ...defaultPipeOptions,
      signal,
    });

    signal.abort('stop');

    await expect(observe(piping)).rejects.toBe('stop');
    expect(cancel).toHaveBeenCalledWith('stop');
    expect(abort).toHaveBeenCalledWith('stop');
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });

  it('aborts the destination when the readable stream errors', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const source = new ReadableStreamImpl({}, {}, runtime);
    const controller = requireDefaultController(
      source.state.controller,
    );
    const abort = vi.fn(() => promises.resolve(undefined));
    const destination = createWritableStream({ abort });
    const piping = source.pipeTo(destination, defaultPipeOptions);
    const error = new Error('source failed');

    controller.error(error);

    await expect(observe(piping)).rejects.toBe(error);
    expect(abort).toHaveBeenCalledWith(error);
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });

  it('tees an ordinary stream into two independently readable branches', async () => {
    const { controller, stream } = createReadableStream();
    const [branch1, branch2] = stream.tee();
    const reader1 = branch1.getReader({});
    const reader2 = branch2.getReader({});
    const read1 = observe(reader1.read());
    const read2 = observe(reader2.read());

    controller.enqueue('shared');
    controller.close();

    await expect(read1).resolves.toEqual(readResult('shared', false));
    await expect(read2).resolves.toEqual(readResult('shared', false));
    await expect(observe(reader1.read())).resolves
      .toEqual(readResult(undefined, true));
    await expect(observe(reader2.read())).resolves
      .toEqual(readResult(undefined, true));
  });

  it('clones the second branch for cross-specification teeing', async () => {
    const { controller, stream } = createReadableStream();
    const [branch1, branch2] = stream.teeDefault(true);
    const reader1 = branch1.getReader({});
    const reader2 = branch2.getReader({});
    const read1 = observe(reader1.read());
    const read2 = observe(reader2.read());
    const chunk = { nested: { value: 'chunk' } };

    controller.enqueue(chunk);

    const [result1, result2] = await Promise.all([read1, read2]);
    const value1 = result1.value;
    const value2 = result2.value;
    expect(value1).toBe(chunk);
    expect(value2).toEqual(chunk);
    expect(value2).not.toBe(chunk);
    expect((value2 as typeof chunk).nested).not.toBe(chunk.nested);
  });

  it('errors both tee branches when cross-specification cloning fails', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const error = new DOMException('', 'DataCloneError');
    const cancel = vi.fn(() => promises.resolve(undefined));
    const stream = new ReadableStreamImpl({ cancel }, {}, runtime);
    const controller = requireDefaultController(
      stream.state.controller,
    );
    vi.spyOn(runtime, 'clone').mockImplementation(() => { throw error; });
    const [branch1, branch2] = stream.teeDefault(true);
    const read1 = observe(branch1.getReader({}).read());
    const read2 = observe(branch2.getReader({}).read());

    controller.enqueue(() => undefined);

    await expect(read1).rejects.toBe(error);
    await expect(read2).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledWith(error);
  });

  it('cancels a tee source after both branches cancel', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const cancel = vi.fn(() => promises.resolve(undefined));
    const { stream } = createReadableStream({ cancel });
    const [branch1, branch2] = stream.tee();
    const cancel1 = branch1.cancel('one');

    expect(cancel).not.toHaveBeenCalled();
    const cancel2 = branch2.cancel('two');

    await expect(Promise.all([observe(cancel1), observe(cancel2)])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(cancel).toHaveBeenCalledWith(['one', 'two']);
  });

  it('rejects both tee cancellations when source cancellation fails', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const error = new Error('cancel failed');
    const cancel = vi.fn(() => promises.reject(error));
    const { stream } = createReadableStream({ cancel });
    const [branch1, branch2] = stream.tee();
    const cancel1 = branch1.cancel('one');
    const cancel2 = branch2.cancel('two');

    await Promise.all([
      expect(observe(cancel1)).rejects.toBe(error),
      expect(observe(cancel2)).rejects.toBe(error),
    ]);
  });

  it('errors both tee branches when their source errors', async () => {
    const { controller, stream } = createReadableStream();
    const [branch1, branch2] = stream.tee();
    const reader1 = branch1.getReader({});
    const reader2 = branch2.getReader({});
    const error = new Error('source failed');

    controller.error(error);

    await Promise.all([
      expect(observe(reader1.closed)).rejects.toBe(error),
      expect(observe(reader2.closed)).rejects.toBe(error),
    ]);
  });

});

describe('readable-stream projection', () => {
  it('preserves a borrowed enqueue failure across the stream\'s rejected promises', async () => {
    const browlet = new Browlet({ route: () => '' });
    const foreign = new Browlet({ route: () => '' });
    Reflect.set(browlet.window, 'foreignStreamRealm', foreign.window);

    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      let controller!: ReadableStreamDefaultController;
      const reader = new ReadableStream({
        start(value) { controller = value; },
      }, { size: () => -1 }).getReader();
      const closed = reader.closed.catch((error: unknown) => error);
      let caught: unknown;
      try {
        other.ReadableStreamDefaultController.prototype.enqueue.call(controller, 'chunk');
      } catch (error) {
        caught = error;
      }
      if (!(caught instanceof other.RangeError)) {
        throw new Error('Expected a RangeError from the borrowed method\'s realm');
      }
      caught.message = 'changed after catching';
      const readError = await reader.read().catch((error: unknown) => error);
      const closedError = await closed;
      const secondReadError = await reader.read().catch((error: unknown) => error);
      return {
        readIsCaught: readError === caught,
        closedIsCaught: closedError === caught,
        secondReadIsCaught: secondReadError === caught,
        mutationPreserved: readError instanceof other.RangeError &&
          readError.message === 'changed after catching',
      };
    });

    expect(result).toEqual({
      readIsCaught: true, closedIsCaught: true,
      secondReadIsCaught: true, mutationPreserved: true,
    });
  });

  it('shares a realm-owned pipe failure between cancellation and rejection', async () => {
    const window = new Browlet({ route: () => '' }).window;
    let cancellationReason: unknown;
    const source = Reflect.construct(requireFunction(window, 'ReadableStream'), [{
      cancel(reason: unknown) {
        cancellationReason = reason;
        Reflect.set(reason as object, 'message', 'changed by cancel');
      },
    }]) as object;
    const destination = Reflect.construct(requireFunction(window, 'WritableStream'), []) as object;
    const close = observeBrowletPromise(window, Reflect.apply(
      requireFunction(destination, 'close'), destination, [],
    ) as Promise<unknown>);
    performTestMicrotaskCheckpoint(window);
    await close;

    const piping = observeBrowletPromise(window, Reflect.apply(
      requireFunction(source, 'pipeTo'), source, [destination],
    ) as Promise<unknown>);
    performTestMicrotaskCheckpoint(window);
    const error = await piping.catch((reason: unknown) => reason);

    expect(cancellationReason).toBeInstanceOf(requireFunction(window, 'TypeError'));
    expect(error).toBe(cancellationReason);
    expect(error).toHaveProperty('message', 'changed by cancel');
  });

  it('realizes cross-specification clone failures in the stream realm', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const realm = getRelevantRealm(window);
    const bindings = getBindingContext(realm);
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const projected = Reflect.construct(ReadableStream_, []) as object;
    const stream = bindings.unwrap(projected, ReadableStreamImpl);
    if (!stream) {
      throw new Error('ReadableStream did not resolve to its implementation');
    }
    const [branch1, branch2] = stream.teeDefault(true);
    const branch1Object = bindings.project(ReadableStreamImpl, branch1);
    const branch2Object = bindings.project(ReadableStreamImpl, branch2);
    const read1 = observeBrowletPromise(
      window,
      readProjectedStream(branch1Object),
    );
    const read2 = observeBrowletPromise(
      window,
      readProjectedStream(branch2Object),
    );
    const controller = requireDefaultController(
      stream.state.controller,
    );

    controller.enqueue(() => undefined);
    performTestMicrotaskCheckpoint(window);

    const [error1, error2] = await Promise.all([
      read1.catch((error: unknown) => error),
      read2.catch((error: unknown) => error),
    ]);
    const DOMException_ = requireFunction(window, 'DOMException');
    expect(error1).toBeInstanceOf(DOMException_);
    expect(error2).toBe(error1);
    expect(Reflect.get(error1 as object, 'name')).toBe('DataCloneError');
  });


  it('rejects both tee cancellations when projected source cancellation fails', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const error = new Error('cancel failed');
    const stream = Reflect.construct(
      requireFunction(window, 'ReadableStream'),
      [{ cancel() { throw error; } }],
    ) as object;
    const [branch1, branch2] = Reflect.apply(
      requireFunction(stream, 'tee'),
      stream,
      [],
    ) as object[];
    const cancel1 = observeBrowletPromise(window, Reflect.apply(
      requireFunction(branch1 as object, 'cancel'), branch1, ['one'],
    ) as Promise<unknown>);
    const cancel2 = observeBrowletPromise(window, Reflect.apply(
      requireFunction(branch2 as object, 'cancel'), branch2, ['two'],
    ) as Promise<unknown>);
    performTestMicrotaskCheckpoint(window);

    await Promise.all([
      expect(cancel1).rejects.toBe(error),
      expect(cancel2).rejects.toBe(error),
    ]);
  });

  it('pipes through DOM abort algorithms with defaulted options', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const cancel = vi.fn();
    const abort = vi.fn();
    const source = Reflect.construct(
      requireFunction(window, 'ReadableStream'),
      [{ cancel }],
    ) as object;
    const destination = Reflect.construct(
      requireFunction(window, 'WritableStream'),
      [{ abort }],
    ) as object;
    const controller = Reflect.construct(
      requireFunction(window, 'AbortController'),
      [],
    ) as object;
    const signal = Reflect.get(controller, 'signal') as object;
    const realm = getRelevantRealm(window);
    const resolved = getBindingContext(realm).getObjectRecord(signal);
    if (resolved?.primaryInterface.definition.name !== 'AbortSignal') {
      throw new Error('AbortSignal did not resolve to its implementation');
    }

    expect(resolved.platformObject).toBe(signal);
    expect(resolved.implInst).toBeInstanceOf(AbortSignalImpl);
    expect(resolved.implInst).not.toBe(signal);
    expect(Reflect.get(signal, 'addAlgorithm')).toBeUndefined();
    expect(typeof Reflect.get(resolved.implInst, 'addAlgorithm')).toBe(
      'function',
    );
    const piping = observeBrowletPromise(window, Reflect.apply(
      requireFunction(source, 'pipeTo'),
      source,
      [destination, {
        signal,
      }],
    ) as Promise<unknown>);

    Reflect.apply(
      requireFunction(controller, 'abort'),
      controller,
      ['stop'],
    );
    performTestMicrotaskCheckpoint(window);

    await expect(piping).rejects.toBe('stop');
    expect(cancel).toHaveBeenCalledWith('stop');
    expect(abort).toHaveBeenCalledWith('stop');
  });

  it('projects ReadableStream.from() and asynchronous iteration', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const otherWindow = new Browlet({ route: () => '' }).window;
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const OtherReadableStream = requireFunction(otherWindow, 'ReadableStream');
    const stream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      OtherReadableStream,
      [['first', 'second']],
    ) as object;
    const iterator = Reflect.apply(
      requireFunction(stream, Symbol.asyncIterator),
      stream,
      [],
    ) as object;

    expect(stream).toBeInstanceOf(ReadableStream_);
    expect(stream).not.toBeInstanceOf(OtherReadableStream);
    const first = observeBrowletPromise(
      window,
      callIterator(iterator, 'next'),
    );
    performTestMicrotaskCheckpoint(window);
    await expect(first).resolves.toEqual({
      done: false,
      value: 'first',
    });
    const second = observeBrowletPromise(
      window,
      callIterator(iterator, 'next'),
    );
    performTestMicrotaskCheckpoint(window);
    await expect(second).resolves.toEqual({
      done: false,
      value: 'second',
    });
    const last = observeBrowletPromise(
      window,
      callIterator(iterator, 'next'),
    );
    performTestMicrotaskCheckpoint(window);
    await expect(last).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(Reflect.get(stream, 'locked')).toBe(false);
  });

  it.each(['fulfill', 'reject'] as const)('adopts a thenable chunk during async iteration (%s)', async (settlement) => {
    const browlet = new Browlet({ route: () => '' });
    const window = browlet.window;
    const calls: string[] = [];
    const reason = new Error('chunk failed');
    Reflect.set(window, 'recordThen', () => { calls.push('then'); });
    Reflect.set(window, 'chunkError', reason);
    const chunk = getRelevantRealm(window).evaluate(`({
      then(resolve, reject) {
        recordThen();
        ${settlement === 'fulfill' ? "resolve('chunk');" : 'reject(chunkError);'}
      }
    })`, 'thenable-chunk.js');
    const stream = Reflect.construct(requireFunction(window, 'ReadableStream'), [{
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(chunk);
        controller.close();
      },
    }]) as object;
    const iterator = Reflect.apply(requireFunction(stream, 'values'), stream, []) as object;
    const next = observeBrowletPromise(window, callIterator(iterator, 'next'));
    performTestMicrotaskCheckpoint(window);

    if (settlement === 'fulfill') {
      await expect(next).resolves.toEqual({ done: false, value: 'chunk' });
    } else {
      await expect(next).rejects.toBe(reason);
    }
    expect(calls).toEqual(['then']);
  });

  it('errors ReadableStream.from() when the iterator throws', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const error = new Error('next failed');
    const iterator = {
      next() {
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const stream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      ReadableStream_,
      [iterator],
    ) as object;
    const reader = Reflect.apply(
      requireFunction(stream, 'getReader'),
      stream,
      [],
    ) as object;
    const read = observeBrowletPromise(window, Reflect.apply(
      requireFunction(reader, 'read'), reader, [],
    ) as Promise<unknown>);
    const closed = observeBrowletPromise(
      window,
      Reflect.get(reader, 'closed') as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);

    await Promise.all([
      expect(read).rejects.toBe(error),
      expect(closed).rejects.toBe(error),
    ]);
  });

  it('keeps a returned iterator finished when another iterator acquires the stream', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const stream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'), ReadableStream_, [['kept']],
    ) as object;
    const iterator = Reflect.apply(
      requireFunction(stream, 'values'), stream, [{ preventCancel: true }],
    ) as object;
    const returned = observeBrowletPromise(window, callIterator(iterator, 'return'));
    performTestMicrotaskCheckpoint(window);
    await expect(returned).resolves.toEqual({ done: true, value: undefined });
    expect(Reflect.get(stream, 'locked')).toBe(false);

    const replacement = Reflect.apply(requireFunction(stream, 'values'), stream, []) as object;
    const oldNext = observeBrowletPromise(window, callIterator(iterator, 'next'));
    const oldReturn = observeBrowletPromise(window, callIterator(iterator, 'return', ['stop']));
    performTestMicrotaskCheckpoint(window);
    await expect(oldNext).resolves.toEqual({ done: true, value: undefined });
    await expect(oldReturn).resolves.toEqual({ done: true, value: 'stop' });
    expect(Reflect.get(stream, 'locked')).toBe(true);

    const next = observeBrowletPromise(window, callIterator(replacement, 'next'));
    performTestMicrotaskCheckpoint(window);
    await expect(next).resolves.toEqual({ done: false, value: 'kept' });
    const finished = observeBrowletPromise(window, callIterator(replacement, 'next'));
    performTestMicrotaskCheckpoint(window);
    await expect(finished).resolves.toEqual({ done: true, value: undefined });
    expect(Reflect.get(stream, 'locked')).toBe(false);
  });

  it('cancels iteration unless preventCancel is true', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const returned = vi.fn(() => ({ done: true }));
    const source = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: returned,
      }),
    };
    const cancelingStream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      ReadableStream_,
      [source],
    ) as object;
    const cancelingIterator = Reflect.apply(
      requireFunction(cancelingStream, 'values'),
      cancelingStream,
      [],
    ) as object;

    const canceled = observeBrowletPromise(
      window,
      callIterator(cancelingIterator, 'return', ['stop']),
    );
    performTestMicrotaskCheckpoint(window);
    await expect(canceled)
      .resolves.toEqual({ done: true, value: 'stop' });
    expect(returned).toHaveBeenCalledWith('stop');

    const retainingStream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      ReadableStream_,
      [source],
    ) as object;
    const retainingIterator = Reflect.apply(
      requireFunction(retainingStream, 'values'),
      retainingStream,
      [{ preventCancel: true }],
    ) as object;
    const retained = observeBrowletPromise(
      window,
      callIterator(retainingIterator, 'return'),
    );
    performTestMicrotaskCheckpoint(window);
    await expect(retained)
      .resolves.toEqual({ done: true, value: undefined });
    expect(returned).toHaveBeenCalledOnce();
    expect(Reflect.get(retainingStream, 'locked')).toBe(false);
  });
});

describe('readable byte-stream implementation', () => {
  it('transfers a BYOB buffer without invoking its own transfer property', async () => {
    const stream = new ReadableStreamImpl({ type: 'bytes' }, {}, createRuntime());
    const reader = stream.getReader({ mode: 'byob' });
    const supplied = new Uint8Array(2);
    const transfer = vi.fn(() => { throw new Error('Author transfer must not run'); });
    Object.defineProperty(supplied.buffer, 'transfer', { value: transfer });
    const reading = reader.read(supplied, { min: 1 });
    void observe(reading).catch(() => {});

    expect(transfer).not.toHaveBeenCalled();
    expect(supplied.buffer.detached).toBe(true);
    const controller = stream.controller;
    const request = requireByteController(controller as ReadableByteStreamControllerImpl).byobRequest;
    if (!request?.view) throw new Error('Missing BYOB request');
    (request.view as Uint8Array).set([9]);
    request.respond(1);
    expect(Array.from((await observe(reading)).value as Uint8Array)).toEqual([9]);
  });

  it('tees bytes into independently owned chunks', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl({
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    }, {}, createRuntime());
    const [branch1, branch2] = stream.tee();
    const read1 = observe(branch1.getReader({}).read());
    const read2 = observe(branch2.getReader({}).read());

    requireByteController(controller).enqueue(Uint8Array.from([3, 4, 5]));

    const result1 = await read1;
    const result2 = await read2;
    const value1 = result1.value as Uint8Array;
    const value2 = result2.value as Uint8Array;
    expect(Array.from(value1)).toEqual([3, 4, 5]);
    expect(Array.from(value2)).toEqual([3, 4, 5]);
    expect(value1.buffer).not.toBe(
      value2.buffer,
    );
  });

  it('coordinates BYOB and default readers across byte tee branches', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl({
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    }, {}, createRuntime());
    const [byobBranch, defaultBranch] = stream.tee();
    const byobRead = byobBranch.getReader({ mode: 'byob' }).read(
      new Uint8Array(4),
      { min: 1 },
    );
    const defaultRead = observe(defaultBranch.getReader({}).read());

    requireByteController(controller).enqueue(Uint8Array.from([6, 7]));

    expect(Array.from((await observe(byobRead)).value as Uint8Array))
      .toEqual([6, 7]);
    expect(Array.from((await defaultRead).value as Uint8Array))
      .toEqual([6, 7]);
  });

  it('delivers enqueued bytes to a default reader', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl({
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    }, {}, createRuntime());
    const reader = stream.getReader({});
    const read = observe(reader.read());
    const chunk = Uint8Array.from([1, 2, 3]);

    requireByteController(controller).enqueue(chunk);

    const result = await read;
    expect(result.done).toBe(false);
    expect(Array.from(result.value as Uint8Array)).toEqual([1, 2, 3]);
    expect(chunk.buffer.detached).toBe(true);
  });

  it('fills a BYOB request and returns a view over transferred storage', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl({
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    }, {}, createRuntime());
    const reader = stream.getReader({ mode: 'byob' });
    const supplied = new Uint16Array(4);
    const read = reader.read(supplied, { min: 2 });
    const request = requireByteController(controller).byobRequest;
    if (!request?.view) throw new Error('Missing BYOB request');
    (request.view as Uint8Array).set([1, 0, 2, 0]);

    request.respond(4);

    const result = await observe(read);
    expect(result.done).toBe(false);
    expect(Array.from(result.value as Uint16Array)).toEqual([1, 2]);
    expect(supplied.buffer.detached).toBe(true);
  });

  it('auto-allocates a pull-into buffer for a default reader', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const stream = new ReadableStreamImpl({
      autoAllocateChunkSize: 4,
      pull(controller: ReadableByteStreamControllerImpl) {
        const request = controller.byobRequest;
        if (!request?.view) throw new Error('Missing auto-allocated request');
        (request.view as Uint8Array).set([7, 8]);
        request.respond(2);
        return promises.resolve(undefined);
      },
      type: 'bytes',
    }, {}, runtime);

    const result = await observe(stream.getReader({}).read());

    expect(Array.from(result.value as Uint8Array)).toEqual([7, 8]);
  });

  it('fulfills a pending BYOB read with an empty view on close', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl({
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    }, {}, createRuntime());
    const reader = stream.getReader({ mode: 'byob' });
    const read = reader.read(new Uint8Array(2), { min: 1 });
    const byteController = requireByteController(controller);

    byteController.close();
    const request = byteController.byobRequest;
    if (!request) throw new Error('Missing closing BYOB request');
    request.respond(0);

    const result = await observe(read);
    expect(result.done).toBe(true);
    expect((result.value as Uint8Array).byteLength).toBe(0);
  });

  it('rejects a BYOB reader for an ordinary readable stream', () => {
    const { stream } = createReadableStream();

    expect(() => stream.getReader({ mode: 'byob' })).toThrow(
      /requires a stream constructed with a byte source/u,
    );
  });
});

function createReadableStream(
  source: { cancel?(reason: unknown): PromiseValue<undefined>; } = {},
): {
  controller: ReadableStreamDefaultControllerImpl;
  stream: ReadableStreamImpl;
} {
  const stream = new ReadableStreamImpl(source, {}, createRuntime());
  const controller = stream.state.controller;
  if (!ReadableStreamDefaultControllerImpl.is(controller)) {
    throw new Error('Readable stream has no default controller');
  }
  return { controller, stream };
}

function requireByteController(
  controller: ReadableByteStreamControllerImpl | undefined,
): ReadableByteStreamControllerImpl {
  if (!controller) throw new Error('Readable byte stream has no controller');
  return controller;
}

function requireDefaultController(
  controller: ReadableStreamDefaultControllerImpl |
    ReadableByteStreamControllerImpl | undefined,
): ReadableStreamDefaultControllerImpl {
  if (!ReadableStreamDefaultControllerImpl.is(controller)) {
    throw new Error('Missing readable stream default controller');
  }
  return controller;
}

class TestAbortSignal
{
  aborted = false;
  reason: unknown = undefined;
  readonly #algorithms = new Set<() => void>();

  abort(reason: unknown): void {
    this.aborted = true;
    this.reason = reason;
    for (const algorithm of this.#algorithms) algorithm();
  }

  addAlgorithm(callback: () => void): { remove(): void; } {
    this.#algorithms.add(callback);
    return { remove: () => this.#algorithms.delete(callback) };
  }
}

const defaultPipeOptions = {
  preventAbort: false,
  preventCancel: false,
  preventClose: false,
};

type ReadableStreamReadResult = {
  readonly done: boolean;
  readonly value: unknown;
};

function readResult(
  value: unknown,
  done: boolean,
): ReadableStreamReadResult {
  return { done, value };
}

function requireFunction(object: object, key: PropertyKey): CallableFunction {
  const value = Reflect.get(object, key) as unknown;
  if (typeof value !== 'function') {
    throw new TypeError(`${String(key)} is not callable`);
  }
  return value;
}

function readProjectedStream(stream: object): Promise<unknown> {
  const reader = Reflect.apply(
    requireFunction(stream, 'getReader'),
    stream,
    [],
  ) as object;
  return Reflect.apply(requireFunction(reader, 'read'), reader, []) as Promise<
    unknown
  >;
}

function callIterator(
  iterator: object,
  operation: 'next' | 'return',
  argumentsList: unknown[] = [],
): Promise<unknown> {
  return Reflect.apply(
    requireFunction(iterator, operation),
    iterator,
    argumentsList,
  ) as Promise<unknown>;
}
