import { idlType } from '../web-idl/declaration/index';
import type { StreamPromise } from './promise';
import type { QueuingStrategySize } from './queuing-strategy';
import {
  createReadableStream, readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerHasBackpressure,
} from './readable-stream-operations';
import {
  ReadableStreamDefaultControllerImpl,
} from './readable-stream-default-controller';
import { ReadableStreamImpl } from './readable-stream';
import type {
  TransformStreamDefaultControllerImpl,
} from './transform-stream-default-controller';
import type {
  Transformer, TransformStreamImpl,
} from './transform-stream';
import {
  createWritableStream, type WritableStreamImpl, type WritableStreamState,
} from './writable-stream';
import {
  writableStreamDefaultControllerErrorIfNeeded,
} from './writable-stream-operations';

export function initializeTransformStream(
  stream: TransformStreamImpl,
  startPromise: StreamPromise,
  writableHighWaterMark: number,
  writableSizeAlgorithm: QueuingStrategySize,
  readableHighWaterMark: number,
  readableSizeAlgorithm: QueuingStrategySize,
): void {
  const { context, state } = stream;
  const startAlgorithm = () => startPromise;
  state.writable = createWritableStream(
    context,
    startAlgorithm,
    (chunk) => transformStreamDefaultSinkWriteAlgorithm(stream, chunk),
    () => transformStreamDefaultSinkCloseAlgorithm(stream),
    (reason) => transformStreamDefaultSinkAbortAlgorithm(stream, reason),
    writableHighWaterMark,
    writableSizeAlgorithm,
  );
  state.readable = createReadableStream(
    context,
    startAlgorithm,
    () => transformStreamDefaultSourcePullAlgorithm(stream),
    (reason) => transformStreamDefaultSourceCancelAlgorithm(stream, reason),
    readableHighWaterMark,
    readableSizeAlgorithm,
  );
  transformStreamSetBackpressure(stream, true);
}

export function setUpTransformStreamDefaultControllerFromTransformer(
  stream: TransformStreamImpl,
  controller: TransformStreamDefaultControllerImpl,
  transformer: object | null,
  transformerDictionary: Transformer,
): void {
  const { context } = stream;
  const transformCallback = transformerDictionary.transform;
  const flushCallback = transformerDictionary.flush;
  const cancelCallback = transformerDictionary.cancel;
  const transformAlgorithm = transformCallback === undefined
    ? (chunk: unknown) => {
      try {
        transformStreamDefaultControllerEnqueue(controller, chunk);
        return context.createResolvedPromise(
          undefined,
          idlType.undefined,
        );
      } catch (exception) {
        return context.createRejectedPromise(
          exception,
          idlType.undefined,
        );
      }
    }
    : (chunk: unknown) => Reflect.apply(
      transformCallback,
      transformer,
      [chunk, controller],
    );
  const flushAlgorithm = flushCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : () => Reflect.apply(
      flushCallback,
      transformer,
      [controller],
    );
  const cancelAlgorithm = cancelCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : (reason: unknown) => Reflect.apply(
      cancelCallback,
      transformer,
      [reason],
    );

  setUpTransformStreamDefaultController(
    stream,
    controller,
    transformAlgorithm,
    flushAlgorithm,
    cancelAlgorithm,
  );
}

export function transformStreamDefaultControllerGetDesiredSize(
  controller: TransformStreamDefaultControllerImpl,
): number | null {
  return readableStreamDefaultControllerGetDesiredSize(
    getReadableController(
      controller.state.stream,
    ),
  );
}

export function transformStreamDefaultControllerEnqueue(
  controller: TransformStreamDefaultControllerImpl,
  chunk: unknown,
): void {
  const stream = controller.state.stream;
  const { context } = stream;
  const readableController = getReadableController(stream);
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(readableController)) {
    throw new context.realm.intrinsics.typeError(
      'Readable side is not in a state that permits enqueue',
    );
  }

  try {
    readableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (exception) {
    transformStreamErrorWritableAndUnblockWrite(stream, exception);
    throw getReadable(stream).storedError;
  }

  const backpressure = readableStreamDefaultControllerHasBackpressure(
    readableController,
  );
  const { state } = stream;
  if (backpressure !== state.backpressure) {
    if (!backpressure) {
      throw new Error('Transform stream unexpectedly lost backpressure');
    }
    transformStreamSetBackpressure(stream, true);
  }
}

export function transformStreamDefaultControllerError(
  controller: TransformStreamDefaultControllerImpl,
  error: unknown,
): void {
  transformStreamError(
    controller.state.stream,
    error,
  );
}

