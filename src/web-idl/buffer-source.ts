import {
  hasExtendedAttribute, type BufferTypeName, type BufferViewTypeName,
  type ExtendedAttribute,
} from './declaration/definition';
import type { WebIDLRealmHost } from './javascript-realm';

export function convertBufferSourceToIDL(
  value: unknown,
  name: BufferTypeName,
  extendedAttributes: ExtendedAttribute[],
  realm: WebIDLRealmHost,
): object {
  if (!isObject(value) || getBufferTypeName(value) !== name) {
    return throwTypeError(realm, `Value is not a ${name}`);
  }

  const allowResizable = hasExtendedAttribute(
    extendedAttributes,
    'AllowResizable',
  );
  if (isBufferViewTypeName(name)) {
    const buffer = getViewedArrayBuffer(value, name);
    if (
      isSharedArrayBuffer(buffer) &&
      !hasExtendedAttribute(extendedAttributes, 'AllowShared')
    ) {
      return throwTypeError(realm, `${name} is backed by a SharedArrayBuffer`);
    }
    if (!allowResizable && isResizableBuffer(buffer)) {
      return throwTypeError(realm, `${name} is backed by a resizable buffer`);
    }
  } else if (!allowResizable && isResizableBuffer(value)) {
    return throwTypeError(realm, `${name} is resizable`);
  }
  return value;
}

export function convertBufferSourceToJavaScript(
  value: unknown,
  name: BufferTypeName,
): object {
  if (!isObject(value) || getBufferTypeName(value) !== name) {
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
): object {
  const constructor = realm.intrinsics.bufferSource.sharedArrayBuffer;
  if (!constructor) {
    throw new Error('The target realm has no SharedArrayBuffer intrinsic');
  }
  const buffer = Reflect.construct(
    constructor,
    maxByteLength === undefined
      ? [bytes.length]
      : [bytes.length, { maxByteLength }],
  ) as object;
  writeArrayBuffer(buffer, bytes);
  return buffer;
}

export function cloneSharedArrayBuffer(
  buffer: object,
  realm: WebIDLRealmHost,
): object {
  if (getBufferTypeName(buffer) !== 'SharedArrayBuffer') {
    throw new Error('Only a SharedArrayBuffer can share its backing store');
  }
  const clone = realm.intrinsics.bufferSource.cloneSharedArrayBuffer(buffer);
  if (getBufferTypeName(clone) !== 'SharedArrayBuffer') {
    throw new Error('The host did not clone a SharedArrayBuffer');
  }
  const constructor = realm.intrinsics.bufferSource.sharedArrayBuffer;
  if (!constructor) {
    throw new Error('The target realm has no SharedArrayBuffer intrinsic');
  }
  if (!Reflect.setPrototypeOf(clone, constructor.prototype)) {
    throw new Error('Could not apply the target SharedArrayBuffer prototype');
  }
  return clone;
}

export function createArrayBufferView(
  name: BufferViewTypeName,
  bytes: ByteSequence,
  realm: WebIDLRealmHost,
): object {
  const elementSize = bufferViewElementSizes[name];
  if (name !== 'DataView' && bytes.length % elementSize !== 0) {
    throw new Error(`${name} byte length is not a multiple of ${elementSize}`);
  }
  const constructor = realm.intrinsics.bufferSource.views[name];
  if (!constructor) {
    throw new Error(`The target realm has no ${name} intrinsic`);
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
): object {
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
    ) as object;
  }
  if (arrayLength === undefined) {
    throw new Error(`${name} has no serialized array length`);
  }
  return Reflect.construct(
    constructor,
    arrayLength === 'auto'
      ? [buffer, byteOffset]
      : [buffer, byteOffset, arrayLength],
  ) as object;
}

export function getBufferSourceCopy(value: object): Uint8Array {
  const buffer = getBufferSourceUnderlyingBuffer(value);
  if (isArrayBufferDetached(buffer)) return new Uint8Array();
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
  if (name === 'ArrayBuffer') {
    return Reflect.apply(arrayBufferByteLength, value, []) as number;
  }
  if (name === 'SharedArrayBuffer') {
    return Reflect.apply(
      requireSharedArrayBufferAccessor(),
      value,
      [],
    ) as number;
  }
  return Reflect.apply(
    name === 'DataView' ? dataViewByteLength : typedArrayByteLength,
    value,
    [],
  ) as number;
}

/** Reads the backing buffer's resizability metadata for HTML §2.7.3. */
export function getBufferSourceMaxByteLength(
  value: object,
): number | undefined {
  const buffer = getBufferSourceUnderlyingBuffer(value);
  if (!isResizableBuffer(buffer)) return;
  return Reflect.apply(
    isSharedArrayBuffer(buffer)
      ? requireSharedArrayBufferMaxByteLengthAccessor()
      : arrayBufferMaxByteLength,
    buffer,
    [],
  ) as number;
}

