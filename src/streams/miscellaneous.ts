import {
  getBufferSourceByteLength, getBufferSourceCopy, isBufferSourceDetached,
} from '../web-idl/buffer-source';
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

export function cloneAsUint8Array(value: object): Uint8Array {
  return getBufferSourceCopy(value);
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
