// @rollup-cycle streams-readable
import {
  arg, defineInterface, idlType, impl, nullable, op, roAttr, reference,
  type BufferViewTypeName,
} from '../web-idl/declaration/index';
import {
  createArrayBuffer, getBufferSourceByteLength,
  getBufferSourceUnderlyingBuffer,
} from '../web-idl/buffer-source';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import type { StreamPromise } from './promise';
import {
  cancelSteps, pullSteps, releaseSteps,
} from './internal-methods';
import type { ReadRequest } from './readable-stream-default-reader';
import { ReadableStreamImpl } from './readable-stream';
import type { ReadableStreamBYOBRequestImpl } from './readable-stream-byob-request';
import {
  readableByteStreamControllerCallPullIfNeeded,
  readableByteStreamControllerClearAlgorithms,
  readableByteStreamControllerClearPendingPullIntos,
  readableByteStreamControllerClose,
  readableByteStreamControllerEnqueue,
  readableByteStreamControllerError,
  readableByteStreamControllerFillReadRequestFromQueue,
  readableByteStreamControllerGetBYOBRequest,
  readableByteStreamControllerGetDesiredSize,
  readableStreamAddReadRequest,
  readableStreamGetNumReadRequests,
  readableStreamHasDefaultReader,
} from './readable-byte-stream-operations';

export class ReadableByteStreamControllerImpl {
  readonly #context: BindingContext;
  #state?: ReadableByteStreamControllerState;

  constructor(context: BindingContext) {
    this.#context = context;
  }

  get byobRequest(): ReadableStreamBYOBRequestImpl | null {
    return readableByteStreamControllerGetBYOBRequest(this);
  }

  get desiredSize(): number | null {
    return readableByteStreamControllerGetDesiredSize(this);
  }

