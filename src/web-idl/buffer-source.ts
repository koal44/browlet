import * as JSEngine from '../js-engine/index';
import {
  hasExtendedAttribute, type BufferTypeName, type BufferViewTypeName,
  type ExtendedAttribute,
} from './declaration/definition';
import type { WebIDLRealmHost } from './javascript-realm';
import { TypeError } from '../js-engine/simple-exception';

export function convertBufferSourceToIDL(
  value: unknown,
  name: BufferTypeName,
  extendedAttributes: ExtendedAttribute[],
): object {
  if (!JSEngine.isObject(value) || getBufferTypeName(value) !== name) {
    throw new TypeError(`Value is not a ${name}`);
  }

  const allowResizable = hasExtendedAttribute(
    extendedAttributes,
    'AllowResizable',
  );
  if (isBufferViewTypeName(name)) {
    const buffer = JSEngine.getArrayBufferViewBuffer(value);
    if (
      JSEngine.getBufferTypeName(buffer) === 'SharedArrayBuffer' &&
      !hasExtendedAttribute(extendedAttributes, 'AllowShared')
    ) {
      throw new TypeError(`${name} is backed by a SharedArrayBuffer`);
    }
    if (!allowResizable && JSEngine.isResizableArrayBuffer(buffer)) {
      throw new TypeError(`${name} is backed by a resizable buffer`);
    }
  } else if (!allowResizable && JSEngine.isResizableArrayBuffer(value)) {
    throw new TypeError(`${name} is resizable`);
  }
  return value;
}

export function convertBufferSourceToJavaScript(
  value: unknown,
  name: BufferTypeName,
): object {
  if (!JSEngine.isObject(value) || getBufferTypeName(value) !== name) {
    throw new Error(`IDL ${name} value has the wrong buffer source type`);
  }
  return value;
}

export function createArrayBuffer(
  bytes: ByteSequence,
  realm: WebIDLRealmHost,
  maxByteLength?: number,
): ArrayBuffer {
  const buffer = Reflect.construct(
    realm.intrinsics.bufferSource.arrayBuffer,
    maxByteLength === undefined
      ? [bytes.length]
      : [bytes.length, { maxByteLength }],
  );
  writeArrayBuffer(buffer, bytes);
  return buffer;
}

export function createSharedArrayBuffer(
  bytes: ByteSequence,
  realm: WebIDLRealmHost,
  maxByteLength?: number,
): SharedArrayBuffer {
  const constructor = realm.intrinsics.bufferSource.sharedArrayBuffer;
  if (!constructor) {
    throw new Error('The target realm has no SharedArrayBuffer intrinsic');
  }
  const buffer = Reflect.construct(
    constructor,
    maxByteLength === undefined
      ? [bytes.length]
      : [bytes.length, { maxByteLength }],
  );
  writeArrayBuffer(buffer, bytes);
  return buffer;
}

export function createArrayBufferView(
  name: BufferViewTypeName,
  bytes: ByteSequence,
  realm: WebIDLRealmHost,
): ArrayBufferView {
  const elementSize = JSEngine.getArrayBufferViewElementSize(name);
  if (name !== 'DataView' && bytes.length % elementSize !== 0) {
    throw new Error(`${name} byte length is not a multiple of ${elementSize}`);
  }
  return createArrayBufferViewFromBuffer(
    name,
    createArrayBuffer(bytes, realm),
    0,
    bytes.length,
    name === 'DataView' ? undefined : bytes.length / elementSize,
    realm,
  );
}

export function createArrayBufferViewFromBuffer(
  name: BufferViewTypeName,
  buffer: object,
  byteOffset: number,
  byteLength: number | 'auto',
  arrayLength: number | 'auto' | undefined,
  realm: WebIDLRealmHost,
): ArrayBufferView {
  const constructor = realm.intrinsics.bufferSource.views[name];
  if (!constructor) {
    throw new Error(`The target realm has no ${name} intrinsic`);
  }
  if (name === 'DataView') {
    return Reflect.construct(
      constructor,
      byteLength === 'auto'
        ? [buffer, byteOffset]
        : [buffer, byteOffset, byteLength],
    ) as ArrayBufferView;
  }
  if (arrayLength === undefined) {
    throw new Error(`${name} has no serialized array length`);
  }
  return Reflect.construct(
    constructor,
    arrayLength === 'auto'
      ? [buffer, byteOffset]
      : [buffer, byteOffset, arrayLength],
  ) as ArrayBufferView;
}

