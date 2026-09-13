import { types as nodeTypes } from 'node:util';
import { getNativeArrayBufferViewLengthTracking } from './runtime';

export type RuntimeBuffers = {
  /** Allocate zero-initialized final storage directly in the owning realm. */
  allocateArrayBuffer(byteLength: number): ArrayBuffer;
  /**
   * Share a buffer; length is elements for typed arrays and bytes for DataView.
   * Omit length to use the remaining range and track subsequent resizing.
   */
  createView<Name extends JSBufferViewName>(
    name: Name,
    buffer: ArrayBufferLike,
    byteOffset?: number,
    length?: number,
  ): JSBufferView<Name>;
  /** Copy the supplied bytes into independent storage, preserving the source. */
  copyArrayBuffer(bytes: Uint8Array): ArrayBuffer;
  copyUint8Array(bytes: Uint8Array): Uint8Array<ArrayBuffer>;
  /** Consume an exclusively owned buffer, detaching the source. */
  transferArrayBuffer(buffer: ArrayBuffer): ArrayBuffer;
};

export type JSBufferView<Name extends JSBufferViewName> =
  InstanceType<(typeof globalThis)[Name]>;

export type ByteSequence = Uint8Array | readonly number[];

export type JSBufferTypeName =
  | 'ArrayBuffer'
  | 'SharedArrayBuffer'
  | JSBufferViewName;

export type JSBufferViewName = keyof typeof bufferViewElementSizes;

const bufferViewElementSizes = {
  BigInt64Array: 8,
  BigUint64Array: 8,
  DataView: 1,
  Float16Array: 2,
  Float32Array: 4,
  Float64Array: 8,
  Int16Array: 2,
  Int32Array: 4,
  Int8Array: 1,
  Uint16Array: 2,
  Uint32Array: 4,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
} as const;

export const bufferViewNames = Object.keys(bufferViewElementSizes) as
  readonly JSBufferViewName[];

/** Buffer or view with fixed-length backing storage, including shared buffers. */
export function isFixedBufferSource(
  value: unknown,
): value is ArrayBufferLike | ArrayBufferView {
  if (typeof value !== 'object' || value === null) return false;
  const name = getBufferTypeName(value);
  if (!name) return false;
  const buffer = name === 'ArrayBuffer' || name === 'SharedArrayBuffer'
    ? value
    : getArrayBufferViewBuffer(value);
  return !isResizableArrayBuffer(buffer);
}

export function getBufferTypeName(
  value: object,
): JSBufferTypeName | undefined {
  if (nodeTypes.isArrayBuffer(value)) return 'ArrayBuffer';
  if (nodeTypes.isSharedArrayBuffer(value)) return 'SharedArrayBuffer';
  if (nodeTypes.isDataView(value)) return 'DataView';
  const name: unknown = Reflect.apply(typedArrayName, value, []);
  return typeof name === 'string' && Object.hasOwn(bufferViewElementSizes, name)
    ? name as JSBufferViewName
    : undefined;
}

export function getArrayBufferByteLength(value: object): number {
  const name = requireBufferTypeName(value);
  if (name === 'ArrayBuffer') {
    return Reflect.apply(arrayBufferByteLength, value, []) as number;
  }
  if (name === 'SharedArrayBuffer') {
    return Reflect.apply(
      requireSharedArrayBufferByteLength(),
      value,
      [],
    ) as number;
  }
  throw new Error(`${name} is not an ArrayBuffer type`);
}

export function getArrayBufferMaxByteLength(
  value: object,
): number | undefined {
  const name = requireBufferTypeName(value);
  if (name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer') {
    throw new Error(`${name} is not an ArrayBuffer type`);
  }
  if (!isResizableArrayBuffer(value)) return;
  return Reflect.apply(
    name === 'SharedArrayBuffer'
      ? requireSharedArrayBufferMaxByteLength()
      : arrayBufferMaxByteLength,
    value,
    [],
  ) as number;
}

export function getArrayBufferViewBuffer(value: object): ArrayBufferLike {
  const name = requireBufferViewTypeName(value);
  return Reflect.apply(
    name === 'DataView' ? dataViewBuffer : typedArrayBuffer,
    value,
    [],
  ) as ArrayBufferLike;
}

export function getArrayBufferViewByteLength(value: object): number {
  const name = requireBufferViewTypeName(value);
  return Reflect.apply(
    name === 'DataView' ? dataViewByteLength : typedArrayByteLength,
    value,
    [],
  ) as number;
}

export function getArrayBufferViewByteOffset(value: object): number {
  const name = requireBufferViewTypeName(value);
  return Reflect.apply(
    name === 'DataView' ? dataViewByteOffset : typedArrayByteOffset,
    value,
    [],
  ) as number;
}

export function getTypedArrayLength(value: object): number {
  const name = requireBufferViewTypeName(value);
  if (name === 'DataView') throw new Error('DataView is not a typed array');
  return Reflect.apply(typedArrayLength, value, []) as number;
}

