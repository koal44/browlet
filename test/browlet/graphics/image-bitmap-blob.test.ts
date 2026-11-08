import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../src/web-idl/core/index';
import { BlobData, BlobImpl, BlobReadFailure } from '../../../src/file/index';
import type { ImageBitmapImpl } from '../../../src/graphics/index';
import { BitmapData, type ImageBitmapOptions } from '../../../src/graphics/index';
import { getMIMETypeEssence } from '../../../src/mime/index';
import { parseURL } from '../../../src/url/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { bitmapTaskSource, DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { createManualUserAgent } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML §8.11 internal Blob bitmap creation', () => {
  const prepared = useFixture(createFixture);

  it('reads in parallel, captures options, and waits for a bitmap task to deliver the decoded result', async () => {
    const f = prepared();
    const bytes = Promise.withResolvers<Uint8Array>();
    const started = Promise.withResolvers<void>();
    const read = vi.fn(() => { started.resolve(); return bytes.promise; });
    const data = BlobData.fromSource({ size: pngBytes.length, snapshotState: null, read });
    const source = BlobImpl.create(data, 'text/plain', null, f.env);
    const pixels = decodedPixels(f.env);
    const decode = vi.spyOn(BitmapData, 'decode').mockReturnValue(pixels);
    const settings = options({ resizeWidth: 1, resizeHeight: 1 });
    const crop = { sx: 1, sy: 2, sw: 3, sh: 4 };
    const originalOptions = { ...settings };
    const originalCrop = { ...crop };
    const result = f.mixin.createImageBitmap(source, settings, crop);
    const completion = outcome(result.backing);
    expect(read).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(f.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
    settings.resizeWidth = 0;
    crop.sw = 0;
    await started.promise;
    expect(read).toHaveBeenCalledExactlyOnceWith(0, pngBytes.length);
    expect(decode).not.toHaveBeenCalled();
    bytes.resolve(pngBytes);
    await f.queued;
    expect(decode).toHaveBeenCalledExactlyOnceWith(
      pngBytes, expect.objectContaining({ type: 'image', subtype: 'png' }), originalOptions, originalCrop, f.env,
    );
    const task = [...f.loop.getTaskQueue(bitmapTaskSource)][0]!;
    expect(task.document === f.document).toBe(true);
    let settled = false;
    void completion.then(() => { settled = true; });
    await runInHostTask(() => { f.loop.performMicrotaskCheckpoint(); });
    expect(settled).toBe(false);
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(true); });
    const { value } = await completion;
    expect(value).toBeInstanceOf(f.window.ImageBitmap);
    expect(unwrap<ImageBitmapImpl>(value as object).bitmapData).toBe(pixels);
    expect(result.backing).toBeInstanceOf(f.env.realm.NativePromise);
  });

  it.each([
    ['image/jpeg', pngBytes, 'image/png'],
    ['application/xml', pngBytes, 'application/xml'],
    ['not a mime type', new Uint8Array([1, 0, 255]), undefined],
  ] as const)('passes the existing image-context sniffing result to the decoder: %s', async (type, bytes, expectedType) => {
    const f = prepared();
    const data = BlobData.concatenate([BlobData.fromBytes(bytes.subarray(0, 2)), BlobData.fromBytes(bytes.subarray(2))]);
    const source = BlobImpl.create(data, type, undefined, f.env);
    const decode = vi.spyOn(BitmapData, 'decode').mockReturnValue(decodedPixels(f.env));
    const completion = outcome(f.mixin.createImageBitmap(source, options()).backing);
    await f.queued;
    expect(decode).toHaveBeenCalledOnce();
    const [received, mimeType] = decode.mock.calls[0]!;
    expect(Array.from(received)).toEqual(Array.from(bytes));
    expect(mimeType === undefined ? undefined : getMIMETypeEssence(mimeType)).toBe(expectedType);
    await runInHostTask(() => { f.loop.runTaskTurn(); });
    expect((await completion).value).toBeInstanceOf(f.window.ImageBitmap);
  });

  it.each(['async', 'sync'] as const)('maps a %s backing-read failure to a queued InvalidStateError', async (kind) => {
    const f = prepared();
    const data = BlobData.fromBytes(pngBytes);
    const read = vi.spyOn(data, 'read');
    if (kind === 'async') read.mockRejectedValue(new BlobReadFailure('SnapshotState'));
    else read.mockImplementation(() => { throw new Error('Backing read failed'); });
    const decode = vi.spyOn(BitmapData, 'decode');
    const completion = outcome(f.mixin.createImageBitmap(BlobImpl.create(data, '', undefined, f.env), options()).backing);
    await f.queued;
    expect(decode).not.toHaveBeenCalled();
    await runInHostTask(() => { f.loop.runTaskTurn(); });
    const { error } = await completion;
    expect(error).toBeInstanceOf(f.window.DOMException);
    expect(error).toHaveProperty('name', 'InvalidStateError');
  });

  it.each(['crop', 'resize'] as const)('rejects invalid %s dimensions before reading or scheduling parallel work', async (kind) => {
    const f = prepared();
    const data = BlobData.fromBytes(pngBytes);
    const read = vi.spyOn(data, 'read');
    const parallel = vi.spyOn(f.env, 'runInParallel');
    const result = f.mixin.createImageBitmap(BlobImpl.create(data, '', undefined, f.env), options({ resizeWidth: 0 }),
      kind === 'crop' ? { sx: 0, sy: 0, sw: 0, sh: 1 } : undefined);
    const completion = outcome(result.backing);
    expect(read).not.toHaveBeenCalled();
    expect(parallel).not.toHaveBeenCalled();
    expect(f.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
    await runInHostTask(() => { f.loop.performMicrotaskCheckpoint(); });
    expect((await completion).error).toHaveProperty('name', kind === 'crop' ? 'RangeError' : 'InvalidStateError');
  });

  it('rejects an empty Blob through the bitmap task without requiring a decoder', async () => {
    const f = prepared();
    const completion = outcome(f.mixin.createImageBitmap(new BlobImpl([], {}, f.env), options()).backing);
    await f.queued;
    await runInHostTask(() => { f.loop.runTaskTurn(); });
    expect((await completion).error).toMatchObject({ name: 'InvalidStateError', message: 'An empty Blob is not an image' });
  });

  it('preserves the named missing decoder instead of claiming that a signature was decoded', async () => {
    const f = prepared();
    const source = BlobImpl.create(BlobData.fromBytes(pngBytes), 'image/png', undefined, f.env);
    const completion = outcome(f.mixin.createImageBitmap(source, options()).backing);
    await f.queued;
    await runInHostTask(() => { f.loop.runTaskTurn(); });
    expect((await completion).error).toBeInstanceOf(InternalError);
    expect((await completion).error).toHaveProperty('message', expect.stringContaining('Image decoding'));
  });

  it('delivers decoder InvalidStateError in the receiving realm', async () => {
    const f = prepared();
    vi.spyOn(BitmapData, 'decode').mockImplementation(() => {
      throw new DOMExceptionImpl('No natural image dimensions', DOMExceptionNames.invalidState);
    });
    const completion = outcome(f.mixin.createImageBitmap(new BlobImpl(['image bytes'], {}, f.env), options()).backing);
    await f.queued;
    await runInHostTask(() => { f.loop.runTaskTurn(); });
    const { error } = await completion;
    expect(error).toBeInstanceOf(f.window.DOMException);
    expect(error).toHaveProperty('message', 'No natural image dimensions');
  });

  it('keeps delivery gated by the receiving Document after the read finishes', async () => {
    const f = prepared();
    vi.spyOn(BitmapData, 'decode').mockReturnValue(decodedPixels(f.env));
    const completion = outcome(f.mixin.createImageBitmap(new BlobImpl(['image bytes'], {}, f.env), options()).backing);
    const activeEntry = f.traversable.activeSessionHistoryEntry;
    f.traversable.activeSessionHistoryEntry = f.env.createSessionHistoryEntry(activeEntry.url, new DocumentState());
    await f.queued;
    expect([...f.loop.getTaskQueue(bitmapTaskSource)][0]!.isRunnable).toBe(false);
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(false); });
    f.traversable.activeSessionHistoryEntry = activeEntry;
    await runInHostTask(() => { f.loop.runTaskTurn(); });
    expect((await completion).value).toBeInstanceOf(f.window.ImageBitmap);
  });
});

