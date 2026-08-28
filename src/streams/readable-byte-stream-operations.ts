// @rollup-cycle streams-readable
import { idlType } from '../web-idl/declaration/index';
import {
  ReadableByteStreamControllerImpl,
  type PullIntoDescriptor,
  type ReadableByteStreamControllerState,
} from './readable-byte-stream-controller';
import {
  ReadableStreamBYOBReaderImpl, type ReadIntoRequest,
} from './readable-stream-byob-reader';
import { ReadableStreamBYOBRequestImpl } from './readable-stream-byob-request';
import {
  ReadableStreamDefaultReaderImpl, type ReadRequest,
} from './readable-stream-default-reader';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  ReadableStreamImpl, type UnderlyingSource,
} from './readable-stream';
import {
  isReadableStreamLocked, readableStreamCancel, readableStreamClose,
  readableStreamError,
  readableStreamDefaultReaderRead, readableStreamDefaultReaderRelease,
  readableStreamReaderGenericInitialize, readableStreamReaderGenericRelease,
  setUpReadableStreamDefaultReader,
} from './readable-stream-operations';
import type { StreamEnvironment, StreamPromise } from './environment';
import { internalStreamSetup } from './internal-methods';
import {
  canTransferArrayBuffer, copyDataBlockBytes, isDetachedBuffer,
  transferArrayBuffer,
} from './ecmascript';

export function setUpReadableStreamBYOBReader(
  reader: ReadableStreamBYOBReaderImpl,
  stream: ReadableStreamImpl,
): void {
  if (isReadableStreamLocked(stream)) {
    throw new TypeError(
      'This stream has already been locked for exclusive reading',
    );
  }
  if (!ReadableByteStreamControllerImpl.is(
    ReadableStreamImpl.getState(stream).controller,
  )) {
    throw new TypeError(
      'A BYOB reader requires a stream constructed with a byte source',
    );
  }

  const generic = ReadableStreamBYOBReaderImpl.getGenericReader(reader);
  readableStreamReaderGenericInitialize(generic, reader, stream);
  ReadableStreamBYOBReaderImpl.resetReadIntoRequests(reader);
}

export function acquireReadableStreamBYOBReader(
  stream: ReadableStreamImpl,
): ReadableStreamBYOBReaderImpl {
  const reader = ReadableStreamImpl.getEnvironment(stream).objects.create(
    ReadableStreamBYOBReaderImpl,
  );
  setUpReadableStreamBYOBReader(reader, stream);
  return reader;
}

