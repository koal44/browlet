import { describe, expect, it, vi } from 'vitest';

import {
  BlobData, BlobImpl, BlobReadFailure, convertLineEndingsToNative,
  readBlobBytes, type BlobByteSource, type BlobEnvironment,
} from '../../../src/file';

const lfEnvironment: BlobEnvironment = { nativeLineEnding: '\n' };
const crlfEnvironment: BlobEnvironment = { nativeLineEnding: '\r\n' };

describe('File API §3: Blob', () => {
  it('constructs the empty Blob', async () => {
    const blob = new BlobImpl(lfEnvironment);

    expect(blob.size).toBe(0);
    expect(blob.type).toBe('');
    expect(await readBlobBytes(blob)).toEqual(new Uint8Array());
  });

  it('copies only the represented BufferSource bytes', async () => {
    const source = Uint8Array.of(0, 1, 2, 3, 4);
    const blob = new BlobImpl(lfEnvironment, [source.subarray(1, 4)]);
    source.fill(9);

    expect([...await readBlobBytes(blob)]).toEqual([1, 2, 3]);
  });

  it('UTF-8 encodes USVStrings and replaces unmatched surrogates', async () => {
    const blob = new BlobImpl(lfEnvironment, ['A\ud800B']);

    expect([...await readBlobBytes(blob)])
      .toEqual([0x41, 0xef, 0xbf, 0xbd, 0x42]);
  });

  it('normalizes native line endings through the File environment', async () => {
    const parts = ['a\rb\r\nc\nd'];
    const options = { endings: 'native' as const };

    expect(new TextDecoder().decode(
      await readBlobBytes(new BlobImpl(lfEnvironment, parts, options)),
    )).toBe('a\nb\nc\nd');
    expect(new TextDecoder().decode(
      await readBlobBytes(new BlobImpl(crlfEnvironment, parts, options)),
    )).toBe('a\r\nb\r\nc\r\nd');
  });

  it('leaves transparent line endings unchanged', async () => {
    const blob = new BlobImpl(crlfEnvironment, ['a\rb\nc\r\nd']);

    expect(new TextDecoder().decode(await readBlobBytes(blob)))
      .toBe('a\rb\nc\r\nd');
  });

  it('normalizes ASCII Blob types and rejects non-ASCII values', () => {
    expect(new BlobImpl(lfEnvironment, [], { type: 'Text/PLAIN;X=Y' }).type)
      .toBe('text/plain;x=y');
    expect(new BlobImpl(lfEnvironment, [], { type: 'text/\u007fplain' }).type)
      .toBe('');
    expect(new BlobImpl(lfEnvironment, [], { type: 'text/\u001fplain' }).type)
      .toBe('');
    expect(new BlobImpl(lfEnvironment, [], { type: 'text/pl\u00e4in' }).type)
      .toBe('');
  });

  it('concatenates mixed parts and ignores nested Blob types', async () => {
    const nested = new BlobImpl(
      lfEnvironment,
      ['bc'],
      { type: 'text/plain' },
    );
    const blob = new BlobImpl(
      lfEnvironment,
      ['a', nested, Uint8Array.of(100)],
      { type: 'Application/Example' },
    );

    expect(blob.size).toBe(4);
    expect(blob.type).toBe('application/example');
    expect(new TextDecoder().decode(await readBlobBytes(blob))).toBe('abcd');
  });

  it('shares a nested Blob source without reading it during construction', async () => {
    const read = vi.fn<BlobByteSource['read']>((start, length) =>
      Promise.resolve(Uint8Array.of(10, 11, 12).slice(start, start + length)));
    const source: BlobByteSource = {
      size: 3,
      snapshotState: { version: 1 },
      read,
    };
    const nested = BlobImpl.create(
      lfEnvironment,
      BlobData.fromSource(source),
      '',
      source.snapshotState,
    );

    const blob = new BlobImpl(lfEnvironment, [nested]);
    expect(read).not.toHaveBeenCalled();
    expect([...await readBlobBytes(blob)]).toEqual([10, 11, 12]);
    expect(read).toHaveBeenCalledOnce();
  });
});