export function transformStreamDefaultControllerTerminate(
  controller: TransformStreamDefaultControllerImpl,
): void {
  const stream = controller.state.stream;
  const { context } = stream;
  readableStreamDefaultControllerClose(getReadableController(stream));
  transformStreamErrorWritableAndUnblockWrite(
    stream,
    new context.realm.intrinsics.typeError(
      'TransformStream terminated',
    ),
  );
}

export function setUpTransformStreamDefaultController(
  stream: TransformStreamImpl,
  controller: TransformStreamDefaultControllerImpl,
  transformAlgorithm: (chunk: unknown) => StreamPromise,
  flushAlgorithm: () => StreamPromise,
  cancelAlgorithm: (reason: unknown) => StreamPromise,
): void {
  const { state } = stream;
  if (state.controller) {
    throw new Error('TransformStream already has a controller');
  }
  controller.state = {
    cancelAlgorithm,
    flushAlgorithm,
    stream,
    transformAlgorithm,
  };
  state.controller = controller;
}

function transformStreamError(
  stream: TransformStreamImpl,
  error: unknown,
): void {
  readableStreamDefaultControllerError(getReadableController(stream), error);
  transformStreamErrorWritableAndUnblockWrite(stream, error);
}

function transformStreamErrorWritableAndUnblockWrite(
  stream: TransformStreamImpl,
  error: unknown,
): void {
  const { state } = stream;
  clearAlgorithms(requireController(state.controller));
  writableStreamDefaultControllerErrorIfNeeded(
    requireWritableController(state.writable),
    error,
  );
  transformStreamUnblockWrite(stream);
}

function transformStreamUnblockWrite(stream: TransformStreamImpl): void {
  if (stream.state.backpressure) {
    transformStreamSetBackpressure(stream, false);
  }
}

function transformStreamSetBackpressure(
  stream: TransformStreamImpl,
  backpressure: boolean,
): void {
  const { state } = stream;
  if (state.backpressure === backpressure) {
    throw new Error('Transform stream backpressure did not change');
  }
  const { context } = stream;
  if (state.backpressureChangePromise) {
    context.resolvePromise(state.backpressureChangePromise, undefined);
  }
  state.backpressureChangePromise = context.createPromise(
    idlType.undefined,
  );
  state.backpressure = backpressure;
}

function transformStreamDefaultControllerPerformTransform(
  controller: TransformStreamDefaultControllerImpl,
  chunk: unknown,
): StreamPromise {
  const { state } = controller;
  const { context } = state.stream;
  return context.reactToPromise(
    requireAlgorithm(state.transformAlgorithm, 'transform')(chunk),
    idlType.undefined,
    {
      rejected(reason) {
        transformStreamError(state.stream, reason);
        throw reason;
      },
    },
  );
}

function transformStreamDefaultSinkWriteAlgorithm(
  stream: TransformStreamImpl,
  chunk: unknown,
): StreamPromise {
  const { state } = stream;
  const writable = requireStateMember(state.writable, 'writable');
  if (writable.state.state !== 'writable') {
    throw new Error('Transform stream writable side is not writable');
  }
  const controller = requireController(state.controller);
  if (!state.backpressure) {
    return transformStreamDefaultControllerPerformTransform(
      controller,
      chunk,
    );
  }

  const { context } = stream;
  return context.reactToPromise(
    requireStateMember(
      state.backpressureChangePromise,
      'backpressure change promise',
    ),
    idlType.undefined,
    {
      fulfilled() {
        if (writable.state.state === 'erroring') {
          throw writable.state.storedError;
        }
        return transformStreamDefaultControllerPerformTransform(
          controller,
          chunk,
        );
      },
    },
  );
}

function transformStreamDefaultSinkAbortAlgorithm(
  stream: TransformStreamImpl,
  reason: unknown,
): StreamPromise {
  const { state } = stream;
  const controller = requireController(state.controller);
  const controllerState = controller.state;
  if (controllerState.finishPromise) return controllerState.finishPromise;

  const { context } = stream;
  const readable = requireStateMember(state.readable, 'readable');
  const finishPromise = context.createPromise(idlType.undefined);
  controllerState.finishPromise = finishPromise;
  const cancelPromise = requireAlgorithm(
    controllerState.cancelAlgorithm,
    'cancel',
  )(reason);
  clearAlgorithms(controller);
  context.reactToPromise(cancelPromise, idlType.undefined, {
    fulfilled() {
      const readableState = ReadableStreamImpl.getState(readable);
      if (readableState.state === 'errored') {
        context.rejectPromise(finishPromise, readableState.storedError);
      } else {
        readableStreamDefaultControllerError(
          getReadableController(stream),
          reason,
        );
        context.resolvePromise(finishPromise, undefined);
      }
    },
    rejected(error) {
      readableStreamDefaultControllerError(getReadableController(stream), error);
      context.rejectPromise(finishPromise, error);
    },
  });
  return finishPromise;
}

