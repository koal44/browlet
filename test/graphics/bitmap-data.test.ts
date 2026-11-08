import { describe, expect, it } from 'vitest';
import {
  BitmapData, ImageBitmapImpl, ImageDataImpl,
  type ImageBitmapOptions, type ImageDataPixelFormat, type ResizeQuality,
} from '../../src/graphics/index';
import { getBufferSourceCopy, getBufferSourceView } from '../../src/js-engine/index';
import { Browlet } from '../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../src/browlet/environment/index';
import type { ImageBitmap } from '../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../support/browlet-binding';
import { useFixture } from '../support/fixture';

describe.each(['ImageData', 'ImageBitmap'] as const)('%s bitmap preparation', (kind) => {
  const prepared = useFixture(createFixture);

  it('copies all pixels into independent storage before the source changes or closes', () => {
    const { browser, env } = prepared();
    const source = createSource(kind, browser, env);
    const output = BitmapData.create(source, options(), undefined, env);
    expect(output).toMatchObject({ width: 3, height: 2, pixelFormat: 'rgba-unorm8', colorSpace: 'srgb', originClean: true });
    if (source instanceof ImageDataImpl) { source.data.fill(0); }
    else { source.bitmapData!.bytes.fill(0); source.close(); }
    expect(Array.from(output.bytes)).toEqual(pixels(10, 20, 30, 40, 50, 60));
    const bitmap = ImageBitmapImpl.create(output, env);
    const image = getBindingContext(env.realm).project(ImageBitmapImpl, bitmap) as ImageBitmap;
    expect(image).toBeInstanceOf(browser.window.ImageBitmap);
    expect(image).toMatchObject({ width: 3, height: 2 });
    image.close();
    expect(bitmap.bitmapData).toBeNull();
  });

  it('crops a rectangle without changing the source', () => {
    const { browser, env } = prepared();
    const source = createSource(kind, browser, env);
    const output = BitmapData.create(source, options(), { sx: 1, sy: 0, sw: 2, sh: 2 }, env);
    expect(output).toMatchObject({ width: 2, height: 2 });
    expect(Array.from(output.bytes)).toEqual(pixels(20, 30, 50, 60));
    expect(Array.from(BitmapData.create(source, options(), undefined, env).bytes))
      .toEqual(pixels(10, 20, 30, 40, 50, 60));
  });

  it('treats negative dimensions as left/up extension, without mirroring pixels', () => {
    const { browser, env } = prepared();
    const output = BitmapData.create(createSource(kind, browser, env), options(), { sx: 3, sy: 2, sw: -2, sh: -2 }, env);
    expect(output).toMatchObject({ width: 2, height: 2 });
    expect(Array.from(output.bytes)).toEqual(pixels(20, 30, 50, 60));
  });

  it('preserves the requested rectangle with transparent-black padding on every side', () => {
    const { browser, env } = prepared();
    const output = BitmapData.create(createSource(kind, browser, env), options(), { sx: -1, sy: -1, sw: 5, sh: 4 }, env);
    expect(output).toMatchObject({ width: 5, height: 4 });
    expect(Array.from(output.bytes)).toEqual(pixels(
      null, null, null, null, null,
      null, 10, 20, 30, null,
      null, 40, 50, 60, null,
      null, null, null, null, null,
    ));
  });

  it('returns the full transparent rectangle when it misses the source entirely', () => {
    const { browser, env } = prepared();
    const source = createSource(kind, browser, env);
    for (const [sx, sy] of [[8, 9], [-8, -9], [8, 0], [0, -9]] as const) {
      const output = BitmapData.create(source, options(), { sx, sy, sw: 2, sh: 1 }, env);
      expect(output).toMatchObject({ width: 2, height: 1 });
      expect(Array.from(output.bytes)).toEqual(pixels(null, null));
    }
  });

  it('flips the cropped rows and their padding vertically', () => {
    const { browser, env } = prepared();
    const output = BitmapData.create(createSource(kind, browser, env), options({ imageOrientation: 'flipY' }),
      { sx: 1, sy: -1, sw: 2, sh: 3 }, env);
    expect(output).toMatchObject({ width: 2, height: 3 });
    expect(Array.from(output.bytes)).toEqual(pixels(50, 60, 20, 30, null, null));
  });

  it('accepts no-op resize and explicit unpremultiplied options', () => {
    const { browser, env } = prepared();
    const output = BitmapData.create(createSource(kind, browser, env), options({
      resizeWidth: 3, premultiplyAlpha: 'none', resizeQuality: 'high',
    }), undefined, env);
    expect(output).toMatchObject({ width: 3, height: 2, premultipliedAlpha: false });
    expect(Array.from(output.bytes)).toEqual(pixels(10, 20, 30, 40, 50, 60));
  });

  it('retains half-float component bits and color metadata during crop and flip', () => {
    const { browser, env } = prepared();
    const bits = new env.realm.Uint16Array([
      0x8000, 0x7e55, 0x3800, 0x3c00, 0x0000, 0x3c00, 0x3800, 0x3800,
      0x4000, 0xbc00, 0x7c00, 0x0000, 0x3555, 0x8000, 0x3c00, 0x3c00,
    ]);
    const data = new browser.window.ImageData(new env.realm.Float16Array!(bits.buffer), 2, undefined, {
      pixelFormat: 'rgba-float16', colorSpace: 'display-p3-linear',
    });
    const source = sourceFromImageData(kind, unwrap<ImageDataImpl>(data), env);
    const output = BitmapData.create(source, options({ imageOrientation: 'flipY', colorSpaceConversion: 'default' }),
      { sx: -1, sy: 0, sw: 2, sh: 2 }, env);
    const raw = getBufferSourceView(bits);
    expect(output).toMatchObject({ width: 2, height: 2, pixelFormat: 'rgba-float16', colorSpace: 'display-p3-linear' });
    expect(Array.from(output.bytes)).toEqual([
      ...new Array<number>(8).fill(0), ...raw.slice(16, 24),
      ...new Array<number>(8).fill(0), ...raw.slice(0, 8),
    ]);
  });
});