export function readableByteStreamTee(
  stream: ReadableStreamImpl,
): [ReadableStreamImpl, ReadableStreamImpl] {
  const environment = ReadableStreamImpl.getEnvironment(stream);
  let reader: ReadableStreamDefaultReaderImpl | ReadableStreamBYOBReaderImpl =
    ReadableStreamImpl.getEnvironment(stream).objects.create(
      ReadableStreamDefaultReaderImpl,
    );
  setUpReadableStreamDefaultReader(reader, stream);
  let readAgainForBranch1 = false;
  let readAgainForBranch2 = false;
  let reading = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: unknown = undefined;
  let reason2: unknown = undefined;
  const cancelPromise = environment.promises.create(idlType.undefined);

  const forwardReaderError = (
    currentReader: ReadableStreamDefaultReaderImpl |
      ReadableStreamBYOBReaderImpl,
  ): void => {
    const generic = ReadableStreamDefaultReaderImpl.is(currentReader)
      ? ReadableStreamDefaultReaderImpl.getGenericReader(currentReader)
      : ReadableStreamBYOBReaderImpl.getGenericReader(currentReader);
    environment.promises.react(
      ReadableStreamGenericReaderMixin.getState(generic).closedPromise,
      idlType.undefined,
      {
        fulfilled: () => undefined,
        rejected(reason) {
          if (currentReader !== reader) return;
          readableByteStreamControllerError(
            requireByteController(branch1),
            reason,
          );
          readableByteStreamControllerError(
            requireByteController(branch2),
            reason,
          );
          if (!canceled1 || !canceled2) {
            environment.promises.resolve(cancelPromise, undefined);
          }
        },
      },
    );
  };

  const pullWithDefaultReader = (): void => {
    if (ReadableStreamBYOBReaderImpl.is(reader)) {
      assert(ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader).length === 0);
      readableStreamBYOBReaderRelease(reader);
      reader = ReadableStreamImpl.getEnvironment(stream).objects.create(
        ReadableStreamDefaultReaderImpl,
      );
      setUpReadableStreamDefaultReader(reader, stream);
      forwardReaderError(reader);
    }

    readableStreamDefaultReaderRead(reader, {
      chunkSteps(chunk) {
        const byteChunk = requireObject(chunk);
        environment.queueMicrotask(() => {
          readAgainForBranch1 = false;
          readAgainForBranch2 = false;
          let chunk2 = byteChunk;
          if (!canceled1 && !canceled2) {
            try {
              chunk2 = cloneAsUint8Array(environment, byteChunk);
            } catch (error) {
              readableByteStreamControllerError(
                requireByteController(branch1),
                error,
              );
              readableByteStreamControllerError(
                requireByteController(branch2),
                error,
              );
              settleCancelPromise(error);
              return;
            }
          }
          if (!canceled1) {
            readableByteStreamControllerEnqueue(
              requireByteController(branch1),
              byteChunk,
            );
          }
          if (!canceled2) {
            readableByteStreamControllerEnqueue(
              requireByteController(branch2),
              chunk2,
            );
          }
          reading = false;
          // Enqueuing can synchronously reenter a branch pull algorithm.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (readAgainForBranch1) void pull1Algorithm();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          else if (readAgainForBranch2) void pull2Algorithm();
        });
      },
      closeSteps() {
        reading = false;
        const controller1 = requireByteController(branch1);
        const controller2 = requireByteController(branch2);
        if (!canceled1) readableByteStreamControllerClose(controller1);
        if (!canceled2) readableByteStreamControllerClose(controller2);
        if (ReadableByteStreamControllerImpl.getState(
          controller1,
        ).pendingPullIntos.length > 0) {
          readableByteStreamControllerRespond(controller1, 0);
        }
        if (ReadableByteStreamControllerImpl.getState(
          controller2,
        ).pendingPullIntos.length > 0) {
          readableByteStreamControllerRespond(controller2, 0);
        }
        if (!canceled1 || !canceled2) {
          environment.promises.resolve(cancelPromise, undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    });
  };

  const pullWithBYOBReader = (
    view: object,
    forBranch2: boolean,
  ): void => {
    if (ReadableStreamDefaultReaderImpl.is(reader)) {
      assert(ReadableStreamDefaultReaderImpl.getReadRequests(reader).length === 0);
      readableStreamDefaultReaderRelease(reader);
      reader = acquireReadableStreamBYOBReader(stream);
      forwardReaderError(reader);
    }

    const byobBranch = forBranch2 ? branch2 : branch1;
    const otherBranch = forBranch2 ? branch1 : branch2;
    readableStreamBYOBReaderRead(reader, view, 1, {
      chunkSteps(chunk) {
        environment.queueMicrotask(() => {
          readAgainForBranch1 = false;
          readAgainForBranch2 = false;
          const byobCanceled = forBranch2 ? canceled2 : canceled1;
          const otherCanceled = forBranch2 ? canceled1 : canceled2;
          if (!otherCanceled) {
            let clonedChunk: object;
            try {
              clonedChunk = cloneAsUint8Array(environment, chunk);
            } catch (error) {
              readableByteStreamControllerError(
                requireByteController(byobBranch),
                error,
              );
              readableByteStreamControllerError(
                requireByteController(otherBranch),
                error,
              );
              settleCancelPromise(error);
              return;
            }
            if (!byobCanceled) {
              readableByteStreamControllerRespondWithNewView(
                requireByteController(byobBranch),
                chunk,
              );
            }
            readableByteStreamControllerEnqueue(
              requireByteController(otherBranch),
              clonedChunk,
            );
          } else if (!byobCanceled) {
            readableByteStreamControllerRespondWithNewView(
              requireByteController(byobBranch),
              chunk,
            );
          }
          reading = false;
          // Enqueuing can synchronously reenter a branch pull algorithm.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (readAgainForBranch1) void pull1Algorithm();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          else if (readAgainForBranch2) void pull2Algorithm();
        });
      },
      closeSteps(chunk) {
        reading = false;
        const byobCanceled = forBranch2 ? canceled2 : canceled1;
        const otherCanceled = forBranch2 ? canceled1 : canceled2;
        const byobController = requireByteController(byobBranch);
        const otherController = requireByteController(otherBranch);
        if (!byobCanceled) readableByteStreamControllerClose(byobController);
        if (!otherCanceled) readableByteStreamControllerClose(otherController);
        if (chunk !== undefined) {
          assert(environment.buffers.getByteLength(chunk) === 0);
          if (!byobCanceled) {
            readableByteStreamControllerRespondWithNewView(
              byobController,
              chunk,
            );
          }
          if (!otherCanceled && ReadableByteStreamControllerImpl.getState(
            otherController,
          ).pendingPullIntos.length > 0) {
            readableByteStreamControllerRespond(otherController, 0);
          }
        }
        if (!byobCanceled || !otherCanceled) {
          environment.promises.resolve(cancelPromise, undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    });
  };

  const pull1Algorithm = (): StreamPromise => {
    if (reading) {
      readAgainForBranch1 = true;
      return resolvedUndefined(environment);
    }
    reading = true;
    const request = readableByteStreamControllerGetBYOBRequest(
      requireByteController(branch1),
    );
    const view = request?.view;
    if (view) pullWithBYOBReader(view, false);
    else pullWithDefaultReader();
    return resolvedUndefined(environment);
  };
  const pull2Algorithm = (): StreamPromise => {
    if (reading) {
      readAgainForBranch2 = true;
      return resolvedUndefined(environment);
    }
    reading = true;
    const request = readableByteStreamControllerGetBYOBRequest(
      requireByteController(branch2),
    );
    const view = request?.view;
    if (view) pullWithBYOBReader(view, true);
    else pullWithDefaultReader();
    return resolvedUndefined(environment);
  };
  const cancel1Algorithm = (reason: unknown): StreamPromise => {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) settleCancelPromise([reason1, reason2]);
    return cancelPromise;
  };
  const cancel2Algorithm = (reason: unknown): StreamPromise => {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) settleCancelPromise([reason1, reason2]);
    return cancelPromise;
  };
  const source1: UnderlyingSource = {
    cancel: cancel1Algorithm,
    pull: pull1Algorithm,
    start: () => undefined,
    type: 'bytes',
  };
  const source2: UnderlyingSource = {
    cancel: cancel2Algorithm,
    pull: pull2Algorithm,
    start: () => undefined,
    type: 'bytes',
  };
  const branch1 = environment.objects.construct(ReadableStreamImpl, [source1]);
  const branch2 = environment.objects.construct(ReadableStreamImpl, [source2]);
  forwardReaderError(reader);
  return [branch1, branch2];

  function settleCancelPromise(reason: unknown): void {
    environment.promises.react(
      readableStreamCancel(stream, reason),
      idlType.undefined,
      {
        fulfilled: () => environment.promises.resolve(
          cancelPromise,
          undefined,
        ),
        rejected: (error) => environment.promises.reject(
          cancelPromise,
          error,
        ),
      },
    );
  }
}

export function readableStreamBYOBReaderRead(
  reader: ReadableStreamBYOBReaderImpl,
  view: object,
  minimum: number,
  request: ReadIntoRequest,
): void {
  const generic = ReadableStreamBYOBReaderImpl.getGenericReader(reader);
  const stream = ReadableStreamGenericReaderMixin.getState(generic).stream;
  if (!stream) throw new Error('Cannot read through a released BYOB reader');

  const streamState = ReadableStreamImpl.getState(stream);
  streamState.disturbed = true;
  if (streamState.state === 'errored') {
    request.errorSteps(streamState.storedError);
    return;
  }
  const controller = streamState.controller;
  if (!ReadableByteStreamControllerImpl.is(controller)) {
    throw new Error('BYOB reader is attached to a non-byte stream');
  }
  readableByteStreamControllerPullInto(
    controller,
    view,
    minimum,
    request,
  );
}

export function readableStreamBYOBReaderRelease(
  reader: ReadableStreamBYOBReaderImpl,
): void {
  const generic = ReadableStreamBYOBReaderImpl.getGenericReader(reader);
  readableStreamReaderGenericRelease(generic, reader);
  errorReadIntoRequests(reader, new TypeError('Reader was released'));
}

export function readableStreamAddReadIntoRequest(
  stream: ReadableStreamImpl,
  request: ReadIntoRequest,
): void {
  const reader = ReadableStreamImpl.getState(stream).reader;
  if (!ReadableStreamBYOBReaderImpl.is(reader)) {
    throw new Error('Readable stream has no BYOB reader');
  }
  ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader).push(request);
}

export function readableStreamAddReadRequest(
  stream: ReadableStreamImpl,
  request: ReadRequest,
): void {
  const reader = ReadableStreamImpl.getState(stream).reader;
  if (!ReadableStreamDefaultReaderImpl.is(reader)) {
    throw new Error('Readable stream has no default reader');
  }
  ReadableStreamDefaultReaderImpl.getReadRequests(reader).push(request);
}

export function readableStreamGetNumReadIntoRequests(
  stream: ReadableStreamImpl,
): number {
  const reader = ReadableStreamImpl.getState(stream).reader;
  if (!ReadableStreamBYOBReaderImpl.is(reader)) {
    throw new Error('Readable stream has no BYOB reader');
  }
  return ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader).length;
}

export function readableStreamGetNumReadRequests(
  stream: ReadableStreamImpl,
): number {
  const reader = ReadableStreamImpl.getState(stream).reader;
  if (!ReadableStreamDefaultReaderImpl.is(reader)) {
    throw new Error('Readable stream has no default reader');
  }
  return ReadableStreamDefaultReaderImpl.getReadRequests(reader).length;
}

export function readableStreamHasBYOBReader(
  stream: ReadableStreamImpl,
): boolean {
  return ReadableStreamBYOBReaderImpl.is(
    ReadableStreamImpl.getState(stream).reader,
  );
}

export function readableStreamHasDefaultReader(
  stream: ReadableStreamImpl,
): boolean {
  return ReadableStreamDefaultReaderImpl.is(
    ReadableStreamImpl.getState(stream).reader,
  );
}

export function readableByteStreamControllerCallPullIfNeeded(
  controller: ReadableByteStreamControllerImpl,
): void {
  if (!shouldCallPull(controller)) return;
  const state = ReadableByteStreamControllerImpl.getState(controller);
  if (state.pulling) {
    state.pullAgain = true;
    return;
  }

  state.pulling = true;
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  const promise = requireAlgorithm(state.pullAlgorithm, 'pull')();
  environment.promises.react(promise, idlType.undefined, {
    fulfilled() {
      state.pulling = false;
      if (state.pullAgain) {
        state.pullAgain = false;
        readableByteStreamControllerCallPullIfNeeded(controller);
      }
    },
    rejected(error) {
      readableByteStreamControllerError(controller, error);
    },
  });
}

export function readableByteStreamControllerClearAlgorithms(
  controller: ReadableByteStreamControllerImpl,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  state.pullAlgorithm = undefined;
  state.cancelAlgorithm = undefined;
}

export function readableByteStreamControllerClearPendingPullIntos(
  controller: ReadableByteStreamControllerImpl,
): void {
  invalidateBYOBRequest(controller);
  ReadableByteStreamControllerImpl.getState(controller).pendingPullIntos = [];
}

export function readableByteStreamControllerClose(
  controller: ReadableByteStreamControllerImpl,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const streamState = ReadableStreamImpl.getState(state.stream);
  if (state.closeRequested || streamState.state !== 'readable') return;
  if (state.queueTotalSize > 0) {
    state.closeRequested = true;
    return;
  }

  const first = state.pendingPullIntos[0];
  if (first && first.bytesFilled % first.elementSize !== 0) {
    const error = new TypeError(
      'Insufficient bytes to fill elements in the supplied buffer',
    );
    readableByteStreamControllerError(controller, error);
    throw error;
  }
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamClose(state.stream);
}

export function readableByteStreamControllerEnqueue(
  controller: ReadableByteStreamControllerImpl,
  chunk: object,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const streamState = ReadableStreamImpl.getState(state.stream);
  if (state.closeRequested || streamState.state !== 'readable') return;

  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  const { buffers } = environment;
  const buffer = buffers.getBuffer(chunk);
  const byteOffset = buffers.getByteOffset(chunk);
  const byteLength = buffers.getByteLength(chunk);
  if (isDetachedBuffer(environment, buffer)) {
    throw new TypeError('chunk\'s buffer is detached');
  }
  const transferredBuffer = transferArrayBuffer(environment, buffer);

  const first = state.pendingPullIntos[0];
  if (first) {
    if (isDetachedBuffer(environment, first.buffer)) {
      throw new TypeError('The BYOB request\'s buffer is detached');
    }
    invalidateBYOBRequest(controller);
    first.buffer = transferArrayBuffer(environment, first.buffer);
    if (first.readerType === 'none') {
      enqueueDetachedPullIntoToQueue(controller, first);
    }
  }

  if (readableStreamHasDefaultReader(state.stream)) {
    processReadRequestsUsingQueue(controller);
    if (readableStreamGetNumReadRequests(state.stream) === 0) {
      assert(state.pendingPullIntos.length === 0);
      enqueueChunkToQueue(
        controller,
        transferredBuffer,
        byteOffset,
        byteLength,
      );
    } else {
      assert(state.queue.length === 0);
      if (state.pendingPullIntos.length > 0) shiftPendingPullInto(controller);
      const view = buffers.createView(
        'Uint8Array',
        transferredBuffer,
        byteOffset,
        byteLength,
      );
      fulfillReadRequest(state.stream, view, false);
    }
  } else if (readableStreamHasBYOBReader(state.stream)) {
    enqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength,
    );
    for (const descriptor of processPullIntosUsingQueue(controller)) {
      commitPullIntoDescriptor(state.stream, descriptor);
    }
  } else {
    enqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength,
    );
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

export function readableByteStreamControllerError(
  controller: ReadableByteStreamControllerImpl,
  error: unknown,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  if (ReadableStreamImpl.getState(state.stream).state !== 'readable') return;
  readableByteStreamControllerClearPendingPullIntos(controller);
  state.queue = [];
  state.queueTotalSize = 0;
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamError(state.stream, error);
}

export function readableByteStreamControllerFillReadRequestFromQueue(
  controller: ReadableByteStreamControllerImpl,
  request: ReadRequest,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  assert(state.queueTotalSize > 0);
  const entry = state.queue.shift();
  assert(entry !== undefined);
  state.queueTotalSize -= entry.byteLength;
  handleQueueDrain(controller);

  const view = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  ).buffers.createView(
    'Uint8Array',
    entry.buffer,
    entry.byteOffset,
    entry.byteLength,
  );
  request.chunkSteps(view);
}