/** Reads a typed array's current numeric [[ArrayLength]] for HTML §2.7.3. */
export function getBufferSourceArrayLength(
  value: object,
): number | undefined {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name) || name === 'DataView') return;
  return Reflect.apply(typedArrayLength, value, []) as number;
}

/** Reads the view length slots serialized by HTML §2.7.3. */
export function getBufferSourceViewLengths(
  value: object,
): BufferSourceViewLengths {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name)) {
    throw new Error(`${name} is not a buffer view type`);
  }
  if (isLengthTrackingResizableArrayBufferView(value, name)) {
    return name === 'DataView'
      ? { byteLength: 'auto' }
      : { byteLength: 'auto', arrayLength: 'auto' };
  }
  return name === 'DataView'
    ? { byteLength: getBufferSourceByteLength(value) }
    : {
      byteLength: getBufferSourceByteLength(value),
      arrayLength: getBufferSourceArrayLength(value),
    };
}

/** Implements IsArrayBufferViewOutOfBounds for HTML §2.7.3. */
export function isBufferSourceViewOutOfBounds(value: object): boolean {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name)) return false;
  try {
    if (name === 'DataView') {
      Reflect.apply(dataViewByteLength, value, []);
    } else {
      // The numeric view accessors collapse out-of-bounds views to zero. The
      // intrinsic setter performs ValidateTypedArray before observing the
      // empty source and therefore validates without allocating or mutating.
      Reflect.apply(typedArraySet, value, [emptyArray]);
    }
    return false;
  } catch {
    return true;
  }
}

export function getBufferSourceUnderlyingBuffer(value: object): object {
  const name = requireBufferTypeName(value);
  return isBufferViewTypeName(name)
    ? getViewedArrayBuffer(value, name)
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
  const elementSize = bufferViewElementSizes[name];
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
  if (isArrayBufferDetached(buffer)) return;
  Reflect.apply(
    realm.intrinsics.bufferSource.arrayBufferTransfer,
    buffer,
    [0],
  );
}

export function isBufferSourceDetached(value: object): boolean {
  return isArrayBufferDetached(getBufferSourceUnderlyingBuffer(value));
}

// TODO(Web IDL BufferSource/transferable): JavaScript exposes no
// non-destructive test for [[ArrayBufferDetachKey]]. Add a host capability
// before exposing that predicate; the transfer operation remains authoritative.
export function transferArrayBuffer(
  buffer: object,
  targetRealm: WebIDLRealmHost,
): object {
  if (getBufferTypeName(buffer) !== 'ArrayBuffer') {
    throw new Error('Only an ArrayBuffer can be transferred');
  }
  if (isArrayBufferDetached(buffer)) {
    throw new targetRealm.intrinsics.typeError('ArrayBuffer is detached');
  }
  return Reflect.apply(
    targetRealm.intrinsics.bufferSource.arrayBufferTransfer,
    buffer,
    [],
  ) as object;
}

export type ByteSequence = Uint8Array | readonly number[];

export type BufferSourceViewLengths = {
  byteLength: number | 'auto';
  arrayLength?: number | 'auto';
};

export function getBufferTypeName(value: object): BufferTypeName | undefined {
  if (hasInternalSlot(value, arrayBufferByteLength)) return 'ArrayBuffer';
  if (
    sharedArrayBufferByteLength &&
    hasInternalSlot(value, sharedArrayBufferByteLength)
  ) return 'SharedArrayBuffer';
  if (hasInternalSlot(value, dataViewBuffer)) return 'DataView';

  try {
    const name = Reflect.apply(typedArrayName, value, []);
    return typeof name === 'string' && typedArrayTypeNames.has(
      name as BufferTypeName,
    )
      ? name as BufferTypeName
      : undefined;
  } catch {
    return;
  }
}

function getViewedArrayBuffer(
  value: object,
  name: BufferTypeName,
): object {
  return Reflect.apply(
    name === 'DataView' ? dataViewBuffer : typedArrayBuffer,
    value,
    [],
  ) as object;
}

export function getBufferSourceByteOffset(value: object): number {
  const name = requireBufferTypeName(value);
  if (!isBufferViewTypeName(name)) return 0;
  return Reflect.apply(
    name === 'DataView' ? dataViewByteOffset : typedArrayByteOffset,
    value,
    [],
  ) as number;
}

function requireBufferTypeName(value: object): BufferTypeName {
  const name = getBufferTypeName(value);
  if (!name) throw new Error('Value is not a buffer source type');
  return name;
}

