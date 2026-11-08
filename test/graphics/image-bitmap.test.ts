import { describe, expect, it } from 'vitest';
import { BitmapData, ImageBitmapImpl, type ImageDataPixelFormat } from '../../src/graphics/index';
import { parseURL } from '../../src/url/index';
import { Browlet } from '../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../src/browlet/environment/index';
import { createWorkerEnvironment } from '../../src/browlet/integration/web-idl/index';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, ImageBitmap, SharedWorkerGlobalScope } from '../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../support/browlet-binding';
import { useFixture } from '../support/fixture';

describe('ImageBitmap lifetime', () => {
  const prepared = useFixture(createFixture);

  it('exposes a nonconstructible interface with readonly dimensions and no pixel-array attribute', () => {
    const { browser, env } = prepared();
    const { image } = createBitmap(env);
    expect(image).toBeInstanceOf(browser.window.ImageBitmap);
    expect(Object.prototype.toString.call(image)).toBe('[object ImageBitmap]');
    // @ts-expect-error ImageBitmap deliberately has no author constructor signature.
    expect(() => { Reflect.construct(browser.window.ImageBitmap, []); }).toThrow(env.realm.TypeError);
    expect(image).toMatchObject({ width: 2, height: 1 });
    expect(Reflect.has(image, 'data')).toBe(false);
    expect(Reflect.has(image, 'bitmapData')).toBe(false);
    for (const name of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(browser.window.ImageBitmap.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(Reflect.set(image, name, 9)).toBe(false);
      expect(() => { descriptor.get!.call({}); }).toThrow(env.realm.TypeError);
    }
    expect(browser.window.ImageBitmap.prototype.close.length).toBe(0);
    expect(() => { browser.window.ImageBitmap.prototype.close.call({} as ImageBitmap); }).toThrow(env.realm.TypeError);
  });

  it('closes idempotently, releases its owned data, and reports zero dimensions', () => {
    const { browser, env } = prepared();
    const { image, implementation } = createBitmap(env);
    expect(image.close()).toBeUndefined();
    expect(implementation.bitmapData).toBeNull();
    expect(image).toMatchObject({ width: 0, height: 0 });
    expect(image.close()).toBeUndefined();
    expect(() => browser.window.structuredClone(image)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => browser.window.structuredClone(image, { transfer: [image] }))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
  });

  it('preserves repeated graph identity while copying only bitmap state', () => {
    const { browser, env } = prepared();
    const { image } = createBitmap(env);
    Object.defineProperty(image, 'authorValue', { get() { throw new Error('Must not inspect author properties'); } });
    const clone = browser.window.structuredClone({ first: image, again: image });
    expect(clone.first).toBe(clone.again);
    expect(clone.first).not.toBe(image);
    expect(clone.first).toBeInstanceOf(browser.window.ImageBitmap);
    expect(Reflect.has(clone.first, 'authorValue')).toBe(false);
    image.close();
    expect(clone.first).toMatchObject({ width: 2, height: 1 });
  });

  it('moves the owned pixels on transfer and keeps the destination alive after source close', () => {
    const { browser, env } = prepared();
    const { image, implementation, data } = createBitmap(env);
    const moved = browser.window.structuredClone({ first: image, again: image }, { transfer: [image] });
    expect(moved.first).toBe(moved.again);
    expect(moved.first).not.toBe(image);
    const received = unwrap<ImageBitmapImpl>(moved.first).bitmapData!;
    expect(received).toBeInstanceOf(BitmapData);
    expect(received.bytes).toBe(data.bytes);
    expect(implementation.bitmapData).toBeNull();
    expect(image).toMatchObject({ width: 0, height: 0 });
    expect(moved.first).toMatchObject({ width: 2, height: 1 });
    image.close();
    expect(moved.first.width).toBe(2);
    expect(() => browser.window.structuredClone(image)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => browser.window.structuredClone(image, { transfer: [image] }))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
  });

  it('rejects duplicate transfer entries before releasing the bitmap', () => {
    const { browser, env } = prepared();
    const { image, implementation, data } = createBitmap(env);
    expect(() => browser.window.structuredClone(image, { transfer: [image, image] }))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(implementation.bitmapData).toBe(data);
    expect(image).toMatchObject({ width: 2, height: 1 });
  });

  it.each([false, true])('rejects non-origin-clean data without releasing it, transfer: %s', (transfer) => {
    const { browser, env } = prepared();
    const { image, implementation, data } = createBitmap(env, { originClean: false });
    try {
      browser.window.structuredClone(image, { transfer: transfer ? [image] : [] });
      expect.unreachable('Expected the origin-clean check to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(browser.window.DOMException);
      expect(error).toHaveProperty('name', 'DataCloneError');
    }
    expect(implementation.bitmapData).toBe(data);
    expect(image).toMatchObject({ width: 2, height: 1 });
    image.close();
    expect(implementation.bitmapData).toBeNull();
  });
});

describe.each<ImageDataPixelFormat>(['rgba-unorm8', 'rgba-float16'])('ImageBitmap %s storage', (pixelFormat) => {
  const prepared = useFixture(createFixture);

  it.each([false, true])('copies exact component bits and alpha metadata, premultiplied: %s', (premultipliedAlpha) => {
    const { browser, env } = prepared();
    const { image, data } = createBitmap(env, { pixelFormat, premultipliedAlpha, colorSpace: 'display-p3-linear' });
    const clone = browser.window.structuredClone(image);
    const copied = unwrap<ImageBitmapImpl>(clone).bitmapData!;
    expect(copied).not.toBe(data);
    expect(copied.bytes).not.toBe(data.bytes);
    expect(copied.bytes.buffer).not.toBe(data.bytes.buffer);
    expect(copied).toEqual(data);
    expect(copied.bytes).toHaveLength(pixelFormat === 'rgba-unorm8' ? 8 : 16);
    image.close();
    expect(clone).toMatchObject({ width: 2, height: 1 });
    expect(copied.bytes).toEqual(data.bytes);
  });

  it.each([false, true])('keeps serialization records portable without a source environment, transfer: %s', (transfer) => {
    const { browser, env } = prepared();
    const { image, data } = createBitmap(env, { pixelFormat, colorSpace: 'srgb-linear' });
    const received = transfer
      ? env.deserializeWithTransfer(structuredClone(env.serializeWithTransfer(image, [image]))).deserialized
      : env.deserialize(structuredClone(env.serialize(image)));
    expect(received).toBeInstanceOf(browser.window.ImageBitmap);
    if (!(received instanceof browser.window.ImageBitmap)) throw new Error('Expected ImageBitmap');
    const receivedData = unwrap<ImageBitmapImpl>(received).bitmapData!;
    expect(receivedData).toBeInstanceOf(BitmapData);
    // A transported plain record must regain its pixel operations in the receiving implementation.
    receivedData.flipY();
    expect(receivedData).toEqual(data);
    expect(received).toMatchObject({ width: 2, height: 1 });
    expect(image.width).toBe(transfer ? 0 : 2);
  });
});

describe('ImageBitmap realms', () => {
  const prepared = useFixture(async () => ({ first: await createFixture(), second: await createFixture() }));

  it.each([false, true])('creates a receiver-realm result, transfer: %s', (transfer) => {
    const { first, second } = prepared();
    const { image, data } = createBitmap(first.env);
    const clone = second.browser.window.structuredClone(image, { transfer: transfer ? [image] : [] });
    expect(clone).toBeInstanceOf(second.browser.window.ImageBitmap);
    expect(clone).not.toBeInstanceOf(first.browser.window.ImageBitmap);
    expect(unwrap<ImageBitmapImpl>(clone).env).toBe(second.env);
    expect(unwrap<ImageBitmapImpl>(clone).bitmapData).toEqual(data);
    expect(image.width).toBe(transfer ? 0 : 2);
  });

  it('keeps borrowed getters and close tied to the receiver', () => {
    const { first, second } = prepared();
    const { image, implementation } = createBitmap(first.env);
    const descriptor = Object.getOwnPropertyDescriptor(second.browser.window.ImageBitmap.prototype, 'width')!;
    expect(descriptor.get!.call(image)).toBe(2);
    second.browser.window.ImageBitmap.prototype.close.call(image);
    expect(implementation.bitmapData).toBeNull();
    expect(descriptor.get!.call(image)).toBe(0);
    expect(() => { descriptor.get!.call({}); }).toThrow(second.env.realm.TypeError);
  });

  it('realizes closed-bitmap clone errors in the calling global realm', () => {
    const { first, second } = prepared();
    const { image } = createBitmap(first.env);
    image.close();
    try {
      second.browser.window.structuredClone(image);
      expect.unreachable('Expected a detached ImageBitmap rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(second.browser.window.DOMException);
      expect(error).not.toBeInstanceOf(first.browser.window.DOMException);
      expect(error).toHaveProperty('name', 'DataCloneError');
    }
  });
});

describe.each([false, true])('ImageBitmap worker exposure, shared: %s', (shared) => {
  const prepared = useFixture(async (fixture) => {
    const { env: outsideEnv } = await createFixture();
    const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected a worker agent');
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://bitmap.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'bitmap', credentials: 'same-origin', extendedLifetime: shared,
    });
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { env, outsideEnv, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it.each([false, true])('receives an ImageBitmap in its own realm, transfer: %s', (transfer) => {
    const { env, outsideEnv, scope } = prepared();
    const { image, data } = createBitmap(outsideEnv);
    // Worker structuredClone forwarding remains §10.3; exercise its existing receiving machinery.
    const received = transfer
      ? env.deserializeWithTransfer(outsideEnv.serializeWithTransfer(image, [image])).deserialized
      : env.deserialize(outsideEnv.serialize(image));
    expect(received).toBeInstanceOf(scope.ImageBitmap);
    if (!(received instanceof scope.ImageBitmap)) throw new Error('Expected worker ImageBitmap');
    expect(unwrap<ImageBitmapImpl>(received).env).toBe(env);
    expect(unwrap<ImageBitmapImpl>(received).bitmapData).toEqual(data);
    received.close();
    expect(received).toMatchObject({ width: 0, height: 0 });
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '<!doctype html><body>' });
  await browser.navigate('https://bitmap.test/');
  return { browser, env: getRelevantRealm(browser.window).env };
}

/** Supply prepared pixel storage, then use real bindings. */
function createBitmap(env: BrowletEnvironment, options: Partial<Pick<BitmapData, 'pixelFormat' | 'colorSpace' | 'premultipliedAlpha' | 'originClean'>> = {}) {
  const pixelFormat = options.pixelFormat ?? 'rgba-unorm8';
  const bytes = Uint8Array.from({ length: pixelFormat === 'rgba-unorm8' ? 8 : 16 }, (_, index) => index * 17);
  const data = new BitmapData({
    width: 2, height: 1, bytes, pixelFormat, colorSpace: options.colorSpace ?? 'srgb',
    premultipliedAlpha: options.premultipliedAlpha ?? false, originClean: options.originClean ?? true,
  });
  const implementation = ImageBitmapImpl.create(data, env);
  const image = getBindingContext(env.realm).project(ImageBitmapImpl, implementation) as ImageBitmap;
  return { image, implementation, data };
}
