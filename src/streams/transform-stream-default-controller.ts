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
    transformAlgorithm: (chunk: unknown) => Promise<unknown>,
    flushAlgorithm: () => Promise<unknown>,
    cancelAlgorithm: (reason: unknown) => Promise<unknown>,
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
      transform ? (chunk) => new Promise((resolve) => {
        resolve(Reflect.apply(transform, transformer, [chunk, this]));
      }) : (chunk) => new Promise<void>((resolve) => {
        this.enqueue(chunk);
        resolve();
      }),
      flush ? () => new Promise((resolve) => {
        resolve(Reflect.apply(flush, transformer, [this]));
      }) : () => Promise.resolve(),
      cancel ? (reason) => new Promise((resolve) => {
        resolve(Reflect.apply(cancel, transformer, [reason]));
      }) : () => Promise.resolve(),
    );
  }

  performTransform(chunk: unknown): Promise<unknown> {
    return requireAlgorithm(this.state.transformAlgorithm, 'transform')(chunk)
      .catch((reason: unknown) => {
        this.state.stream.error(reason);
        throw reason;
      });
  }

  flush(): Promise<unknown> {
    return requireAlgorithm(this.state.flushAlgorithm, 'flush')();
  }

  cancel(reason: unknown): Promise<unknown> {
    return requireAlgorithm(this.state.cancelAlgorithm, 'cancel')(reason);
  }

  clearAlgorithms(): void {
    this.state.transformAlgorithm = undefined;
    this.state.flushAlgorithm = undefined;
    this.state.cancelAlgorithm = undefined;
  }
}

export type TransformStreamDefaultControllerState = {
  cancelAlgorithm?: (reason: unknown) => Promise<unknown>;
  finishPromise?: Promise<void>;
  flushAlgorithm?: () => Promise<unknown>;
  stream: TransformStreamImpl;
  transformAlgorithm?: (chunk: unknown) => Promise<unknown>;
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
