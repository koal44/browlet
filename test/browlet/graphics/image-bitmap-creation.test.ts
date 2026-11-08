import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImageDataImpl } from '../../../src/graphics/index';
import { BitmapData, ImageBitmapImpl, type ImageBitmapOptions } from '../../../src/graphics/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { bitmapTaskSource, DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML §8.11 internal ImageBitmap creation', () => {
  const prepared = useFixture(createFixture);

  it('snapshots ImageData during the call and fulfills in the associated bitmap task', async () => {
    const f = prepared();
    const source = new f.window.ImageData(new f.env.realm.Uint8ClampedArray([10, 20, 30, 255]), 1);
    const result = f.mixin.createImageBitmap(unwrap<ImageDataImpl>(source), options());
    const delivery = observeBeforeTask(result.backing);
    expect(result.backing).toBeInstanceOf(f.env.realm.NativePromise);
    const queue = f.loop.getTaskQueue(bitmapTaskSource);
    expect(queue.size).toBe(1);
    const task = [...queue][0]!;
    expect(task.document === f.document).toBe(true);
    expect(task.source).toBe(bitmapTaskSource);
    let fulfilled = false;
    result.observe(() => { fulfilled = true; }, (error) => { throw error; });
    source.data.fill(0);
    f.window.structuredClone(source.data.buffer, { transfer: [source.data.buffer] });
    await runInHostTask(() => { f.loop.performMicrotaskCheckpoint(); });
    expect(fulfilled).toBe(false);
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(true); });
    const image = await delivery;
    expect(image).toBeInstanceOf(f.window.ImageBitmap);
    expect(fulfilled).toBe(true);
    const implementation = unwrap<ImageBitmapImpl>(image as object);
    expect(implementation.env).toBe(f.env);
    expect(Array.from(implementation.bitmapData!.bytes)).toEqual([10, 20, 30, 255]);
    expect(implementation.bitmapData!.bytes.buffer).toBeInstanceOf(f.env.realm.ArrayBuffer);
    expect(queue.size).toBe(0);
  });

  it.each([false, true])('copies ImageBitmap before the source closes, tainted: %s', async (tainted) => {
    const f = prepared();
    const source = ImageBitmapImpl.create(new BitmapData({
      bytes: new Uint8Array([10, 20, 30, 255]), width: 1, height: 1,
      pixelFormat: 'rgba-unorm8', colorSpace: 'display-p3', premultipliedAlpha: true, originClean: !tainted,
    }), f.env);
    const pixels = source.bitmapData!;
    const result = f.mixin.createImageBitmap(source, options());
    const delivery = observeBeforeTask(result.backing);
    source.close();
    pixels.bytes.fill(0);
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(true); });
    const image = await delivery;
    const data = unwrap<ImageBitmapImpl>(image as object).bitmapData!;
    expect(data).toMatchObject({ width: 1, height: 1, colorSpace: 'display-p3', premultipliedAlpha: true, originClean: !tainted });
    expect(Array.from(data.bytes)).toEqual([10, 20, 30, 255]);
    expect(data.bytes.buffer).not.toBe(pixels.bytes.buffer);
    if (tainted) expect(() => f.window.structuredClone(image)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
  });

  it('applies crop, resize, flip and alpha conversion before returning', async () => {
    const f = prepared();
    const source = new f.window.ImageData(new f.env.realm.Uint8ClampedArray([
      10, 0, 0, 255, 60, 0, 0, 128, 120, 0, 0, 255, 240, 0, 0, 255,
    ]), 2);
    const input = Array.from(source.data);
    const settings = options({ resizeWidth: 2, resizeHeight: 2, imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' });
    const crop = { sx: 1, sy: 0, sw: 1, sh: 2 };
    const result = f.mixin.createImageBitmap(unwrap<ImageDataImpl>(source), settings, crop);
    const delivery = observeBeforeTask(result.backing);
    settings.resizeWidth = 1;
    crop.sw = 0;
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(true); });
    const data = unwrap<ImageBitmapImpl>(await delivery as object).bitmapData!;
    expect(data).toMatchObject({ width: 2, height: 2, premultipliedAlpha: true });
    expect(Array.from(data.bytes)).toEqual([240, 0, 0, 255, 240, 0, 0, 255, 30, 0, 0, 128, 30, 0, 0, 128]);
    expect(Array.from(source.data)).toEqual(input);
  });

  it('keeps concurrent calls independent and snapshots each call separately', async () => {
    const f = prepared();
    const source = new f.window.ImageData(new f.env.realm.Uint8ClampedArray([10, 20, 30, 255]), 1);
    const first = f.mixin.createImageBitmap(unwrap<ImageDataImpl>(source), options());
    const firstDelivery = observeBeforeTask(first.backing);
    source.data[0] = 100;
    const second = f.mixin.createImageBitmap(unwrap<ImageDataImpl>(source), options());
    const secondDelivery = observeBeforeTask(second.backing);
    expect(first.backing).not.toBe(second.backing);
    expect(f.loop.getTaskQueue(bitmapTaskSource).size).toBe(2);
    await runInHostTask(() => { f.loop.runTaskTurn(); f.loop.runTaskTurn(); });
    const firstImage = unwrap<ImageBitmapImpl>(await firstDelivery as object);
    const secondImage = unwrap<ImageBitmapImpl>(await secondDelivery as object);
    expect(firstImage).not.toBe(secondImage);
    expect(firstImage.bitmapData!.bytes[0]).toBe(10);
    expect(secondImage.bitmapData!.bytes[0]).toBe(100);
    expect(firstImage.bitmapData!.bytes.buffer).not.toBe(secondImage.bitmapData!.bytes.buffer);
  });

  it.each(['crop', 'resize', 'detached data', 'closed bitmap'] as const)('rejects %s without throwing or queuing a bitmap task', async (invalid) => {
    const f = prepared();
    const source = new f.window.ImageData(1, 1);
    let image: ImageDataImpl | ImageBitmapImpl = unwrap<ImageDataImpl>(source);
    if (invalid === 'detached data') f.window.structuredClone(source.data.buffer, { transfer: [source.data.buffer] });
    if (invalid === 'closed bitmap') image = new ImageBitmapImpl(f.env);
    const result = f.mixin.createImageBitmap(image, options({ resizeWidth: invalid === 'resize' ? 0 : undefined }),
      invalid === 'crop' ? { sx: 0, sy: 0, sw: 0, sh: 1 } : undefined);
    const assertion = expect(result.backing).rejects.toMatchObject({ name: invalid === 'crop' ? 'RangeError' : 'InvalidStateError' });
    expect(f.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
    await runInHostTask(() => { f.loop.performMicrotaskCheckpoint(); });
    await assertion;
  });

  it('checks crop dimensions before resize dimensions and source lifetime', async () => {
    const f = prepared();
    const source = new ImageBitmapImpl(f.env);
    const access = vi.spyOn(source, 'prepareBitmapData');
    const result = f.mixin.createImageBitmap(source, options({ resizeWidth: 0 }), { sx: 0, sy: 0, sw: 0, sh: 1 });
    const assertion = expect(result.backing).rejects.toBeInstanceOf(f.env.realm.RangeError);
    expect(access).not.toHaveBeenCalled();
    await runInHostTask(() => { f.loop.performMicrotaskCheckpoint(); });
    await assertion;
  });

  it('uses Document activity to gate delivery', async () => {
    const f = prepared();
    const result = f.mixin.createImageBitmap(unwrap<ImageDataImpl>(new f.window.ImageData(1, 1)), options());
    const delivery = observeBeforeTask(result.backing);
    const task = [...f.loop.getTaskQueue(bitmapTaskSource)][0]!;
    const activeEntry = f.traversable.activeSessionHistoryEntry;
    f.traversable.activeSessionHistoryEntry = f.document.env.createSessionHistoryEntry(activeEntry.url, new DocumentState());
    expect(task.isRunnable).toBe(false);
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(false); });
    expect(f.loop.getTaskQueue(bitmapTaskSource).has(task)).toBe(true);
    f.traversable.activeSessionHistoryEntry = activeEntry;
    await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(true); });
    expect(await delivery).toBeInstanceOf(f.window.ImageBitmap);
  });
});