function isArrayBufferDetached(value: object): boolean {
  if (isSharedArrayBuffer(value)) return false;
  if (!hasInternalSlot(value, arrayBufferByteLength)) {
    throw new Error('Value is not an ArrayBuffer');
  }
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

function isResizableBuffer(value: object): boolean {
  if (isSharedArrayBuffer(value)) {
    return sharedArrayBufferGrowable
      ? Reflect.apply(sharedArrayBufferGrowable, value, []) === true
      : false;
  }
  return arrayBufferResizable
    ? Reflect.apply(arrayBufferResizable, value, []) === true
    : false;
}

function isLengthTrackingResizableArrayBufferView(
  value: object,
  name: BufferViewTypeName,
): boolean {
  const buffer = getViewedArrayBuffer(value, name);
  if (isSharedArrayBuffer(buffer) || !isResizableBuffer(buffer)) return false;

  const bufferByteLength = getBufferSourceByteLength(buffer);
  const byteOffset = getBufferSourceByteOffset(value);
  const byteLength = getBufferSourceByteLength(value);
  const elementSize = bufferViewElementSizes[name];
  const automaticByteLength = Math.floor(
    (bufferByteLength - byteOffset) / elementSize,
  ) * elementSize;
  if (byteLength !== automaticByteLength) return false;

  const maxByteLength = getBufferSourceMaxByteLength(buffer);
  if (maxByteLength === undefined) {
    throw new Error('A resizable ArrayBuffer has no maximum byte length');
  }

  const remainder = (bufferByteLength - byteOffset) % elementSize;
  const growth = elementSize - remainder;
  if (bufferByteLength + growth <= maxByteLength) {
    resizeArrayBuffer(buffer, bufferByteLength + growth);
    try {
      return getBufferSourceByteLength(value) !== byteLength;
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
    return !isBufferSourceViewOutOfBounds(value);
  } finally {
    resizeArrayBuffer(buffer, bufferByteLength);
    writeArrayBuffer(buffer, removedBytes, probeByteLength);
  }
}

function resizeArrayBuffer(buffer: object, byteLength: number): void {
  if (!arrayBufferResize) {
    throw new Error('Resizable ArrayBuffer operations are unavailable');
  }
  Reflect.apply(arrayBufferResize, buffer, [byteLength]);
}

function isSharedArrayBuffer(value: object): boolean {
  return sharedArrayBufferByteLength !== undefined &&
    hasInternalSlot(value, sharedArrayBufferByteLength);
}

function isBufferViewTypeName(name: BufferTypeName): name is BufferViewTypeName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}

function hasInternalSlot(
  value: object,
  getter: (this: object) => unknown,
): boolean {
  try {
    Reflect.apply(getter, value, []);
    return true;
  } catch {
    return false;
  }
}

function throwTypeError(
  realm: WebIDLRealmHost,
  message: string,
): never {
  throw new realm.intrinsics.typeError(message);
}

const typedArrayTypeNames = new Set<BufferTypeName>([
  'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array',
  'Uint32Array', 'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array',
  'Float16Array', 'Float32Array', 'Float64Array',
]);

const bufferViewElementSizes: Record<BufferViewTypeName, number> = {
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
};

const arrayBufferByteLength = getAccessor(
  ArrayBuffer.prototype,
  'byteLength',
);

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
  : getAccessor(
    SharedArrayBuffer.prototype,
    'byteLength',
  );

const sharedArrayBufferGrowable = typeof SharedArrayBuffer === 'undefined'
  ? undefined
  : getOptionalAccessor(
    SharedArrayBuffer.prototype,
    'growable',
  );

const sharedArrayBufferMaxByteLength =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : getOptionalAccessor(
      SharedArrayBuffer.prototype,
      'maxByteLength',
    );

const dataViewBuffer = getAccessor(
  DataView.prototype,
  'buffer',
);

const dataViewByteLength = getAccessor(
  DataView.prototype,
  'byteLength',
);

const dataViewByteOffset = getAccessor(
  DataView.prototype,
  'byteOffset',
);

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;

const typedArrayBuffer = getAccessor(
  typedArrayPrototype,
  'buffer',
);

const typedArrayByteLength = getAccessor(
  typedArrayPrototype,
  'byteLength',
);

const typedArrayByteOffset = getAccessor(
  typedArrayPrototype,
  'byteOffset',
);

const typedArrayLength = getAccessor(
  typedArrayPrototype,
  'length',
);

const typedArraySet = Reflect.get(
  typedArrayPrototype,
  'set',
) as (this: object, source: readonly unknown[]) => void;

const emptyArray = Object.freeze([]);

const typedArrayName = getAccessor(
  typedArrayPrototype,
  Symbol.toStringTag,
);

function getAccessor(
  object: object,
  key: PropertyKey,
): (this: object) => unknown {
  const getter = getOptionalAccessor(object, key);
  if (!getter) throw new Error(`Missing intrinsic accessor ${String(key)}`);
  return getter;
}

function requireSharedArrayBufferAccessor(): (this: object) => unknown {
  if (!sharedArrayBufferByteLength) {
    throw new Error('SharedArrayBuffer is unavailable');
  }
  return sharedArrayBufferByteLength;
}

function requireSharedArrayBufferMaxByteLengthAccessor(): (
  this: object,
) => unknown {
  if (!sharedArrayBufferMaxByteLength) {
    throw new Error('SharedArrayBuffer maxByteLength is unavailable');
  }
  return sharedArrayBufferMaxByteLength;
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

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
