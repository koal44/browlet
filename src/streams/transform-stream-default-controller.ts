import {
  arg, defineInterface, idlType, impl, nullable, op, roAttr,
} from '../web-idl/declaration/index';
import type { StreamPromise } from './promise';
import {
  transformStreamDefaultControllerEnqueue,
  transformStreamDefaultControllerError,
  transformStreamDefaultControllerGetDesiredSize,
  transformStreamDefaultControllerTerminate,
} from './transform-stream-operations';
import type { TransformStreamImpl } from './transform-stream';

export class TransformStreamDefaultControllerImpl {
  state!: TransformStreamDefaultControllerState;

  get desiredSize(): number | null {
    return transformStreamDefaultControllerGetDesiredSize(this);
  }

  enqueue(chunk?: unknown): void {
    transformStreamDefaultControllerEnqueue(this, chunk);
  }

  error(reason?: unknown): void {
    transformStreamDefaultControllerError(this, reason);
  }

  terminate(): void {
    transformStreamDefaultControllerTerminate(this);
  }
}

export type TransformStreamDefaultControllerState = {
  cancelAlgorithm?: (reason: unknown) => StreamPromise;
  finishPromise?: StreamPromise;
  flushAlgorithm?: () => StreamPromise;
  stream: TransformStreamImpl;
  transformAlgorithm?: (chunk: unknown) => StreamPromise;
};

export const transformStreamDefaultControllerIDL = defineInterface({
  name: 'TransformStreamDefaultController',
  exposed: '*',
  implementation: impl(TransformStreamDefaultControllerImpl),
  members: [
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('enqueue', idlType.undefined, [
      arg('chunk', idlType.any, { optional: true }),
    ]),
    op('error', idlType.undefined, [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('terminate', idlType.undefined),
  ],
});
