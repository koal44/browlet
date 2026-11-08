import { InternalError } from '../infra/index';
import { getBufferSourceView, type JSEnvironment } from '../js-engine/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../web-idl/core/index';
import type { MIMEType } from '../mime/index';

import type { ImageBitmapCrop, ImageBitmapOptions, ResizeQuality } from './image-bitmap';
import type { ImageDataPixelFormat, PredefinedColorSpace } from './image-data';

/**
 * Tightly packed RGBA pixels and their formatting operations, without a retained realm or backend.
 * A source view may borrow pixels for synchronous preparation; create() and crop() return independent storage.
 * Producers supply positive dimensions and exactly width * height * bytes-per-pixel bytes.
 */
export class BitmapData {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  pixelFormat: ImageDataPixelFormat;
  colorSpace: PredefinedColorSpace;
  premultipliedAlpha: boolean;
  originClean: boolean;

  /** Adopt the supplied storage without copying or interpreting its component bits. */
  constructor(data: BitmapDataRecord) {
    this.bytes = data.bytes;
    this.width = data.width;
    this.height = data.height;
    this.pixelFormat = data.pixelFormat;
    this.colorSpace = data.colorSpace;
    this.premultipliedAlpha = data.premultipliedAlpha;
    this.originClean = data.originClean;
  }

  /**
   * Prepare independent pixels from an already converted in-memory source and options.
   * This extracts createImageBitmap's source preparation and formatting steps; its caller still
   * owns source-union conversion, Promise rejection, and bitmap-task delivery.
   * Crop coordinates are converted Web IDL longs; omitting the record selects the full source.
   */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#cropped-to-the-source-rectangle-with-formatting
  static create(
    source: BitmapDataSource, options: ImageBitmapOptions, crop: ImageBitmapCrop | undefined, env: JSEnvironment,
  ): BitmapData {
    BitmapData.validateDimensions(options, crop, env);
    const input = source.prepareBitmapData();
    const { sx, sy, sw, sh } = crop ?? { sx: 0, sy: 0, sw: input.width, sh: input.height };
    const width = Math.abs(sw);
    const height = Math.abs(sh);
    const outputWidth = options.resizeWidth ??
      (options.resizeHeight === undefined ? width : Math.ceil(width * options.resizeHeight / height));
    const outputHeight = options.resizeHeight ??
      (options.resizeWidth === undefined ? height : Math.ceil(height * options.resizeWidth / width));

    let output = input.crop(Math.min(sx, sx + sw), Math.min(sy, sy + sh), width, height, env);
    if (outputWidth !== width || outputHeight !== height) {
      output = output.resize(outputWidth, outputHeight, options.resizeQuality, env);
    }
    if (options.imageOrientation === 'flipY') output.flipY();

    // HTML applies colorSpaceConversion only to image elements and Blobs, not these in-memory sources.
    // SPEC_CLASH(imagebitmap-default-alpha): Preserve source alpha by default, as Gecko does for ImageData; Blink selects premultiplication. HTML permits either policy.
    const premultipliedAlpha = options.premultiplyAlpha === 'default'
      ? output.premultipliedAlpha : options.premultiplyAlpha === 'premultiply';
    if (premultipliedAlpha !== output.premultipliedAlpha) {
      output = output.convertAlpha(premultipliedAlpha, env);
    }
    return output;
  }

  /**
   * Decode a complete image byte sequence and return independently owned, formatted pixels.
   * mimeType is the image-context sniffing result; undefined means no type was identified.
   * Unsupported/corrupt data or unavailable natural dimensions must fail with InvalidStateError.
   */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
  static decode(
    bytes: Uint8Array, _mimeType: MIMEType | undefined, options: ImageBitmapOptions,
    crop: ImageBitmapCrop | undefined, env: JSEnvironment,
  ): BitmapData {
    BitmapData.validateDimensions(options, crop, env);
    if (bytes.byteLength === 0) throw new DOMExceptionImpl('An empty Blob is not an image', DOMExceptionNames.invalidState);
    // TODO(HTML §8.11.2, Blob source): Select a supported codec and the default animation image
    // (or first frame), obtain natural dimensions, and apply source orientation, crop, resize,
    // imageOrientation, colorSpaceConversion, and alpha formatting. Return origin-clean pixels
    // with storage allocated through env.realm. A format signature alone is not successful decoding.
    throw new InternalError('Image decoding and encoded-image formatting are not implemented (HTML §8.11.2)');
  }