export function readableByteStreamControllerGetBYOBRequest(
  controller: ReadableByteStreamControllerImpl,
): ReadableStreamBYOBRequestImpl | null {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  if (!state.byobRequest && state.pendingPullIntos.length > 0) {
    const first = state.pendingPullIntos[0];
    assert(first !== undefined);
    const environment = ReadableByteStreamControllerImpl.getEnvironment(
      controller,
    );
    const view = environment.buffers.createView(
      'Uint8Array',
      first.buffer,
      first.byteOffset + first.bytesFilled,
      first.byteLength - first.bytesFilled,
    );
    const request = environment.objects.create(ReadableStreamBYOBRequestImpl);
    ReadableStreamBYOBRequestImpl.initialize(request, controller, view);
    state.byobRequest = request;
  }
  return state.byobRequest;
}

export function readableByteStreamControllerGetDesiredSize(
  controller: ReadableByteStreamControllerImpl,
): number | null {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const streamState = ReadableStreamImpl.getState(state.stream).state;
  if (streamState === 'errored') return null;
  if (streamState === 'closed') return 0;
  return state.strategyHighWaterMark - state.queueTotalSize;
}

export function readableByteStreamControllerPullInto(
  controller: ReadableByteStreamControllerImpl,
  view: object,
  minimum: number,
  request: ReadIntoRequest,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  const buffers = environment.buffers;
  const viewType = buffers.getViewType(view);
  const elementSize = bufferViewElementSizes[viewType];
  const minimumFill = minimum * elementSize;
  const byteOffset = buffers.getByteOffset(view);
  const byteLength = buffers.getByteLength(view);
  const originalBuffer = buffers.getBuffer(view);
  const bufferByteLength = buffers.getByteLength(originalBuffer);

  let buffer: object;
  try {
    buffer = transferArrayBuffer(environment, originalBuffer);
  } catch (error) {
    request.errorSteps(error);
    return;
  }
  const descriptor: PullIntoDescriptor = {
    buffer,
    bufferByteLength,
    byteLength,
    byteOffset,
    bytesFilled: 0,
    elementSize,
    minimumFill,
    readerType: 'byob',
    viewType,
  };

  if (state.pendingPullIntos.length > 0) {
    state.pendingPullIntos.push(descriptor);
    readableStreamAddReadIntoRequest(state.stream, request);
    return;
  }
  if (ReadableStreamImpl.getState(state.stream).state === 'closed') {
    request.closeSteps(createDescriptorView(environment, descriptor, 0));
    return;
  }
  if (state.queueTotalSize > 0) {
    if (fillPullIntoFromQueue(controller, descriptor)) {
      const filled = convertPullIntoDescriptor(controller, descriptor);
      handleQueueDrain(controller);
      request.chunkSteps(filled);
      return;
    }
    if (state.closeRequested) {
      const error = new TypeError(
        'Insufficient bytes to fill elements in the supplied buffer',
      );
      readableByteStreamControllerError(controller, error);
      request.errorSteps(error);
      return;
    }
  }

  state.pendingPullIntos.push(descriptor);
  readableStreamAddReadIntoRequest(state.stream, request);
  readableByteStreamControllerCallPullIfNeeded(controller);
}