describe('ImageBitmap source validation and metadata', () => {
  const prepared = useFixture(createFixture);

  it('checks zero crop dimensions before resize and detached-source checks', () => {
    const { env } = prepared();
    const closed = new ImageBitmapImpl(env);
    for (const [sw, sh] of [[0, 1], [1, -0]] as const) {
      expect(() => BitmapData.create(closed, options({ resizeWidth: 0 }), { sx: 0, sy: 0, sw, sh }, env))
        .toThrow(env.realm.RangeError);
    }
  });

  it.each([{ resizeWidth: 0 }, { resizeHeight: 0 }])('rejects zero resize dimensions: %j', (resize) => {
    const { browser, env } = prepared();
    expect(() => BitmapData.create(createSource('ImageData', browser, env), options(resize), undefined, env))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('rejects ImageData after its pixel buffer is transferred', () => {
    const { browser, env } = prepared();
    const image = new browser.window.ImageData(1, 1);
    browser.window.structuredClone(image.data.buffer, { transfer: [image.data.buffer] });
    expect(() => BitmapData.create(unwrap<ImageDataImpl>(image), options(), undefined, env))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it.each([false, true])('rejects a detached ImageBitmap, transferred: %s', (transfer) => {
    const { browser, env } = prepared();
    const implementation = sourceFromImageData('ImageBitmap', unwrap<ImageDataImpl>(new browser.window.ImageData(1, 1)), env);
    const image = getBindingContext(env.realm).project(ImageBitmapImpl, implementation) as ImageBitmap;
    if (transfer) browser.window.structuredClone(image, { transfer: [image] });
    else image.close();
    expect(() => BitmapData.create(implementation, options(), undefined, env))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('copies only the intrinsic pixel subarray, without reading author properties or methods', () => {
    const { browser, env } = prepared();
    const pixels = new env.realm.Uint8ClampedArray([99, 99, 99, 99, 32, 64, 128, 255, 88, 88, 88, 88]);
    const view = pixels.subarray(4, 8);
    const image = new browser.window.ImageData(view, 1);
    for (const name of ['buffer', 'byteLength', 'byteOffset', 'length', 'subarray', Symbol.iterator]) {
      Object.defineProperty(view, name, { get() { throw new Error('Must use the pixel view intrinsics'); } });
    }
    for (const name of ['set', 'subarray', 'copyWithin']) {
      Object.defineProperty(env.realm.Uint8Array.prototype, name, { value() { throw new Error('Must use internal byte operations'); } });
    }
    const output = BitmapData.create(unwrap<ImageDataImpl>(image), options({ imageOrientation: 'flipY' }), undefined, env);
    expect(Array.from(output.bytes)).toEqual([32, 64, 128, 255]);
  });

  it.each([false, true])('preserves alpha state by default and accepts a matching explicit mode: %s', (premultipliedAlpha) => {
    const { browser, env } = prepared();
    const source = createSource('ImageBitmap', browser, env) as ImageBitmapImpl;
    source.bitmapData!.premultipliedAlpha = premultipliedAlpha;
    source.bitmapData!.originClean = false;
    source.bitmapData!.colorSpace = 'display-p3';
    for (const premultiplyAlpha of ['default', premultipliedAlpha ? 'premultiply' : 'none'] as const) {
      const output = BitmapData.create(source, options({ premultiplyAlpha, colorSpaceConversion: 'none' }), undefined, env);
      expect(output).toMatchObject({ premultipliedAlpha, originClean: false, colorSpace: 'display-p3' });
      expect(output).toEqual(source.bitmapData);
      expect(output.bytes.buffer).not.toBe(source.bitmapData!.bytes.buffer);
    }
  });
});

describe('ImageBitmap preparation ownership', () => {
  const prepared = useFixture(async () => ({ source: await createFixture(), target: await createFixture() }));

  it('copies foreign-realm pixels into the destination owner and keeps their color labels', () => {
    const { source, target } = prepared();
    const image = new source.browser.window.ImageData(1, 1, { colorSpace: 'srgb-linear' });
    image.data.set([8, 16, 32, 64]);
    const output = BitmapData.create(unwrap<ImageDataImpl>(image), options(), undefined, target.env);
    expect(output.bytes.buffer).toBeInstanceOf(target.env.realm.ArrayBuffer);
    expect(output.bytes.buffer).not.toBeInstanceOf(source.env.realm.ArrayBuffer);
    expect(output.colorSpace).toBe('srgb-linear');
    image.data.fill(0);
    expect(Array.from(output.bytes)).toEqual([8, 16, 32, 64]);
  });
});

describe('ImageBitmap pixel processing', () => {
  const prepared = useFixture(createFixture);

  it('resizes pixels and rounds up the inferred aspect-ratio dimension', () => {
    const { browser, env } = prepared();
    const image = new browser.window.ImageData(new env.realm.Uint8ClampedArray(pixels(50, 50, 50, 50, 50, 50)), 3);
    const output = BitmapData.create(unwrap<ImageDataImpl>(image), options({ resizeHeight: 1, resizeQuality: 'pixelated' }), undefined, env);
    expect(output).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(output.bytes)).toEqual(pixels(50, 50));
  });

  it('premultiplies unpremultiplied color components', () => {
    const { browser, env } = prepared();
    const image = new browser.window.ImageData(new env.realm.Uint8ClampedArray([255, 0, 0, 128]), 1);
    const output = BitmapData.create(unwrap<ImageDataImpl>(image), options({ premultiplyAlpha: 'premultiply' }), undefined, env);
    expect(output.premultipliedAlpha).toBe(true);
    expect(Array.from(output.bytes)).toEqual([128, 0, 0, 128]);
  });

  it('unpremultiplies premultiplied color components', () => {
    const { env } = prepared();
    const data = new BitmapData({
      bytes: Uint8Array.from([128, 0, 0, 128]), width: 1, height: 1, pixelFormat: 'rgba-unorm8', colorSpace: 'srgb',
      premultipliedAlpha: true, originClean: true,
    });
    const output = BitmapData.create(ImageBitmapImpl.create(data, env), options({ premultiplyAlpha: 'none' }), undefined, env);
    expect(output.premultipliedAlpha).toBe(false);
    expect(Array.from(output.bytes)).toEqual([255, 0, 0, 128]);
  });
});

describe('BitmapData resizing', () => {
  const prepared = useFixture(createFixture);

  it.each<{ name: string; quality: ResizeQuality; red: number[]; width: number; expected: number[]; }>([
    { name: 'integer enlargement', quality: 'pixelated', red: [0, 100, 250], width: 6, expected: [0, 0, 100, 100, 250, 250] },
    { name: 'fractional enlargement', quality: 'pixelated', red: [0, 100, 250], width: 5, expected: [0, 30, 100, 205, 250] },
    { name: 'small enlargement and nearest-even rounding', quality: 'pixelated', red: [0, 100, 250], width: 4, expected: [0, 62, 156, 250] },
    { name: 'tied integer multiple', quality: 'pixelated', red: [0, 60, 120, 240], width: 6, expected: [0, 30, 60, 120, 180, 240] },
    { name: 'reduction', quality: 'pixelated', red: [0, 64, 128, 255], width: 2, expected: [32, 192] },
    { name: 'low-quality bilinear enlargement', quality: 'low', red: [0, 100, 250], width: 5, expected: [0, 40, 100, 190, 250] },
  ])('samples $name', ({ quality, red, width, expected }) => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-unorm8', pixels(...red));
    const output = source.resize(width, 1, quality, env);
    expect(Array.from(output.bytes)).toEqual(pixels(...expected));
    expect(output).toMatchObject({ width, height: 1, colorSpace: 'display-p3-linear', originClean: false, premultipliedAlpha: false });
    expect(output.bytes.buffer).toBeInstanceOf(env.realm.ArrayBuffer);
    expect(output.bytes.buffer).not.toBe(source.bytes.buffer);
    expect(Array.from(source.bytes)).toEqual(pixels(...red));
  });

  it('chooses integer multiples independently for the two axes', () => {
    const { env } = prepared();
    const source = new BitmapData({ ...alphaBitmap(env, 'rgba-unorm8', pixels(0, 60, 120, 240)).toRecord(), width: 2, height: 2 });
    const output = source.resize(3, 5, 'pixelated', env);
    expect(Array.from(output.bytes)).toEqual(pixels(
      0, 30, 60,
      0, 30, 60,
      60, 105, 150,
      120, 180, 240,
      120, 180, 240,
    ));
  });

  it('copies exact half-float pixels, including NaN payloads and signed zeros', () => {
    const { env } = prepared();
    const words = new Uint16Array([0x8000, 0x7e55, 0x7c00, 0x8000, 0x3c00, 0xfc00, 0x0000, 0x3c00]);
    const source = new BitmapData({
      ...alphaBitmap(env, 'rgba-float16', new Array<number>(8).fill(0)).toRecord(), bytes: getBufferSourceCopy(words),
    });
    const output = source.resize(4, 2, 'pixelated', env);
    const row = [...source.bytes.slice(0, 8), ...source.bytes.slice(0, 8), ...source.bytes.slice(8), ...source.bytes.slice(8)];
    expect(Array.from(output.bytes)).toEqual([...row, ...row]);
    expect(output.pixelFormat).toBe('rgba-float16');
  });

  it.each([false, true])('interpolates stored half-float RGBA without changing alpha representation: %s', (premultipliedAlpha) => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [-2, 4, 0.5, 0, 2, 8, 1.5, 2], premultipliedAlpha);
    const output = source.resize(3, 1, 'low', env);
    expect(halfComponents(output, env)).toEqual([-2, 4, 0.5, 0, 0, 6, 1, 1, 2, 8, 1.5, 2]);
    expect(output.premultipliedAlpha).toBe(premultipliedAlpha);
  });

  it('rounds only the interpolated half-float result, including ties and subnormals', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [1, 1.0009765625, 2 ** -24, 1, 1.0009765625, 1.001953125, 0, 1]);
    expect(halfComponents(source.resize(3, 1, 'low', env), env).slice(4, 8)).toEqual([1, 1.001953125, 0, 1]);
  });

  it('uses an unaligned source view without including neighboring bytes', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [0, 2, 4, 1, 2, 4, 8, 1]);
    const storage = new Uint8Array(source.bytes.length + 2).fill(77);
    storage.set(source.bytes, 1);
    source.bytes = storage.subarray(1, -1);
    const before = Array.from(storage);
    expect(halfComponents(source.resize(3, 1, 'low', env), env)).toEqual([0, 2, 4, 1, 1, 3, 6, 1, 2, 4, 8, 1]);
    expect(Array.from(storage)).toEqual(before);
  });

  it('clamps edges and does not mix zero-weight non-finite neighbors', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [Infinity, -Infinity, 2, 1, Infinity, -Infinity, NaN, 1]);
    const output = halfComponents(source.resize(3, 1, 'low', env), env);
    expect(output).toEqual([Infinity, -Infinity, 2, 1, Infinity, -Infinity, NaN, 1, Infinity, -Infinity, NaN, 1]);
  });

  it('interpolates before the factory applies requested alpha conversion', () => {
    const { browser, env } = prepared();
    const image = new browser.window.ImageData(new env.realm.Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]), 2);
    const source = unwrap<ImageDataImpl>(image);
    const resized = BitmapData.create(source, options({ resizeWidth: 3, resizeHeight: 1 }), undefined, env);
    expect(Array.from(resized.bytes)).toEqual([255, 0, 0, 0, 128, 0, 128, 128, 0, 0, 255, 255]);
    const converted = BitmapData.create(source, options({ resizeWidth: 3, resizeHeight: 1, premultiplyAlpha: 'premultiply' }), undefined, env);
    expect(Array.from(converted.bytes)).toEqual([0, 0, 0, 0, 64, 0, 64, 128, 0, 0, 255, 255]);
  });

  it('accepts unchanged dimensions for every quality without touching the storage', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [-0, NaN, Infinity, 1]);
    const bytes = source.bytes;
    const original = Array.from(bytes);
    for (const quality of ['pixelated', 'low', 'medium', 'high'] as const) {
      expect(source.resize(1, 1, quality, env)).toBe(source);
      expect(source.bytes).toBe(bytes);
      expect(Array.from(source.bytes)).toEqual(original);
    }
  });

  it.each<ResizeQuality>(['medium', 'high'])('resizes a constant image with %s quality', (quality) => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-unorm8', pixels(50, 50));
    expect(Array.from(source.resize(3, 2, quality, env).bytes)).toEqual(pixels(50, 50, 50, 50, 50, 50));
  });
});

