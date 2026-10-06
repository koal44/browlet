import { types as nodeTypes } from 'node:util';
import { getNativeArrayBufferViewLengthTracking } from './runtime';
import { TypeError } from '../infra/exceptions';
import { InternalError } from '../infra/internal-error';

export type RuntimeBuffers = {
  /** Allocate zero-initialized final storage directly in the owning realm. */
  allocateArrayBuffer(byteLength: number): ArrayBuffer;
  /**
   * Share a buffer; length is elements for typed arrays and bytes for DataView.
   * Omit length to use the remaining range and track subsequent resizing.
   */
  createView<Name extends JSBufferViewName, Buffer extends ArrayBufferLike>(
    name: Name,
    buffer: Buffer,
    byteOffset?: number,
    length?: number,
  ): JSBufferView<Name, Buffer>;
  /** Copy the supplied bytes into independent storage, preserving the source. */
  copyArrayBuffer(bytes: Uint8Array): ArrayBuffer;
  copyUint8Array(bytes: Uint8Array): Uint8Array<ArrayBuffer>;
  /** Consume an exclusively owned buffer, detaching the source. */
  transferArrayBuffer(buffer: ArrayBuffer): ArrayBuffer;
};

export type JSBuffer<Name extends JSBufferTypeName = JSBufferTypeName> =
  (typeof globalThis)[Name]['prototype'];
export type JSBufferView<
  Name extends JSBufferViewName = JSBufferViewName,
  Buffer extends ArrayBufferLike = ArrayBufferLike,
> = BufferViews<Buffer>[Name];
export type JSTypedArray = JSBufferView<Exclude<JSBufferViewName, 'DataView'>>;
export type JSBufferSource = ArrayBufferLike | ArrayBufferView;

/** Preserve both the view kind and the backing buffer selected by its allocator. */
type BufferViews<Buffer extends ArrayBufferLike> = {
  BigInt64Array: BigInt64Array<Buffer>;
  BigUint64Array: BigUint64Array<Buffer>;
  DataView: DataView<Buffer>;
  Float16Array: Float16Array<Buffer>;
  Float32Array: Float32Array<Buffer>;
  Float64Array: Float64Array<Buffer>;
  Int16Array: Int16Array<Buffer>;
  Int32Array: Int32Array<Buffer>;
  Int8Array: Int8Array<Buffer>;
  Uint16Array: Uint16Array<Buffer>;
  Uint32Array: Uint32Array<Buffer>;
  Uint8Array: Uint8Array<Buffer>;
  Uint8ClampedArray: Uint8ClampedArray<Buffer>;
};

export type ByteSequence = Uint8Array | number[];

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
} as const satisfies Record<keyof BufferViews<ArrayBufferLike>, number>;

export const bufferViewNames = Object.keys(bufferViewElementSizes) as JSBufferViewName[];

export const isArrayBuffer: (value: unknown) => value is ArrayBuffer = nodeTypes.isArrayBuffer;
export const isSharedArrayBuffer: (value: unknown) => value is SharedArrayBuffer = nodeTypes.isSharedArrayBuffer;
export const isAnyArrayBuffer: (value: unknown) => value is ArrayBufferLike = nodeTypes.isAnyArrayBuffer;
export const isDataView: (value: unknown) => value is DataView = nodeTypes.isDataView;
export const isUint8Array: (value: unknown) => value is Uint8Array = nodeTypes.isUint8Array;

/** Recognize a native view, including newer typed arrays absent from Node's typings. */
export function isArrayBufferView(value: unknown): value is JSBufferView {
  return nodeTypes.isArrayBufferView(value);
}

/** Match an author value against its declared buffer kind and retain that kind. */
export function isBufferType<Name extends JSBufferTypeName>(
  value: unknown,
  name: Name,
): value is JSBuffer<Name> {
  return getBufferTypeName(value) === name;
}

/** Buffer or view with fixed-length backing storage, including shared buffers. */
export function isFixedBufferSource(
  value: unknown,
): value is JSBufferSource {
  if (isAnyArrayBuffer(value)) return !isResizableArrayBuffer(value);
  return isArrayBufferView(value) && !isResizableArrayBuffer(getArrayBufferViewBuffer(value));
}

