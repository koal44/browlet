import { describe, expect, it } from 'vitest';
import {
  BlobData, BlobImpl, BlobReadFailure, packageData,
} from '../../src/file/index';
import type { TaskScheduling } from '../../src/infra/index';
import type { InternalPromise } from '../../src/infra/promises';
import { createEnvironment } from '../js-engine/execution-fixture';
import { expectBytesEqual } from '../support/bytes';

describe('File reading implementation', () => {
  it.each([
    { name: 'empty input', text: '' },
    { name: 'a UTF-8 character crossing the chunk boundary', text: `${'a'.repeat(65535)}😀` },
  ])('reads bytes and text for $name', async ({ text }) => {
    const env = { ...createEnvironment(), runInParallel: queueMicrotask, fileReading: scheduling };
    const blob = new BlobImpl([text], {}, env);
    const [decoded, bytes, bufferBytes] = await Promise.all([
      observe(blob.text()),
      observe(blob.bytes()),
      observe(blob.arrayBuffer()),
    ]);
    expect(decoded).toBe(text);
    expectBytesEqual(bytes, new TextEncoder().encode(text));
    expectBytesEqual(new Uint8Array(bufferBytes), bytes);
  });

  it.each(['text', 'bytes', 'arrayBuffer'] as const)('transforms the completed read in a Promise reaction for %s', async (method) => {
    const env = createEnvironment();
    const tasks: (() => void)[] = [];
    env.exec.runInParallel = (steps) => { steps(); };
    env.exec.fileReading = {
      queueTask(steps) {
        tasks.push(steps);
        return { remove() {} };
      },
    };
    const blob = new BlobImpl([], {}, env);
    const result = blob[method]();
    const trace: string[] = [];
    const completed = Promise.withResolvers<void>();
    result.observe(() => {
      trace.push('result');
      completed.resolve();
    }, completed.reject);
    expect(tasks).toHaveLength(1);
    tasks[0]!();
    env.exec.queueMicrotask(() => { trace.push('after reading'); });
    await completed.promise;
    expect(trace).toEqual(['after reading', 'result']);
  });

  it.each(['text', 'bytes', 'arrayBuffer'] as const)('realizes a %s read failure when rejecting the declared result', async (method) => {
    const data = BlobData.fromSource({
      size: 1,
      snapshotState: null,
      read: () => Promise.reject(new BlobReadFailure('NotFound')),
    });
    const env = { ...createEnvironment(), runInParallel: queueMicrotask, fileReading: scheduling };
    const blob = BlobImpl.create(data, '', null, env);
    const result = blob[method]();
    const failure = await observe<unknown>(result).catch((error: unknown) => error);
    expect(failure).toHaveProperty('name', 'NotFoundError');
    expect(Object.prototype.toString.call(failure)).toBe('[object DOMException]');
  });

  it('packages bytes without a binding context and preserves the source', () => {
    const env = createEnvironment();
    const bytes = Uint8Array.of(65, 66, 67);
    const result = packageData(bytes, 'ArrayBuffer', '', undefined, env) as ArrayBuffer;
    expect(new Uint8Array(result)).toEqual(bytes);
    new Uint8Array(result)[0] = 90;
    expect(bytes[0]).toBe(65);
    expect(packageData(bytes, 'Text', '', undefined, env)).toBe('ABC');
    expect(packageData(bytes, 'DataURL', '', undefined, env)).toBe('data:application/octet-stream;base64,QUJD');
  });
});

function observe<T>(result: InternalPromise<T>): Promise<T> {
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
};