describe.each(['medium', 'high'] as const)('BitmapData %s-quality resizing', (quality) => {
  const prepared = useFixture(createFixture);

  it('enlarges using the selected reconstruction filter', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-unorm8', pixels(0, 100, 250));
    const output = source.resize(5, 1, quality, env);
    expect(Array.from(output.bytes)).toEqual(pixels(...(quality === 'medium'
      ? [0, 40, 100, 190, 250] : [0, 30, 100, 198, 255])));
    expect(Array.from(source.bytes)).toEqual(pixels(0, 100, 250));
    expect(output).toMatchObject({ width: 5, height: 1, colorSpace: 'display-p3-linear', originClean: false, premultipliedAlpha: false });
    expect(output.bytes.buffer).toBeInstanceOf(env.realm.ArrayBuffer);
    expect(output.bytes.buffer).not.toBe(source.bytes.buffer);
  });

  it('widens the filter for a fourfold reduction instead of undersampling the impulse', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-unorm8', pixels(0, 0, 255, 0, 0, 0, 0, 0));
    expect(Array.from(source.resize(2, 1, quality, env).bytes))
      .toEqual(pixels(...(quality === 'medium' ? [56, 8] : [61, 6])));
  });

  it('normalizes both axes while reducing a constant half-float image', () => {
    const { env } = prepared();
    const components = [1.25, -2.5, 8, 0.375];
    const source = new BitmapData({
      ...alphaBitmap(env, 'rgba-float16', Array.from({ length: 35 }, () => components).flat()).toRecord(), width: 5, height: 7,
    });
    expect(halfComponents(source.resize(3, 2, quality, env), env)).toEqual(Array.from({ length: 6 }, () => components).flat());
  });

  it('copies exact samples without involving zero-weight neighbors', () => {
    const { env } = prepared();
    const words = new Uint16Array([0x8000, 0x7e55, 0x7c00, 0x8000, 0x3c00, 0xfc00, 0x0000, 0x3c00]);
    const source = new BitmapData({
      ...alphaBitmap(env, 'rgba-float16', new Array<number>(8).fill(0)).toRecord(), bytes: getBufferSourceCopy(words),
    });
    const output = source.resize(2, 3, quality, env);
    expect(Array.from(output.bytes)).toEqual([...source.bytes, ...source.bytes, ...source.bytes]);
  });

  it('reads an unaligned half-float view while retaining the source storage', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [0, 2, 4, 1, 2, 4, 8, 1]);
    const storage = new Uint8Array(source.bytes.length + 2).fill(77);
    storage.set(source.bytes, 1);
    source.bytes = storage.subarray(1, -1);
    const before = Array.from(storage);
    expect(halfComponents(source.resize(3, 1, quality, env), env).slice(4, 8)).toEqual([1, 3, 6, 1]);
    expect(Array.from(storage)).toEqual(before);
  });
});

