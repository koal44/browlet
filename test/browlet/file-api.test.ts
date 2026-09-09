import { EOL as nodeLineEnding } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  BlobData, BlobImpl, BlobReadFailure, createFileFromHost, FileImpl,
  FileListImpl, type BlobByteSource,
} from '../../src/file/index';
import {
  browletBindings, getRelevantRealm,
} from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import {
  structuredDeserialize,
} from '../../src/browlet/scripting/structured-data/deserialize';
import {
  structuredSerializeForStorage,
} from '../../src/browlet/scripting/structured-data/serialize';
import {
  observeBrowletPromise, performTestMicrotaskCheckpoint,
} from './test-runtime';

describe('File API Blob projection', () => {
  it('completes a text-only Blob read', async () => {
    const window = createWindow();
    const blob = constructBlob(window, ['hello']);

    await expect(call(blob, 'text')).resolves.toBe('hello');
  });

  it('constructs Blob state with the host native line ending', async () => {
    const window = createWindow();
    const blob = constructBlob(window, ['a\nb'], {
      endings: 'native',
      type: 'Text/PLAIN',
    });
    const expected = `a${nodeLineEnding}b`;

    expect(blob).toBeInstanceOf(requireFunction(window, 'Blob'));
    expect(Reflect.get(blob, 'size')).toBe(expected.length);
    expect(Reflect.get(blob, 'type')).toBe('text/plain');
    await expect(call(blob, 'text')).resolves.toBe(expected);

    const repaired = constructBlob(window, ['A\ud800B']);
    await expect(call(repaired, 'text')).resolves.toBe('A\uFFFDB');
  });

  it('returns realm-owned streams, promises, and byte objects', async () => {
    const window = createWindow();
    const blob = constructBlob(window, ['hello']);
    const stream = call(blob, 'stream') as object;
    const bytesPromise = call(blob, 'bytes') as Promise<unknown>;
    const arrayBufferPromise = call(blob, 'arrayBuffer') as Promise<unknown>;

    expect(stream).toBeInstanceOf(requireFunction(window, 'ReadableStream'));
    expect(bytesPromise).toBeInstanceOf(requireFunction(window, 'Promise'));
    expect(arrayBufferPromise)
      .toBeInstanceOf(requireFunction(window, 'Promise'));

    const bytes = await bytesPromise as object;
    const buffer = await arrayBufferPromise as object;
    expect(bytes).toBeInstanceOf(requireFunction(window, 'Uint8Array'));
    expect(buffer).toBeInstanceOf(requireFunction(window, 'ArrayBuffer'));
    expect(Array.from(bytes as Uint8Array)).toEqual([104, 101, 108, 108, 111]);
  });

  it('keeps the Blob relevant realm when a method is borrowed', async () => {
    const first = createWindow();
    const second = createWindow();
    const blob = constructBlob(first, ['A']);
    const bytesMethod = Reflect.get(
      requireFunction(second, 'Blob').prototype,
      'bytes',
    ) as unknown;
    if (typeof bytesMethod !== 'function') {
      throw new Error('Blob.prototype.bytes is not a function');
    }

    const promise = Reflect.apply(bytesMethod, blob, []) as Promise<object>;
    expect(promise).toBeInstanceOf(requireFunction(first, 'Promise'));
    expect(promise).not.toBeInstanceOf(requireFunction(second, 'Promise'));
    const bytes = await promise;
    expect(bytes).toBeInstanceOf(requireFunction(first, 'Uint8Array'));
    expect(bytes).not.toBeInstanceOf(requireFunction(second, 'Uint8Array'));

    const secondBlobPrototype = requireObject(
      requireFunction(second, 'Blob'),
      'prototype',
    );
    const streamMethod = Reflect.get(secondBlobPrototype, 'stream') as unknown;
    const sliceMethod = Reflect.get(secondBlobPrototype, 'slice') as unknown;
    if (typeof streamMethod !== 'function' || typeof sliceMethod !== 'function') {
      throw new Error('Blob stream or slice method is missing');
    }
    const stream = Reflect.apply(streamMethod, blob, []) as object;
    const slice = Reflect.apply(sliceMethod, blob, []) as object;

    expect(stream).toBeInstanceOf(requireFunction(first, 'ReadableStream'));
    expect(stream).not.toBeInstanceOf(requireFunction(second, 'ReadableStream'));
    expect(slice).toBeInstanceOf(requireFunction(first, 'Blob'));
    expect(slice).not.toBeInstanceOf(requireFunction(second, 'Blob'));
  });

  it('preserves the construction realm for a host-created Blob', () => {
    const first = createWindow();
    const second = createWindow();
    const context = browletBindings.forRealm(getRelevantRealm(first)).context;
    const blob = projectBlob(
      first,
      context.construct(BlobImpl, ['A']),
    );
    const secondBlobPrototype = requireObject(
      requireFunction(second, 'Blob'),
      'prototype',
    );
    const streamMethod = Reflect.get(secondBlobPrototype, 'stream') as unknown;
    const sliceMethod = Reflect.get(secondBlobPrototype, 'slice') as unknown;
    if (typeof streamMethod !== 'function' || typeof sliceMethod !== 'function') {
      throw new Error('Blob stream or slice method is missing');
    }

    const stream = Reflect.apply(streamMethod, blob, []) as object;
    const slice = Reflect.apply(sliceMethod, blob, []) as object;

    expect(stream).toBeInstanceOf(requireFunction(first, 'ReadableStream'));
    expect(stream).not.toBeInstanceOf(requireFunction(second, 'ReadableStream'));
    expect(slice).toBeInstanceOf(requireFunction(first, 'Blob'));
    expect(slice).not.toBeInstanceOf(requireFunction(second, 'Blob'));
  });

  it('streams implementation-defined chunks in order and then closes', async () => {
    const window = createWindow();
    const source = Uint8Array.from(
      { length: 128 * 1024 + 3 },
      (_, index) => index % 251,
    );
    const blob = constructBlob(window, [source]);
    const reader = call(call(blob, 'stream') as object, 'getReader') as object;
    const chunks: Uint8Array[] = [];

    while (true) {
      const result = await call(reader, 'read') as {
        done: boolean;
        value?: Uint8Array;
      };
      if (result.done) break;
      if (!result.value) throw new Error('Blob stream returned no chunk');
      expect(result.value)
        .toBeInstanceOf(requireFunction(window, 'Uint8Array'));
      chunks.push(result.value);
    }

    expect(chunks.map((chunk) => chunk.byteLength))
      .toEqual([64 * 1024, 64 * 1024, 3]);
    expect(concatenate(chunks)).toEqual(source);
  });

  it('decodes through a realm-owned TextDecoderStream', async () => {
    const window = createWindow();
    const blob = constructBlob(window, [Uint8Array.of(
      0x41,
      0xf0,
      0x9f,
      0x98,
      0x80,
    )]);
    const stream = call(blob, 'textStream') as object;
    const reader = call(stream, 'getReader') as object;

    await expect(call(reader, 'read')).resolves.toEqual({
      done: false,
      value: 'A😀',
    });
    await expect(call(reader, 'read')).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('cancels before scheduled Blob reading begins', async () => {
    const window = createWindow();
    const blob = constructBlob(window, ['unused']);
    const stream = call(blob, 'stream') as object;

    const cancellation = observeBrowletPromise(
      window,
      call(stream, 'cancel', ['stop']) as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);
    await expect(cancellation).resolves.toBeUndefined();
    const reader = call(stream, 'getReader') as object;
    const reading = observeBrowletPromise(
      window,
      call(reader, 'read') as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);
    await expect(reading).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('maps backing-source failures into the Blob realm', async () => {
    const window = createWindow();
    const source: BlobByteSource = {
      size: 1,
      snapshotState: { version: 1 },
      read: () => Promise.reject(new BlobReadFailure('SnapshotState')),
    };
    const implementation = BlobImpl.create(
      BlobData.fromSource(source),
      '',
      source.snapshotState,
    );
    const blob = projectBlob(window, implementation);

    await expect(call(blob, 'bytes')).rejects.toMatchObject({
      name: 'NotReadableError',
    });
    await expect(call(blob, 'bytes')).rejects
      .toBeInstanceOf(requireFunction(window, 'DOMException'));
  });

  it('structured-clones Blob data into a distinct wrapper', async () => {
    const window = createWindow();
    const blob = constructBlob(window, ['payload'], { type: 'Text/PLAIN' });
    const clone = window.structuredClone(blob);

    expect(clone).not.toBe(blob);
    expect(clone).toBeInstanceOf(requireFunction(window, 'Blob'));
    expect(Reflect.get(clone, 'size')).toBe(7);
    expect(Reflect.get(clone, 'type')).toBe('text/plain');
    await expect(call(clone, 'text')).resolves.toBe('payload');
  });

  it('storage-clones bytes into a Blob in the target realm', async () => {
    const sourceWindow = createWindow();
    const targetWindow = createWindow();
    const sourceRealm = getRelevantRealm(sourceWindow);
    const targetRealm = getRelevantRealm(targetWindow);
    const agentCluster = {};
    const serialized = structuredSerializeForStorage(
      constructBlob(sourceWindow, ['stored'], { type: 'text/plain' }),
      {
        agentCluster,
        context: browletBindings.forRealm(sourceRealm).context,
        realm: sourceRealm,
      },
    );
    const clone = structuredDeserialize(serialized, {
      agentCluster,
      context: browletBindings.forRealm(targetRealm).context,
      realm: targetRealm,
    }) as object;

    expect(clone).toBeInstanceOf(requireFunction(targetWindow, 'Blob'));
    expect(clone).not.toBeInstanceOf(requireFunction(sourceWindow, 'Blob'));
    expect(Reflect.get(clone, 'type')).toBe('text/plain');
    await expect(call(clone, 'text')).resolves.toBe('stored');
  });
});

describe('File API File and FileList projection', () => {
  it('constructs File as a Blob with converted metadata', async () => {
    const before = Date.now();
    const window = createWindow();
    const file = constructFile(window, ['a\nb'], 'A\ud800B.txt', {
      endings: 'native',
      type: 'Text/PLAIN;CHARSET=UTF-8',
    });
    const after = Date.now();

    expect(file).toBeInstanceOf(requireFunction(window, 'File'));
    expect(file).toBeInstanceOf(requireFunction(window, 'Blob'));
    expect(Reflect.get(file, 'name')).toBe('A\uFFFDB.txt');
    expect(Reflect.get(file, 'type')).toBe('text/plain;charset=utf-8');
    expect(Reflect.get(file, 'lastModified')).toBeGreaterThanOrEqual(before);
    expect(Reflect.get(file, 'lastModified')).toBeLessThanOrEqual(after);
    await expect(call(file, 'text')).resolves.toBe(`a${nodeLineEnding}b`);
  });

  it('enforces required arguments and propagates conversion exceptions', () => {
    const window = createWindow();
    const File_ = requireFunction(window, 'File');
    const TypeError_ = requireFunction(window, 'TypeError') as ErrorConstructor;
    const expected = new Error('expected');

    expect(() => { Reflect.construct(File_, []); }).toThrow(TypeError_);
    expect(() => { Reflect.construct(File_, [[]]); }).toThrow(TypeError_);
    expect(() => {
      Reflect.construct(File_, [[{
        toString() { throw expected; },
      }], 'name']);
    }).toThrow(expected);
  });

  it('honors explicit modification time and inherited Blob options', async () => {
    const window = createWindow();
    const file = constructFile(window, ['value'], 'value.txt', {
      endings: 'transparent',
      lastModified: 42,
      type: 'Application/Example',
    });

    expect(Reflect.get(file, 'lastModified')).toBe(42);
    expect(Reflect.get(file, 'type')).toBe('application/example');
    expect(Reflect.get(file, 'size')).toBe(5);
    await expect(call(file, 'text')).resolves.toBe('value');
  });

  it('projects an owner-mutable FileList without author mutators', () => {
    const window = createWindow();
    const first = constructFile(window, [], 'first', { lastModified: 1 });
    const second = constructFile(window, [], 'second', { lastModified: 2 });
    const { implementation, platformObject } = createFileList(
      window,
      [first],
    );

    expect(platformObject).toBeInstanceOf(requireFunction(window, 'FileList'));
    const TypeError_ = requireFunction(window, 'TypeError') as ErrorConstructor;
    expect(() => {
      Reflect.construct(requireFunction(window, 'FileList'), []);
    })
      .toThrow(TypeError_);
    expect(Reflect.get(platformObject, 'length')).toBe(1);
    expect(Reflect.get(platformObject, '0')).toBe(first);
    expect(call(platformObject, 'item', [0])).toBe(first);
    expect(call(platformObject, 'item', [1])).toBeNull();
    expect(Reflect.get(platformObject, 'add')).toBeUndefined();
    expect(Reflect.get(platformObject, 'replace')).toBeUndefined();

    implementation.add(requireFileImplementation(window, second));
    expect(Reflect.get(platformObject, 'length')).toBe(2);
    expect(Reflect.get(platformObject, '1')).toBe(second);
  });

  it('creates host Files without exposing paths or invalid MIME metadata', async () => {
    const window = createWindow();
    const context = browletBindings.forRealm(getRelevantRealm(window)).context;
    const source: BlobByteSource = {
      size: 3,
      snapshotState: { version: 1 },
      read: (start, length) => Promise.resolve(
        Uint8Array.of(1, 2, 3).slice(start, start + length),
      ),
    };
    const implementation = createFileFromHost(context, source, {
      lastModified: 12,
      name: 'picked.bin',
      type: 'application/octet-stream',
    });
    const file = context.project(FileImpl, implementation);

    expect(Reflect.get(file, 'name')).toBe('picked.bin');
    expect(Reflect.get(file, 'lastModified')).toBe(12);
    expect(Reflect.get(file, 'type')).toBe('application/octet-stream');
    const bytes = await call(file, 'bytes') as Uint8Array;
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(() => createFileFromHost(context, source, {
      name: 'invalid.txt',
      type: 'Text/Plain',
    })).toThrow(TypeError);
    expect(() => createFileFromHost(context, source, {
      name: 'invalid.txt',
      type: 'text/plain;charset=utf-8',
    })).toThrow(TypeError);
    expect(() => createFileFromHost(context, source, {
      name: 'invalid.txt',
      type: 'application/example;name=é',
    })).toThrow(TypeError);

    const before = Date.now();
    const unknown = context.project(FileImpl, createFileFromHost(
      context,
      source,
      { name: 'unknown.bin', type: '' },
    ));
    const modificationTime = Reflect.get(unknown, 'lastModified') as number;
    const after = Date.now();
    expect(modificationTime).toBeGreaterThanOrEqual(before);
    expect(modificationTime).toBeLessThanOrEqual(after);
  });

  it('subserializes FileList entries with shared graph identity', async () => {
    const sourceWindow = createWindow();
    const targetWindow = createWindow();
    const file = constructFile(
      sourceWindow,
      ['payload'],
      'payload.txt',
      { lastModified: 42, type: 'text/plain' },
    );
    const list = createFileList(sourceWindow, [file]).platformObject;
    const sourceRealm = getRelevantRealm(sourceWindow);
    const targetRealm = getRelevantRealm(targetWindow);
    const agentCluster = {};
    const serialized = structuredSerializeForStorage(
      { file, list },
      {
        agentCluster,
        context: browletBindings.forRealm(sourceRealm).context,
        realm: sourceRealm,
      },
    );
    const clone = structuredDeserialize(serialized, {
      agentCluster,
      context: browletBindings.forRealm(targetRealm).context,
      realm: targetRealm,
    }) as Record<string, object>;
    const clonedFile = clone.file!;
    const clonedList = clone.list!;

    expect(clonedFile).toBeInstanceOf(requireFunction(targetWindow, 'File'));
    expect(clonedFile).not.toBeInstanceOf(requireFunction(sourceWindow, 'File'));
    expect(clonedList).toBeInstanceOf(requireFunction(targetWindow, 'FileList'));
    expect(Reflect.get(clonedList, '0')).toBe(clonedFile);
    expect(Reflect.get(clonedFile, 'name')).toBe('payload.txt');
    expect(Reflect.get(clonedFile, 'lastModified')).toBe(42);
    expect(Reflect.get(clonedFile, 'type')).toBe('text/plain');
    await expect(call(clonedFile, 'text')).resolves.toBe('payload');
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as
    Window & typeof globalThis;
}

function constructBlob(
  window: object,
  parts: unknown[] = [],
  options: object = {},
): object {
  return Reflect.construct(
    requireFunction(window, 'Blob'),
    [parts, options],
  ) as object;
}

function constructFile(
  window: object,
  parts: unknown[],
  name: unknown,
  options: object = {},
): object {
  return Reflect.construct(
    requireFunction(window, 'File'),
    [parts, name, options],
  ) as object;
}

function createFileList(
  window: object,
  files: object[],
): { implementation: FileListImpl; platformObject: object; } {
  const context = browletBindings.forRealm(getRelevantRealm(window)).context;
  const implementation = context.construct(
    FileListImpl,
    files.map((file) => requireFileImplementation(window, file)),
  );
  return {
    implementation,
    platformObject: context.project(FileListImpl, implementation),
  };
}

function requireFileImplementation(window: object, file: object): FileImpl {
  const context = browletBindings.forRealm(getRelevantRealm(window)).context;
  const implementation = context.getImplementation(file, FileImpl);
  if (!implementation) throw new Error('Value is not a File');
  return implementation;
}

function projectBlob(window: object, implementation: BlobImpl): object {
  const realm = getRelevantRealm(window);
  return browletBindings.forRealm(realm).context.project(
    BlobImpl,
    implementation,
  );
}

function call(
  object: object,
  name: string,
  argumentsList: unknown[] = [],
): unknown {
  return Reflect.apply(requireFunction(object, name), object, argumentsList);
}

function requireFunction(object: object, name: string): CallableFunction {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  return value;
}

function requireObject(object: object, name: string): object {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${name} is not an object`);
  }
  return value;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
