import { getBufferSourceCopy, type JSEnvironment } from '../js-engine/index';
import {
  atArg, defineDictionary, defineEnumeration, defineInterface, dictMember,
  DOMExceptionImpl, DOMExceptionNames, idlType, impl, op, reference, roAttr, xattr,
  type SerialSteps, type StructuredData, type TransferSteps,
} from '../web-idl/core/index';

import { BitmapData, type BitmapDataRecord, type BitmapDataSource } from './bitmap-data';

/** An owned bitmap whose pixels can be copied, moved, or released independently of its source. */
// https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#the-imagebitmap-interface
export class ImageBitmapImpl implements BitmapDataSource {
  env: JSEnvironment;
  /** Null after close/transfer, or during internal allocation before receiving pixels. */
  #bitmapData: BitmapData | null = null;

  /** Internal allocation for creation or structured deserialization; there is no author constructor. */
  constructor(env: JSEnvironment) {
    this.env = env;
  }

  /** Take ownership of prepared bitmap data; the producer must stop retaining mutable aliases. */
  static create(bitmapData: BitmapData, env: JSEnvironment): ImageBitmapImpl {
    const image = new ImageBitmapImpl(env);
    image.#bitmapData = bitmapData;
    return image;
  }

  /** Snapshot the complete pixel representation after the origin-clean and lifetime checks. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmap
  static serializationSteps(this: void, value: ImageBitmapImpl, serialized: StructuredData<ImageBitmapFields>): void {
    const bitmapData = value.#requireSerializableBitmap();
    // SPEC_CLASH(imagebitmap-clone-identity): HTML's enclosing serialization memory preserves aliases, as Chromium/Firefox do; WebKit duplicates repeated references.
    serialized.fields.BitmapData = { ...bitmapData.toRecord(), bytes: getBufferSourceCopy(bitmapData.bytes) };
  }

  /** Adopt the independently serialized snapshot in the receiving implementation. */
  static deserializationSteps(this: void, serialized: StructuredData<ImageBitmapFields>, value: ImageBitmapImpl): void {
    value.#bitmapData = new BitmapData(serialized.fields.BitmapData);
  }

  /** Move the backing data; HTML's enclosing transfer algorithm also marks the sender detached. */
  static transferSteps(this: void, value: ImageBitmapImpl, dataHolder: StructuredData<ImageBitmapFields>): void {
    dataHolder.fields.BitmapData = value.#requireSerializableBitmap().toRecord();
    value.#bitmapData = null;
  }

  /** Receive the moved pixels without copying them or retaining the source implementation. */
  static transferReceivingSteps(this: void, dataHolder: StructuredData<ImageBitmapFields>, value: ImageBitmapImpl): void {
    value.#bitmapData = new BitmapData(dataHolder.fields.BitmapData);
  }

  /** Internal source access; callers must handle the detached state explicitly. */
  get bitmapData(): BitmapData | null { return this.#bitmapData; }

  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagebitmap-width
  get width(): number { return this.#bitmapData?.width ?? 0; }

  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagebitmap-height
  get height(): number { return this.#bitmapData?.height ?? 0; }

  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagebitmap-close
  close(): void {
    // No bitmap data is the local detached state, for both explicit close and transfer.
    this.#bitmapData = null;
  }

  /** Validate this source and borrow its pixels for synchronous bitmap preparation. */
  // https://html.spec.whatwg.org/multipage/canvas.html#check-the-usability-of-the-image-argument
  prepareBitmapData(): BitmapData {
    if (this.#bitmapData === null) throw new DOMExceptionImpl('ImageBitmap is detached', DOMExceptionNames.invalidState);
    // Unlike cloning/transfer, creation may copy a tainted bitmap and retain its origin-clean state.
    return this.#bitmapData;
  }

  /** Shared guards for copying or moving pixels; failed checks leave the source intact. */
  #requireSerializableBitmap(): BitmapData {
    // SPEC_CLASH(imagebitmap-closed-clone): Follow HTML/Chromium/Firefox's DataCloneError; WebKit cloning throws TypeError.
    if (this.#bitmapData === null) throw new DOMExceptionImpl('ImageBitmap is detached', DOMExceptionNames.dataClone);
    if (!this.#bitmapData.originClean) throw new DOMExceptionImpl('ImageBitmap is not origin-clean', DOMExceptionNames.dataClone);
    return this.#bitmapData;
  }
}

/** The optional source rectangle from createImageBitmap's second overload. */
export interface ImageBitmapCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Post-conversion options; Web IDL supplies the four enumeration defaults. */
export interface ImageBitmapOptions {
  imageOrientation: ImageOrientation;
  premultiplyAlpha: PremultiplyAlpha;
  colorSpaceConversion: ColorSpaceConversion;
  resizeWidth?: number;
  resizeHeight?: number;
  resizeQuality: ResizeQuality;
}

export type ImageOrientation = 'from-image' | 'flipY';
export type PremultiplyAlpha = 'none' | 'premultiply' | 'default';
export type ColorSpaceConversion = 'none' | 'default';
export type ResizeQuality = 'pixelated' | 'low' | 'medium' | 'high';

type ImageBitmapFields = { BitmapData: BitmapDataRecord; };

const imageBitmapSerialSteps = {
  serializationSteps: ImageBitmapImpl.serializationSteps,
  deserializationSteps: ImageBitmapImpl.deserializationSteps,
} satisfies SerialSteps<ImageBitmapImpl, ImageBitmapFields>;

const imageBitmapTransferSteps = {
  transferSteps: ImageBitmapImpl.transferSteps,
  transferReceivingSteps: ImageBitmapImpl.transferReceivingSteps,
} satisfies TransferSteps<ImageBitmapImpl, ImageBitmapFields>;

export const imageBitmapIDL = defineInterface<JSEnvironment>({
  name: 'ImageBitmap', exposed: ['Window', 'Worker'], ...xattr('Serializable', 'Transferable'),
  implementation: impl(ImageBitmapImpl, { constructWith: [atArg(0, (env) => env)] }),
  serialSteps: imageBitmapSerialSteps,
  transferSteps: imageBitmapTransferSteps,
  members: [
    roAttr('width', idlType.unsignedLong), roAttr('height', idlType.unsignedLong),
    op('close', idlType.undefined),
  ],
});

export const imageOrientationIDL = defineEnumeration({ name: 'ImageOrientation', values: ['from-image', 'flipY'] });
export const premultiplyAlphaIDL = defineEnumeration({ name: 'PremultiplyAlpha', values: ['none', 'premultiply', 'default'] });
export const colorSpaceConversionIDL = defineEnumeration({ name: 'ColorSpaceConversion', values: ['none', 'default'] });
export const resizeQualityIDL = defineEnumeration({ name: 'ResizeQuality', values: ['pixelated', 'low', 'medium', 'high'] });

export const imageBitmapOptionsIDL = defineDictionary({
  name: 'ImageBitmapOptions',
  members: [
    dictMember('imageOrientation', reference('ImageOrientation'), { default: 'from-image' }),
    dictMember('premultiplyAlpha', reference('PremultiplyAlpha'), { default: 'default' }),
    dictMember('colorSpaceConversion', reference('ColorSpaceConversion'), { default: 'default' }),
    dictMember('resizeWidth', idlType.unsignedLong, xattr('EnforceRange')),
    dictMember('resizeHeight', idlType.unsignedLong, xattr('EnforceRange')),
    dictMember('resizeQuality', reference('ResizeQuality'), { default: 'low' }),
  ],
});
