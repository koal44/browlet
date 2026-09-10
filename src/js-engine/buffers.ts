import * as JSEngine from './array-buffer-primitives';
import type { JavaScriptBufferTypeName } from './array-buffer-primitives';
import type { JavaScriptBufferViewName, JavaScriptRealm } from './realm';

/** Realm-owned allocation for implementation producers. */
export function createRuntimeBuffers(realm: JavaScriptRealm): RuntimeBuffers {
  return {
    allocateArrayBuffer: (byteLength) => new realm.intrinsics.bufferSource.arrayBuffer(byteLength),
    createView: (name, buffer, byteOffset = 0, length) =>
      constructBufferView(name, buffer, byteOffset, length, realm),
    copyArrayBuffer: (bytes) => createArrayBuffer(bytes, realm),
    copyUint8Array: (bytes) => createArrayBufferView('Uint8Array', bytes, realm) as Uint8Array<ArrayBuffer>,
    transferArrayBuffer: (buffer) => transferArrayBuffer(buffer, realm) as ArrayBuffer,
  };
}

export type RuntimeBuffers = {
  /** Allocate zero-initialized final storage directly in the owning realm. */
  allocateArrayBuffer(byteLength: number): ArrayBuffer;
  /**
   * Share a buffer; length is elements for typed arrays and bytes for DataView.
   * Omit length to use the remaining range and track subsequent resizing.
   */
  createView<Name extends JavaScriptBufferViewName>(
    name: Name,
    buffer: ArrayBufferLike,
    byteOffset?: number,
    length?: number,
  ): JavaScriptBufferView<Name>;
  /** Copy the supplied bytes into independent storage, preserving the source. */
  copyArrayBuffer(bytes: Uint8Array): ArrayBuffer;
  copyUint8Array(bytes: Uint8Array): Uint8Array<ArrayBuffer>;
  /** Consume an exclusively owned buffer, detaching the source. */
  transferArrayBuffer(buffer: ArrayBuffer): ArrayBuffer;
};

export type JavaScriptBufferView<Name extends JavaScriptBufferViewName> =
  InstanceType<(typeof globalThis)[Name]>;

export function createArrayBuffer(
  bytes: ByteSequence,
  realm: JavaScriptRealm,
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
  realm: JavaScriptRealm,
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
  name: JavaScriptBufferViewName,
  bytes: ByteSequence,
  realm: JavaScriptRealm,
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
  name: JavaScriptBufferViewName,
  buffer: object,
  byteOffset: number,
  byteLength: number | 'auto',
  arrayLength: number | 'auto' | undefined,
  realm: JavaScriptRealm,
): ArrayBufferView {
  const length = name === 'DataView' ? byteLength : arrayLength;
  if (length === undefined) {
    throw new Error(`${name} has no serialized array length`);
  }
  return constructBufferView(
    name, buffer, byteOffset, length === 'auto' ? undefined : length, realm,
  );
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
  realm: JavaScriptRealm,
): void {
  if (JSEngine.getBufferTypeName(buffer) !== 'ArrayBuffer') {
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
  targetRealm: JavaScriptRealm,
): object {
  if (JSEngine.getBufferTypeName(buffer) !== 'ArrayBuffer') {
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

export function getBufferSourceByteOffset(value: object): number {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name)) return 0;
  return JSEngine.getArrayBufferViewByteOffset(value);
}

function constructBufferView<Name extends JavaScriptBufferViewName>(
  name: Name,
  buffer: object,
  byteOffset: number,
  length: number | undefined,
  realm: JavaScriptRealm,
): JavaScriptBufferView<Name> {
  const constructor = realm.intrinsics.bufferSource.views[name];
  if (!constructor) {
    throw new Error(`The target realm has no ${name} intrinsic`);
  }
  return Reflect.construct(
    constructor,
    length === undefined ? [buffer, byteOffset] : [buffer, byteOffset, length],
  ) as JavaScriptBufferView<Name>;
}

function requireBufferTypeName(value: object): JavaScriptBufferTypeName {
  const name = JSEngine.getBufferTypeName(value);
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

function isBufferViewTypeName(name: JavaScriptBufferTypeName): name is JavaScriptBufferViewName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}