export function readableByteStreamControllerRespond(
  controller: ReadableByteStreamControllerImpl,
  bytesWritten: number,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const first = state.pendingPullIntos[0];
  assert(first !== undefined);
  const streamState = ReadableStreamImpl.getState(state.stream).state;
  if (streamState === 'closed') {
    if (bytesWritten !== 0) {
      throw new TypeError('bytesWritten must be 0 for a closed stream');
    }
  } else {
    assert(streamState === 'readable');
    if (bytesWritten === 0) {
      throw new TypeError('bytesWritten must be greater than 0');
    }
    if (first.bytesFilled + bytesWritten > first.byteLength) {
      throw new RangeError('bytesWritten is out of range');
    }
  }
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  first.buffer = transferArrayBuffer(environment, first.buffer);
  respondInternal(controller, bytesWritten);
}

export function readableByteStreamControllerRespondWithNewView(
  controller: ReadableByteStreamControllerImpl,
  view: object,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const first = state.pendingPullIntos[0];
  assert(first !== undefined);
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  const buffers = environment.buffers;
  assert(!isDetachedBuffer(environment, buffers.getBuffer(view)));
  const viewByteLength = buffers.getByteLength(view);
  const streamState = ReadableStreamImpl.getState(state.stream).state;
  if (streamState === 'closed') {
    if (viewByteLength !== 0) {
      throw new TypeError('The view must be empty for a closed stream');
    }
  } else {
    assert(streamState === 'readable');
    if (viewByteLength === 0) {
      throw new TypeError('The view must not be empty');
    }
  }
  if (first.byteOffset + first.bytesFilled !== buffers.getByteOffset(view)) {
    throw new RangeError('The view region does not match the BYOB request');
  }
  const viewBuffer = buffers.getBuffer(view);
  if (first.bufferByteLength !== buffers.getByteLength(viewBuffer)) {
    throw new RangeError('The view buffer has a different capacity');
  }
  if (first.bytesFilled + viewByteLength > first.byteLength) {
    throw new RangeError('The view region is larger than the BYOB request');
  }
  first.buffer = transferArrayBuffer(environment, viewBuffer);
  respondInternal(controller, viewByteLength);
}

