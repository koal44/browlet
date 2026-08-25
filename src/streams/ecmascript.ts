// eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with its ArrayBuffer receiver through Reflect.apply
const arrayBufferDetached = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'detached',
)?.get;
const arrayBufferTransferToFixedLength = Reflect.get(
  ArrayBuffer.prototype,
  'transferToFixedLength',
) as ((this: ArrayBuffer) => ArrayBuffer) | undefined;

export function isObject(value: unknown): value is object {
  return (
    typeof value === 'object' && value !== null
  ) || typeof value === 'function';
}

export function createArrayFromList<Value>(
  elements: readonly Value[],
): Value[] {
  return elements.slice();
}

export function copyDataBlockBytes(
  destination: ArrayBuffer,
  destinationOffset: number,
  source: ArrayBuffer,
  sourceOffset: number,
  count: number,
): void {
  new Uint8Array(destination).set(
    new Uint8Array(source, sourceOffset, count),
    destinationOffset,
  );
}

export function transferArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  if (isDetachedBuffer(buffer)) {
    throw new TypeError('Cannot transfer a detached ArrayBuffer');
  }
  if (!arrayBufferTransferToFixedLength) {
    throw new TypeError('ArrayBuffer transfer is not supported by this host');
  }
  return Reflect.apply(arrayBufferTransferToFixedLength, buffer, []);
}

export function canTransferArrayBuffer(buffer: ArrayBuffer): boolean {
  return !isDetachedBuffer(buffer) &&
    arrayBufferTransferToFixedLength !== undefined;
}

export function isDetachedBuffer(buffer: ArrayBuffer): boolean {
  if (!arrayBufferDetached) return buffer.byteLength === 0;
  return Reflect.apply(arrayBufferDetached, buffer, []) === true;
}