export function getBufferTypeName(
  value: unknown,
): JSBufferTypeName | undefined {
  if (nodeTypes.isArrayBuffer(value)) return 'ArrayBuffer';
  if (nodeTypes.isSharedArrayBuffer(value)) return 'SharedArrayBuffer';
  if (nodeTypes.isDataView(value)) return 'DataView';
  const name = Reflect.apply(typedArrayName, value, []);
  return typeof name === 'string' && Object.hasOwn(bufferViewElementSizes, name)
    ? name as JSBufferViewName
    : undefined;
}

/** Read the kind of an already validated view without classifying buffers again. */
export function getBufferViewTypeName(value: ArrayBufferView): JSBufferViewName {
  return isDataView(value) ? 'DataView' : Reflect.apply(typedArrayName, value, []) as JSBufferViewName;
}

export function getArrayBufferByteLength(value: ArrayBufferLike): number {
  return Reflect.apply(
    isSharedArrayBuffer(value) ? requireSharedArrayBufferByteLength() : arrayBufferByteLength,
    value,
    [],
  );
}

export function getArrayBufferMaxByteLength(
  value: ArrayBufferLike,
): number | undefined {
  if (!isResizableArrayBuffer(value)) return;
  return Reflect.apply(
    isSharedArrayBuffer(value)
      ? requireSharedArrayBufferMaxByteLength()
      : arrayBufferMaxByteLength,
    value,
    [],
  );
}

export function getArrayBufferViewBuffer<Buffer extends ArrayBufferLike>(value: ArrayBufferView<Buffer>): Buffer {
  return Reflect.apply(
    isDataView(value) ? dataViewBuffer : typedArrayBuffer,
    value,
    [],
  ) as Buffer;
}

/**
 * Read the current byte length. Detached/out-of-bounds typed arrays return zero;
 * DataViews in those states request TypeError.
 */
export function getArrayBufferViewByteLength(value: ArrayBufferView): number {
  if (!isDataView(value)) return Reflect.apply(typedArrayByteLength, value, []);
  try {
    return Reflect.apply(dataViewByteLength, value, []);
  } catch {
    // The brand is checked and the captured getter cannot invoke author code.
    throw new TypeError('DataView is detached or out of bounds');
  }
}

/** Read intrinsic offset; detached or out-of-bounds DataViews request TypeError. */
export function getArrayBufferViewByteOffset(value: ArrayBufferView): number {
  if (!isDataView(value)) return Reflect.apply(typedArrayByteOffset, value, []);
  try {
    return Reflect.apply(dataViewByteOffset, value, []);
  } catch {
    // The brand is checked and the captured getter cannot invoke author code.
    throw new TypeError('DataView is detached or out of bounds');
  }
}

export function getTypedArrayLength(value: JSTypedArray): number {
  return Reflect.apply(typedArrayLength, value, []);
}

export function getArrayBufferViewElementSize(
  name: JSBufferViewName,
): number {
  return bufferViewElementSizes[name];
}

export function isDetachedArrayBuffer(value: ArrayBufferLike): boolean {
  if (isSharedArrayBuffer(value)) return false;
  if (arrayBufferDetached) {
    return Reflect.apply(arrayBufferDetached, value, []) === true;
  }
  try {
    new Uint8Array(value);
    return false;
  } catch {
    return true;
  }
}

export function isResizableArrayBuffer(value: ArrayBufferLike): boolean {
  if (isSharedArrayBuffer(value)) {
    return sharedArrayBufferGrowable
      ? Reflect.apply(sharedArrayBufferGrowable, value, []) === true
      : false;
  }
  return arrayBufferResizable
    ? Reflect.apply(arrayBufferResizable, value, []) === true
    : false;
}