export function setUpReadableByteStreamControllerFromUnderlyingSource(
  stream: ReadableStreamImpl,
  underlyingSource: unknown,
  source: UnderlyingSource,
  highWaterMark: number,
): void {
  const environment = ReadableStreamImpl.getEnvironment(stream);
  const controller = environment.objects.create(
    ReadableByteStreamControllerImpl,
  );
  const startAlgorithm = source.start === undefined
    ? () => undefined
    : () => environment.callbacks.invoke(
      source.start,
      [controller],
      'rethrow',
      underlyingSource,
    );
  const pullAlgorithm = source.pull === undefined
    ? () => environment.promises.createResolved(undefined, idlType.undefined)
    : () => requirePromise(environment.callbacks.invoke(
      source.pull,
      [controller],
      undefined,
      underlyingSource,
    ));
  const cancelAlgorithm = source.cancel === undefined
    ? () => environment.promises.createResolved(undefined, idlType.undefined)
    : (reason: unknown) => requirePromise(environment.callbacks.invoke(
      source.cancel,
      [reason],
      undefined,
      underlyingSource,
    ));

  const autoAllocateChunkSize = source.autoAllocateChunkSize;
  if (autoAllocateChunkSize === 0) {
    throw new TypeError('autoAllocateChunkSize must be greater than 0');
  }
  setUpReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    autoAllocateChunkSize,
  );
}

