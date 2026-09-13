import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { createMicrotaskQueue, type PromiseValue } from '../../src/js-engine/index';
import { createBindings } from '../../src/web-idl/index';
import { createRuntime } from '../js-engine/runtime-fixture';
import { TestRealm } from '../web-idl/test-realm';

import {
  createResourceMetadata,
  detectSuppliedMIMEType,
  maximumResourceHeaderLength,
  parseMIMEType,
  readResourceHeader,
  serializeMIMEType,
  type MIMEType,
  type ReadResourceBytes,
} from '../../src/mime';

const encoder = new TextEncoder();
const runtime = createRuntime();

describe('MIME Sniffing §5.2: interpreting resource metadata', () => {
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
    expect(detectSuppliedMIMEType({
      kind: 'http',
      contentTypeHeaders: [],
    }).suppliedMIMEType).toBeUndefined();

    expect(detectSuppliedMIMEType({
      kind: 'http',
      contentTypeHeaders: [encoder.encode('not a MIME type')],
    }).suppliedMIMEType).toBeUndefined();
  });

  it('accepts the type determined by file and other protocol owners', () => {
    const mimeType = requiredMIMEType('application/example');

    expect(detectSuppliedMIMEType({ kind: 'file', mimeType }))
      .toEqual({ suppliedMIMEType: mimeType, checkForApacheBug: false });
    expect(detectSuppliedMIMEType({ kind: 'other', mimeType: undefined }))
      .toEqual({ suppliedMIMEType: undefined, checkForApacheBug: false });
  });

  it('creates the initial resource metadata state', () => {
    const metadata = createResourceMetadata(
      { kind: 'file', mimeType: requiredMIMEType('text/plain') },
      { noSniff: true },
    );

    expect(metadata.noSniff).toBe(true);
    expect(metadata.checkForApacheBug).toBe(false);
    expect(metadata.computedMIMEType).toBeUndefined();
    expect(metadata.resourceHeader).toBeUndefined();
  });
});

describe('MIME Sniffing §5.3: reading the resource header', () => {
  it('completes collection through the supplied runtime queue', async () => {
    const queue = createMicrotaskQueue();
    const runtime = createRuntime(new TestRealm({ microtaskQueue: queue }));
    const source = runtime.promises.withResolvers<Uint8Array | null>();
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const bytes = Uint8Array.of(4, 5);
    const headers: Uint8Array[] = [];
    const errors: unknown[] = [];
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(source.promise)
      .mockImplementation(() => runtime.promises.resolve(null));

    void readResourceHeader(metadata, readBytes, runtime).then(
      (header) => { headers.push(header); },
      (error: unknown) => { errors.push(error); },
    );
    source.resolve(bytes);
    expect(metadata.resourceHeader).toBeUndefined();
    queue.performMicrotaskCheckpoint();
    // Stock Node's ambient backend may finish after control returns to Node.
    if (queue.kind === 'ambient') await nextTurn();

    expect(errors).toEqual([]);
    expect(headers).toEqual([bytes]);
    expect(metadata.resourceHeader).toBe(headers[0]);
  });

  it('realizes invalid-reader failures in the binding realm', async () => {
    const realm = new TestRealm();
    const context = createBindings([]).register(realm).context;
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const runtime = createRuntime(realm);
    const failure = await observe(readResourceHeader(
      metadata,
      () => runtime.promises.resolve(new Uint8Array()),
      runtime,
    )).catch((error: unknown) => context.realizeException(error));

    expect(failure).toBeInstanceOf(realm.intrinsics.rangeError);
    expect(failure).toHaveProperty('message',
      'A resource byte source must return between 1 and the requested number of bytes');
  });

  it('reads incrementally through end-of-resource', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const reads = [Uint8Array.of(1, 2), Uint8Array.of(3), null];
    const maximums: number[] = [];

    const header = await observe(readResourceHeader(metadata, (max) => {
      maximums.push(max);
      return runtime.promises.resolve(reads.shift() ?? null);
    }, runtime));

    expect([...header]).toEqual([1, 2, 3]);
    expect(maximums).toEqual([1445, 1443, 1442]);
    expect(metadata.resourceHeader).toBe(header);
  });

  it('stops exactly at 1445 bytes without over-reading the source', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    let next = 0;
    const source = Uint8Array.from(
      { length: maximumResourceHeaderLength + 10 },
      () => next++ & 0xff,
    );
    let offset = 0;
    const readBytes = vi.fn<ReadResourceBytes>((max) => {
      const length = Math.min(max, 127, source.length - offset);
      if (length === 0) return runtime.promises.resolve(null);
      const chunk = source.slice(offset, offset + length);
      offset += length;
      return runtime.promises.resolve(chunk);
    });

    const header = await observe(readResourceHeader(metadata, readBytes, runtime));

    expect(header).toEqual(source.slice(0, maximumResourceHeaderLength));
    expect(offset).toBe(maximumResourceHeaderLength);
    expect(readBytes).toHaveBeenLastCalledWith(48);
  });

  it('lets the host close the read window before end-of-resource', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(runtime.promises.resolve(Uint8Array.of(1, 2, 3)))
      .mockReturnValueOnce(runtime.promises.resolve(null));

    expect([...await observe(readResourceHeader(metadata, readBytes, runtime))])
      .toEqual([1, 2, 3]);
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('determines and reuses the resource header only once', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockReturnValueOnce(runtime.promises.resolve(Uint8Array.of(1)))
      .mockReturnValueOnce(runtime.promises.resolve(null));

    const first = await observe(readResourceHeader(metadata, readBytes, runtime));
    const second = await observe(readResourceHeader(
      metadata,
      () => runtime.promises.reject(new Error('the source must not be read again')),
      runtime,
    ));

    expect(second).toBe(first);
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('copies source chunks into resource-owned header storage', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const chunk = Uint8Array.of(1, 2, 3);
    const reads = [chunk, null];

    const header = await observe(readResourceHeader(
      metadata,
      () => runtime.promises.resolve(reads.shift() ?? null),
      runtime,
    ));
    chunk[0] = 9;

    expect([...header]).toEqual([1, 2, 3]);
  });

  it('propagates source cancellation and errors', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const cancellation = new Error('cancelled');

    await expect(observe(readResourceHeader(
      metadata,
      () => runtime.promises.reject(cancellation),
      runtime,
    ))).rejects.toBe(cancellation);
    expect(metadata.resourceHeader).toBeUndefined();
  });

  it.each(['first', 'later'] as const)('rejects when the %s source read throws synchronously', async (which) => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const failure = new Error('source failed');
    const readBytes = vi.fn<ReadResourceBytes>(() => { throw failure; });
    if (which === 'later') readBytes.mockReturnValueOnce(runtime.promises.resolve(Uint8Array.of(1)));

    const result = readResourceHeader(metadata, readBytes, runtime);
    await expect(observe(result)).rejects.toBe(failure);
    expect(metadata.resourceHeader).toBeUndefined();
  });

  it('rejects byte sources that make no progress or over-read', async () => {
    const emptyMetadata = createResourceMetadata({
      kind: 'other',
      mimeType: undefined,
    });
    await expect(observe(readResourceHeader(
      emptyMetadata,
      () => runtime.promises.resolve(new Uint8Array()),
      runtime,
    ))).rejects.toThrow(RangeError);

    const oversizedMetadata = createResourceMetadata({
      kind: 'other',
      mimeType: undefined,
    });
    await expect(observe(readResourceHeader(
      oversizedMetadata,
      (max) => runtime.promises.resolve(new Uint8Array(max + 1)),
      runtime,
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
