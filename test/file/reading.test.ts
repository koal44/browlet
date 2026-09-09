import { describe, expect, it } from 'vitest';
import {
  BlobData, BlobImpl, BlobReadFailure, packageData,
} from '../../src/file/index';
import type { TaskScheduling } from '../../src/infra/index';
import { getDOMExceptionRequest } from '../../src/web-idl/exceptions/dom-exception-core';

describe('File reading implementation', () => {
  it('reads bytes and text using ordinary promises and explicit scheduling', async () => {
    const blob = new BlobImpl(['hello']);
    const bytes = blob.bytes(scheduling);
    expect(bytes).toBeInstanceOf(Promise);
    await expect(bytes).resolves.toEqual(Uint8Array.of(104, 101, 108, 108, 111));
    await expect(blob.text(scheduling)).resolves.toBe('hello');
    await expect(blob.arrayBuffer(scheduling)).resolves.toEqual(await bytes);
  });

  it('retains a read-failure request for the binding boundary', async () => {
    const data = BlobData.fromSource({
      size: 1,
      snapshotState: null,
      read: () => Promise.reject(new BlobReadFailure('NotFound')),
    });
    const blob = BlobImpl.create(data, '', null);
    const failure = await blob.bytes(scheduling).catch((error: unknown) => error);
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

// The standalone implementation needs only file-task delivery, not a realm.
const scheduling: TaskScheduling = {
  queueTask(steps) {
    const task = setImmediate(steps);
    return { remove: () => { clearImmediate(task); } };
  },
  runInParallel: queueMicrotask,
};
