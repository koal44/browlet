import { observe } from '../browlet/streams/implementation-fixture';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { brotliCompressSync, brotliDecompressSync, deflateSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import { BodyRecord, bytesAsBody, handleContentCodings } from '../../src/fetch/body';
import {
  cancelReadableStream, closeReadableStream, createReadableStream, errorReadableStream,
  getReadableStreamReader, isReadableStreamClosed, isReadableStreamDisturbed,
  isReadableStreamLocked, readReadableStreamChunk,
} from '../../src/streams/index';
import {
  createArrayBufferView, getBufferSourceCopy, getBufferSourceUnderlyingBuffer,
} from '../../src/js-engine/index';
import { createBodyFixture, readBodyBytes } from './body-fixture';

describe('Fetch body cloning', () => {
  it('clones a body by replacing its stream with one tee branch and retaining the other', async () => {
    const fixture = createBodyFixture();
    const body = fixture.createBody([Uint8Array.of(1, 2), Uint8Array.of(3)]);
    const original = body.stream;
    body.source = Uint8Array.of(1, 2, 3);
    body.length = 3;
    closeReadableStream(original);

    const clone = body.clone();

    expect(body.stream).not.toBe(original);
    expect(clone.stream).not.toBe(body.stream);
    expect(isReadableStreamLocked(original)).toBe(true);
    expect(clone.source).toBe(body.source);
    expect(clone.length).toBe(3);
    const [first, second] = await Promise.all([readBodyBytes(body), readBodyBytes(clone)]);
    expect(first).toEqual(Uint8Array.of(1, 2, 3));
    expect(second).toEqual(first);
    first[0] = 99;
    expect(second).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('clones a chunk before either branch can modify it', async () => {
    const { createBody } = createBodyFixture();
    const body = createBody([Uint8Array.of(1, 2)]);
    closeReadableStream(body.stream);
    const clone = body.clone();
    const chunk = await new Promise<Uint8Array>((resolve, reject) => {
      readReadableStreamChunk(getReadableStreamReader(body.stream), {
        chunkSteps: (value) => resolve(value as Uint8Array),
        closeSteps: () => reject(new Error('Expected a body chunk')),
        errorSteps: reject,
      });
    });
    chunk[0] = 99;
    expect(await readBodyBytes(clone)).toEqual(Uint8Array.of(1, 2));
  });

  it('cancels the source only after both cloned branches cancel', async () => {
    const { runtime } = createBodyFixture();
    const cancel = vi.fn();
    const body = new BodyRecord(createReadableStream(undefined, cancel, 1, () => 1, runtime), runtime);
    const clone = body.clone();

    const first = cancelReadableStream(body.stream, 'first');
    expect(cancel).not.toHaveBeenCalled();
    const second = cancelReadableStream(clone.stream, 'second');
    await Promise.all([observe(first), observe(second)]);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(['first', 'second']);
  });
});

describe('Fetch byte sequences as bodies', () => {
  it('retains the source and length and creates a separate stream buffer in parallel', async () => {
    const fixture = createBodyFixture();
    const source = Uint8Array.of(9, 1, 2, 9).subarray(1, 3);
    const body = bytesAsBody(source, fixture.runtime);

    expect(body.source).toBe(source);
    expect(body.length).toBe(2);
    expect(isReadableStreamDisturbed(body.stream)).toBe(false);
    expect(isReadableStreamLocked(body.stream)).toBe(false);
    expect(fixture.parallelSteps).toHaveLength(1);
    fixture.runParallel();
    expect(source).toEqual(Uint8Array.of(1, 2));
    source[0] = 99;
    expect(await readBodyBytes(body)).toEqual(Uint8Array.of(1, 2));
  });

  it('supports BYOB reading in the supplied realm', async () => {
    const fixture = createBodyFixture();
    const body = bytesAsBody(Uint8Array.of(1, 2), fixture.runtime);
    const reader = body.stream.getReader({ mode: 'byob' });
    const view = createArrayBufferView('Uint8Array', [0, 0, 0, 0], fixture.context.realm);
    const buffer = getBufferSourceUnderlyingBuffer(view);
    const reading = reader.read(view, { min: 1 });
    fixture.runParallel();
    const result = await observe(reading);
    expect(result.done).toBe(false);
    expect(getBufferSourceCopy(result.value as object)).toEqual(Uint8Array.of(1, 2));
    expect(Object.getPrototypeOf(result.value)).toBe(Object.getPrototypeOf(view));
    expect(getBufferSourceCopy(buffer)).toHaveLength(0);
    expect(Object.getPrototypeOf(getBufferSourceUnderlyingBuffer(result.value as object)))
      .toBe(Object.getPrototypeOf(buffer));
  });

  it('closes an empty byte sequence without enqueueing an empty chunk', async () => {
    const fixture = createBodyFixture();
    const body = bytesAsBody(new Uint8Array(), fixture.runtime);
    fixture.runParallel();
    expect(body.length).toBe(0);
    expect(isReadableStreamClosed(body.stream)).toBe(true);
    expect(await readBodyBytes(body)).toEqual(new Uint8Array());
  });

  it('allows a byte body to be cloned before its bytes become available', async () => {
    const fixture = createBodyFixture();
    const source = Uint8Array.of(1, 2, 3);
    const body = bytesAsBody(source, fixture.runtime);
    const clone = body.clone();
    const process = vi.fn();
    const error = vi.fn();
    clone.fullyRead(process, error, fixture.global);
    const reading = readBodyBytes(body);
    fixture.runParallel();
    expect(await reading).toEqual(source);
    await nextTurn();
    expect(process).not.toHaveBeenCalled();
    expect(fixture.tasks).toHaveLength(1);
    expect(fixture.tasks[0]!.global).toBe(fixture.global);
    fixture.runTask();
    expect(process).toHaveBeenCalledExactlyOnceWith(source);
    expect(error).not.toHaveBeenCalled();
    expect(clone.source).toBe(source);
    expect(clone.length).toBe(3);
  });

  it('does not revive a byte stream canceled before its parallel work runs', async () => {
    const fixture = createBodyFixture();
    const body = bytesAsBody(Uint8Array.of(1), fixture.runtime);
    await observe(cancelReadableStream(body.stream, 'canceled'));
    expect(() => fixture.runParallel()).not.toThrow();
    expect(await readBodyBytes(body)).toEqual(new Uint8Array());
  });

  it('preserves a byte stream error raised before its parallel work runs', async () => {
    const fixture = createBodyFixture();
    const body = bytesAsBody(Uint8Array.of(1), fixture.runtime);
    const failure = new Error('failed');
    errorReadableStream(body.stream, failure);
    fixture.runParallel();
    await expect(readBodyBytes(body)).rejects.toBe(failure);
  });
});

describe('Fetch incremental body reading', () => {
  it('copies each chunk and waits for its global Fetch task before reading the next one', () => {
    const fixture = createBodyFixture();
    const first = Uint8Array.of(9, 1, 2, 9).subarray(1, 3);
    const second = Uint8Array.of(3);
    const body = fixture.createBody([first, second]);
    closeReadableStream(body.stream);
    const events: (number[] | string)[] = [];
    const error = vi.fn();

    body.incrementallyRead(
      (bytes) => events.push([...bytes]), () => events.push('end'), error,
      fixture.global,
    );
    expect(events).toEqual([]);
    expect(isReadableStreamDisturbed(body.stream)).toBe(true);
    expect(fixture.tasks).toHaveLength(1);
    expect(fixture.tasks[0]!.global).toBe(fixture.global);
    first[0] = 99;
    second[0] = 4;
    fixture.runTask();
    expect(events).toEqual([[1, 2]]);
    expect(fixture.tasks).toHaveLength(1);
    second[0] = 5;
    fixture.runTask();
    expect(events).toEqual([[1, 2], [4]]);
    fixture.runTask();
    expect(events).toEqual([[1, 2], [4], 'end']);
    expect(fixture.tasks).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(['supplied', 'default'] as const)('delivers chunks and completion through a %s parallel queue', (kind) => {
    const fixture = createBodyFixture();
    const body = fixture.createBody([Uint8Array.of(1), Uint8Array.of(2)]);
    closeReadableStream(body.stream);
    const destination = kind === 'supplied' ? fixture.createParallelQueue() : null;
    const events: (number[] | string)[] = [];
    body.incrementallyRead(
      (bytes) => events.push([...bytes]), () => events.push('end'), vi.fn(),
      destination,
    );
    expect(events).toEqual([]);
    expect(fixture.parallelSteps).toHaveLength(1);
    fixture.runParallel();
    expect(events).toEqual([[1], [2], 'end']);
    expect(fixture.scheduling.queueGlobalTask).not.toHaveBeenCalled();
  });

  it('accepts a Uint8Array from another realm', () => {
    const fixture = createBodyFixture();
    const other = createBodyFixture();
    const chunk = createArrayBufferView('Uint8Array', [1, 2], other.context.realm);
    const body = fixture.createBody([chunk]);
    closeReadableStream(body.stream);
    const process = vi.fn();
    body.incrementallyRead(process, vi.fn(), vi.fn());
    fixture.runParallel();
    expect(process).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(1, 2));
  });

  it.each([null, 'text', new Uint16Array([1]), { [Symbol.toStringTag]: 'Uint8Array' }])(
    'reports a non-byte chunk through a Fetch task: %j', (chunk) => {
      const fixture = createBodyFixture();
      const body = fixture.createBody([chunk, Uint8Array.of(2)]);
      closeReadableStream(body.stream);
      const process = vi.fn();
      const end = vi.fn();
      const error = vi.fn();
      body.incrementallyRead(process, end, error, fixture.global);
      expect(error).not.toHaveBeenCalled();
      fixture.runTask();
      expect(error).toHaveBeenCalledExactlyOnceWith(expect.any(TypeError));
      expect(process).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
      expect(fixture.tasks).toHaveLength(0);
    },
  );

  it('delivers an underlying stream error after already queued bytes', () => {
    const fixture = createBodyFixture();
    const body = fixture.createBody([Uint8Array.of(1)]);
    const failure = new Error('source failed');
    const events: unknown[] = [];
    body.incrementallyRead(
      (bytes) => events.push([...bytes]), () => events.push('end'), (error) => events.push(error),
      fixture.global,
    );
    errorReadableStream(body.stream, failure);
    fixture.runTask();
    expect(events).toEqual([[1]]);
    fixture.runTask();
    expect(events).toEqual([[1], failure]);
  });

  it('queues completion when an active read is canceled by the consuming specification', async () => {
    const fixture = createBodyFixture();
    const body = fixture.createBody();
    const end = vi.fn();
    const error = vi.fn();
    body.incrementallyRead(vi.fn(), end, error);
    await observe(cancelReadableStream(body.stream, 'aborted'));
    expect(end).not.toHaveBeenCalled();
    fixture.runParallel();
    expect(end).toHaveBeenCalledExactlyOnceWith();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('Fetch full body reading', () => {
  it.each(['global', 'parallel', 'default'] as const)('delivers all bytes in one task to a %s destination', async (kind) => {
    const fixture = createBodyFixture();
    const body = fixture.createBody([Uint8Array.of(1, 2), Uint8Array.of(3)]);
    closeReadableStream(body.stream);
    const destination = kind === 'global' ? fixture.global : kind === 'parallel' ? fixture.createParallelQueue() : null;
    const process = vi.fn();
    const error = vi.fn();
    body.fullyRead(process, error, destination);
    await nextTurn();
    expect(process).not.toHaveBeenCalled();
    if (kind === 'global') {
      expect(fixture.tasks).toHaveLength(1);
      expect(fixture.tasks[0]!.global).toBe(fixture.global);
      fixture.runTask();
    } else {
      expect(fixture.parallelSteps).toHaveLength(1);
      fixture.runParallel();
      expect(fixture.scheduling.queueGlobalTask).not.toHaveBeenCalled();
    }
    expect(process).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(1, 2, 3));
    expect(error).not.toHaveBeenCalled();
  });

  it('queues an empty body as a successful zero-length byte sequence', () => {
    const fixture = createBodyFixture();
    const body = fixture.createBody();
    closeReadableStream(body.stream);
    const process = vi.fn();
    body.fullyRead(process, vi.fn());
    expect(process).not.toHaveBeenCalled();
    fixture.runParallel();
    expect(process).toHaveBeenCalledExactlyOnceWith(new Uint8Array());
  });

  it('queues stream failures without exposing partial bytes', async () => {
    const fixture = createBodyFixture();
    const body = fixture.createBody([Uint8Array.of(1)]);
    const failure = new Error('source failed');
    const process = vi.fn();
    const error = vi.fn();
    body.fullyRead(process, error);
    errorReadableStream(body.stream, failure);
    await nextTurn();
    expect(error).not.toHaveBeenCalled();
    fixture.runParallel();
    expect(error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(process).not.toHaveBeenCalled();
  });
});

describe('Fetch content codings', () => {
  const bytes = Uint8Array.of(1, 2, 3, 4);
  const decoders = new Map([
    ['gzip', (input: Uint8Array) => Uint8Array.from(gunzipSync(input))],
    ['deflate', (input: Uint8Array) => Uint8Array.from(inflateSync(input))],
    ['br', (input: Uint8Array) => Uint8Array.from(brotliDecompressSync(input))],
  ]);

  it.each([
    ['gzip', gzipSync(bytes)], ['deflate', deflateSync(bytes)], ['br', brotliCompressSync(bytes)],
  ] as const)('decodes %s with a supplied host codec', (coding, encoded) => {
    expect(handleContentCodings([coding], encoded, decoders)).toEqual(bytes);
  });

  it('decodes case-insensitive codings in reverse application order', () => {
    const encoded = brotliCompressSync(gzipSync(bytes));
    expect(handleContentCodings(['GZip', 'BR'], encoded, decoders)).toEqual(bytes);
  });

  it('returns the original bytes without partially decoding an unsupported coding list', () => {
    const decode = vi.fn(() => bytes);
    const available = new Map([['known', decode]]);
    for (const codings of [[], ['unknown'], ['unknown', 'known'], ['known', 'unknown']]) {
      expect(handleContentCodings(codings, bytes, available)).toBe(bytes);
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it('returns failure for corrupt or truncated encoded bytes', () => {
    expect(handleContentCodings(['gzip'], bytes, decoders)).toBeNull();
    expect(handleContentCodings(['gzip'], gzipSync(bytes).subarray(0, 10), decoders)).toBeNull();
  });

  it('stops decoding after a codec fails', () => {
    const inner = vi.fn(() => bytes);
    const outer = vi.fn((): Uint8Array => { throw new Error('corrupt data'); });
    expect(handleContentCodings(['inner', 'outer'], bytes, new Map([['inner', inner], ['outer', outer]]))).toBeNull();
    expect(inner).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledExactlyOnceWith(bytes);
  });
});