/** Streams §9.1, create and set up a stream with byte reading support. */
export function createReadableStreamWithByteReadingSupport(
  environment: StreamEnvironment,
  pullAlgorithm?: () => unknown,
  cancelAlgorithm?: (reason: unknown) => unknown,
  highWaterMark = 0,
): ReadableStreamImpl {
  const stream = environment.objects.construct(
    ReadableStreamImpl,
    [internalStreamSetup],
  );
  const controller = environment.objects.create(
    ReadableByteStreamControllerImpl,
  );
  setUpReadableByteStreamController(
    stream,
    controller,
    () => undefined,
    () => runAlgorithm(environment, () => pullAlgorithm?.()),
    (reason) => runAlgorithm(
      environment,
      () => cancelAlgorithm?.(reason),
    ),
    highWaterMark,
    undefined,
  );
  return stream;
}

function setUpReadableByteStreamController(
  stream: ReadableStreamImpl,
  controller: ReadableByteStreamControllerImpl,
  startAlgorithm: () => unknown,
  pullAlgorithm: () => StreamPromise,
  cancelAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark: number,
  autoAllocateChunkSize: number | undefined,
): void {
  if (ReadableStreamImpl.getState(stream).controller) {
    throw new Error('ReadableStream already has a controller');
  }
  const state: ReadableByteStreamControllerState = {
    autoAllocateChunkSize,
    byobRequest: null,
    cancelAlgorithm,
    closeRequested: false,
    pendingPullIntos: [],
    pullAgain: false,
    pullAlgorithm,
    pulling: false,
    queue: [],
    queueTotalSize: 0,
    started: false,
    strategyHighWaterMark: highWaterMark,
    stream,
  };
  ReadableByteStreamControllerImpl.setState(controller, state);
  ReadableStreamImpl.getState(stream).controller = controller;

  const environment = ReadableStreamImpl.getEnvironment(stream);
  environment.promises.react(
    environment.promises.createResolved(startAlgorithm(), idlType.any),
    idlType.undefined,
    {
      fulfilled() {
        state.started = true;
        readableByteStreamControllerCallPullIfNeeded(controller);
      },
      rejected(error) {
        readableByteStreamControllerError(controller, error);
      },
    },
  );
}

function runAlgorithm(
  environment: StreamEnvironment,
  algorithm: () => unknown,
): StreamPromise {
  try {
    return environment.promises.createResolved(
      algorithm(),
      idlType.undefined,
    );
  } catch (error) {
    return environment.promises.createRejected(error, idlType.undefined);
  }
}

function commitPullIntoDescriptor(
  stream: ReadableStreamImpl,
  descriptor: PullIntoDescriptor,
): void {
  const streamState = ReadableStreamImpl.getState(stream);
  assert(streamState.state !== 'errored');
  assert(descriptor.readerType !== 'none');
  const done = streamState.state === 'closed';
  const controller = streamState.controller;
  assert(ReadableByteStreamControllerImpl.is(controller));
  const view = convertPullIntoDescriptor(controller, descriptor);
  if (descriptor.readerType === 'default') {
    fulfillReadRequest(stream, view, done);
  } else {
    fulfillReadIntoRequest(stream, view, done);
  }
}

function convertPullIntoDescriptor(
  controller: ReadableByteStreamControllerImpl,
  descriptor: PullIntoDescriptor,
): object {
  assert(descriptor.bytesFilled <= descriptor.byteLength);
  assert(descriptor.bytesFilled % descriptor.elementSize === 0);
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  descriptor.buffer = transferArrayBuffer(environment, descriptor.buffer);
  return createDescriptorView(
    environment,
    descriptor,
    descriptor.bytesFilled / descriptor.elementSize,
  );
}

function createDescriptorView(
  environment: ReturnType<
    typeof ReadableByteStreamControllerImpl.getEnvironment
  >,
  descriptor: PullIntoDescriptor,
  length: number,
): object {
  return environment.buffers.createView(
    descriptor.viewType,
    descriptor.buffer,
    descriptor.byteOffset,
    length,
  );
}

function enqueueChunkToQueue(
  controller: ReadableByteStreamControllerImpl,
  buffer: object,
  byteOffset: number,
  byteLength: number,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  state.queue.push({ buffer, byteLength, byteOffset });
  state.queueTotalSize += byteLength;
}

function enqueueClonedChunkToQueue(
  controller: ReadableByteStreamControllerImpl,
  buffer: object,
  byteOffset: number,
  byteLength: number,
): void {
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  let clone: object;
  try {
    clone = environment.buffers.clone(buffer, byteOffset, byteLength);
  } catch (error) {
    readableByteStreamControllerError(controller, error);
    throw error;
  }
  enqueueChunkToQueue(controller, clone, 0, byteLength);
}

