import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { BlobData, BlobReadFailure, type BlobByteSource } from '../../src/file/index';
import { FetchBody } from '../../src/fetch/body';
import { HTTPCacheStore } from '../../src/fetch/cache-http';
import { FetchResponse } from '../../src/fetch/response';
import { ReadableStreamImpl } from '../../src/streams/index';
import { fileTaskSource } from '../../src/browlet/scripting/tasks';
import type { ReadableStream, ReadableStreamDefaultReader } from '../../src/browlet/platform';
import { createFetchRequest } from '../fetch/fetch-fixture';
import { createFetchWindow } from './fetch-fixture';
import { observeBrowletPromise } from './test-runtime';

describe('body production across Document destruction', () => {
  it.each([
    [0, false], [2, false], [0, true], [2, true],
  ] as const)('fails %s queued bytes when destruction precedes production (already destroyed: %s)', (size, alreadyDestroyed) => {
    const owner = createFetchWindow();
    owner.queueTask(() => owner.document!.destroy());
    if (alreadyDestroyed) expect(owner.runTask()).toBe(true);
    const body = FetchBody.fromBytes(new Uint8Array(size), owner.context.getEnvironment());
    const read = readChunk(body.stream);
    expect(read.errorSteps).not.toHaveBeenCalled();

    expect(owner.runTask()).toBe(true);
    expect(owner.document!.isDestroyed).toBe(true);
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));
    expect(read.chunkSteps).not.toHaveBeenCalled();
    expect(read.closeSteps).not.toHaveBeenCalled();
    expect(owner.networkingTasks()).toHaveLength(0);
  });

  it('rejects a projected read in its owning realm when another Window observes it', async () => {
    const owner = createFetchWindow();
    const other = createFetchWindow();
    owner.queueTask(() => owner.document!.destroy());
    const body = FetchBody.fromBytes(Uint8Array.of(1), owner.context.getEnvironment());
    const stream = owner.context.project(ReadableStreamImpl, body.stream) as ReadableStream;
    const reader = stream.getReader() as ReadableStreamDefaultReader;
    const result = observeBrowletPromise(other.realm.globalObject, reader.read());
    expect(owner.runTask()).toBe(true);
    await expect(result).rejects.toBeInstanceOf(owner.realm.TypeError);
  });

  it('does not enqueue bytes after the consumer has already canceled', () => {
    const owner = createFetchWindow();
    const body = FetchBody.fromBytes(Uint8Array.of(1), owner.context.getEnvironment());
    body.stream.cancel();
    expect(() => owner.runTask()).not.toThrow();
    expect(body.stream.isClosed).toBe(true);
    expect(owner.networkingTasks()).toHaveLength(0);
  });

  it.each(['bytes', 'blob'] as const)('preserves a completed %s producer for a later reader', async (source) => {
    const owner = createFetchWindow();
    const bytes = Uint8Array.of(3, 5);
    const body = FetchBody.fromSource(source === 'bytes' ? bytes : BlobData.fromBytes(bytes), owner.context.getEnvironment());
    await nextTurn();
    while (owner.runTask()) { /* Finish production without consuming the retained bytes. */ }
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);

    const read = readChunk(body.stream);
    expect(read.chunkSteps).toHaveBeenCalledOnce();
    expect([...read.chunkSteps.mock.calls[0]![0] as Uint8Array]).toEqual([...bytes]);
    expect(read.errorSteps).not.toHaveBeenCalled();
    read.reader.readChunk(read);
    expect(read.closeSteps).toHaveBeenCalledOnce();
  });

  it.each(['data', 'eof', 'failure'] as const)('settles a Blob read when its queued %s task is discarded', async (phase) => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    env.queueTask('file', { run: () => owner.document!.destroy() });
    const data = phase === 'failure' ? BlobData.fromSource({
      size: 1, snapshotState: null,
      read: () => Promise.reject(new BlobReadFailure('SnapshotState')),
    }) : BlobData.fromBytes(phase === 'eof' ? new Uint8Array() : Uint8Array.of(7));
    const read = readChunk(data.stream(env));
    await nextTurn();
    const tasks = env.responsibleEventLoop.getTaskQueue(fileTaskSource);
    expect(tasks.size).toBeGreaterThan(1);
    expect(owner.runTask()).toBe(true);
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));
    expect(read.chunkSteps).not.toHaveBeenCalled();
    expect(read.closeSteps).not.toHaveBeenCalled();
    expect(tasks.size).toBe(0);
  });

  it.each(['success', 'failure'] as const)('fails a pending backing read at destruction and ignores later %s', async (outcome) => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const bytes = Promise.withResolvers<Uint8Array>();
    const source: BlobByteSource = { size: 1, snapshotState: null, read: () => bytes.promise };
    const read = readChunk(BlobData.fromSource(source).stream(env));
    await nextTurn();
    const tasks = env.responsibleEventLoop.getTaskQueue(fileTaskSource);
    expect(tasks.size).toBe(0);
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));

    if (outcome === 'success') bytes.resolve(Uint8Array.of(9));
    else bytes.reject(new BlobReadFailure('SnapshotState'));
    await nextTurn();
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));
    expect(read.chunkSteps).not.toHaveBeenCalled();
    expect(read.closeSteps).not.toHaveBeenCalled();
    expect(tasks.size).toBe(0);
  });

  it('fails an outstanding end-of-body read when destruction discards Blob EOF', async () => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const stream = BlobData.fromBytes(Uint8Array.of(8)).stream(env);
    const reader = stream.getDefaultReader();
    const completed = { chunkSteps: vi.fn(), closeSteps: vi.fn(), errorSteps: vi.fn() };
    const firstChunk = vi.fn();
    reader.readChunk({
      chunkSteps: (bytes) => {
        firstChunk(bytes);
        reader.readChunk(completed);
        owner.document!.destroy();
      },
      closeSteps: vi.fn(), errorSteps: vi.fn(),
    });
    await nextTurn();
    const tasks = env.responsibleEventLoop.getTaskQueue(fileTaskSource);
    expect(tasks.size).toBe(2);
    expect(owner.runTask()).toBe(true);
    expect(firstChunk).toHaveBeenCalledOnce();
    expect(completed.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));
    expect(completed.closeSteps).not.toHaveBeenCalled();
    expect(tasks.size).toBe(0);
  });

  it('fails a Blob stream created after destruction without starting its backing read', async () => {
    const owner = createFetchWindow();
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    const readSource = vi.fn(() => Promise.resolve(Uint8Array.of(1)));
    const stream = BlobData.fromSource({ size: 1, snapshotState: null, read: readSource })
      .stream(owner.context.getEnvironment());
    const read = readChunk(stream);
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));
    await nextTurn();
    expect(readSource).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('ignores a second backing read completing with %s after queued data is discarded', async (outcome) => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const bytes = Promise.withResolvers<Uint8Array>();
    const readSource = vi.fn((start: number, length: number) => start === 0 ? Promise.resolve(new Uint8Array(length)) : bytes.promise);
    const source: BlobByteSource = {
      size: 64 * 1024 + 1, snapshotState: null, read: readSource,
    };
    env.queueTask('file', { run: () => owner.document!.destroy() });
    const read = readChunk(BlobData.fromSource(source).stream(env));
    await nextTurn();
    expect(readSource).toHaveBeenCalledTimes(2);
    expect(owner.runTask()).toBe(true);
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));

    if (outcome === 'success') bytes.resolve(Uint8Array.of(9));
    else bytes.reject(new BlobReadFailure('SnapshotState'));
    await nextTurn();
    expect(env.responsibleEventLoop.getTaskQueue(fileTaskSource).size).toBe(0);
    expect(read.errorSteps).toHaveBeenCalledOnce();
    expect(read.chunkSteps).not.toHaveBeenCalled();
    expect(read.closeSteps).not.toHaveBeenCalled();
    expect(readSource).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'] as const)('ignores a backing read completing with %s after explicit stream cancellation', async (outcome) => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const bytes = Promise.withResolvers<Uint8Array>();
    const stream = BlobData.fromSource({ size: 1, snapshotState: null, read: () => bytes.promise }).stream(env);
    const read = readChunk(stream);
    await nextTurn();
    read.reader.cancel();
    if (outcome === 'success') bytes.resolve(Uint8Array.of(9));
    else bytes.reject(new BlobReadFailure('SnapshotState'));
    await nextTurn();
    expect(env.responsibleEventLoop.getTaskQueue(fileTaskSource).size).toBe(0);
    expect(stream.isClosed).toBe(true);
    expect(read.closeSteps).toHaveBeenCalledOnce();
    expect(read.errorSteps).not.toHaveBeenCalled();
    expect(read.chunkSteps).not.toHaveBeenCalled();
  });

  it('fails a discarded cache reader without discarding the shared cached representation', async () => {
    const owner = createFetchWindow();
    const other = createFetchWindow();
    const env = owner.context.getEnvironment();
    const request = createFetchRequest('https://example.test/cached', env);
    const cache = new HTTPCacheStore().determine(request)!;
    const response = new FetchResponse();
    response.headerList.set('Cache-Control', 'max-age=60');
    const entry = cache.begin(request, response, 0, 0)!;
    entry.append(Uint8Array.of(4, 6));
    entry.finish(response.bodyInfo);
    env.queueTask('file', { run: () => owner.document!.destroy() });
    const read = readChunk(entry.materialize(request, 'local', 0, env).body!.stream);
    await nextTurn();
    expect(owner.runTask()).toBe(true);
    expect(read.errorSteps).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TypeError' }));
    expect(cache.select(request)).toBe(entry);

    const freshRead = readChunk(entry.materialize(request, 'local', 0, other.context.getEnvironment()).body!.stream);
    await nextTurn();
    while (other.runTask()) { /* A different execution owner still reads the same immutable cache data. */ }
    expect(freshRead.chunkSteps).toHaveBeenCalledOnce();
    expect([...freshRead.chunkSteps.mock.calls[0]![0] as Uint8Array]).toEqual([4, 6]);
    expect(freshRead.errorSteps).not.toHaveBeenCalled();
  });
});

function readChunk(stream: ReadableStreamImpl) {
  const reader = stream.getDefaultReader();
  const steps = { chunkSteps: vi.fn(), closeSteps: vi.fn(), errorSteps: vi.fn() };
  reader.readChunk(steps);
  return { reader, ...steps };
}
