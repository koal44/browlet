import { describe, expect, it } from 'vitest';
import {
  BlobData, BlobImpl, BlobReadFailure, packageData,
} from '../../src/file/index';
import type { TaskScheduling } from '../../src/infra/index';
import { getDOMExceptionRequest } from '../../src/web-idl/exceptions/dom-exception-core';
import {
  createPromiseReactions, type InternalPromise, type PromiseReactions,
} from '../../src/js-engine/index';
import { TestRealm } from '../web-idl/test-realm';

describe('File reading implementation', () => {
  it.each([
    { name: 'empty input', text: '' },
    { name: 'a UTF-8 character crossing the chunk boundary', text: `${'a'.repeat(65535)}😀` },
  ])('reads bytes and text for $name', async ({ text }) => {
    const blob = new BlobImpl([text]);
    const reactions = createPromiseReactions(new TestRealm());
    const [decoded, bytes, bufferBytes] = await Promise.all([
      observe(blob.text(scheduling, reactions), reactions),
      observe(blob.bytes(scheduling, reactions), reactions),
      observe(blob.arrayBuffer(scheduling, reactions), reactions),
    ]);
    expect(decoded).toBe(text);
    expect(bytes).toEqual(new TextEncoder().encode(text));
    expect(bufferBytes).toEqual(bytes);
  });

  it.each(['text', 'bytes', 'arrayBuffer'] as const)('retains a %s read-failure request for the binding boundary', async (method) => {
    const data = BlobData.fromSource({
      size: 1,
      snapshotState: null,
      read: () => Promise.reject(new BlobReadFailure('NotFound')),
    });
    const blob = BlobImpl.create(data, '', null);
    const reactions = createPromiseReactions(new TestRealm());
    const result = blob[method](scheduling, reactions);
    const failure = await observe<unknown>(result, reactions).catch((error: unknown) => error);
    expect(getDOMExceptionRequest(failure)?.name).toBe('NotFoundError');
  });

  it('packages bytes without a binding context and preserves the source', () => {
    const bytes = Uint8Array.of(65, 66, 67);
    const result = packageData(bytes, 'ArrayBuffer', '') as ArrayBuffer;
    expect(new Uint8Array(result)).toEqual(bytes);
    new Uint8Array(result)[0] = 90;
    expect(bytes[0]).toBe(65);
    expect(packageData(bytes, 'Text', '')).toBe('ABC');
    expect(packageData(bytes, 'DataURL', '')).toBe('data:application/octet-stream;base64,QUJD');
  });
});

function observe<T>(result: InternalPromise<T>, reactions: PromiseReactions): Promise<T> {
  const observed = Promise.withResolvers<T>();
  result.observe(observed.resolve, observed.reject, reactions);
  return observed.promise;
}

// File-task delivery stays separate from explicit result observation.
const scheduling: TaskScheduling = {
  queueTask(steps) {
    const task = setImmediate(steps);
    return { remove: () => { clearImmediate(task); } };
  },
  runInParallel: queueMicrotask,
};