  /** Validate converted dimensions before accessing any source or starting a Blob read. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
  static validateDimensions(options: ImageBitmapOptions, crop: ImageBitmapCrop | undefined, env: JSEnvironment): void {
    if (crop && (crop.sw === 0 || crop.sh === 0)) throw new env.realm.RangeError('ImageBitmap crop dimensions must be nonzero');
    if (options.resizeWidth === 0 || options.resizeHeight === 0) {
      throw new DOMExceptionImpl('ImageBitmap resize dimensions must be nonzero', DOMExceptionNames.invalidState);
    }
  }

  /** Produce plain transportable state, retaining the pixel storage; cloning must copy those bytes. */
  toRecord(): BitmapDataRecord {
    return {
      bytes: this.bytes, width: this.width, height: this.height, pixelFormat: this.pixelFormat,
      colorSpace: this.colorSpace, premultipliedAlpha: this.premultipliedAlpha, originClean: this.originClean,
    };
  }

  /** Copy the intersecting rows into an otherwise transparent-black rectangle. */
  crop(left: number, top: number, width: number, height: number, env: JSEnvironment): BitmapData {
    const bytesPerPixel = this.pixelFormat === 'rgba-unorm8' ? 4 : 8;
    // Use intrinsic-backed byte views, so author changes to a typed-array prototype cannot enter copying.
    const bytes = new Uint8Array(new env.realm.ArrayBuffer(width * height * bytesPerPixel));
    const sourceBytes = getBufferSourceView(this.bytes);
    // SPEC_CLASH(imagebitmap-crop-padding): Follow HTML/Chromium/Firefox's requested dimensions and transparent padding; WebKit clips to the source or returns 1x1 when disjoint.
    const startX = Math.max(0, left);
    const endX = Math.min(this.width, left + width);
    const startY = Math.max(0, top);
    const endY = Math.min(this.height, top + height);
    if (startX < endX) {
      const rowByteLength = (endX - startX) * bytesPerPixel;
      for (let y = startY; y < endY; y++) {
        const from = (y * this.width + startX) * bytesPerPixel;
        const to = ((y - top) * width + startX - left) * bytesPerPixel;
        bytes.set(sourceBytes.subarray(from, from + rowByteLength), to);
      }
    }
    return new BitmapData({ ...this.toRecord(), bytes, width, height });
  }

  /** Reverse rows in independently owned storage, including transparent padding. */
  flipY(): void {
    const stride = this.width * (this.pixelFormat === 'rgba-unorm8' ? 4 : 8);
    const bytes = getBufferSourceView(this.bytes);
    const row = new Uint8Array(stride);
    for (let top = 0, bottom = (this.height - 1) * stride; top < bottom; top += stride, bottom -= stride) {
      row.set(bytes.subarray(top, top + stride));
      bytes.copyWithin(top, bottom, bottom + stride);
      bytes.set(row, bottom);
    }
  }