function enqueueDetachedPullIntoToQueue(
  controller: ReadableByteStreamControllerImpl,
  descriptor: PullIntoDescriptor,
): void {
  assert(descriptor.readerType === 'none');
  if (descriptor.bytesFilled > 0) {
    enqueueClonedChunkToQueue(
      controller,
      descriptor.buffer,
      descriptor.byteOffset,
      descriptor.bytesFilled,
    );
  }
  shiftPendingPullInto(controller);
}

function fillHeadPullInto(
  state: ReadableByteStreamControllerState,
  size: number,
  descriptor: PullIntoDescriptor,
): void {
  assert(state.pendingPullIntos.length === 0 ||
    state.pendingPullIntos[0] === descriptor);
  assert(state.byobRequest === null);
  descriptor.bytesFilled += size;
}

function fillPullIntoFromQueue(
  controller: ReadableByteStreamControllerImpl,
  descriptor: PullIntoDescriptor,
): boolean {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const maxToCopy = Math.min(
    state.queueTotalSize,
    descriptor.byteLength - descriptor.bytesFilled,
  );
  const maxFilled = descriptor.bytesFilled + maxToCopy;
  let remaining = maxToCopy;
  const remainder = maxFilled % descriptor.elementSize;
  const maxAligned = maxFilled - remainder;
  let ready = false;
  if (maxAligned >= descriptor.minimumFill) {
    remaining = maxAligned - descriptor.bytesFilled;
    ready = true;
  }

  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  while (remaining > 0) {
    const head = state.queue[0];
    assert(head !== undefined);
    const count = Math.min(remaining, head.byteLength);
    copyDataBlockBytes(
      environment,
      descriptor.buffer,
      descriptor.byteOffset + descriptor.bytesFilled,
      head.buffer,
      head.byteOffset,
      count,
    );
    if (head.byteLength === count) {
      state.queue.shift();
    } else {
      head.byteOffset += count;
      head.byteLength -= count;
    }
    state.queueTotalSize -= count;
    fillHeadPullInto(state, count, descriptor);
    remaining -= count;
  }
  return ready;
}

function handleQueueDrain(controller: ReadableByteStreamControllerImpl): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  if (state.queueTotalSize === 0 && state.closeRequested) {
    readableByteStreamControllerClearAlgorithms(controller);
    readableStreamClose(state.stream);
  } else {
    readableByteStreamControllerCallPullIfNeeded(controller);
  }
}

function invalidateBYOBRequest(
  controller: ReadableByteStreamControllerImpl,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  if (!state.byobRequest) return;
  ReadableStreamBYOBRequestImpl.invalidate(state.byobRequest);
  state.byobRequest = null;
}

function processPullIntosUsingQueue(
  controller: ReadableByteStreamControllerImpl,
): PullIntoDescriptor[] {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const filled: PullIntoDescriptor[] = [];
  while (state.pendingPullIntos.length > 0 && state.queueTotalSize > 0) {
    const descriptor = state.pendingPullIntos[0];
    assert(descriptor !== undefined && descriptor.readerType !== 'none');
    if (!fillPullIntoFromQueue(controller, descriptor)) break;
    shiftPendingPullInto(controller);
    filled.push(descriptor);
  }
  return filled;
}

function processReadRequestsUsingQueue(
  controller: ReadableByteStreamControllerImpl,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const reader = ReadableStreamImpl.getState(state.stream).reader;
  assert(ReadableStreamDefaultReaderImpl.is(reader));
  while (ReadableStreamDefaultReaderImpl.getReadRequests(reader).length > 0) {
    if (state.queueTotalSize === 0) return;
    const request = ReadableStreamDefaultReaderImpl.getReadRequests(
      reader,
    ).shift();
    assert(request !== undefined);
    readableByteStreamControllerFillReadRequestFromQueue(controller, request);
  }
}