describe('ImageBitmap creation realms', () => {
  const prepared = useFixture(() => ({ first: createFixture(), second: createFixture() }));

  it('allocates the Promise, bitmap, and pixels in the receiving global', async () => {
    const { first, second } = prepared();
    const result = second.mixin.createImageBitmap(unwrap<ImageDataImpl>(new first.window.ImageData(1, 1)), options());
    const delivery = observeBeforeTask(result.backing);
    expect(result.backing).toBeInstanceOf(second.env.realm.NativePromise);
    expect(result.backing).not.toBeInstanceOf(first.env.realm.NativePromise);
    expect(first.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
    await runInHostTask(() => { expect(second.loop.runTaskTurn()).toBe(true); });
    const image = await delivery;
    expect(image).toBeInstanceOf(second.window.ImageBitmap);
    expect(image).not.toBeInstanceOf(first.window.ImageBitmap);
    const data = unwrap<ImageBitmapImpl>(image as object).bitmapData!;
    expect(data.bytes.buffer).toBeInstanceOf(second.env.realm.ArrayBuffer);
    expect(data.bytes.buffer).not.toBeInstanceOf(first.env.realm.ArrayBuffer);
  });

  it('rejects a foreign closed source with an exception from the receiving realm', async () => {
    const { first, second } = prepared();
    const result = second.mixin.createImageBitmap(new ImageBitmapImpl(first.env), options());
    const assertion = expect(result.backing).rejects.toBeInstanceOf(second.window.DOMException);
    await runInHostTask(() => { second.loop.performMicrotaskCheckpoint(); });
    await assertion;
  });
});

describe.each([false, true])('ImageBitmap creation in a worker, shared: %s', (shared) => {
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
    return { outside, env, agent, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it('delivers on the worker loop without retaining the outside Document', async () => {
    const { outside, env, agent, scope } = prepared();
    const source = new outside.window.ImageData(1, 1);
    const result = env.getWindowOrWorkerGlobalScopeMixin().createImageBitmap(unwrap<ImageDataImpl>(source), options());
    const tasks = [...agent.eventLoop.getTaskQueue(bitmapTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document).toBeNull();
    expect(outside.loop.getTaskQueue(bitmapTaskSource).size).toBe(0);
    const image = await result.backing;
    expect(result.backing).toBeInstanceOf(env.realm.NativePromise);
    expect(image).toBeInstanceOf(scope.ImageBitmap);
    expect(unwrap<ImageBitmapImpl>(image as object).env).toBe(env);
  });
});

function createFixture() {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const env = traversable.activeWindow!.env;
  return {
    traversable, env, window: env.realm.windowProxy.platform, document: traversable.activeDocument!,
    loop: env.responsibleEventLoop, mixin: env.getWindowOrWorkerGlobalScopeMixin(),
  };
}

function options(values: Partial<ImageBitmapOptions> = {}): ImageBitmapOptions {
  return { imageOrientation: 'from-image', premultiplyAlpha: 'default', colorSpaceConversion: 'default', resizeQuality: 'low', ...values };
}

/** Attach before advancing a manually driven loop; later reactions would need another checkpoint. */
function observeBeforeTask(promise: Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => { void promise.then(resolve, reject); });
}