  /**
   * Resize to positive integer dimensions in independent storage, retaining the source's pixel metadata.
   * Unchanged dimensions return this bitmap without filtering or reallocating.
   */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-resizequality-pixelated
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-resizequality-low
  resize(width: number, height: number, quality: ResizeQuality, env: JSEnvironment): BitmapData {
    if (width === this.width && height === this.height) return this;
    if (quality === 'medium' || quality === 'high') return this.#resizeFiltered(width, height, quality, env);
    const pixelated = quality === 'pixelated';

    const unorm8 = this.pixelFormat === 'rgba-unorm8';
    const bytesPerComponent = unorm8 ? 1 : 2;
    const bytesPerPixel = 4 * bytesPerComponent;
    const ArrayClass = unorm8 ? env.realm.Uint8ClampedArray : env.realm.Float16Array;
    if (!ArrayClass) throw new InternalError('ImageBitmap resizing requires the realm Float16Array intrinsic');
    const sourceBytes = getBufferSourceView(this.bytes);
    const componentBytes = unorm8 || sourceBytes.byteOffset % 2 === 0 ? sourceBytes : sourceBytes.slice();
    const source = new ArrayClass(
      componentBytes.buffer as ArrayBuffer, componentBytes.byteOffset, componentBytes.byteLength / bytesPerComponent,
    );
    const bytes = new Uint8Array(new env.realm.ArrayBuffer(width * height * bytesPerPixel));
    const target = new ArrayClass(bytes.buffer);

    // SPEC_CLASH(imagebitmap-pixelated-resize): Follow HTML's integer enlargement then bilinear scaling; Chromium/Firefox/WebKit use direct nearest-neighbor scaling.
    // SPEC_GAP(imagebitmap-resize-sampling): Choose the larger integer multiple on a tie; sample pixel centers and clamp at the image edges.
    const multipleX = pixelated ? Math.max(1, Math.round(width / this.width)) : 1;
    const multipleY = pixelated ? Math.max(1, Math.round(height / this.height)) : 1;
    const enlargedWidth = this.width * multipleX;
    const enlargedHeight = this.height * multipleY;
    const scaleX = enlargedWidth / width;
    const scaleY = enlargedHeight / height;
    // Keep zero-weight non-finite neighbors out of the result, and round only when storing it.
    const interpolate = (first: number, second: number, weight: number): number =>
      weight === 0 ? first : weight === 1 ? second : first * (1 - weight) + second * weight;

    // Address the conceptual nearest-neighbor enlargement directly instead of allocating it.
    for (let y = 0; y < height; y++) {
      const sourceY = Math.max(0, Math.min(enlargedHeight - 1, (y + 0.5) * scaleY - 0.5));
      const top = Math.floor(sourceY / multipleY);
      const bottom = Math.floor(Math.ceil(sourceY) / multipleY);
      const weightY = sourceY - Math.floor(sourceY);
      for (let x = 0; x < width; x++) {
        const sourceX = Math.max(0, Math.min(enlargedWidth - 1, (x + 0.5) * scaleX - 0.5));
        const left = Math.floor(sourceX / multipleX);
        const right = Math.floor(Math.ceil(sourceX) / multipleX);
        const weightX = sourceX - Math.floor(sourceX);
        const topLeft = (top * this.width + left) * 4;
        const topRight = (top * this.width + right) * 4;
        const bottomLeft = (bottom * this.width + left) * 4;
        const bottomRight = (bottom * this.width + right) * 4;
        const to = (y * width + x) * 4;
        if (left === right && top === bottom) {
          // Exact copies retain all component bits, including half-float NaN payloads and signed zeros.
          const sourceByte = topLeft * bytesPerComponent;
          const targetByte = to * bytesPerComponent;
          for (let byte = 0; byte < bytesPerPixel; byte++) bytes[targetByte + byte] = sourceBytes[sourceByte + byte]!;
          continue;
        }
        // SPEC_CLASH(imagebitmap-resize-components): Interpolate stored RGBA as Chromium/Firefox do, unlike WebKit's transparent-color result; retain nearest-even byte rounding instead of browsers' upward midpoint rounding.
        for (let component = 0; component < 4; component++) {
          const upper = interpolate(source[topLeft + component]!, source[topRight + component]!, weightX);
          const lower = interpolate(source[bottomLeft + component]!, source[bottomRight + component]!, weightX);
          target[to + component] = interpolate(upper, lower, weightY);
        }
      }
    }
    return new BitmapData({ ...this.toRecord(), bytes, width, height });
  }