export function getArrayBufferViewElementSize(
  name: JSBufferViewName,
): number {
  return bufferViewElementSizes[name];
}

export function isDetachedArrayBuffer(value: object): boolean {
  const name = requireBufferTypeName(value);
  if (name === 'SharedArrayBuffer') return false;
  if (name !== 'ArrayBuffer') throw new Error(`${name} is not an ArrayBuffer`);
  if (arrayBufferDetached) {
    return Reflect.apply(arrayBufferDetached, value, []) === true;
  }
  try {
    new Uint8Array(value as ArrayBuffer);
    return false;
  } catch {
    return true;
  }
}

export function isResizableArrayBuffer(value: object): boolean {
  const name = requireBufferTypeName(value);
  if (name === 'SharedArrayBuffer') {
    return sharedArrayBufferGrowable
      ? Reflect.apply(sharedArrayBufferGrowable, value, []) === true
      : false;
  }
  if (name !== 'ArrayBuffer') {
    throw new Error(`${name} is not an ArrayBuffer type`);
  }
  return arrayBufferResizable
    ? Reflect.apply(arrayBufferResizable, value, []) === true
    : false;
}

export function isArrayBufferViewOutOfBounds(value: object): boolean {
  const name = requireBufferViewTypeName(value);
  try {
    if (name === 'DataView') {
      Reflect.apply(dataViewByteLength, value, []);
    } else {
      // Numeric view accessors collapse out-of-bounds views to zero. The
      // intrinsic setter validates the view before observing the empty source.
      Reflect.apply(typedArraySet, value, [emptyArray]);
    }
    return false;
  } catch {
    return true;
  }
}

/** Whether a view's specification length is auto rather than a fixed number. */
export function isLengthTrackingArrayBufferView(
  value: object,
): boolean {
  const name = requireBufferViewTypeName(value);
  const native = getNativeArrayBufferViewLengthTracking(value);
  if (native !== undefined) return native;
  return probeLengthTrackingArrayBufferView(value, name);
}

export function getBufferSourceCopy(value: object): Uint8Array {
  return Uint8Array.from(getBufferSourceView(value));
}

/** Borrow the actual byte range; subsequent changes to the source remain visible. */
export function getBufferSourceView(value: object): Uint8Array {
  const buffer = getBufferSourceUnderlyingBuffer(value);
  if (isDetachedArrayBuffer(buffer)) return new Uint8Array();
  const offset = getBufferSourceByteOffset(value);
  const length = getBufferSourceByteLength(value);
  return new Uint8Array(buffer, offset, length);
}

export function getBufferSourceByteLength(value: object): number {
  const name = requireBufferTypeName(value);
  return isBufferViewTypeName(name)
    ? getArrayBufferViewByteLength(value)
    : getArrayBufferByteLength(value);
}

export function getBufferSourceUnderlyingBuffer(value: object): ArrayBufferLike {
  const name = requireBufferTypeName(value);
  return isBufferViewTypeName(name)
    ? getArrayBufferViewBuffer(value)
    : value as ArrayBufferLike;
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
  const elementSize = getArrayBufferViewElementSize(name);
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

export function isBufferSourceDetached(value: object): boolean {
  return isDetachedArrayBuffer(
    getBufferSourceUnderlyingBuffer(value),
  );
}

export function getBufferSourceByteOffset(value: object): number {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name)) return 0;
  return getArrayBufferViewByteOffset(value);
}

/*
 * ACCOMMODATION(node-v8-array-buffer-slots): Stock Node lacks a direct query.
 * Grow or truncate an ordinary resizable buffer, then restore its length and
 * bytes. Shared buffers cannot be restored, so their tracking remains unknown.
 */
function probeLengthTrackingArrayBufferView(
  value: object,
  name: JSBufferViewName,
): boolean {
  const buffer = getArrayBufferViewBuffer(value);
  if (
    getBufferTypeName(buffer) === 'SharedArrayBuffer' ||
    !isResizableArrayBuffer(buffer)
  ) return false;

  const bufferByteLength = getArrayBufferByteLength(buffer);
  const byteOffset = getArrayBufferViewByteOffset(value);
  const byteLength = getArrayBufferViewByteLength(value);
  const elementSize = getArrayBufferViewElementSize(name);
  const automaticByteLength = Math.floor(
    (bufferByteLength - byteOffset) / elementSize,
  ) * elementSize;
  if (byteLength !== automaticByteLength) return false;

  const maxByteLength = getArrayBufferMaxByteLength(buffer);
  if (maxByteLength === undefined) {
    throw new Error('A resizable ArrayBuffer has no maximum byte length');
  }

  const growth = elementSize - (bufferByteLength - byteOffset) % elementSize;
  if (bufferByteLength + growth <= maxByteLength) {
    resizeArrayBuffer(buffer, bufferByteLength + growth);
    try {
      return getArrayBufferViewByteLength(value) !== byteLength;
    } finally {
      resizeArrayBuffer(buffer, bufferByteLength);
    }
  }

  // A fixed and an auto-length zero-sized view are observably equivalent when
  // the buffer can never grow enough to contain another complete element.
  if (byteLength === 0) return false;

  const probeByteLength = byteOffset + byteLength - 1;
  const removedBytes = Uint8Array.from(new Uint8Array(
    buffer as ArrayBuffer,
    probeByteLength,
    bufferByteLength - probeByteLength,
  ));
  resizeArrayBuffer(buffer, probeByteLength);
  try {
    return !isArrayBufferViewOutOfBounds(value);
  } finally {
    resizeArrayBuffer(buffer, bufferByteLength);
    const restoredView = new Uint8Array(
      buffer as ArrayBuffer,
      probeByteLength,
      removedBytes.length,
    );
    Reflect.apply(typedArraySet, restoredView, [removedBytes]);
  }
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

function isBufferViewTypeName(name: JSBufferTypeName): name is JSBufferViewName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}

