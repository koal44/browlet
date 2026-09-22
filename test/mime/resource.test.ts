import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { createMicrotaskQueue } from '../../src/js-engine/index';
import type { PromiseValue } from '../../src/infra/promises';
import { BindingWorld } from '../../src/web-idl/index';
import { createExecution } from '../js-engine/execution-fixture';
import { TestRealm } from '../web-idl/test-realm';

import { parseMIMEType, serializeMIMEType, type MIMEType } from '../../src/mime/mime-type';
import {
  detectSuppliedMIMEType, maximumResourceHeaderLength, readResourceHeader,
  type ReadResourceBytes,
} from '../../src/mime/resource';
import { sniffMIMEType } from '../../src/mime/sniffing';

const encoder = new TextEncoder();
const exec = createExecution();

describe('MIME Sniffing §5.1: detecting a supplied MIME type', () => {
  for (const value of [
    'text/plain',
    'text/plain; charset=ISO-8859-1',
    'text/plain; charset=iso-8859-1',
    'text/plain; charset=UTF-8',
  ]) {
    it(`sets the Apache-bug flag for exact ${value} bytes`, () => {
      const detected = detectSuppliedMIMEType({
        kind: 'http',
        contentTypeHeaders: [encoder.encode(value)],
      });

      expect(detected.checkForApacheBug).toBe(true);
      expect(serializeMIMEType(detected.suppliedMIMEType!))
        .toBe(serializeMIMEType(requiredMIMEType(value)));
    });
  }

  it('uses only the last HTTP Content-Type header', () => {
    const detected = detectSuppliedMIMEType({
      kind: 'http',
      contentTypeHeaders: [
        encoder.encode('text/plain'),
        encoder.encode('IMAGE/PNG;NAME=icon'),
      ],
    });

    expect(detected.checkForApacheBug).toBe(false);
    expect(serializeMIMEType(detected.suppliedMIMEType!))
      .toBe('image/png;name=icon');
  });

  it('compares the legacy HTTP value case-sensitively and exactly', () => {
    for (const value of [
      'TEXT/PLAIN',
      'text/plain; charset=utf-8',
      'text/plain; charset=UTF-8 ',
      'text/plain; charset=UTF-8;param=x',
    ]) {
      expect(detectSuppliedMIMEType({
        kind: 'http',
        contentTypeHeaders: [encoder.encode(value)],
      }).checkForApacheBug).toBe(false);
    }
  });

  it('leaves the supplied type undefined without a valid final value', () => {
    expect(detectSuppliedMIMEType(
      { kind: 'http', contentTypeHeaders: [] },
    ).suppliedMIMEType).toBeUndefined();

    expect(detectSuppliedMIMEType({
      kind: 'http',
      contentTypeHeaders: [encoder.encode('not a MIME type')],
    }).suppliedMIMEType).toBeUndefined();
  });

  it('accepts a MIME type determined by the resource owner', () => {
    const mimeType = requiredMIMEType('application/example');

    expect(detectSuppliedMIMEType(
      { kind: 'mime-type', mimeType },
    )).toEqual({ suppliedMIMEType: mimeType, checkForApacheBug: false });
    expect(detectSuppliedMIMEType(
      { kind: 'mime-type', mimeType: undefined },
    )).toEqual({ suppliedMIMEType: undefined, checkForApacheBug: false });
  });
});

