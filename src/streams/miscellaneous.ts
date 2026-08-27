import type { StreamEnvironment } from './environment';
import { isDetachedBuffer } from './ecmascript';

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 0;
}

export function cloneAsUint8Array(
  environment: StreamEnvironment,
  value: object,
): object {
  const buffer = environment.buffers.getBuffer(value);
  const clone = environment.buffers.clone(
    buffer,
    environment.buffers.getByteOffset(value),
    environment.buffers.getByteLength(value),
  );
  return environment.buffers.createView(
    'Uint8Array',
    clone,
    0,
    environment.buffers.getByteLength(clone),
  );
}

export function canCopyDataBlockBytes(
  environment: StreamEnvironment,
  destination: object,
  destinationOffset: number,
  source: object,
  sourceOffset: number,
  count: number,
): boolean {
  return destination !== source &&
    !isDetachedBuffer(environment, destination) &&
    !isDetachedBuffer(environment, source) &&
    destinationOffset + count <= environment.buffers.getByteLength(
      destination,
    ) &&
    sourceOffset + count <= environment.buffers.getByteLength(source);
}
