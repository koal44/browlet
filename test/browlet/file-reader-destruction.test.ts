import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { BlobData, BlobImpl, BlobReadFailure } from '../../src/file/index';
import { FileReaderImpl } from '../../src/browlet/integration/file/file-reader';
import { fileTaskSource } from '../../src/browlet/scripting/tasks';
import { createFetchWindow } from './fetch-fixture';

describe('FileReader Document destruction', () => {
  it.each([
    ['same', 'success'], ['same', 'failure'], ['other', 'success'], ['other', 'failure'],
  ] as const)('stops a pending read from the %s global and ignores late %s', async (sourceOwner, outcome) => {
    const owner = createFetchWindow();
    const other = createFetchWindow(owner.context.getEnvironment().userAgent);
    const env = owner.context.getEnvironment();
    const sourceEnv = sourceOwner === 'same' ? env : other.context.getEnvironment();
    const bytes = Promise.withResolvers<Uint8Array>();
    const readSource = vi.fn(() => bytes.promise);
    const blob = BlobImpl.create(BlobData.fromSource({ size: 1, snapshotState: null, read: readSource }), '', null, sourceEnv);
    const reader = new FileReaderImpl(env);
    const events = recordEvents(reader);
    reader.readAsArrayBuffer(blob);
    await vi.waitFor(() => expect(readSource).toHaveBeenCalledOnce());
    const tasks = env.responsibleEventLoop.getTaskQueue(fileTaskSource);
    expect(tasks.size).toBe(0);
    expect(reader.readyState).toBe(1);

    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    expect(reader.readyState).toBe(2);
    expect(reader.result).toBeNull();
    expect(reader.error).toBeNull();
    expect(events).toEqual([]);
    if (outcome === 'success') bytes.resolve(Uint8Array.of(9));
    else bytes.reject(new BlobReadFailure('SnapshotState'));
    await nextTurn();
    while (owner.runTask() || other.runTask()) { /* Drain any internal cleanup on its original loop. */ }
    expect(events).toEqual([]);
    expect(reader.error).toBeNull();
    expect(tasks.size).toBe(0);
    expect(readSource).toHaveBeenCalledOnce();
    expect(other.document!.isFullyActive()).toBe(true);
  });

  it.each(['loadstart', 'progress'] as const)('removes remaining notifications when %s destroys the Document', async (type) => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const reader = new FileReaderImpl(env);
    const events = recordEvents(reader);
    reader[`on${type}`] = () => {
      events.push(type);
      owner.document!.destroy();
    };
    reader.readAsText(new BlobImpl(['pending'], {}, env));
    await vi.waitFor(() => {
      while (owner.runTask()) { /* Deliver the callback that destroys the Document. */ }
      expect(owner.document!.isDestroyed).toBe(true);
    });
    expect(reader.readyState).toBe(2);
    expect(reader.result).toBeNull();
    expect(reader.error).toBeNull();
    const expectedEvents = type === 'loadstart' ? ['loadstart'] : ['loadstart', 'progress'];
    expect(events).toEqual(expectedEvents);
    await nextTurn();
    while (owner.runTask()) { /* No old read may publish a later event. */ }
    expect(events).toEqual(expectedEvents);
  });

  it('preserves a completed result and leaves another global reading', async () => {
    const owner = createFetchWindow();
    const other = createFetchWindow(owner.context.getEnvironment().userAgent);
    const env = owner.context.getEnvironment();
    const reader = new FileReaderImpl(env);
    const events = recordEvents(reader);
    reader.readAsText(new BlobImpl(['complete'], {}, env));
    await vi.waitFor(() => {
      while (owner.runTask()) { /* Complete the first read before destroying its Document. */ }
      expect(reader.readyState).toBe(2);
    });
    const completedEvents = [...events];
    const otherEnv = other.context.getEnvironment();
    const otherReader = new FileReaderImpl(otherEnv);
    otherReader.readAsText(new BlobImpl(['independent'], {}, otherEnv));
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    await vi.waitFor(() => {
      while (other.runTask()) { /* The other reader has its own lifetime. */ }
      expect(otherReader.readyState).toBe(2);
    });
    expect(reader.result).toBe('complete');
    expect(reader.error).toBeNull();
    expect(events).toEqual(completedEvents);
    expect(otherReader.result).toBe('independent');
  });

  it('retains the result but suppresses loadend when load destroys the Document', async () => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const reader = new FileReaderImpl(env);
    const events = recordEvents(reader);
    reader.onload = () => {
      events.push('load');
      owner.document!.destroy();
    };
    reader.readAsText(new BlobImpl(['complete'], {}, env));
    await vi.waitFor(() => {
      while (owner.runTask()) { /* Complete the read and destroy its Document from load. */ }
      expect(owner.document!.isDestroyed).toBe(true);
    });
    expect(reader.result).toBe('complete');
    expect(reader.error).toBeNull();
    expect(reader.readyState).toBe(2);
    expect(events).toEqual(['loadstart', 'progress', 'load']);
  });

  it('rejects a projected read after destruction before starting its Blob source', async () => {
    const owner = createFetchWindow();
    const env = owner.context.getEnvironment();
    const reader = new FileReaderImpl(env);
    const events = recordEvents(reader);
    const platformReader = owner.context.project(FileReaderImpl, reader) as FileReader;
    const readSource = vi.fn(() => Promise.resolve(Uint8Array.of(1)));
    const blob = BlobImpl.create(BlobData.fromSource({ size: 1, snapshotState: null, read: readSource }), '', null, env);
    const platformBlob = owner.context.project(BlobImpl, blob) as Blob;
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    let error: unknown;
    try { platformReader.readAsArrayBuffer(platformBlob); }
    catch (failure) { error = failure; }
    expect(error).toBeInstanceOf(env.DOMException);
    expect(error).toHaveProperty('name', 'AbortError');
    await nextTurn();
    expect(readSource).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

function recordEvents(reader: FileReaderImpl): string[] {
  const events: string[] = [];
  for (const attribute of ['onloadstart', 'onprogress', 'onload', 'onerror', 'onabort', 'onloadend'] as const) {
    reader[attribute] = (event) => { events.push(event.type); };
  }
  return events;
}