  /** Convert independently owned pixels in place, preserving alpha bits and image metadata. */
  // https://html.spec.whatwg.org/multipage/canvas.html#premultiplied-alpha-and-the-2d-rendering-context
  convertAlpha(premultipliedAlpha: boolean, env: JSEnvironment): BitmapData {
    if (premultipliedAlpha === this.premultipliedAlpha) return this;

    const unorm8 = this.pixelFormat === 'rgba-unorm8';
    const ArrayClass = unorm8 ? env.realm.Uint8ClampedArray : env.realm.Float16Array;
    if (!ArrayClass) throw new InternalError('The active JavaScript engine does not support Float16Array');
    const bytes = getBufferSourceView(this.bytes);
    // A transported byte view need not have the alignment required by Float16Array.
    const componentBytes = unorm8 || bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
    const componentCount = componentBytes.byteLength / (unorm8 ? 1 : 2);
    const components = new ArrayClass(componentBytes.buffer as ArrayBuffer, componentBytes.byteOffset, componentCount);
    const alphaScale = unorm8 ? 255 : 1;
    const convert = premultipliedAlpha
      ? (component: number, alpha: number) => component * alpha / alphaScale
      : (component: number, alpha: number) => component * alphaScale / alpha;

    // SPEC_CLASH(imagebitmap-alpha-rounding): Use Uint8ClampedArray's nearest-even rounding, matching Chromium; Firefox/WebKit differ on some byte components.
    // SPEC_GAP(imagebitmap-alpha-conversion): HTML leaves zero-alpha and half-float normalization unspecified. Zero RGB at zero alpha; otherwise use stored values and Float16Array rounding without extra clamping.
    for (let index = 0; index < componentCount; index += 4) {
      const alpha = components[index + 3]!;
      if (alpha === alphaScale) continue;
      if (alpha === 0) {
        components[index] = 0;
        components[index + 1] = 0;
        components[index + 2] = 0;
      } else {
        components[index] = convert(components[index]!, alpha);
        components[index + 1] = convert(components[index + 1]!, alpha);
        components[index + 2] = convert(components[index + 2]!, alpha);
      }
    }
    if (componentBytes !== bytes) bytes.set(componentBytes);
    this.premultipliedAlpha = premultipliedAlpha;
    return this;
  }