describe('Blob bitmap source ownership', () => {
  const prepared = useFixture(() => ({ source: createFixture(), target: createFixture() }));

  it('reads a foreign Blob without waiting on its inactive source Document', async () => {
    const { source, target } = prepared();
    const blob = unwrap<BlobImpl>(new source.window.Blob([pngBytes]));
    const stream = vi.spyOn(blob, 'stream');
    const activeEntry = source.traversable.activeSessionHistoryEntry;
    source.traversable.activeSessionHistoryEntry = source.env.createSessionHistoryEntry(activeEntry.url, new DocumentState());
    const pixels = decodedPixels(target.env);
    vi.spyOn(BitmapData, 'decode').mockReturnValue(pixels);
    const result = target.mixin.createImageBitmap(blob, options());
    const completion = outcome(result.backing);
    await target.queued;
    expect(stream).not.toHaveBeenCalled();
    expect(source.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
    await runInHostTask(() => { target.loop.runTaskTurn(); });
    const { value } = await completion;
    expect(value).toBeInstanceOf(target.window.ImageBitmap);
    expect(value).not.toBeInstanceOf(source.window.ImageBitmap);
    expect(result.backing).toBeInstanceOf(target.env.realm.NativePromise);
    expect(pixels.bytes.buffer).toBeInstanceOf(target.env.realm.ArrayBuffer);
  });
});

describe.each([false, true])('Blob bitmap worker delivery, shared: %s', (shared) => {
  const prepared = useFixture((fixture) => {
    const outside = createFixture();
    const outsideEnv = outside.env;
    const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected a worker agent');
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://bitmap.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'bitmap', credentials: 'same-origin', extendedLifetime: shared,
    });
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { outside, env, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it('returns the decoded bitmap in the worker realm', async () => {
    const { outside, env, scope } = prepared();
    const decode = vi.spyOn(BitmapData, 'decode').mockReturnValue(decodedPixels(env));
    const result = env.getWindowOrWorkerGlobalScopeMixin().createImageBitmap(new BlobImpl([pngBytes], {}, outside.env), options());
    const { value } = await outcome(result.backing);
    expect(value).toBeInstanceOf(scope.ImageBitmap);
    expect(unwrap<ImageBitmapImpl>(value as object).env).toBe(env);
    expect(decode.mock.calls[0]![4]).toBe(env);
    expect(outside.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
  });
});

function createFixture() {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const env = traversable.activeWindow!.env;
  const queued = Promise.withResolvers<void>();
  const queue = env.queueTask.bind(env);
  vi.spyOn(env, 'queueTask').mockImplementation((source, task) => {
    const handle = queue(source, task);
    if (source === 'bitmap') queued.resolve();
    return handle;
  });
  return {
    traversable, env, window: env.realm.windowProxy.platform, document: traversable.activeDocument!,
    loop: env.responsibleEventLoop, mixin: env.getWindowOrWorkerGlobalScopeMixin(), queued: queued.promise,
  };
}

function options(values: Partial<ImageBitmapOptions> = {}): ImageBitmapOptions {
  return { imageOrientation: 'from-image', premultiplyAlpha: 'default', colorSpaceConversion: 'default', resizeQuality: 'low', ...values };
}

/** The decoder is the only missing owner replaced by these integration tests. */
function decodedPixels(env: BrowletEnvironment): BitmapData {
  const bytes = new Uint8Array(new env.realm.ArrayBuffer(4));
  bytes.set([10, 20, 30, 255]);
  return new BitmapData({ bytes, width: 1, height: 1, pixelFormat: 'rgba-unorm8', colorSpace: 'srgb', premultipliedAlpha: false, originClean: true });
}

/** Attach before advancing a manual loop and retain either realm-owned result. */
function outcome(promise: Promise<unknown>): Promise<{ value?: unknown; error?: unknown; }> {
  return new Promise((resolve) => {
    void promise.then((value) => { resolve({ value }); }, (error: unknown) => { resolve({ error }); });
  });
}

// A signature plus binary payload tests sniffing/transport, not successful PNG decoding.
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 0]);
