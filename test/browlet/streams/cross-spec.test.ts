import { idlType } from '../../../src/web-idl/core/index';
import { createEnvironment } from '../../js-engine/execution-fixture';
import { createTransformStream, observe } from './implementation-fixture';
import { assert, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createReadableStreamProxy, GenericTransformStreamMixin, ReadableStreamImpl,
  WritableStreamImpl,
} from '../../../src/streams/index';
import {
  getBufferSourceByteOffset, getBufferSourceCopy, getBufferSourceUnderlyingBuffer,
  writeArrayBufferView,
} from '../../../src/js-engine/index';

describe('Streams operations for other specifications', () => {
  it('drains buffered bytes without recursion or Node microtask scheduling', () => {
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, createEnvironment());
    for (let i = 0; i < 4_096; i++) stream.enqueueChunk(Uint8Array.of(i % 256));
    stream.close();
    const success = vi.fn();
    const failure = vi.fn();
    const schedule = vi.spyOn(globalThis, 'queueMicrotask');
    try {
      stream.getDefaultReader().readAllBytes(success, failure);
      expect(schedule).not.toHaveBeenCalled();
      expect(failure).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledExactlyOnceWith(
        Uint8Array.from({ length: 4_096 }, (_, i) => i % 256),
      );
    } finally {
      schedule.mockRestore();
    }
  });

  it('resumes byte reading when later chunks arrive', () => {
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, createEnvironment());
    const success = vi.fn();
    const failure = vi.fn();
    stream.getDefaultReader().readAllBytes(success, failure);
    expect(success).not.toHaveBeenCalled();
    stream.enqueueChunk(Uint8Array.of(1, 2));
    stream.enqueueChunk(Uint8Array.of(3));
    stream.close();
    expect(success).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(1, 2, 3));
    expect(failure).not.toHaveBeenCalled();
  });

  it('retains the actual transform associated with a generic transform', () => {
    const transform = createTransformStream(null);
    transform.setUp(() => undefined);
    const generic = new GenericTransformStreamMixin(transform);

    expect(generic.getAssociatedTransform()).toBe(transform);
    expect(generic.readable).toBe(transform.readable);
    expect(generic.writable).toBe(transform.writable);
  });

  it('creates, reads, and introspects an ordinary readable stream', async () => {
    let pulled = false;
    const stream: ReadableStreamImpl = ReadableStreamImpl.createDefault(
      () => {
        if (pulled) return;
        pulled = true;
        stream.enqueueChunk('chunk');
        stream.close();
      },
      undefined,
      1,
      () => 1,
      createEnvironment(),
    );

    expect(stream.desiredSize).toBe(1);
    expect(stream.needsMoreData).toBe(true);
    expect(stream.isReadable).toBe(true);

    const reader = stream.getDefaultReader();
    expect(stream.locked).toBe(true);
    const chunk = new Promise<unknown>((resolve, reject) => {
      reader.readChunk({
        chunkSteps: resolve,
        closeSteps: () => reject(new Error('Stream closed without a chunk')),
        errorSteps: reject,
      });
    });

    await expect(chunk).resolves.toBe('chunk');
    expect(stream.disturbed).toBe(true);
    expect(stream.isClosed).toBe(true);
    reader.release(stream.env);
    expect(stream.locked).toBe(false);
  });

  it('responds when a byte chunk uses the current BYOB request buffer', async () => {
    const stream: ReadableStreamImpl = ReadableStreamImpl.createWithByteReadingSupport(
      () => {
        const view = stream.byobRequestView;
        if (view === null) throw new Error('No current BYOB request');
        expectTypeOf(view.buffer).toEqualTypeOf<ArrayBuffer>();
        const chunk = new Uint8Array(getBufferSourceUnderlyingBuffer(view) as ArrayBuffer, getBufferSourceByteOffset(view), 2);
        writeArrayBufferView(chunk, [7, 8]);
        stream.enqueueChunk(chunk);
        stream.close();
      },
      undefined,
      0,
      createEnvironment(),
    );
    const reader = stream.getReader({ mode: 'byob' });
    const destination = new Uint8Array([0, 0, 0, 0]);

    const result = await observe(reader.read(destination, { min: 1 }, stream.env));

    expect(result.done).toBe(false);
    assert(result.value !== undefined);
    expectTypeOf(result.value.buffer).toEqualTypeOf<ArrayBuffer>();
    expect(getBufferSourceCopy(result.value))
      .toEqual(Uint8Array.from([7, 8]));
  });

  it('pulls bytes into a BYOB view without copying the remainder', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    let offset = 1;
    const stream: ReadableStreamImpl = ReadableStreamImpl.createWithByteReadingSupport(
      () => {
        offset = stream.pullFromBytes(bytes, offset);
        stream.close();
      },
      undefined,
      0,
      createEnvironment(),
    );
    const reader = stream.getReader({ mode: 'byob' });
    const destination = new Uint8Array([0, 0, 0, 0]);

    const result = await observe(reader.read(destination, { min: 1 }, stream.env));

    expect(offset).toBe(4);
    assert(result.value !== undefined);
    expect(getBufferSourceCopy(result.value))
      .toEqual(Uint8Array.from([2, 3, 4]));
  });

  it('waits for internal promises returned by writable algorithms', async () => {
    const env = createEnvironment();
    const { Promise: P } = env.exec;
    const finishWrite = P.withResolvers(idlType.undefined);
    const write = vi.fn(() => finishWrite.promise);
    const stream = WritableStreamImpl.createDefault(write, undefined, undefined, 1, () => 1, env);
    const writer = stream.getWriter();
    const writing = writer.writeInternal('chunk', env);
    let settled = false;
    void observe(writing).then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(stream.signal.aborted).toBe(false);
    finishWrite.resolve();
    await expect(observe(writing)).resolves.toBeUndefined();
    await expect(observe(stream.closeInternal()))
      .resolves.toBeUndefined();
    writer.release(stream.env);
    expect(write).toHaveBeenCalledWith('chunk');
  });

  it('errors a writable stream and proxies a readable stream', async () => {
    const writable = WritableStreamImpl.createDefault(
      () => undefined,
      undefined,
      undefined,
      1,
      () => 1,
      createEnvironment(),
    );
    const writer = writable.getWriter();
    const failure = new Error('sink failed');
    writable.error(failure);
    await expect(observe(writer.closed)).rejects.toBe(failure);

    const source = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, createEnvironment());
    const proxy = createReadableStreamProxy(source, source.env);
    expect(source.locked).toBe(true);
    expect(source.disturbed).toBe(true);
    const reading = observe(proxy.getReader({}).read(proxy.env));
    source.enqueueChunk('proxied');
    source.close();
    await expect(reading).resolves.toEqual({
      done: false,
      value: 'proxied',
    });
  });
});

