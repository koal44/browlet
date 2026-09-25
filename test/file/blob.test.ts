import { describe, expect, it, vi } from 'vitest';

import {
  BlobData, BlobImpl, BlobReadFailure, convertLineEndingsToNative,
  type BlobByteSource,
} from '../../src/file';
import { createEnvironment } from '../js-engine/execution-fixture';
import { InternalError } from '../../src/infra/internal-error';

const crlf = '\r\n';

const env = createEnvironment();

describe('File API §3: Blob', () => {
  it('constructs the empty Blob', async () => {
    const blob = new BlobImpl([], {}, env);

    expect(blob.size).toBe(0);
    expect(blob.type).toBe('');
    expect(await blob.data.read()).toEqual(new Uint8Array());
  });

  it('copies only the represented BufferSource bytes', async () => {
    const source = Uint8Array.of(0, 1, 2, 3, 4);
    const blob = new BlobImpl([source.subarray(1, 4)], {}, env);
    source.fill(9);

    expect([...await blob.data.read()]).toEqual([1, 2, 3]);
  });

  it('normalizes native line endings using the supplied convention', async () => {
    const parts = ['a\rb\r\nc\nd'];
    const options = { endings: 'native' as const };

    expect(new TextDecoder().decode(
      await new BlobImpl(parts, options, env).data.read(),
    )).toBe('a\nb\nc\nd');
    expect(new TextDecoder().decode(
      await new BlobImpl(parts, options, { exec: { ...env.exec, nativeLineEnding: crlf } }).data.read(),
    )).toBe('a\r\nb\r\nc\r\nd');
  });

  it('leaves transparent line endings unchanged', async () => {
    const blob = new BlobImpl(
      ['a\rb\nc\r\nd'], {}, { exec: { ...env.exec, nativeLineEnding: crlf } },
    );

    expect(new TextDecoder().decode(await blob.data.read()))
      .toBe('a\rb\nc\r\nd');
  });

  it('normalizes ASCII Blob types and rejects non-ASCII values', () => {
    expect(new BlobImpl([], { type: 'Text/PLAIN;X=Y' }, env).type)
      .toBe('text/plain;x=y');
    expect(new BlobImpl([], { type: 'text/\u007fplain' }, env).type)
      .toBe('');
    expect(new BlobImpl([], { type: 'text/\u001fplain' }, env).type)
      .toBe('');
    expect(new BlobImpl([], { type: 'text/pl\u00e4in' }, env).type)
      .toBe('');
  });

  it('concatenates mixed parts and ignores nested Blob types', async () => {
    const nested = new BlobImpl(['bc'], { type: 'text/plain' }, env);
    const blob = new BlobImpl(
      ['a', nested, Uint8Array.of(100)], { type: 'Application/Example' }, env,
    );

    expect(blob.size).toBe(4);
    expect(blob.type).toBe('application/example');
    expect(new TextDecoder().decode(await blob.data.read())).toBe('abcd');
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
      BlobData.fromSource(source), '', source.snapshotState, env,
    );

    const blob = new BlobImpl([nested], {}, env);
    expect(read).not.toHaveBeenCalled();
    expect([...await blob.data.read()]).toEqual([10, 11, 12]);
    expect(read).toHaveBeenCalledOnce();
  });
});

describe('File API §2: slice blob', () => {
  const blob = new BlobImpl(
    [Uint8Array.from({ length: 10 }, (_, index) => index)],
    { type: 'application/example' }, env,
  );

  for (const [label, start, end, expected] of [
    ['positive positions', 2, 7, [2, 3, 4, 5, 6]],
    ['negative positions', -5, -2, [5, 6, 7]],
    ['start below the range', -20, 3, [0, 1, 2]],
    ['end above the range', 8, 20, [8, 9]],
    ['reversed positions', 7, 2, []],
  ] as const) {
    it(`normalizes ${label}`, async () => {
      expect([...await blob.slice(start, end).data.read()])
        .toEqual(expected);
    });
  }

  it('uses the full remaining range when end is omitted', async () => {
    expect([...await blob.slice(7).data.read()]).toEqual([7, 8, 9]);
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
    const original = BlobImpl.create(BlobData.fromSource(source), '', undefined, env);

    const slice = original.slice(4, 9);
    expect(read).not.toHaveBeenCalled();
    expect([...await slice.data.read()]).toEqual([4, 5, 6, 7, 8]);
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
    const blob = BlobImpl.create(BlobData.fromSource(source), '', source.snapshotState, env);

    await expect(blob.data.read()).rejects.toBe(failure);
  });

  it('rejects a host source that violates the exact-range contract', async () => {
    const source: BlobByteSource = {
      size: 2,
      snapshotState: undefined,
      read: () => Promise.resolve(Uint8Array.of(1)),
    };
    const blob = BlobImpl.create(BlobData.fromSource(source), '', undefined, env);

    await expect(blob.data.read()).rejects.toThrow(InternalError);
  });
});

describe('File API §3: Blob serialization data', () => {
  it('copies host Buffer bytes instead of retaining Buffer.slice views', async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 4]);
    const data = BlobData.fromBytes(bytes.subarray(1, 4));
    bytes.fill(9);
    expect(await data.read()).toEqual(Uint8Array.of(1, 2, 3));
  });

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
    expect(convertLineEndingsToNative('\r\n', env)).toBe('\n');
    expect(convertLineEndingsToNative('\r\n', {
      exec: {
        ...env.exec, nativeLineEnding: crlf,
      },
    })).toBe(crlf);
  });
});