export function isArrayBufferViewOutOfBounds(value: ArrayBufferView): boolean {
  try {
    if (isDataView(value)) {
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
  value: ArrayBufferView,
): boolean {
  const native = getNativeArrayBufferViewLengthTracking(value);
  if (native !== undefined) return native;
  return probeLengthTrackingArrayBufferView(value, getBufferViewTypeName(value));
}

export function getBufferSourceCopy(value: JSBufferSource): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(getBufferSourceView(value));
}

/** Borrow live storage so mutations stay visible; detached storage yields an empty view. */
export function getBufferSourceView(value: JSBufferSource): Uint8Array {
  if (isAnyArrayBuffer(value)) {
    return isDetachedArrayBuffer(value)
      ? new Uint8Array()
      : new Uint8Array(value, 0, getArrayBufferByteLength(value));
  }
  const dataView = isDataView(value);
  const buffer = Reflect.apply(dataView ? dataViewBuffer : typedArrayBuffer, value, []);
  if (isDetachedArrayBuffer(buffer)) return new Uint8Array();
  let offset: number;
  let length: number;
  if (dataView) {
    try {
      offset = Reflect.apply(dataViewByteOffset, value, []);
      length = Reflect.apply(dataViewByteLength, value, []);
    } catch {
      throw new TypeError('DataView is out of bounds');
    }
  } else {
    offset = Reflect.apply(typedArrayByteOffset, value, []);
    length = Reflect.apply(typedArrayByteLength, value, []);
  }
  return new Uint8Array(buffer, offset, length);
}

/** Read current byte length through the buffer/view intrinsic, bypassing author properties. */
export function getBufferSourceByteLength(value: JSBufferSource): number {
  // SPEC_CLASH(webidl-buffer-source-byte-length): Use current intrinsic lengths rather than Web IDL's raw [[ByteLength]]; see the JS Engine roadmap.
  return isAnyArrayBuffer(value)
    ? getArrayBufferByteLength(value)
    : getArrayBufferViewByteLength(value);
}

export function getBufferSourceUnderlyingBuffer(value: JSBufferSource): ArrayBufferLike {
  return isAnyArrayBuffer(value) ? value : getArrayBufferViewBuffer(value);
}

/** Write into live storage; an invalid byte range is an implementation error. */
export function writeArrayBuffer(
  buffer: ArrayBufferLike,
  bytes: ByteSequence,
  startingOffset = 0,
): void {
  const byteCount = bytes.length;
  const byteLength = getArrayBufferByteLength(buffer);
  if (byteLength === 0 && isDetachedArrayBuffer(buffer)) {
    throw new TypeError('Cannot write to a detached ArrayBuffer');
  }
  if (byteCount === 0 && !Array.isArray(bytes) && isArrayBufferViewOutOfBounds(bytes)) {
    throw new TypeError('Source view is detached or out of bounds');
  }
  assertWriteRange(byteCount, byteLength, startingOffset);
  new Uint8Array(
    buffer,
    startingOffset,
    byteCount,
  ).set(bytes);
}

/** Write into a live, in-bounds view, including when the source is empty. */
export function writeArrayBufferView(
  view: ArrayBufferView,
  bytes: ByteSequence,
  startingOffset = 0,
): void {
  const name = getBufferViewTypeName(view);
  const elementSize = getArrayBufferViewElementSize(name);
  const byteCount = bytes.length;
  if (name !== 'DataView' && byteCount % elementSize !== 0) {
    throw new InternalError(`${name} byte length is not a multiple of ${elementSize}`);
  }
  const byteLength = getArrayBufferViewByteLength(view);
  if (byteLength === 0 && isArrayBufferViewOutOfBounds(view)) {
    throw new TypeError('Destination view is detached or out of bounds');
  }
  assertWriteRange(byteCount, byteLength, startingOffset);
  writeArrayBuffer(
    getArrayBufferViewBuffer(view),
    bytes,
    getArrayBufferViewByteOffset(view) + startingOffset,
  );
}

export function isBufferSourceDetached(value: JSBufferSource): boolean {
  return isDetachedArrayBuffer(
    getBufferSourceUnderlyingBuffer(value),
  );
}

export function getBufferSourceByteOffset(value: JSBufferSource): number {
  return isAnyArrayBuffer(value) ? 0 : getArrayBufferViewByteOffset(value);
}

/*
 * ACCOMMODATION(node-v8-array-buffer-slots): Stock Node lacks a direct query.
 * Grow or truncate an ordinary resizable buffer, then restore its length and
 * bytes. Shared buffers cannot be restored, so their tracking remains unknown.
 */
function probeLengthTrackingArrayBufferView(
  value: ArrayBufferView,
  name: JSBufferViewName,
): boolean {
  const buffer = getArrayBufferViewBuffer(value);
  if (
    isSharedArrayBuffer(buffer) ||
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
    throw new InternalError('A resizable ArrayBuffer has no maximum byte length');
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
    buffer,
    probeByteLength,
    bufferByteLength - probeByteLength,
  ));
  resizeArrayBuffer(buffer, probeByteLength);
  try {
    return !isArrayBufferViewOutOfBounds(value);
  } finally {
    resizeArrayBuffer(buffer, bufferByteLength);
    const restoredView = new Uint8Array(
      buffer,
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
    throw new InternalError('Buffer source write exceeds the available byte range');
  }
}

function resizeArrayBuffer(buffer: ArrayBuffer, byteLength: number): void {
  if (!arrayBufferResize) {
    throw new InternalError('Resizable ArrayBuffer operations are unavailable');
  }
  Reflect.apply(arrayBufferResize, buffer, [byteLength]);
}

function getAccessor<Value, Receiver = object>(
  object: object,
  key: PropertyKey,
): (this: Receiver) => Value {
  const getter = getOptionalAccessor<Value, Receiver>(object, key);
  if (!getter) throw new InternalError(`Missing intrinsic accessor ${String(key)}`);
  return getter;
}

function getOptionalAccessor<Value, Receiver = object>(
  object: object,
  key: PropertyKey,
): ((this: Receiver) => Value) | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  const getter = descriptor && Reflect.get(descriptor, 'get') as unknown;
  return typeof getter === 'function'
    ? getter as (this: Receiver) => Value
    : undefined;
}

