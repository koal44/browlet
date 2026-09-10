import type { PromiseValue } from '../js-engine/promises';
import {
  arg, defineInterface, idlType, impl, nullable, op, roAttr,
} from '../web-idl/declaration/index';
import { TypeError } from '../js-engine/simple-exception';
import {
  readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerClose, readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerHasBackpressure,
} from './readable-stream-operations';
import { ReadableStreamImpl } from './readable-stream';
import type { TransformerRecord, TransformStreamImpl } from './transform-stream';

export class TransformStreamDefaultControllerImpl {
  state!: TransformStreamDefaultControllerState;

  get desiredSize(): number | null {
    return readableStreamDefaultControllerGetDesiredSize(this.state.stream.readableController);
  }

  enqueue(chunk?: unknown): void {
    const { stream } = this.state;
    const controller = stream.readableController;
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
      throw new TypeError('Readable side is not in a state that permits enqueue');
    }
    try {
      readableStreamDefaultControllerEnqueue(controller, chunk);
    } catch (error) {
      stream.errorWritableAndUnblockWrite(error);
      throw ReadableStreamImpl.getState(stream.readable).storedError;
    }
    const backpressure = readableStreamDefaultControllerHasBackpressure(controller);
    if (backpressure !== stream.state.backpressure) {
      if (!backpressure) throw new Error('Transform stream unexpectedly lost backpressure');
      stream.setBackpressure(true);
    }
  }

  error(reason?: unknown): void {
    this.state.stream.error(reason);
  }

  terminate(): void {
    const { stream } = this.state;
    readableStreamDefaultControllerClose(stream.readableController);
    stream.errorWritableAndUnblockWrite(new TypeError('TransformStream terminated'));
  }

  setUp(
    stream: TransformStreamImpl,
    transformAlgorithm: (chunk: unknown) => PromiseValue<unknown>,
    flushAlgorithm: () => PromiseValue<unknown>,
    cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
  ): void {
    if (stream.state.controller) throw new Error('TransformStream already has a controller');
    this.state = { stream, transformAlgorithm, flushAlgorithm, cancelAlgorithm };
    stream.state.controller = this;
  }

  // SPEC_MISMATCH: SetUpTransformStreamDefaultControllerFromTransformer(stream, transformer, transformerDict) -> void
  setUpFromTransformer(
    stream: TransformStreamImpl,
    transformer: TransformerRecord,
    transformerDict: TransformerRecord,
  ): void {
    const { transform, flush, cancel } = transformerDict;
    this.setUp(
      stream,
      (chunk) => stream.runtime.promises.try(() => transform ? transform.call(transformer, chunk, this) : this.enqueue(chunk)),
      () => stream.runtime.promises.try(() => flush?.call(transformer, this)),
      (reason) => stream.runtime.promises.try(() => cancel?.call(transformer, reason)),
    );
  }

  // SPEC_MISMATCH: TransformStreamDefaultControllerPerformTransform(controller, chunk) -> Promise<undefined>
  performTransform(chunk: unknown): PromiseValue<unknown> {
    return requireAlgorithm(this.state.transformAlgorithm, 'transform')(chunk)
      .then(undefined, (reason: unknown) => {
        this.state.stream.error(reason);
        throw reason;
      });
  }

  flush(): PromiseValue<unknown> {
    return requireAlgorithm(this.state.flushAlgorithm, 'flush')();
  }

  cancel(reason: unknown): PromiseValue<unknown> {
    return requireAlgorithm(this.state.cancelAlgorithm, 'cancel')(reason);
  }

  clearAlgorithms(): void {
    this.state.transformAlgorithm = undefined;
    this.state.flushAlgorithm = undefined;
    this.state.cancelAlgorithm = undefined;
  }
}

export type TransformStreamDefaultControllerState = {
  cancelAlgorithm?: (reason: unknown) => PromiseValue<unknown>;
  finishPromise?: PromiseValue<void>;
  flushAlgorithm?: () => PromiseValue<unknown>;
  stream: TransformStreamImpl;
  transformAlgorithm?: (chunk: unknown) => PromiseValue<unknown>;
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

function requireAlgorithm<Algorithm>(algorithm: Algorithm | undefined, name: string): Algorithm {
  if (!algorithm) throw new Error(`Transform stream ${name} algorithm is gone`);
  return algorithm;
}