  /** Sample normalized reconstruction filters, widening their footprints for reductions. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-resizequality-medium
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-resizequality-high
  #resizeFiltered(width: number, height: number, quality: 'medium' | 'high', env: JSEnvironment): BitmapData {
    const unorm8 = this.pixelFormat === 'rgba-unorm8';
    const bytesPerComponent = unorm8 ? 1 : 2;
    const bytesPerPixel = 4 * bytesPerComponent;
    const ArrayClass = unorm8 ? env.realm.Uint8ClampedArray : env.realm.Float16Array;
    if (!ArrayClass) throw new InternalError('ImageBitmap resizing requires the realm Float16Array intrinsic');
    const sourceBytes = getBufferSourceView(this.bytes);
    const componentBytes = unorm8 || sourceBytes.byteOffset % 2 === 0 ? sourceBytes : sourceBytes.slice();
    const source = new ArrayClass(
      componentBytes.buffer as ArrayBuffer, componentBytes.byteOffset, componentBytes.byteLength / bytesPerComponent,
    );
    const bytes = new Uint8Array(new env.realm.ArrayBuffer(width * height * bytesPerPixel));
    const target = new ArrayClass(bytes.buffer);

    // SPEC_GAP(imagebitmap-quality-filters): HTML leaves these filters open; use triangle for medium and Catmull-Rom for high, widening both when shrinking.
    // SPEC_CLASH(imagebitmap-quality-resize): Browser reduction kernels/footprints differ; retain normalized, widened filters with clamped edge samples.
    const cubic = quality === 'high';
    const horizontal = createResizeWeights(this.width, width, cubic);
    const vertical = createResizeWeights(this.height, height, cubic);
    for (let y = 0; y < height; y++) {
      const rows = vertical[y]!;
      for (let x = 0; x < width; x++) {
        const columns = horizontal[x]!;
        const to = (y * width + x) * 4;
        if (rows.weights.length === 1 && columns.weights.length === 1) {
          const fromByte = (rows.start * this.width + columns.start) * bytesPerPixel;
          const toByte = to * bytesPerComponent;
          for (let byte = 0; byte < bytesPerPixel; byte++) bytes[toByte + byte] = sourceBytes[fromByte + byte]!;
          continue;
        }
        // SPEC_GAP(imagebitmap-cubic-range): Filter stored RGBA without extra normalization; byte storage clamps overshoot, while half-floats retain it in RGB and alpha.
        for (let component = 0; component < 4; component++) {
          let value: number | undefined;
          for (let row = 0; row < rows.weights.length; row++) {
            const rowWeight = rows.weights[row]!;
            if (rowWeight === 0) continue;
            const from = ((rows.start + row) * this.width + columns.start) * 4 + component;
            for (let column = 0; column < columns.weights.length; column++) {
              const weight = rowWeight * columns.weights[column]!;
              if (weight === 0) continue;
              const contribution = source[from + column * 4]! * weight;
              value = value === undefined ? contribution : value + contribution;
            }
          }
          target[to + component] = value!;
        }
      }
    }
    return new BitmapData({ ...this.toRecord(), bytes, width, height });
  }
}

/** A validated in-memory pixel source; the returned view is borrowed only until synchronous preparation ends. */
export interface BitmapDataSource {
  prepareBitmapData(): BitmapData;
}

/** Plain bitmap state for construction and serialization; no prototype, realm, or backend is required. */
export interface BitmapDataRecord {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  pixelFormat: ImageDataPixelFormat;
  colorSpace: PredefinedColorSpace;
  premultipliedAlpha: boolean;
  originClean: boolean;
}

interface ResizeWeights {
  start: number;
  weights: number[];
}

/** Precompute one axis's normalized weights, combining samples clamped to the same edge pixel. */
// Implementation helper for the approved filters above; HTML does not define a weight-generation algorithm.
function createResizeWeights(sourceSize: number, targetSize: number, cubic: boolean): ResizeWeights[] {
  const ratio = sourceSize / targetSize;
  const scale = Math.max(1, ratio);
  const radius = (cubic ? 2 : 1) * scale;
  // Catmull-Rom cubic convolution has B = 0 and C = 1/2.
  const filter = cubic ? (distance: number): number => {
    const x = Math.abs(distance);
    if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
    if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
    return 0;
  } : (distance: number): number => Math.max(0, 1 - Math.abs(distance));

  return Array.from({ length: targetSize }, (_, position) => {
    const center = (position + 0.5) * ratio - 0.5;
    const left = Math.ceil(center - radius);
    const right = Math.floor(center + radius);
    const start = Math.max(0, left);
    const end = Math.min(sourceSize - 1, right);
    const weights = new Array<number>(end - start + 1).fill(0);
    let total = 0;
    for (let sample = left; sample <= right; sample++) {
      const weight = filter((sample - center) / scale);
      const index = Math.max(0, Math.min(sourceSize - 1, sample)) - start;
      weights[index] = weights[index]! + weight;
      total += weight;
    }
    // Discard zero-only edges so a single contributing pixel can be copied bit-for-bit.
    let first = 0;
    let last = weights.length;
    while (first < last && weights[first] === 0) first++;
    while (last > first && weights[last - 1] === 0) last--;
    const normalized = weights.slice(first, last);
    for (let index = 0; index < normalized.length; index++) normalized[index] = normalized[index]! / total;
    return { start: start + first, weights: normalized };
  });
}
