import { describe, expect, it, vi } from 'vitest';

import {
  createResourceMetadata,
  detectSuppliedMIMEType,
  maximumResourceHeaderLength,
  parseMIMEType,
  readResourceHeader,
  serializeMIMEType,
  type MIMEType,
  type ReadResourceBytes,
} from '../../../src/mime';

const encoder = new TextEncoder();

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
  it('reads incrementally through end-of-resource', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const reads = [Uint8Array.of(1, 2), Uint8Array.of(3), null];
    const maximums: number[] = [];

    const header = await readResourceHeader(metadata, (max) => {
      maximums.push(max);
      return Promise.resolve(reads.shift() ?? null);
    });

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
      if (length === 0) return Promise.resolve(null);
      const chunk = source.slice(offset, offset + length);
      offset += length;
      return Promise.resolve(chunk);
    });

    const header = await readResourceHeader(metadata, readBytes);

    expect(header).toEqual(source.slice(0, maximumResourceHeaderLength));
    expect(offset).toBe(maximumResourceHeaderLength);
    expect(readBytes).toHaveBeenLastCalledWith(48);
  });

  it('lets the host close the read window before end-of-resource', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockResolvedValueOnce(Uint8Array.of(1, 2, 3))
      .mockResolvedValueOnce(null);

    expect([...await readResourceHeader(metadata, readBytes)])
      .toEqual([1, 2, 3]);
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('determines and reuses the resource header only once', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const readBytes = vi.fn<ReadResourceBytes>()
      .mockResolvedValueOnce(Uint8Array.of(1))
      .mockResolvedValueOnce(null);

    const first = await readResourceHeader(metadata, readBytes);
    const second = await readResourceHeader(
      metadata,
      () => Promise.reject(new Error('the source must not be read again')),
    );

    expect(second).toBe(first);
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('copies source chunks into resource-owned header storage', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const chunk = Uint8Array.of(1, 2, 3);
    const reads = [chunk, null];

    const header = await readResourceHeader(
      metadata,
      () => Promise.resolve(reads.shift() ?? null),
    );
    chunk[0] = 9;

    expect([...header]).toEqual([1, 2, 3]);
  });

  it('propagates source cancellation and errors', async () => {
    const metadata = createResourceMetadata({ kind: 'other', mimeType: undefined });
    const cancellation = new Error('cancelled');

    await expect(readResourceHeader(
      metadata,
      () => Promise.reject(cancellation),
    )).rejects.toBe(cancellation);
    expect(metadata.resourceHeader).toBeUndefined();
  });

  it('rejects byte sources that make no progress or over-read', async () => {
    const emptyMetadata = createResourceMetadata({
      kind: 'other',
      mimeType: undefined,
    });
    await expect(readResourceHeader(
      emptyMetadata,
      () => Promise.resolve(new Uint8Array()),
    )).rejects.toThrow(RangeError);

    const oversizedMetadata = createResourceMetadata({
      kind: 'other',
      mimeType: undefined,
    });
    await expect(readResourceHeader(
      oversizedMetadata,
      (max) => Promise.resolve(new Uint8Array(max + 1)),
    )).rejects.toThrow(RangeError);
  });
});

function requiredMIMEType(input: string): MIMEType {
  const mimeType = parseMIMEType(input);
  if (mimeType === null) throw new Error(`Expected a MIME type: ${input}`);
  return mimeType;
}