export function getBufferSourceCopy(value: object): Uint8Array {
  const buffer = getBufferSourceUnderlyingBuffer(value);
  if (JSEngine.isDetachedArrayBuffer(buffer)) return new Uint8Array();
  const offset = getBufferSourceByteOffset(value);
  const length = getBufferSourceByteLength(value);
  return Uint8Array.from(new Uint8Array(
    buffer as ArrayBufferLike,
    offset,
    length,
  ));
}

export function getBufferSourceByteLength(value: object): number {
  const name = requireBufferTypeName(value);
  return isBufferViewTypeName(name)
    ? JSEngine.getArrayBufferViewByteLength(value)
    : JSEngine.getArrayBufferByteLength(value);
}

export function getBufferSourceUnderlyingBuffer(value: object): object {
  const name = requireBufferTypeName(value);
  return isBufferViewTypeName(name)
    ? JSEngine.getArrayBufferViewBuffer(value)
    : value;
}

export function writeArrayBuffer(
  buffer: object,
  bytes: ByteSequence,
  startingOffset = 0,
): void {
  const name = requireBufferTypeName(buffer);
  if (name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer') {
    throw new Error(`${name} is not a buffer type`);
  }
  assertWriteRange(
    bytes.length,
    getBufferSourceByteLength(buffer),
    startingOffset,
  );
  new Uint8Array(
    buffer as ArrayBufferLike,
    startingOffset,
    bytes.length,
  ).set(bytes);
}

export function writeArrayBufferView(
  view: object,
  bytes: ByteSequence,
  startingOffset = 0,
): void {
  const name = requireBufferTypeName(view);
  if (!isBufferViewTypeName(name)) {
    throw new Error(`${name} is not a buffer view type`);
  }
  const elementSize = JSEngine.getArrayBufferViewElementSize(name);
  if (name !== 'DataView' && bytes.length % elementSize !== 0) {
    throw new Error(`${name} byte length is not a multiple of ${elementSize}`);
  }
  assertWriteRange(
    bytes.length,
    getBufferSourceByteLength(view),
    startingOffset,
  );
  writeArrayBuffer(
    getBufferSourceUnderlyingBuffer(view),
    bytes,
    getBufferSourceByteOffset(view) + startingOffset,
  );
}

export function detachArrayBuffer(
  buffer: object,
  realm: WebIDLRealmHost,
): void {
  if (getBufferTypeName(buffer) !== 'ArrayBuffer') {
    throw new Error('Only an ArrayBuffer can be detached');
  }
  if (JSEngine.isDetachedArrayBuffer(buffer)) return;
  Reflect.apply(
    realm.intrinsics.bufferSource.arrayBufferTransfer,
    buffer,
    [0],
  );
}

export function isBufferSourceDetached(value: object): boolean {
  return JSEngine.isDetachedArrayBuffer(
    getBufferSourceUnderlyingBuffer(value),
  );
}

// TODO(Web IDL BufferSource/transferable): JavaScript exposes no
// non-destructive test for [[ArrayBufferDetachKey]]. Add a host capability
// before exposing that predicate; the transfer operation remains authoritative.
// SPEC_MISMATCH: TransferArrayBuffer(O) -> ArrayBuffer
export function transferArrayBuffer(
  buffer: object,
  targetRealm: WebIDLRealmHost,
): object {
  if (getBufferTypeName(buffer) !== 'ArrayBuffer') {
    throw new Error('Only an ArrayBuffer can be transferred');
  }
  if (JSEngine.isDetachedArrayBuffer(buffer)) {
    throw new targetRealm.intrinsics.typeError('ArrayBuffer is detached');
  }
  return Reflect.apply(
    targetRealm.intrinsics.bufferSource.arrayBufferTransfer,
    buffer,
    [],
  ) as object;
}

export type ByteSequence = Uint8Array | readonly number[];

export function getBufferTypeName(value: object): BufferTypeName | undefined {
  return JSEngine.getBufferTypeName(value);
}

export function getBufferSourceByteOffset(value: object): number {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name)) return 0;
  return JSEngine.getArrayBufferViewByteOffset(value);
}

function requireBufferTypeName(value: object): BufferTypeName {
  const name = getBufferTypeName(value);
  if (!name) throw new Error('Value is not a buffer source type');
  return name;
}

function assertWriteRange(
  byteCount: number,
  byteLength: number,
  startingOffset: number,
): void {
  if (
    !Number.isInteger(startingOffset) ||
    startingOffset < 0 ||
    byteCount > byteLength - startingOffset
  ) {
    throw new Error('Buffer source write exceeds the available byte range');
  }
}

function isBufferViewTypeName(name: BufferTypeName): name is BufferViewTypeName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}
