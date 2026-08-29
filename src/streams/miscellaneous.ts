import {
  createArrayBuffer, createArrayBufferViewFromBuffer,
  getBufferSourceByteLength, getBufferSourceCopy, isBufferSourceDetached,
} from '../web-idl/buffer-source';
import type { BindingContext } from '../web-idl/projection';

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 0;
}

export function cloneAsUint8Array(
  context: BindingContext,
  value: object,
): object {
  const bytes = getBufferSourceCopy(value);
  const buffer = createArrayBuffer(bytes, context.realm);
  return createArrayBufferViewFromBuffer(
    'Uint8Array',
    buffer,
    0,
    bytes.length,
    bytes.length,
    context.realm,
  );
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