function requireBufferTypeName(value: object): JSBufferTypeName {
  const name = getBufferTypeName(value);
  if (!name) throw new Error('Value is not an ArrayBuffer or view');
  return name;
}

function requireBufferViewTypeName(value: object): JSBufferViewName {
  const name = requireBufferTypeName(value);
  if (name === 'ArrayBuffer' || name === 'SharedArrayBuffer') {
    throw new Error(`${name} is not an ArrayBuffer view`);
  }
  return name;
}

function resizeArrayBuffer(buffer: object, byteLength: number): void {
  if (!arrayBufferResize) {
    throw new Error('Resizable ArrayBuffer operations are unavailable');
  }
  Reflect.apply(arrayBufferResize, buffer, [byteLength]);
}

function getAccessor(
  object: object,
  key: PropertyKey,
): (this: object) => unknown {
  const getter = getOptionalAccessor(object, key);
  if (!getter) throw new Error(`Missing intrinsic accessor ${String(key)}`);
  return getter;
}

function getOptionalAccessor(
  object: object,
  key: PropertyKey,
): ((this: object) => unknown) | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  const getter = descriptor && Reflect.get(descriptor, 'get') as unknown;
  return typeof getter === 'function'
    ? getter as (this: object) => unknown
    : undefined;
}

function requireSharedArrayBufferByteLength(): (this: object) => unknown {
  if (!sharedArrayBufferByteLength) {
    throw new Error('SharedArrayBuffer is unavailable');
  }
  return sharedArrayBufferByteLength;
}

function requireSharedArrayBufferMaxByteLength(): (this: object) => unknown {
  if (!sharedArrayBufferMaxByteLength) {
    throw new Error('SharedArrayBuffer maxByteLength is unavailable');
  }
  return sharedArrayBufferMaxByteLength;
}

const arrayBufferByteLength = getAccessor(ArrayBuffer.prototype, 'byteLength');
const arrayBufferResizable = getOptionalAccessor(
  ArrayBuffer.prototype,
  'resizable',
);
const arrayBufferMaxByteLength = getAccessor(
  ArrayBuffer.prototype,
  'maxByteLength',
);
const arrayBufferResize = Reflect.get(
  ArrayBuffer.prototype,
  'resize',
) as ((this: object, byteLength: number) => void) | undefined;
const arrayBufferDetached = getOptionalAccessor(
  ArrayBuffer.prototype,
  'detached',
);

const sharedArrayBufferByteLength = typeof SharedArrayBuffer === 'undefined'
  ? undefined
  : getAccessor(SharedArrayBuffer.prototype, 'byteLength');
const sharedArrayBufferGrowable = typeof SharedArrayBuffer === 'undefined'
  ? undefined
  : getOptionalAccessor(SharedArrayBuffer.prototype, 'growable');
const sharedArrayBufferMaxByteLength =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : getOptionalAccessor(SharedArrayBuffer.prototype, 'maxByteLength');

const dataViewBuffer = getAccessor(DataView.prototype, 'buffer');
const dataViewByteLength = getAccessor(DataView.prototype, 'byteLength');
const dataViewByteOffset = getAccessor(DataView.prototype, 'byteOffset');

const typedArrayPrototype = Reflect.getPrototypeOf(Uint8Array.prototype)!;
const typedArrayBuffer = getAccessor(typedArrayPrototype, 'buffer');
const typedArrayByteLength = getAccessor(typedArrayPrototype, 'byteLength');
const typedArrayByteOffset = getAccessor(typedArrayPrototype, 'byteOffset');
const typedArrayLength = getAccessor(typedArrayPrototype, 'length');
const typedArrayName = getAccessor(typedArrayPrototype, Symbol.toStringTag);
const typedArraySet = Reflect.get(
  typedArrayPrototype,
  'set',
) as (this: object, source: readonly unknown[]) => void;
const emptyArray = Object.freeze([]);
