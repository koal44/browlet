import { describe, expect, it } from 'vitest';
import { ImageDataImpl, type ImageDataPixelFormat } from '../../src/graphics/index';
import { parseURL } from '../../src/url/index';
import { Browlet } from '../../src/browlet/browlet';
import { createWorkerEnvironment } from '../../src/browlet/integration/web-idl/index';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../src/browlet/platform';
import { getRelevantRealm } from '../support/browlet-binding';
import { useFixture } from '../support/fixture';

describe.each<ImageDataPixelFormat>(['rgba-unorm8', 'rgba-float16'])('ImageData %s', (pixelFormat) => {
  const prepared = useFixture(createFixture);

  it('allocates transparent black pixels in the owning realm', () => {
    const { browser, env } = prepared();
    const ArrayClass = pixelFormat === 'rgba-unorm8' ? env.realm.Uint8ClampedArray : env.realm.Float16Array!;
    const image = new browser.window.ImageData(2, 3, { pixelFormat, colorSpace: 'display-p3-linear' });
    expect(image).toBeInstanceOf(browser.window.ImageData);
    expect(image.data).toBeInstanceOf(ArrayClass);
    expect(image.data.buffer).toBeInstanceOf(env.realm.ArrayBuffer);
    expect(image).toMatchObject({ width: 2, height: 3, pixelFormat, colorSpace: 'display-p3-linear' });
    expect(Array.from(image.data)).toEqual(Array(24).fill(0));
    expect(image.data.byteOffset).toBe(0);
    expect(image.data.byteLength).toBe(image.data.buffer.byteLength);
    expect(image.data).toBe(image.data);
  });

  it('retains a supplied subarray and infers its omitted height', () => {
    const { browser, env } = prepared();
    const ArrayClass = pixelFormat === 'rgba-unorm8' ? env.realm.Uint8ClampedArray : env.realm.Float16Array!;
    const buffer = new env.realm.ArrayBuffer(16 * ArrayClass.BYTES_PER_ELEMENT);
    const data = new ArrayClass(buffer, 4 * ArrayClass.BYTES_PER_ELEMENT, 8);
    const image = new browser.window.ImageData(data, 1, undefined, { pixelFormat });
    expect(image.data).toBe(data);
    expect(image).toMatchObject({ width: 1, height: 2, colorSpace: 'srgb', pixelFormat });
    data[0] = 42;
    expect(image.data[0]).toBe(42);
    image.data[1] = 23;
    expect(data[1]).toBe(23);
  });

  it('clones pixels with the surrounding graph and preserves offsets and aliases', () => {
    const { browser, env } = prepared();
    const ArrayClass = pixelFormat === 'rgba-unorm8' ? env.realm.Uint8ClampedArray : env.realm.Float16Array!;
    const buffer = new env.realm.ArrayBuffer(16 * ArrayClass.BYTES_PER_ELEMENT);
    const data = new ArrayClass(buffer, 4 * ArrayClass.BYTES_PER_ELEMENT, 8);
    data[0] = 42;
    const image = new browser.window.ImageData(data, 2, 1, { pixelFormat, colorSpace: 'display-p3' });
    const clone = browser.window.structuredClone({ image, data, buffer, again: image });
    expect(clone.image).toBeInstanceOf(browser.window.ImageData);
    expect(clone.image).toBe(clone.again);
    expect(clone.image.data).toBe(clone.data);
    expect(clone.data).toBeInstanceOf(ArrayClass);
    expect(clone.data.buffer).toBe(clone.buffer);
    expect(clone.buffer).not.toBe(buffer);
    expect(clone.data.byteOffset).toBe(data.byteOffset);
    expect(clone.image).toMatchObject({ width: 2, height: 1, pixelFormat, colorSpace: 'display-p3' });
    expect(clone.data[0]).toBe(42);
    data[0] = 9;
    expect(clone.data[0]).toBe(42);
  });

  it('transfers the backing buffer separately and rejects detached pixels or ImageData transfer', () => {
    const { browser } = prepared();
    const image = new browser.window.ImageData(1, 2, { pixelFormat });
    const buffer = image.data.buffer;
    const clone = browser.window.structuredClone({ image, buffer }, { transfer: [buffer] });
    expect(image.data.byteLength).toBe(0);
    expect(image).toMatchObject({ width: 1, height: 2 });
    expect(clone.image.data.buffer).toBe(clone.buffer);
    expect(clone.image.data.length).toBe(8);
    expect(() => browser.window.structuredClone(image)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => browser.window.structuredClone(clone.image, { transfer: [clone.image] }))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
  });
});

