import { InternalError } from '../infra/index';
import { getArrayBufferViewByteLength, getBufferViewTypeName, type JSEnvironment } from '../js-engine/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface, defineTypedef, dictMember,
  DOMExceptionImpl, DOMExceptionNames, emptyDictionary, idlType, impl, implementationType,
  reference, roAttr, union, xattr, type SerialSteps,
} from '../web-idl/core/index';

/** Rectangular RGBA storage with explicit pixel format and color-space metadata. */
// https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#the-imagedata-interface
export class ImageDataImpl {
  /** Owner of fresh pixel arrays and allocation failures. */
  env: JSEnvironment;
  /** Initialized by a constructor algorithm or structured deserialization before exposure. */
  data!: ImageDataArray;
  width!: number;
  height!: number;
  pixelFormat!: ImageDataPixelFormat;
  colorSpace!: PredefinedColorSpace;

  /** Allocate implementation identity; construction/deserialization supplies the bitmap state. */
  constructor(env: JSEnvironment) {
    this.env = env;
  }

  /** Create transparent black pixels in the constructor's realm. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagedata
  static create(sw: number, sh: number, settings: ImageDataSettings, env: JSEnvironment): ImageDataImpl {
    if (sw === 0 || sh === 0) throw new DOMExceptionImpl('ImageData dimensions must be nonzero', DOMExceptionNames.indexSize);
    const image = new ImageDataImpl(env);
    image.initialize(sw, sh, settings);
    return image;
  }

  /** Validate the supplied view's dimensions and retain the view itself. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagedata-with-data
  static createWithData(
    data: ImageDataArray, sw: number, sh: number | undefined, settings: ImageDataSettings, env: JSEnvironment,
  ): ImageDataImpl {
    const bytesPerPixel = settings.pixelFormat === 'rgba-unorm8' ? 4 : 8;
    const byteLength = getArrayBufferViewByteLength(data);
    // SPEC_CLASH(imagedata-validation-order): Follow HTML/Firefox/WebKit's byte-length check before dimensions; Chromium checks zero width first.
    if (byteLength === 0 || byteLength % bytesPerPixel !== 0) {
      throw new DOMExceptionImpl('ImageData requires a nonempty whole number of pixels', DOMExceptionNames.invalidState);
    }
    const pixels = byteLength / bytesPerPixel;
    if (sw === 0 || pixels % sw !== 0) {
      throw new DOMExceptionImpl('ImageData width does not divide its pixel count', DOMExceptionNames.indexSize);
    }
    const height = pixels / sw;
    if (sh !== undefined && sh !== height) {
      throw new DOMExceptionImpl('ImageData height does not match its pixel count', DOMExceptionNames.indexSize);
    }
    const image = new ImageDataImpl(env);
    // SPEC_CLASH(imagedata-inferred-height): Use the computed height as all browsers do; HTML passes the possibly omitted sh.
    image.initialize(sw, height, settings, data);
    return image;
  }

  /** Initialize already validated positive dimensions, optionally using an existing pixel view. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#initialize-an-imagedata-object
  initialize(
    pixelsPerRow: number, rows: number, settings: ImageDataSettings,
    source?: ImageDataArray, defaultColorSpace?: PredefinedColorSpace,
  ): void {
    const unorm8 = settings.pixelFormat === 'rgba-unorm8';
    if (source !== undefined) {
      if (getBufferViewTypeName(source) !== (unorm8 ? 'Uint8ClampedArray' : 'Float16Array')) {
        throw new DOMExceptionImpl('ImageData pixel format does not match its typed array', DOMExceptionNames.invalidState);
      }
      // SPEC_CLASH(imagedata-array-identity): Follow HTML/Chromium/Firefox's exact view identity; WebKit creates another view.
      this.data = source;
    } else if (unorm8) {
      this.data = new this.env.realm.Uint8ClampedArray(4 * rows * pixelsPerRow);
    } else {
      const Float16Array = this.env.realm.Float16Array;
      // The JS engine owns this intrinsic; a host without it cannot supply half-float pixels.
      if (!Float16Array) throw new InternalError('ImageData float16 allocation requires the realm Float16Array intrinsic');
      this.data = new Float16Array(4 * rows * pixelsPerRow);
    }
    this.width = pixelsPerRow;
    this.height = rows;
    this.pixelFormat = settings.pixelFormat;
    this.colorSpace = settings.colorSpace ?? defaultColorSpace ?? 'srgb';
  }
}

export type ImageDataArray = Uint8ClampedArray<ArrayBuffer> | Float16Array<ArrayBuffer>;
export type ImageDataPixelFormat = 'rgba-unorm8' | 'rgba-float16';

/** Converted ImageData settings; omitted color space uses the initializer's default. */
export interface ImageDataSettings {
  colorSpace?: PredefinedColorSpace;
  pixelFormat: ImageDataPixelFormat;
}

/** HTML canvas/image color-space labels; labeling pixels does not convert their values. */
export type PredefinedColorSpace = 'srgb' | 'srgb-linear' | 'display-p3' | 'display-p3-linear';

// https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagedata
const imageDataSerialSteps = {
  serializationSteps(value, serialized, _forStorage, context) {
    // SPEC_CLASH(imagedata-clone-aliases): Follow HTML/Firefox's sub-serialization memory; Chromium/WebKit copy pixels separately.
    serialized.fields.Data = context.subserialize(value.data);
    serialized.fields.Width = value.width;
    serialized.fields.Height = value.height;
    serialized.fields.ColorSpace = value.colorSpace;
    serialized.fields.PixelFormat = value.pixelFormat;
  },
  deserializationSteps(serialized, value, _targetRealm, context) {
    value.data = context.subdeserialize(serialized.fields.Data) as ImageDataArray;
    value.width = serialized.fields.Width;
    value.height = serialized.fields.Height;
    value.colorSpace = serialized.fields.ColorSpace;
    value.pixelFormat = serialized.fields.PixelFormat;
  },
} satisfies SerialSteps<ImageDataImpl, {
  Data: object; Width: number; Height: number; ColorSpace: PredefinedColorSpace; PixelFormat: ImageDataPixelFormat;
}>;

export const imageDataArrayIDL = defineTypedef({
  name: 'ImageDataArray', type: union(idlType.Uint8ClampedArray, idlType.Float16Array),
});

// SPEC_CLASH(imagedata-formats): Follow current HTML; Firefox/WebKit lack parts of the pixel-format/color-space surface.
export const imageDataPixelFormatIDL = defineEnumeration({
  name: 'ImageDataPixelFormat', values: ['rgba-unorm8', 'rgba-float16'],
});

// https://html.spec.whatwg.org/multipage/canvas.html#predefinedcolorspace
// SPEC_CLASH(imagedata-color-spaces): Include HTML's linear spaces; Chromium rejects them and Firefox/WebKit lack the full settings model.
export const predefinedColorSpaceIDL = defineEnumeration({
  name: 'PredefinedColorSpace', values: ['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'],
});

export const imageDataSettingsIDL = defineDictionary({
  name: 'ImageDataSettings',
  members: [
    dictMember('colorSpace', reference('PredefinedColorSpace')),
    dictMember('pixelFormat', reference('ImageDataPixelFormat'), { default: 'rgba-unorm8' }),
  ],
});

export const imageDataIDL = defineInterface<JSEnvironment>({
  name: 'ImageData', exposed: ['Window', 'Worker'], ...xattr('Serializable'),
  implementation: impl(ImageDataImpl, { constructWith: [atArg(0, (env) => env)] }),
  serialSteps: imageDataSerialSteps,
  members: [
    ctor(
      [arg('sw', idlType.unsignedLong), arg('sh', idlType.unsignedLong),
        arg('settings', implementationType<ImageDataSettings>(reference('ImageDataSettings')), { optional: true, default: emptyDictionary })],
      { overrideConstruct({ relevant: env }, sw, sh, settings) { return ImageDataImpl.create(sw, sh, settings, env); } },
    ),
    ctor(
      [arg('data', implementationType<ImageDataArray>(reference('ImageDataArray'))), arg('sw', idlType.unsignedLong),
        arg('sh', idlType.unsignedLong, { optional: true }),
        arg('settings', implementationType<ImageDataSettings>(reference('ImageDataSettings')), { optional: true, default: emptyDictionary })],
      { overrideConstruct({ relevant: env }, data, sw, sh, settings) { return ImageDataImpl.createWithData(data, sw, sh, settings, env); } },
    ),
    roAttr('width', idlType.unsignedLong), roAttr('height', idlType.unsignedLong),
    roAttr('data', reference('ImageDataArray')), roAttr('pixelFormat', reference('ImageDataPixelFormat')),
    roAttr('colorSpace', reference('PredefinedColorSpace')),
  ],
});
