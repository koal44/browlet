import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BlobData, BlobImpl, BlobReadFailure, type BlobByteSource } from '../../../src/file/index';
import type { Blob } from '../../../src/browlet/platform';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { fileTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { observeBrowletPromise } from '../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

// HTML §8.1.7.5: background I/O supplies neutral data; the owning global's
// task makes completion observable. Drive HTML turns explicitly and control
// the Blob's backing byte source.
describe('parallel work returning to a global task', () => {
  it.each(['success', 'failure'] as const)('holds Blob read %s until its Document becomes active again', async (outcome) => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const document = traversable.activeDocument!;
    const window = traversable.activeBrowsingContext!.windowProxy.platform;
    const { realm, responsibleEventLoop: loop } = document.env;
    const activeEntry = traversable.activeSessionHistoryEntry;
    const requested = Promise.withResolvers<void>();
    const bytes = Promise.withResolvers<Uint8Array>();
    const readTasks: (Task | null)[] = [];
    const source: BlobByteSource = {
      size: 1,
      snapshotState: null,
      read() {
        readTasks.push(loop.currentlyRunningTask);
        requested.resolve();
        return bytes.promise;
      },
    };
    const blob = getBindingContext(realm).project(BlobImpl,
      BlobImpl.create(BlobData.fromSource(source), '', source.snapshotState, document.env),
    ) as Blob;
    const promise = blob.arrayBuffer();
    const fulfilled = vi.fn();
    const rejected = vi.fn();
    const observed = observeBrowletPromise(window, promise).then(fulfilled, rejected);
    expect(promise).toBeInstanceOf(realm.NativePromise);

    await requested.promise;
    expect(readTasks).toEqual([null]);
    traversable.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(activeEntry.url, new DocumentState());
    expect(document.isFullyActive()).toBe(false);
    if (outcome === 'success') bytes.resolve(Uint8Array.of(5));
    else bytes.reject(new BlobReadFailure('SnapshotState'));
    // Let the backing read finish and queue delivery, without advancing HTML.
    await nextTurn();
    const tasks = loop.getTaskQueue(fileTaskSource);
    expect(tasks.size).toBeGreaterThan(0);
    for (const task of tasks) expect(task.document).toBe(document);
    await runInHostTask(() => {
      expect(loop.runTaskTurn()).toBe(false);
      loop.performMicrotaskCheckpoint();
    });
    expect(fulfilled).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();

    traversable.activeSessionHistoryEntry = activeEntry;
    await runInHostTask(() => {
      while (loop.runTaskTurn()) { /* Drain the restored Document's delivery tasks. */ }
    });
    await observed;
    expect(tasks.size).toBe(0);
    if (outcome === 'success') {
      expect(rejected).not.toHaveBeenCalled();
      expect(fulfilled).toHaveBeenCalledOnce();
      const buffer = fulfilled.mock.calls[0]![0] as ArrayBuffer;
      expect(buffer).toBeInstanceOf(realm.ArrayBuffer);
      expect([...new Uint8Array(buffer)]).toEqual([5]);
    } else {
      expect(fulfilled).not.toHaveBeenCalled();
      expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'NotReadableError' }));
      expect(rejected.mock.calls[0]![0]).toBeInstanceOf(window.DOMException);
    }
  });
});