describe('BitmapData cubic interpolation', () => {
  const prepared = useFixture(createFixture);

  it('combines the horizontal and vertical cubic weights', () => {
    const { env } = prepared();
    const source = new BitmapData({ ...alphaBitmap(env, 'rgba-unorm8', pixels(0, 60, 120, 240)).toRecord(), width: 2, height: 2 });
    expect(Array.from(source.resize(3, 3, 'high', env).bytes)).toEqual(pixels(0, 21, 53, 55, 105, 155, 120, 189, 255));
  });

  it.each([false, true])('retains half-float overshoot in RGB and alpha, premultiplied: %s', (premultipliedAlpha) => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [0, 0, 0, 0, 1, 2, 4, 1], premultipliedAlpha);
    const output = source.resize(4, 1, 'high', env);
    expect(halfComponents(output, env)).toEqual([
      -0.0703125, -0.140625, -0.28125, -0.0703125,
      0.203125, 0.40625, 0.8125, 0.203125,
      0.796875, 1.59375, 3.1875, 0.796875,
      1.0703125, 2.140625, 4.28125, 1.0703125,
    ]);
    expect(output.premultipliedAlpha).toBe(premultipliedAlpha);
  });

  it('clamps and rounds byte components only at the destination', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-unorm8', [0, 0, 0, 0, 255, 255, 255, 255]);
    expect(Array.from(source.resize(4, 1, 'high', env).bytes)).toEqual([
      0, 0, 0, 0, 52, 52, 52, 52, 203, 203, 203, 203, 255, 255, 255, 255,
    ]);
  });

  it('applies signed filter weights to non-finite half-float components', () => {
    const { env } = prepared();
    const source = alphaBitmap(env, 'rgba-float16', [Infinity, -Infinity, 0, 1, 0, 0, 1, 1]);
    expect(halfComponents(source.resize(4, 1, 'high', env), env)).toEqual([
      Infinity, -Infinity, -0.0703125, 1,
      Infinity, -Infinity, 0.203125, 1,
      Infinity, -Infinity, 0.796875, 1,
      -Infinity, Infinity, 1.0703125, 1,
    ]);
  });
});

