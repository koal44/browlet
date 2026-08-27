import type { StreamEnvironment } from './environment';

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
  environment: StreamEnvironment,
  destination: object,
  destinationOffset: number,
  source: object,
  sourceOffset: number,
  count: number,
): void {
  environment.buffers.copy(
    destination,
    destinationOffset,
    source,
    sourceOffset,
    count,
  );
}

export function transferArrayBuffer(
  environment: StreamEnvironment,
  buffer: object,
): object {
  if (isDetachedBuffer(environment, buffer)) {
    throw new TypeError('Cannot transfer a detached ArrayBuffer');
  }
  return environment.buffers.transfer(buffer);
}

// JavaScript exposes no non-destructive test for [[ArrayBufferDetachKey]].
// The actual transfer operation remains authoritative until the host does.
export function canTransferArrayBuffer(
  environment: StreamEnvironment,
  buffer: object,
): boolean {
  return !isDetachedBuffer(environment, buffer);
}

export function isDetachedBuffer(
  environment: StreamEnvironment,
  buffer: object,
): boolean {
  return environment.buffers.isDetached(buffer);
}