function transformStreamDefaultSinkCloseAlgorithm(
  stream: TransformStreamImpl,
): StreamPromise {
  const { state } = stream;
  const controller = requireController(state.controller);
  const controllerState = controller.state;
  if (controllerState.finishPromise) return controllerState.finishPromise;

  const { context } = stream;
  const readable = requireStateMember(state.readable, 'readable');
  const finishPromise = context.createPromise(idlType.undefined);
  controllerState.finishPromise = finishPromise;
  const flushPromise = requireAlgorithm(
    controllerState.flushAlgorithm,
    'flush',
  )();
  clearAlgorithms(controller);
  context.reactToPromise(flushPromise, idlType.undefined, {
    fulfilled() {
      const readableState = ReadableStreamImpl.getState(readable);
      if (readableState.state === 'errored') {
        context.rejectPromise(finishPromise, readableState.storedError);
      } else {
        readableStreamDefaultControllerClose(getReadableController(stream));
        context.resolvePromise(finishPromise, undefined);
      }
    },
    rejected(error) {
      readableStreamDefaultControllerError(getReadableController(stream), error);
      context.rejectPromise(finishPromise, error);
    },
  });
  return finishPromise;
}

function transformStreamDefaultSourcePullAlgorithm(
  stream: TransformStreamImpl,
): StreamPromise {
  const { state } = stream;
  if (!state.backpressure) {
    throw new Error('Transform stream source pulled without backpressure');
  }
  transformStreamSetBackpressure(stream, false);
  return requireStateMember(
    stream.state.backpressureChangePromise,
    'backpressure change promise',
  );
}

function transformStreamDefaultSourceCancelAlgorithm(
  stream: TransformStreamImpl,
  reason: unknown,
): StreamPromise {
  const { state } = stream;
  const controller = requireController(state.controller);
  const controllerState = controller.state;
  if (controllerState.finishPromise) return controllerState.finishPromise;

  const { context } = stream;
  const writable = requireStateMember(state.writable, 'writable');
  const finishPromise = context.createPromise(idlType.undefined);
  controllerState.finishPromise = finishPromise;
  const cancelPromise = requireAlgorithm(
    controllerState.cancelAlgorithm,
    'cancel',
  )(reason);
  clearAlgorithms(controller);
  context.reactToPromise(cancelPromise, idlType.undefined, {
    fulfilled() {
      const writableState = writable.state;
      if (writableState.state === 'errored') {
        context.rejectPromise(finishPromise, writableState.storedError);
      } else {
        writableStreamDefaultControllerErrorIfNeeded(
          requireWritableController(writable),
          reason,
        );
        transformStreamUnblockWrite(stream);
        context.resolvePromise(finishPromise, undefined);
      }
    },
    rejected(error) {
      writableStreamDefaultControllerErrorIfNeeded(
        requireWritableController(writable),
        error,
      );
      transformStreamUnblockWrite(stream);
      context.rejectPromise(finishPromise, error);
    },
  });
  return finishPromise;
}

function clearAlgorithms(
  controller: TransformStreamDefaultControllerImpl,
): void {
  const { state } = controller;
  state.transformAlgorithm = undefined;
  state.flushAlgorithm = undefined;
  state.cancelAlgorithm = undefined;
}

function getReadableController(
  stream: TransformStreamImpl,
): ReadableStreamDefaultControllerImpl {
  const controller = ReadableStreamImpl.getState(
    requireStateMember(
      stream.state.readable,
      'readable',
    ),
  ).controller;
  if (!ReadableStreamDefaultControllerImpl.is(controller)) {
    throw new Error('TransformStream has no readable default controller');
  }
  return controller;
}

function getReadable(
  stream: TransformStreamImpl,
): ReturnType<typeof ReadableStreamImpl.getState> {
  return ReadableStreamImpl.getState(requireStateMember(
    stream.state.readable,
    'readable',
  ));
}

function requireWritableController(
  writable: WritableStreamImpl | undefined,
): NonNullable<WritableStreamState['controller']> {
  const controller = requireStateMember(writable, 'writable').state.controller;
  if (!controller) {
    throw new Error('TransformStream has no writable default controller');
  }
  return controller;
}

function requireController(
  controller: TransformStreamDefaultControllerImpl | undefined,
): TransformStreamDefaultControllerImpl {
  return requireStateMember(controller, 'controller');
}

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Transform stream ${name} algorithm is gone`);
  return algorithm;
}

function requireStateMember<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) {
    throw new Error(`TransformStream has no ${name}`);
  }
  return value;
}
