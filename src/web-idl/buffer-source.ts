import type {
  BufferTypeName, BufferViewTypeName, ExtendedAttribute,
} from './definition';
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
): object {
  const buffer = Reflect.construct(
    realm.intrinsics.bufferSource.arrayBuffer,
    [bytes.length],
  ) as object;
  writeArrayBuffer(buffer, bytes);
  return buffer;
}

export function createSharedArrayBuffer(
  bytes: ByteSequence,
  realm: WebIDLRealmHost,
): object {
  const constructor = realm.intrinsics.bufferSource.sharedArrayBuffer;
  if (!constructor) {
    throw new Error('The target realm has no SharedArrayBuffer intrinsic');
  }
  const buffer = Reflect.construct(constructor, [bytes.length]) as object;
  writeArrayBuffer(buffer, bytes);
  return buffer;
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
  return Reflect.construct(
    constructor,
    [createArrayBuffer(bytes, realm)],
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

function getBufferSourceByteOffset(value: object): number {
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

function hasExtendedAttribute(
  attributes: ExtendedAttribute[],
  name: string,
): boolean {
  return attributes.some((attribute) =>
    attribute.kind !== 'raw' && attribute.name === name);
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
