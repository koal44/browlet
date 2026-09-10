import {
  getBufferSourceByteLength, getBufferSourceByteOffset, getBufferSourceUnderlyingBuffer,
  isBufferSourceDetached, type RuntimeContext,
} from '../js-engine/index';
import { isCallable } from '../js-engine/abstract-operations';
import { TypeError } from '../js-engine/simple-exception';

/** Validate a callback member while capturing a stream dictionary. */
export function checkCallback<Callback extends CallableFunction>(
  value: Callback | undefined,
): Callback | undefined {
  if (value !== undefined && !isCallable(value)) {
    throw new TypeError('Stream callback is not callable');
  }
  return value;
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 0;
}

export function cloneAsUint8Array(value: object, runtime: RuntimeContext): Uint8Array<ArrayBuffer> {
  const bytes = runtime.buffers.createView(
    'Uint8Array', getBufferSourceUnderlyingBuffer(value),
    getBufferSourceByteOffset(value), getBufferSourceByteLength(value),
  );
  return runtime.buffers.copyUint8Array(bytes);
}

export function canCopyDataBlockBytes(
  destination: object,
  destinationOffset: number,
  source: object,
  sourceOffset: number,
  count: number,
): boolean {
  return destination !== source &&
    !isBufferSourceDetached(destination) &&
    !isBufferSourceDetached(source) &&
    destinationOffset + count <= getBufferSourceByteLength(destination) &&
    sourceOffset + count <= getBufferSourceByteLength(source);
}