describe('File API §2: slice blob', () => {
  const blob = new BlobImpl(
    lfEnvironment,
    [Uint8Array.from({ length: 10 }, (_, index) => index)],
    { type: 'application/example' },
  );

  for (const [label, start, end, expected] of [
    ['positive positions', 2, 7, [2, 3, 4, 5, 6]],
    ['negative positions', -5, -2, [5, 6, 7]],
    ['start below the range', -20, 3, [0, 1, 2]],
    ['end above the range', 8, 20, [8, 9]],
    ['reversed positions', 7, 2, []],
  ] as const) {
    it(`normalizes ${label}`, async () => {
      expect([...await readBlobBytes(blob.slice(start, end))])
        .toEqual(expected);
    });
  }

  it('uses the full remaining range when end is omitted', async () => {
    expect([...await readBlobBytes(blob.slice(7))]).toEqual([7, 8, 9]);
  });

  it('normalizes the new type independently from the original', () => {
    expect(blob.slice(0, 1, 'Text/PLAIN').type).toBe('text/plain');
    expect(blob.slice(0, 1).type).toBe('');
    expect(blob.type).toBe('application/example');
  });

  it('keeps slices as bounded views over their source', async () => {
    const read = vi.fn<BlobByteSource['read']>((start, length) =>
      Promise.resolve(Uint8Array.from(
        { length },
        (_, index) => start + index,
      )));
    const source: BlobByteSource = {
      size: 20,
      snapshotState: undefined,
      read,
    };
    const original = BlobImpl.create(
      lfEnvironment,
      BlobData.fromSource(source),
      '',
      undefined,
    );

    const slice = original.slice(4, 9);
    expect(read).not.toHaveBeenCalled();
    expect([...await readBlobBytes(slice)]).toEqual([4, 5, 6, 7, 8]);
    expect(read).toHaveBeenCalledWith(4, 5);
  });
});

describe('File API §7: Blob read failures', () => {
  it('preserves a host source failure reason', async () => {
    const failure = new BlobReadFailure('SnapshotState');
    const source: BlobByteSource = {
      size: 1,
      snapshotState: { version: 1 },
      read: () => Promise.reject(failure),
    };
    const blob = BlobImpl.create(
      lfEnvironment,
      BlobData.fromSource(source),
      '',
      source.snapshotState,
    );

    await expect(readBlobBytes(blob)).rejects.toBe(failure);
  });

  it('rejects a host source that violates the exact-range contract', async () => {
    const source: BlobByteSource = {
      size: 2,
      snapshotState: undefined,
      read: () => Promise.resolve(Uint8Array.of(1)),
    };
    const blob = BlobImpl.create(
      lfEnvironment,
      BlobData.fromSource(source),
      '',
      undefined,
    );

    await expect(readBlobBytes(blob)).rejects.toThrow(RangeError);
  });
});

describe('File API §3: Blob serialization data', () => {
  it('copies in-memory byte sources for storage', async () => {
    const original = BlobData.fromBytes(Uint8Array.of(1, 2, 3));
    const stored = original.cloneForStorage();

    expect(stored).not.toBe(original);
    expect(await stored.read()).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('rejects a host source without a storage-safe clone operation', () => {
    const source: BlobByteSource = {
      size: 1,
      snapshotState: { version: 1 },
      read: () => Promise.resolve(Uint8Array.of(1)),
    };

    expect(() => BlobData.fromSource(source).cloneForStorage())
      .toThrow('cannot be serialized for storage');
  });
});

describe('File API §3.1: native line ending conversion', () => {
  it('collapses CRLF into one native ending', () => {
    expect(convertLineEndingsToNative('\r\n', '\n')).toBe('\n');
    expect(convertLineEndingsToNative('\r\n', '\r\n')).toBe('\r\n');
  });
});
