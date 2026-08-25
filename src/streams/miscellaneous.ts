import { isDetachedBuffer } from './ecmascript';

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 0;
}

export function cloneAsUint8Array(value: ArrayBufferView): Uint8Array {
  const buffer = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  );
  return new Uint8Array(buffer);
}

export function canCopyDataBlockBytes(
  destination: ArrayBuffer,
  destinationOffset: number,
  source: ArrayBuffer,
  sourceOffset: number,
  count: number,
): boolean {
  return destination !== source &&
    !isDetachedBuffer(destination) &&
    !isDetachedBuffer(source) &&
    destinationOffset + count <= destination.byteLength &&
    sourceOffset + count <= source.byteLength;
}