describe('BitmapData alpha conversion', () => {
  const prepared = useFixture(createFixture);

  it('premultiplies byte components with nearest rounding, retaining opaque pixels', () => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-unorm8', [
      255, 3, 127, 128, 10, 20, 30, 0, 1, 3, 5, 128,
      254, 1, 17, 255, 43, 128, 255, 6, 2, 3, 255, 170,
    ]);
    const bytes = bitmap.bytes;
    expect(bitmap.convertAlpha(true, env)).toBe(bitmap);
    expect(bitmap.bytes).toBe(bytes);
    expect(Array.from(bytes)).toEqual([
      128, 2, 64, 128, 0, 0, 0, 0, 1, 2, 3, 128,
      254, 1, 17, 255, 1, 3, 6, 6, 1, 2, 170, 170,
    ]);
    expect(bitmap).toMatchObject({ premultipliedAlpha: true, colorSpace: 'display-p3-linear', originClean: false });
  });

  it('unpremultiplies bytes with nearest-even ties and saturation', () => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-unorm8', [
      128, 2, 64, 128, 1, 3, 6, 6, 255, 128, 1, 128, 255, 127, 0, 0,
    ], true);
    bitmap.convertAlpha(false, env);
    expect(Array.from(bitmap.bytes)).toEqual([
      255, 4, 128, 128, 42, 128, 255, 6, 255, 255, 2, 128, 0, 0, 0, 0,
    ]);
    expect(bitmap.premultipliedAlpha).toBe(false);
  });

  it('retains signed and HDR half-float components, including stored alpha outside 0–1', () => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-float16', [2, -0.5, 0.25, 0.5, 0.5, 1, 2, 2, 8, -4, 0, -2]);
    bitmap.convertAlpha(true, env);
    expect(halfComponents(bitmap, env)).toEqual([1, -0.25, 0.125, 0.5, 1, 2, 4, 2, -16, 8, -0, -2]);
    bitmap.convertAlpha(false, env);
    expect(halfComponents(bitmap, env)).toEqual([2, -0.5, 0.25, 0.5, 0.5, 1, 2, 2, 8, -4, 0, -2]);
    expect(bitmap).toMatchObject({ colorSpace: 'display-p3-linear', originClean: false });
  });

  it('rounds half-floats to nearest-even, including subnormal underflow and overflow', () => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-float16', [
      1.0009765625, 1.0029296875, 0, 0.75,
      2 ** -24, 3 * 2 ** -24, -(2 ** -24), 0.5,
      65504, -65504, 0.5, 2,
    ]);
    bitmap.convertAlpha(true, env);
    expect(halfComponents(bitmap, env)).toEqual([
      0.7509765625, 0.751953125, 0, 0.75,
      0, 2 ** -23, -0, 0.5,
      Infinity, -Infinity, 1, 2,
    ]);
  });

  it.each([false, true])('zeroes RGB at zero alpha while preserving the alpha sign bit, premultiply: %s', (premultiply) => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-float16', [Infinity, -Infinity, NaN, -0, 2, 3, 4, 0], !premultiply);
    bitmap.convertAlpha(premultiply, env);
    expect(halfComponents(bitmap, env)).toEqual([0, 0, 0, -0, 0, 0, 0, 0]);
  });

  it.each([false, true])('retains NaN alpha payloads and applies non-finite arithmetic, premultiply: %s', (premultiply) => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-float16', [1, -1, 0, NaN, 2, -3, 0, Infinity], !premultiply);
    const words = new Uint16Array(bitmap.bytes.buffer);
    words[3] = 0x7e55;
    bitmap.convertAlpha(premultiply, env);
    expect(words[3]).toBe(0x7e55);
    expect(halfComponents(bitmap, env)).toEqual(premultiply
      ? [NaN, NaN, NaN, NaN, Infinity, -Infinity, NaN, Infinity]
      : [NaN, NaN, NaN, NaN, 0, -0, 0, Infinity]);
  });

  it('preserves component bits for matching modes and fully opaque pixels', () => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-float16', [-0, NaN, Infinity, 1, 2, 3, 4, 0]);
    new Uint16Array(bitmap.bytes.buffer)[1] = 0x7e55;
    const original = Array.from(bitmap.bytes);
    expect(bitmap.convertAlpha(false, env)).toBe(bitmap);
    expect(Array.from(bitmap.bytes)).toEqual(original);
    bitmap.convertAlpha(true, env);
    expect(Array.from(bitmap.bytes.subarray(0, 8))).toEqual(original.slice(0, 8));
  });

  it('converts an unaligned half-float byte view without touching surrounding storage', () => {
    const { env } = prepared();
    const bitmap = alphaBitmap(env, 'rgba-float16', [2, -1, 0.25, 0.5]);
    const storage = new Uint8Array(bitmap.bytes.length + 2).fill(77);
    storage.set(bitmap.bytes, 1);
    bitmap.bytes = storage.subarray(1, storage.length - 1);
    const view = bitmap.bytes;
    bitmap.convertAlpha(true, env);
    expect(bitmap.bytes).toBe(view);
    expect(storage[0]).toBe(77);
    expect(storage[storage.length - 1]).toBe(77);
    expect(halfComponents(bitmap, env)).toEqual([1, -0.5, 0.125, 0.5]);
  });

  it.each<ImageDataPixelFormat>(['rgba-unorm8', 'rgba-float16'])('keeps the original %s image unchanged when preparing converted pixels', (pixelFormat) => {
    const { browser, env } = prepared();
    const ArrayClass = pixelFormat === 'rgba-unorm8' ? env.realm.Uint8ClampedArray : env.realm.Float16Array!;
    const components = pixelFormat === 'rgba-unorm8' ? [255, 0, 0, 128] : [2, -1, 0.25, 0.5];
    const data = new browser.window.ImageData(new ArrayClass(components), 1, undefined, { pixelFormat });
    const output = BitmapData.create(unwrap<ImageDataImpl>(data), options({ premultiplyAlpha: 'premultiply' }), undefined, env);
    expect(output.premultipliedAlpha).toBe(true);
    expect(output.bytes.buffer).not.toBe(data.data.buffer);
    expect(Array.from(data.data)).toEqual(components);
    expect(pixelFormat === 'rgba-unorm8' ? Array.from(output.bytes) : halfComponents(output, env))
      .toEqual(pixelFormat === 'rgba-unorm8' ? [128, 0, 0, 128] : [1, -0.5, 0.125, 0.5]);
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '<!doctype html><body>' });
  await browser.navigate('https://bitmap.test/');
  return { browser, env: getRelevantRealm(browser.window).env };
}

