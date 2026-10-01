import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { createMicrotaskQueue } from '../../src/js-engine/index';
import { internalType, type InternalPromise } from '../../src/infra/promises';
import { idlType, BindingWorld } from '../../src/web-idl/index';
import { createEnvironment } from '../js-engine/execution-fixture';
import { TestRealm } from '../web-idl/test-realm';

import { parseMIMEType, serializeMIMEType, type MIMEType } from '../../src/mime/mime-type';
import {
  detectSuppliedMIMEType, maximumResourceHeaderLength, readResourceHeader,
  type ReadResourceBytes,
} from '../../src/mime/resource';
import { sniffMIMEType } from '../../src/mime/sniffing';

const encoder = new TextEncoder();
const env = createEnvironment();

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
    const env = createEnvironment(new TestRealm({ microtaskQueue: queue }));
    const source = env.exec.Promise.withResolvers(internalType<Uint8Array<ArrayBufferLike> | null>('OptionalResult'));
    const bytes = Uint8Array.of(4, 5);
    const headers: Uint8Array[] = [];
    const errors: unknown[] = [];
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(source.promise)
      .mockImplementation(() => env.exec.Promise.fromValue(null, env.exec.NativePromise, internalType<null>('Result')));

    void readResourceHeader(readBytes, deadline).then(
      (header) => { headers.push(header); },
      (error: unknown) => { errors.push(error); }, idlType.undefined,
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
    const context = new BindingWorld([]).register(realm, (ctx) => ({ realm: ctx.realm }));
    const env = createEnvironment(realm);
    const failure = await observe(readResourceHeader(
      () => env.exec.Promise.fromValue(new Uint8Array(), env.exec.NativePromise, idlType.Uint8Array),
      deadline,
    )).catch((error: unknown) => context.realizeException(error));

    expect(failure).toBeInstanceOf(realm.intrinsics.rangeError);
    expect(failure).toHaveProperty('message',
      'A resource byte source must return between 1 and the requested number of bytes');
  });

  it('reads incrementally with one deadline and combines the prefix into exact-sized storage', async () => {
    const reads = [Uint8Array.of(1, 2), Uint8Array.of(3), null];
    const readBytes = vi.fn<ReadResourceBytes>(() =>
      env.exec.Promise.fromValue(reads.shift() ?? null, env.exec.NativePromise, internalType<Uint8Array<ArrayBuffer> | null>('OptionalResult')));

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
      .mockReturnValueOnce(env.exec.Promise.fromValue(chunk, env.exec.NativePromise, idlType.Uint8Array))
      .mockImplementation(() => env.exec.Promise.fromValue(null, env.exec.NativePromise, internalType<null>('Result')));

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
      if (length === 0) return env.exec.Promise.fromValue(null, env.exec.NativePromise, internalType<null>('Result'));
      const chunk = source.subarray(offset, offset + length);
      offset += length;
      return env.exec.Promise.fromValue(chunk, env.exec.NativePromise, idlType.Uint8Array);
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
      if (now >= readDeadline) return env.exec.Promise.fromValue(null, env.exec.NativePromise, internalType<null>('Result'));
      now += 10;
      return env.exec.Promise.fromValue(chunks.shift() ?? null, env.exec.NativePromise, internalType<Uint8Array<ArrayBuffer> | null>('OptionalResult'));
    });

    expect([...await observe(readResourceHeader(readBytes, deadline))]).toEqual([1, 2, 3]);
    expect(readBytes).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([Uint8Array.of(4, 5)]);
  });

  it('keeps collected bytes when a pending source read ends at the deadline', async () => {
    const pending = env.exec.Promise.withResolvers(internalType<Uint8Array<ArrayBufferLike> | null>('OptionalResult'));
    const readStarted = env.exec.Promise.withResolvers(idlType.undefined);
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(env.exec.Promise.fromValue(Uint8Array.of(1, 2, 3), env.exec.NativePromise, idlType.Uint8Array))
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
    const readBytes = vi.fn<ReadResourceBytes>(() => env.exec.Promise.fromValue(null, env.exec.NativePromise, internalType<null>('Result')));

    expect(await observe(readResourceHeader(readBytes, deadline))).toEqual(new Uint8Array());
    expect(readBytes).toHaveBeenCalledExactlyOnceWith(maximumResourceHeaderLength, deadline);
  });

  it('returns the header for the caller to retain before sniffing', async () => {
    const bytes = encoder.encode('<html>');
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(env.exec.Promise.fromValue(bytes, env.exec.NativePromise, idlType.Uint8Array))
      .mockReturnValueOnce(env.exec.Promise.fromValue(null, env.exec.NativePromise, internalType<null>('Result')));

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
      () => env.exec.Promise.reject(cancellation, internalType<Uint8Array<ArrayBufferLike> | null>('OptionalResult')),
      deadline,
    ))).rejects.toBe(cancellation);
  });

  it.each(['first', 'later'] as const)('propagates a %s read failure rejected by the source runtime', async (which) => {
    const failure = new Error('source failed');
    const readBytes = vi.fn<ReadResourceBytes>(() =>
      env.exec.Promise.try(() => { throw failure; }, internalType<Uint8Array | null>('ResourceBytes')));
    if (which === 'later') readBytes.mockReturnValueOnce(env.exec.Promise.fromValue(Uint8Array.of(1), env.exec.NativePromise, idlType.Uint8Array));

    const result = readResourceHeader(readBytes, deadline);
    await expect(observe(result)).rejects.toBe(failure);
  });

  it('rejects byte sources that make no progress or over-read', async () => {
    await expect(observe(readResourceHeader(
      () => env.exec.Promise.fromValue(new Uint8Array(), env.exec.NativePromise, idlType.Uint8Array),
      deadline,
    ))).rejects.toThrow(RangeError);

    await expect(observe(readResourceHeader(
      (max) => env.exec.Promise.fromValue(new Uint8Array(max + 1), env.exec.NativePromise, idlType.Uint8Array),
      deadline,
    ))).rejects.toThrow(RangeError);
  });
});

function observe<T>(value: InternalPromise<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.observe(resolve, reject); });
}

function requiredMIMEType(input: string): MIMEType {
  const mimeType = parseMIMEType(input);
  if (mimeType === null) throw new Error(`Expected a MIME type: ${input}`);
  return mimeType;
}