  close(): void {
    const state = ReadableByteStreamControllerImpl.getState(this);
    if (state.closeRequested) {
      throw new this.#context.realm.intrinsics.typeError(
        'The stream has already been closed',
      );
    }
    const streamState = ReadableStreamImpl.getState(state.stream).state;
    if (streamState !== 'readable') {
      throw new this.#context.realm.intrinsics.typeError(
        `A stream in the ${streamState} state cannot be closed`,
      );
    }
    readableByteStreamControllerClose(this);
  }

  enqueue(chunk: object): void {
    if (getBufferSourceByteLength(chunk) === 0) {
      throw new this.#context.realm.intrinsics.typeError(
        'chunk must have non-zero byteLength',
      );
    }
    if (getBufferSourceByteLength(
      getBufferSourceUnderlyingBuffer(chunk),
    ) === 0) {
      throw new this.#context.realm.intrinsics.typeError(
        'chunk\'s buffer must have non-zero byteLength',
      );
    }

    const state = ReadableByteStreamControllerImpl.getState(this);
    if (state.closeRequested) {
      throw new this.#context.realm.intrinsics.typeError(
        'The stream is closed or draining',
      );
    }
    const streamState = ReadableStreamImpl.getState(state.stream).state;
    if (streamState !== 'readable') {
      throw new this.#context.realm.intrinsics.typeError(
        `A stream in the ${streamState} state cannot be enqueued to`,
      );
    }
    readableByteStreamControllerEnqueue(this, chunk);
  }

  error(error?: unknown): void {
    readableByteStreamControllerError(this, error);
  }

  readonly [cancelSteps] = (reason: unknown): StreamPromise => {
    const state = ReadableByteStreamControllerImpl.getState(this);
    readableByteStreamControllerClearPendingPullIntos(this);
    state.queue = [];
    state.queueTotalSize = 0;
    const result = requireAlgorithm(state.cancelAlgorithm, 'cancel')(reason);
    readableByteStreamControllerClearAlgorithms(this);
    return result;
  };

  readonly [pullSteps] = (request: ReadRequest): void => {
    const state = ReadableByteStreamControllerImpl.getState(this);
    if (!readableStreamHasDefaultReader(state.stream)) {
      throw new Error('Byte-stream default pull requires a default reader');
    }

    if (state.queueTotalSize > 0) {
      if (readableStreamGetNumReadRequests(state.stream) !== 0) {
        throw new Error('Queued bytes cannot coexist with read requests');
      }
      readableByteStreamControllerFillReadRequestFromQueue(this, request);
      return;
    }

    const autoAllocateChunkSize = state.autoAllocateChunkSize;
    if (autoAllocateChunkSize !== undefined) {
      let buffer: object;
      try {
        buffer = createArrayBuffer(
          new Uint8Array(autoAllocateChunkSize),
          this.#context.realm,
        );
      } catch (error) {
        request.errorSteps(error);
        return;
      }
      state.pendingPullIntos.push({
        buffer,
        bufferByteLength: autoAllocateChunkSize,
        byteLength: autoAllocateChunkSize,
        byteOffset: 0,
        bytesFilled: 0,
        elementSize: 1,
        minimumFill: 1,
        readerType: 'default',
        viewType: 'Uint8Array',
      });
    }

    readableStreamAddReadRequest(state.stream, request);
    readableByteStreamControllerCallPullIfNeeded(this);
  };

  readonly [releaseSteps] = (): void => {
    const state = ReadableByteStreamControllerImpl.getState(this);
    if (state.pendingPullIntos.length === 0) return;
    const first = state.pendingPullIntos[0];
    if (!first) return;
    first.readerType = 'none';
    state.pendingPullIntos = [first];
  };

  // -- Friends ----------------------------------------------------------

  static getContext(
    controller: ReadableByteStreamControllerImpl,
  ): BindingContext {
    return controller.#context;
  }

  static is(value: unknown): value is ReadableByteStreamControllerImpl {
    return typeof value === 'object' && value !== null && #context in value;
  }

  static getState(
    controller: ReadableByteStreamControllerImpl,
  ): ReadableByteStreamControllerState {
    if (!controller.#state) {
      throw new Error('ReadableByteStreamController is not set up');
    }
    return controller.#state;
  }

  static setState(
    controller: ReadableByteStreamControllerImpl,
    state: ReadableByteStreamControllerState,
  ): void {
    controller.#state = state;
  }
}

export type ReadableByteStreamControllerState =
  {
    autoAllocateChunkSize?: number;
    byobRequest: ReadableStreamBYOBRequestImpl | null;
    cancelAlgorithm?: (reason: unknown) => StreamPromise;
    closeRequested: boolean;
    pendingPullIntos: PullIntoDescriptor[];
    pullAgain: boolean;
    pullAlgorithm?: () => StreamPromise;
    pulling: boolean;
    queue: ByteQueueEntry[];
    queueTotalSize: number;
    started: boolean;
    strategyHighWaterMark: number;
    stream: ReadableStreamImpl;
  };

export type ByteQueueEntry = {
  buffer: object;
  byteLength: number;
  byteOffset: number;
};

export type PullIntoDescriptor = {
  buffer: object;
  bufferByteLength: number;
  byteLength: number;
  byteOffset: number;
  bytesFilled: number;
  elementSize: number;
  minimumFill: number;
  readerType: 'byob' | 'default' | 'none';
  viewType: BufferViewTypeName;
};

export const readableByteStreamControllerIDL = defineInterface({
  name: 'ReadableByteStreamController',
  exposed: '*',
  implementation: impl(ReadableByteStreamControllerImpl, {
    constructWith: [bindingContext],
  }),
  members: [
    roAttr('byobRequest', nullable(reference('ReadableStreamBYOBRequest'))),
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('close', idlType.undefined),
    op('enqueue', idlType.undefined, [
      arg('chunk', reference('ArrayBufferView')),
    ]),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
});

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Readable stream ${name} algorithm is gone`);
  return algorithm;
}