function createSource(kind: 'ImageData' | 'ImageBitmap', browser: Browlet, env: BrowletEnvironment): ImageDataImpl | ImageBitmapImpl {
  const data = new browser.window.ImageData(new env.realm.Uint8ClampedArray(pixels(10, 20, 30, 40, 50, 60)), 3);
  return sourceFromImageData(kind, unwrap<ImageDataImpl>(data), env);
}

/** Supply already prepared storage for the ImageBitmap source, independently of the factory under test. */
function sourceFromImageData(kind: 'ImageData' | 'ImageBitmap', data: ImageDataImpl, env: BrowletEnvironment): ImageDataImpl | ImageBitmapImpl {
  if (kind === 'ImageData') return data;
  return ImageBitmapImpl.create(new BitmapData({
    bytes: getBufferSourceCopy(data.data), width: data.width, height: data.height,
    pixelFormat: data.pixelFormat, colorSpace: data.colorSpace, premultipliedAlpha: false, originClean: true,
  }), env);
}

function options(overrides: Partial<ImageBitmapOptions> = {}): ImageBitmapOptions {
  return { imageOrientation: 'from-image', premultiplyAlpha: 'default', colorSpaceConversion: 'default', resizeQuality: 'low', ...overrides };
}

function pixels(...red: (number | null)[]): number[] {
  return red.flatMap((value) => value === null ? [0, 0, 0, 0] : [value, 0, 0, 255]);
}

function alphaBitmap(env: BrowletEnvironment, pixelFormat: ImageDataPixelFormat, values: number[], premultipliedAlpha = false): BitmapData {
  const ArrayClass = pixelFormat === 'rgba-unorm8' ? env.realm.Uint8ClampedArray : env.realm.Float16Array!;
  return new BitmapData({
    bytes: getBufferSourceCopy(new ArrayClass(values)), width: values.length / 4, height: 1,
    pixelFormat, colorSpace: 'display-p3-linear', originClean: false, premultipliedAlpha,
  });
}

function halfComponents(bitmap: BitmapData, env: BrowletEnvironment): number[] {
  const aligned = getBufferSourceCopy(bitmap.bytes);
  return Array.from(new env.realm.Float16Array!(aligned.buffer));
}