describe('Readable-stream completion steps', () => {
  it('waits for queued bytes without locking or pulling and precedes read completion', async () => {
    const env = createEnvironment();
    const pull = vi.fn();
    const stream = ReadableStreamImpl.createDefault(pull, undefined, 0, () => 1, env);
    const events: string[] = [];
    const closed = vi.fn(() => { events.push('closed'); });
    const errored = vi.fn();
    stream.onCompletion(closed, errored);
    stream.enqueueChunk(Uint8Array.of(1, 2, 3));
    stream.close();
    await observe(env.exec.Promise.resolve(undefined, idlType.undefined));

    expect(stream.locked).toBe(false);
    expect(stream.disturbed).toBe(false);
    expect(pull).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    const reader = stream.getDefaultReader();
    reader.readAllBytes((bytes) => {
      events.push('read');
      expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
    }, errored);
    expect(events).toEqual(['closed', 'read']);
    expect(closed).toHaveBeenCalledOnce();
    expect(errored).not.toHaveBeenCalled();
    reader.release(env);
  });

  it.each(['close', 'error', 'cancel'] as const)('observes %s once despite reader release, including late registrations', async (mode) => {
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, createEnvironment());
    const closed = vi.fn();
    const errored = vi.fn();
    const second = vi.fn();
    stream.onCompletion(closed, errored);
    stream.onCompletion(second, second);
    const reader = stream.getDefaultReader();
    reader.closed.observe(() => {}, () => {});
    reader.release(stream.env);
    expect(closed).not.toHaveBeenCalled();
    expect(errored).not.toHaveBeenCalled();
    if (mode === 'close') stream.close();
    else if (mode === 'error') stream.error(undefined);
    else await observe(stream.cancelInternal('stop'));
    expect(closed).toHaveBeenCalledTimes(mode === 'error' ? 0 : 1);
    expect(errored).toHaveBeenCalledTimes(mode === 'error' ? 1 : 0);
    if (mode === 'error') expect(errored).toHaveBeenCalledWith(undefined);
    expect(second).toHaveBeenCalledOnce();
    const late = vi.fn();
    stream.onCompletion(late, late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('notifies completion before pending reads fail, preserving the original error', () => {
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, createEnvironment());
    const failure = new Error('source failed');
    const events: unknown[] = [];
    stream.onCompletion(vi.fn(), (reason) => { events.push(['end', reason]); });
    stream.getDefaultReader().readAllBytes(vi.fn(), (reason) => { events.push(['read', reason]); });
    stream.error(failure);
    expect(events).toEqual([['end', failure], ['read', failure]]);
  });

  it('completes closure even if source cancellation subsequently rejects', async () => {
    const env = createEnvironment();
    const stream = ReadableStreamImpl.createDefault(undefined, () => env.exec.Promise.reject('cleanup', idlType.undefined), 0, () => 1, env);
    const closed = vi.fn();
    const errored = vi.fn();
    stream.onCompletion(closed, errored);
    await expect(observe(stream.cancelInternal('stop'))).rejects.toBe('cleanup');
    expect(closed).toHaveBeenCalledOnce();
    expect(errored).not.toHaveBeenCalled();
  });
});
