import type { JavaScriptBufferViewName } from './realm';

/** JavaScript engine facts for ArrayBuffer objects and views. */

export type JavaScriptBufferTypeName =
  | 'ArrayBuffer'
  | 'SharedArrayBuffer'
  | JavaScriptBufferViewName;

export function getBufferTypeName(
  value: object,
): JavaScriptBufferTypeName | undefined {
  if (hasInternalSlot(value, arrayBufferByteLength)) return 'ArrayBuffer';
  if (
    sharedArrayBufferByteLength &&
    hasInternalSlot(value, sharedArrayBufferByteLength)
  ) return 'SharedArrayBuffer';
  if (hasInternalSlot(value, dataViewBuffer)) return 'DataView';

  try {
    const name = Reflect.apply(typedArrayName, value, []);
    return typeof name === 'string' && bufferViewTypeNames.has(
      name as JavaScriptBufferViewName,
    )
      ? name as JavaScriptBufferViewName
      : undefined;
  } catch {
    return;
  }
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

export function getArrayBufferViewBuffer(value: object): object {
  const name = requireBufferViewTypeName(value);
  return Reflect.apply(
    name === 'DataView' ? dataViewBuffer : typedArrayBuffer,
    value,
    [],
  ) as object;
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
  name: JavaScriptBufferViewName,
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

/*
 * ACCOMMODATION(node-v8-array-buffer-slots): V8 records whether a resizable
 * ArrayBuffer view is length-tracking, but Node exposes no direct query. Grow
 * or truncate the buffer just enough to distinguish the states, then restore
 * its length and bytes before returning.
 */
export function isLengthTrackingResizableArrayBufferView(
  value: object,
): boolean {
  const name = requireBufferViewTypeName(value);
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

function requireBufferTypeName(value: object): JavaScriptBufferTypeName {
  const name = getBufferTypeName(value);
  if (!name) throw new Error('Value is not an ArrayBuffer or view');
  return name;
}

function requireBufferViewTypeName(value: object): JavaScriptBufferViewName {
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

const bufferViewTypeNames = new Set<JavaScriptBufferViewName>([
  'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array',
  'Uint32Array', 'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'DataView',
]);

const bufferViewElementSizes: Record<JavaScriptBufferViewName, number> = {
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