function requireSharedArrayBufferByteLength(): (this: object) => number {
  if (!sharedArrayBufferByteLength) {
    throw new InternalError('SharedArrayBuffer is unavailable');
  }
  return sharedArrayBufferByteLength;
}

function requireSharedArrayBufferMaxByteLength(): (this: object) => number {
  if (!sharedArrayBufferMaxByteLength) {
    throw new InternalError('SharedArrayBuffer maxByteLength is unavailable');
  }
  return sharedArrayBufferMaxByteLength;
}

const arrayBufferByteLength = getAccessor<number>(ArrayBuffer.prototype, 'byteLength');
const arrayBufferResizable = getOptionalAccessor<boolean>(
  ArrayBuffer.prototype,
  'resizable',
);
const arrayBufferMaxByteLength = getAccessor<number>(
  ArrayBuffer.prototype,
  'maxByteLength',
);
const arrayBufferResize = Reflect.get(
  ArrayBuffer.prototype,
  'resize',
) as ((this: object, byteLength: number) => void) | undefined;
const arrayBufferDetached = getOptionalAccessor<boolean>(
  ArrayBuffer.prototype,
  'detached',
);

const sharedArrayBufferByteLength = typeof SharedArrayBuffer === 'undefined'
  ? undefined
  : getAccessor<number>(SharedArrayBuffer.prototype, 'byteLength');
const sharedArrayBufferGrowable = typeof SharedArrayBuffer === 'undefined'
  ? undefined
  : getOptionalAccessor<boolean>(SharedArrayBuffer.prototype, 'growable');
const sharedArrayBufferMaxByteLength =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : getOptionalAccessor<number>(SharedArrayBuffer.prototype, 'maxByteLength');

const dataViewBuffer = getAccessor<ArrayBufferLike>(DataView.prototype, 'buffer');
const dataViewByteLength = getAccessor<number>(DataView.prototype, 'byteLength');
const dataViewByteOffset = getAccessor<number>(DataView.prototype, 'byteOffset');

const typedArrayPrototype = Reflect.getPrototypeOf(Uint8Array.prototype)!;
const typedArrayBuffer = getAccessor<ArrayBufferLike>(typedArrayPrototype, 'buffer');
const typedArrayByteLength = getAccessor<number>(typedArrayPrototype, 'byteLength');
const typedArrayByteOffset = getAccessor<number>(typedArrayPrototype, 'byteOffset');
const typedArrayLength = getAccessor<number>(typedArrayPrototype, 'length');
const typedArrayName = getAccessor<string | undefined, unknown>(typedArrayPrototype, Symbol.toStringTag);
const typedArraySet = Reflect.get(
  typedArrayPrototype,
  'set',
) as (this: object, source: ArrayLike<unknown>) => void;
const emptyArray = Object.freeze([]);