function respondInternal(
  controller: ReadableByteStreamControllerImpl,
  bytesWritten: number,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const first = state.pendingPullIntos[0];
  assert(first !== undefined);
  const environment = ReadableByteStreamControllerImpl.getEnvironment(
    controller,
  );
  assert(canTransferArrayBuffer(environment, first.buffer));
  invalidateBYOBRequest(controller);
  const streamState = ReadableStreamImpl.getState(state.stream).state;
  if (streamState === 'closed') {
    respondInClosedState(controller, first);
  } else {
    assert(streamState === 'readable' && bytesWritten > 0);
    respondInReadableState(controller, bytesWritten, first);
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function respondInClosedState(
  controller: ReadableByteStreamControllerImpl,
  first: PullIntoDescriptor,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  assert(first.bytesFilled % first.elementSize === 0);
  if (first.readerType === 'none') shiftPendingPullInto(controller);
  if (!readableStreamHasBYOBReader(state.stream)) return;

  const filled: PullIntoDescriptor[] = [];
  while (filled.length < readableStreamGetNumReadIntoRequests(state.stream)) {
    filled.push(shiftPendingPullInto(controller));
  }
  for (const descriptor of filled) {
    commitPullIntoDescriptor(state.stream, descriptor);
  }
}

function respondInReadableState(
  controller: ReadableByteStreamControllerImpl,
  bytesWritten: number,
  descriptor: PullIntoDescriptor,
): void {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  fillHeadPullInto(state, bytesWritten, descriptor);
  if (descriptor.readerType === 'none') {
    enqueueDetachedPullIntoToQueue(controller, descriptor);
    for (const filled of processPullIntosUsingQueue(controller)) {
      commitPullIntoDescriptor(state.stream, filled);
    }
    return;
  }
  if (descriptor.bytesFilled < descriptor.minimumFill) return;

  shiftPendingPullInto(controller);
  const remainder = descriptor.bytesFilled % descriptor.elementSize;
  if (remainder > 0) {
    const end = descriptor.byteOffset + descriptor.bytesFilled;
    enqueueClonedChunkToQueue(
      controller,
      descriptor.buffer,
      end - remainder,
      remainder,
    );
  }
  descriptor.bytesFilled -= remainder;
  const filled = processPullIntosUsingQueue(controller);
  commitPullIntoDescriptor(state.stream, descriptor);
  for (const pending of filled) {
    commitPullIntoDescriptor(state.stream, pending);
  }
}

function shiftPendingPullInto(
  controller: ReadableByteStreamControllerImpl,
): PullIntoDescriptor {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  assert(state.byobRequest === null);
  const descriptor = state.pendingPullIntos.shift();
  assert(descriptor !== undefined);
  return descriptor;
}

function shouldCallPull(controller: ReadableByteStreamControllerImpl): boolean {
  const state = ReadableByteStreamControllerImpl.getState(controller);
  const streamState = ReadableStreamImpl.getState(state.stream);
  if (streamState.state !== 'readable' || state.closeRequested ||
    !state.started) {
    return false;
  }
  if (readableStreamHasDefaultReader(state.stream) &&
    readableStreamGetNumReadRequests(state.stream) > 0) {
    return true;
  }
  if (readableStreamHasBYOBReader(state.stream) &&
    readableStreamGetNumReadIntoRequests(state.stream) > 0) {
    return true;
  }
  return (readableByteStreamControllerGetDesiredSize(controller) ?? 0) > 0;
}

function fulfillReadIntoRequest(
  stream: ReadableStreamImpl,
  chunk: object,
  done: boolean,
): void {
  const reader = ReadableStreamImpl.getState(stream).reader;
  assert(ReadableStreamBYOBReaderImpl.is(reader));
  const request = ReadableStreamBYOBReaderImpl.getReadIntoRequests(
    reader,
  ).shift();
  assert(request !== undefined);
  if (done) request.closeSteps(chunk);
  else request.chunkSteps(chunk);
}

function fulfillReadRequest(
  stream: ReadableStreamImpl,
  chunk: object,
  done: boolean,
): void {
  const reader = ReadableStreamImpl.getState(stream).reader;
  assert(ReadableStreamDefaultReaderImpl.is(reader));
  const request = ReadableStreamDefaultReaderImpl.getReadRequests(
    reader,
  ).shift();
  assert(request !== undefined);
  if (done) request.closeSteps();
  else request.chunkSteps(chunk);
}

function errorReadIntoRequests(
  reader: ReadableStreamBYOBReaderImpl,
  error: unknown,
): void {
  const requests = ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader);
  ReadableStreamBYOBReaderImpl.resetReadIntoRequests(reader);
  for (const request of requests) request.errorSteps(error);
}

function cloneAsUint8Array(
  environment: StreamEnvironment,
  view: object,
): object {
  const byteLength = environment.buffers.getByteLength(view);
  const buffer = environment.buffers.clone(
    environment.buffers.getBuffer(view),
    environment.buffers.getByteOffset(view),
    byteLength,
  );
  return environment.buffers.createView(
    'Uint8Array',
    buffer,
    0,
    byteLength,
  );
}

function requireByteController(
  stream: ReadableStreamImpl,
): ReadableByteStreamControllerImpl {
  const controller = ReadableStreamImpl.getState(stream).controller;
  if (!ReadableByteStreamControllerImpl.is(controller)) {
    throw new Error('ReadableStream has no byte controller');
  }
  return controller;
}

function requireObject(value: unknown): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Readable byte stream produced a non-object chunk');
  }
  return value;
}

function resolvedUndefined(environment: StreamEnvironment): StreamPromise {
  return environment.promises.createResolved(undefined, idlType.undefined);
}

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Readable stream ${name} algorithm is gone`);
  return algorithm;
}

function requirePromise(value: unknown): StreamPromise {
  if ((typeof value !== 'object' || value === null) &&
    typeof value !== 'function') {
    throw new TypeError('Stream callback did not return a Web IDL promise');
  }
  return value;
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('Streams implementation invariant failed');
}

const bufferViewElementSizes = {
  BigInt64Array: 8,
  BigUint64Array: 8,
  DataView: 1,
  Float16Array: 2,
  Float32Array: 4,
  Float64Array: 8,
  Int16Array: 2,
  Int32Array: 4,
  Int8Array: 1,
  Uint16Array: 2,
  Uint32Array: 4,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
} as const;