describe('MIME Sniffing §5.2: reading the resource header', () => {
  const deadline = 100;

  it('completes collection through the byte source\'s promise queue', async () => {
    const queue = createMicrotaskQueue();
    const exec = createExecution(new TestRealm({ microtaskQueue: queue }));
    const source = exec.promises.withResolvers<Uint8Array | null>();
    const bytes = Uint8Array.of(4, 5);
    const headers: Uint8Array[] = [];
    const errors: unknown[] = [];
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(source.promise)
      .mockImplementation(() => exec.promises.resolve(null));

    void readResourceHeader(readBytes, deadline).then(
      (header) => { headers.push(header); },
      (error: unknown) => { errors.push(error); },
    );
    source.resolve(bytes);
    expect(headers).toEqual([]);
    queue.performMicrotaskCheckpoint();
    // Stock Node's ambient backend may finish after control returns to Node.
    if (queue.kind === 'ambient') await nextTurn();

    expect(errors).toEqual([]);
    expect(headers).toEqual([bytes]);
    expect(headers[0]).toBe(bytes);
  });

  it('realizes invalid-reader failures in the binding realm', async () => {
    const realm = new TestRealm();
    const context = new BindingWorld([]).register(realm);
    const exec = createExecution(realm);
    const failure = await observe(readResourceHeader(
      () => exec.promises.resolve(new Uint8Array()),
      deadline,
    )).catch((error: unknown) => context.realizeException(error));

    expect(failure).toBeInstanceOf(realm.intrinsics.rangeError);
    expect(failure).toHaveProperty('message',
      'A resource byte source must return between 1 and the requested number of bytes');
  });

  it('reads incrementally with one deadline and combines the prefix into exact-sized storage', async () => {
    const reads = [Uint8Array.of(1, 2), Uint8Array.of(3), null];
    const readBytes = vi.fn<ReadResourceBytes>(() =>
      exec.promises.resolve(reads.shift() ?? null));

    const header = await observe(readResourceHeader(readBytes, deadline));

    expect([...header]).toEqual([1, 2, 3]);
    expect(header.buffer.byteLength).toBe(3);
    expect(readBytes.mock.calls).toEqual([
      [1445, deadline], [1443, deadline], [1442, deadline],
    ]);
  });

  it.each([3, maximumResourceHeaderLength])('reuses a single %i-byte source view', async (length) => {
    const storage = new Uint8Array(length + 4);
    const chunk = storage.subarray(2, 2 + length);
    chunk.fill(7);
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(exec.promises.resolve(chunk))
      .mockImplementation(() => exec.promises.resolve(null));

    const header = await observe(readResourceHeader(readBytes, deadline));

    expect(header).toBe(chunk);
    expect(readBytes).toHaveBeenCalledTimes(length === maximumResourceHeaderLength ? 1 : 2);
  });

  it('stops exactly at 1445 bytes without over-reading the source', async () => {
    let next = 0;
    const source = Uint8Array.from(
      { length: maximumResourceHeaderLength + 10 },
      () => next++ & 0xff,
    );
    let offset = 0;
    const readBytes = vi.fn<ReadResourceBytes>((max) => {
      const length = Math.min(max, 127, source.length - offset);
      if (length === 0) return exec.promises.resolve(null);
      const chunk = source.subarray(offset, offset + length);
      offset += length;
      return exec.promises.resolve(chunk);
    });

    const header = await observe(readResourceHeader(readBytes, deadline));

    expect(header).toEqual(source.slice(0, maximumResourceHeaderLength));
    expect(offset).toBe(maximumResourceHeaderLength);
    expect(readBytes).toHaveBeenLastCalledWith(48, deadline);
  });

  it('stops at the source\'s deadline while later body bytes remain available', async () => {
    const chunks = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)];
    let now = 90;
    const readBytes = vi.fn<ReadResourceBytes>((_maxBytes, readDeadline) => {
      if (now >= readDeadline) return exec.promises.resolve(null);
      now += 10;
      return exec.promises.resolve(chunks.shift() ?? null);
    });

    expect([...await observe(readResourceHeader(readBytes, deadline))]).toEqual([1, 2, 3]);
    expect(readBytes).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([Uint8Array.of(4, 5)]);
  });

  it('keeps collected bytes when a pending source read ends at the deadline', async () => {
    const pending = exec.promises.withResolvers<Uint8Array | null>();
    const readStarted = exec.promises.withResolvers<void>();
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(exec.promises.resolve(Uint8Array.of(1, 2, 3)))
      .mockImplementationOnce(() => {
        readStarted.resolve();
        return pending.promise;
      });
    const result = observe(readResourceHeader(readBytes, deadline));

    await observe(readStarted.promise);
    // The source settles its outstanding read when its deadline elapses.
    pending.resolve(null);

    expect([...await result]).toEqual([1, 2, 3]);
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('returns an empty header when the source ends before supplying bytes', async () => {
    const readBytes = vi.fn<ReadResourceBytes>(() => exec.promises.resolve(null));

    expect(await observe(readResourceHeader(readBytes, deadline))).toEqual(new Uint8Array());
    expect(readBytes).toHaveBeenCalledExactlyOnceWith(maximumResourceHeaderLength, deadline);
  });

  it('returns the header for the caller to retain before sniffing', async () => {
    const bytes = encoder.encode('<html>');
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(exec.promises.resolve(bytes))
      .mockReturnValueOnce(exec.promises.resolve(null));

    const resourceHeader = await observe(readResourceHeader(readBytes, deadline));
    const detection = detectSuppliedMIMEType({
      kind: 'mime-type',
      mimeType: undefined,
    });

    expect(resourceHeader).toBe(bytes);
    expect(serializeMIMEType(sniffMIMEType(
      detection,
      resourceHeader,
      false,
      () => true,
    ))).toBe('text/html');
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('propagates source cancellation', async () => {
    const cancellation = new Error('cancelled');

    await expect(observe(readResourceHeader(
      () => exec.promises.reject(cancellation),
      deadline,
    ))).rejects.toBe(cancellation);
  });

  it.each(['first', 'later'] as const)('propagates a %s read failure rejected by the source runtime', async (which) => {
    const failure = new Error('source failed');
    const readBytes = vi.fn<ReadResourceBytes>(() =>
      exec.promises.try(() => { throw failure; }));
    if (which === 'later') readBytes.mockReturnValueOnce(exec.promises.resolve(Uint8Array.of(1)));

    const result = readResourceHeader(readBytes, deadline);
    await expect(observe(result)).rejects.toBe(failure);
  });

  it('rejects byte sources that make no progress or over-read', async () => {
    await expect(observe(readResourceHeader(
      () => exec.promises.resolve(new Uint8Array()),
      deadline,
    ))).rejects.toThrow(RangeError);

    await expect(observe(readResourceHeader(
      (max) => exec.promises.resolve(new Uint8Array(max + 1)),
      deadline,
    ))).rejects.toThrow(RangeError);
  });
});

function observe<T>(value: PromiseValue<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.observe(resolve, reject); });
}

function requiredMIMEType(input: string): MIMEType {
  const mimeType = parseMIMEType(input);
  if (mimeType === null) throw new Error(`Expected a MIME type: ${input}`);
  return mimeType;
}