describe('ImageData construction and initialization', () => {
  const prepared = useFixture(createFixture);

  it.each(['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'] as const)('retains the %s label without converting pixels', (colorSpace) => {
    const { browser, env } = prepared();
    const data = new env.realm.Uint8ClampedArray([1, 2, 3, 4]);
    const image = new browser.window.ImageData(data, 1, 1, { colorSpace });
    expect(image.data).toBe(data);
    expect(Array.from(image.data)).toEqual([1, 2, 3, 4]);
    expect(image.colorSpace).toBe(colorSpace);
    expect(image.pixelFormat).toBe('rgba-unorm8');
  });

  it('uses Web IDL dimension conversion and rejects zero dimensions', () => {
    const { browser } = prepared();
    expect(new browser.window.ImageData(2 ** 32 + 1, 2.9)).toMatchObject({
      width: 1, height: 2, pixelFormat: 'rgba-unorm8', colorSpace: 'srgb',
    });
    for (const [width, height] of [[0, 1], [1, 0], [NaN, 1], [2 ** 32, 1]]) {
      expect(() => new browser.window.ImageData(width!, height!)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    }
  });

  it('validates pixel length, dimensions, and array format in the specified order', () => {
    const { browser, env } = prepared();
    const ImageData = browser.window.ImageData;
    for (const length of [0, 1, 6]) {
      expect(() => new ImageData(new env.realm.Uint8ClampedArray(length), 0))
        .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    }
    for (const [length, width, height] of [[4, 0, undefined], [8, 3, undefined], [8, 1, 1], [4, 1, 0]]) {
      expect(() => new ImageData(new env.realm.Uint8ClampedArray(length!), width!, height))
        .toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    }
    const data = new env.realm.Uint8ClampedArray(8);
    expect(() => new ImageData(data, 0, 1, { pixelFormat: 'rgba-float16' }))
      .toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(() => new ImageData(data, 1, 1, { pixelFormat: 'rgba-float16' }))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    const Float16Array = env.realm.Float16Array!;
    expect(() => new ImageData(new Float16Array(4), 1))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('uses intrinsic view metadata and the existing enum and buffer conversions', () => {
    const { browser, env } = prepared();
    const data = new env.realm.Uint8ClampedArray(8);
    Object.defineProperties(data, {
      byteLength: { get() { throw new Error('Must not read author byteLength'); } },
      [Symbol.toStringTag]: { value: 'Float16Array' },
    });
    expect(new browser.window.ImageData(data, 1)).toMatchObject({ width: 1, height: 2 });
    // @ts-expect-error Exercise the projected enum conversion.
    expect(() => new browser.window.ImageData(1, 1, { pixelFormat: 'rgba-float32' })).toThrow(env.realm.TypeError);
    const resizable = new env.realm.Uint8ClampedArray(new env.realm.ArrayBuffer(4, { maxByteLength: 8 }));
    expect(() => new browser.window.ImageData(resizable, 1)).toThrow(env.realm.TypeError);
    const shared = new Uint8ClampedArray(new SharedArrayBuffer(4));
    // @ts-expect-error ImageData does not accept shared backing stores.
    expect(() => new browser.window.ImageData(shared, 1)).toThrow(env.realm.TypeError);
  });

  it('exposes readonly receiver-checked attributes and rejects a detached input', () => {
    const { browser, env } = prepared();
    const image = new browser.window.ImageData(1, 1);
    for (const name of ['data', 'width', 'height', 'pixelFormat', 'colorSpace']) {
      const descriptor = Object.getOwnPropertyDescriptor(browser.window.ImageData.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(Reflect.set(image, name, 1)).toBe(false);
      expect(() => { descriptor.get!.call({}); }).toThrow(env.realm.TypeError);
    }
    browser.window.structuredClone(image.data.buffer, { transfer: [image.data.buffer] });
    expect(() => new browser.window.ImageData(image.data, 1)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('uses the consuming algorithm default color space unless settings override it', () => {
    const { env } = prepared();
    const image = new ImageDataImpl(env);
    image.initialize(1, 1, { pixelFormat: 'rgba-unorm8' }, undefined, 'display-p3');
    expect(image.colorSpace).toBe('display-p3');
    image.initialize(1, 1, { pixelFormat: 'rgba-unorm8', colorSpace: 'srgb-linear' }, undefined, 'display-p3');
    expect(image.colorSpace).toBe('srgb-linear');
  });

  it('honors newTarget for both constructor overloads', async () => {
    const { browser } = prepared();
    const result = await browser.evaluate(() => {
      class Pixels extends ImageData {}
      const allocated = new Pixels(1, 1);
      const supplied = new Pixels(new Uint8ClampedArray(8), 2);
      return [allocated instanceof Pixels, supplied instanceof Pixels, supplied.width, supplied.height];
    });
    expect(result).toEqual([true, true, 2, 1]);
  });
});

describe('ImageData across realms', () => {
  const prepared = useFixture(async () => ({ first: await createFixture(), second: await createFixture() }));

  it('retains the supplied array realm and allocates clones in the target realm', () => {
    const { first, second } = prepared();
    const data = new first.env.realm.Uint8ClampedArray(4);
    const image = new second.browser.window.ImageData(data, 1);
    const descriptor = Object.getOwnPropertyDescriptor(first.browser.window.ImageData.prototype, 'data')!;
    expect(descriptor.get!.call(image)).toBe(data);
    expect(image).toBeInstanceOf(second.browser.window.ImageData);
    expect(image).not.toBeInstanceOf(first.browser.window.ImageData);
    const clone = first.browser.window.structuredClone(image);
    expect(clone).toBeInstanceOf(first.browser.window.ImageData);
    expect(clone.data).toBeInstanceOf(first.env.realm.Uint8ClampedArray);
    expect(clone.data.buffer).toBeInstanceOf(first.env.realm.ArrayBuffer);
    expect(clone.data).not.toBe(data);
  });
});

describe.each([false, true])('ImageData worker exposure, shared: %s', (shared) => {
  const prepared = useFixture(async (fixture) => {
    const { env: outsideEnv } = await createFixture();
    const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected a worker agent');
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://pixels.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'pixels', credentials: 'same-origin', extendedLifetime: shared,
    });
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { env, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
  });

  it('constructs and deserializes in the worker realm', () => {
    const { env, scope } = prepared();
    const image = new scope.ImageData(1, 2, { pixelFormat: 'rgba-float16' });
    // Worker forwarding of the public structuredClone() API remains HTML §10.3 work.
    const clone = env.clone(image, []);
    if (!(clone instanceof scope.ImageData)) throw new Error('Expected a cloned ImageData');
    expect(image.data).toBeInstanceOf(env.realm.Float16Array!);
    expect(clone).toBeInstanceOf(scope.ImageData);
    expect(clone.data).toBeInstanceOf(env.realm.Float16Array!);
    expect(clone.data).not.toBe(image.data);
    expect(clone).toMatchObject({ width: 1, height: 2, pixelFormat: 'rgba-float16' });
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '<!doctype html><body>' });
  await browser.navigate('https://pixels.test/');
  return { browser, env: getRelevantRealm(browser.window).env };
}
