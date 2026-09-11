import { describe, expect, it } from 'vitest';
import {
  BlobData, BlobImpl, BlobReadFailure, packageData,
} from '../../src/file/index';
import type { TaskScheduling } from '../../src/infra/index';
import { getDOMExceptionRequest } from '../../src/web-idl/exceptions/dom-exception-core';
import type { PromiseValue } from '../../src/js-engine/index';
import { createRuntime } from '../js-engine/runtime-fixture';

describe('File reading implementation', () => {
  it.each([
    { name: 'empty input', text: '' },
    { name: 'a UTF-8 character crossing the chunk boundary', text: `${'a'.repeat(65535)}😀` },
  ])('reads bytes and text for $name', async ({ text }) => {
    const runtime = { ...createRuntime(), fileReading: scheduling };
    const blob = new BlobImpl([text], {}, runtime);
    const [decoded, bytes, bufferBytes] = await Promise.all([
      observe(blob.text()),
      observe(blob.bytes()),
      observe(blob.arrayBuffer()),
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
    const runtime = { ...createRuntime(), fileReading: scheduling };
    const blob = BlobImpl.create(data, '', null, runtime);
    const result = blob[method]();
    const failure = await observe<unknown>(result).catch((error: unknown) => error);
    expect(getDOMExceptionRequest(failure)?.name).toBe('NotFoundError');
  });

  it('packages bytes without a binding context and preserves the source', () => {
    const runtime = createRuntime();
    const bytes = Uint8Array.of(65, 66, 67);
    const result = packageData(bytes, 'ArrayBuffer', '', undefined, runtime) as ArrayBuffer;
    expect(new Uint8Array(result)).toEqual(bytes);
    new Uint8Array(result)[0] = 90;
    expect(bytes[0]).toBe(65);
    expect(packageData(bytes, 'Text', '', undefined, runtime)).toBe('ABC');
    expect(packageData(bytes, 'DataURL', '', undefined, runtime)).toBe('data:application/octet-stream;base64,QUJD');
  });
});

function observe<T>(result: PromiseValue<T>): Promise<T> {
  const observed = Promise.withResolvers<T>();
  result.observe(observed.resolve, observed.reject);
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
