// @rollup-cycle streams-transform
import { idlType } from '../web-idl/declaration/index';
import type { BindingContext } from '../web-idl/projection';
import type { StreamPromise } from './promise';
import type { QueuingStrategySize } from './queuing-strategy';
import {
  createReadableStream, readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
} from './readable-stream-operations';
import {
  ReadableStreamDefaultControllerImpl,
} from './readable-stream-default-controller';
import { ReadableStreamImpl } from './readable-stream';
import {
  TransformStreamDefaultControllerImpl,
} from './transform-stream-default-controller';
import {
  TransformStreamImpl, type Transformer, type TransformStreamAlgorithms,
} from './transform-stream';
import {
  createWritableStream, type WritableStreamImpl,
} from './writable-stream';
import {
  writableStreamDefaultControllerErrorIfNeeded,
} from './writable-stream-operations';
import { getWritableStreamState } from './writable-stream-slots';

export function initializeTransformStream(
  stream: TransformStreamImpl,
  startPromise: StreamPromise,
  writableHighWaterMark: number,
  writableSizeAlgorithm: QueuingStrategySize,
  readableHighWaterMark: number,
  readableSizeAlgorithm: QueuingStrategySize,
): void {
  const context = TransformStreamImpl.getContext(stream);
  const state = TransformStreamImpl.getState(stream);
  state.writable = createWritableStream(
    context,
    () => undefined,
    (chunk) => transformStreamDefaultSinkWriteAlgorithm(stream, chunk),
    () => transformStreamDefaultSinkCloseAlgorithm(stream),
    (reason) => transformStreamDefaultSinkAbortAlgorithm(stream, reason),
    writableHighWaterMark,
    writableSizeAlgorithm,
    startPromise,
  );
  state.readable = createReadableStream(
    context,
    () => undefined,
    () => transformStreamDefaultSourcePullAlgorithm(stream),
    (reason) => transformStreamDefaultSourceCancelAlgorithm(stream, reason),
    readableHighWaterMark,
    readableSizeAlgorithm,
    startPromise,
  );
  transformStreamSetBackpressure(stream, true);
}

export function setUpTransformStreamDefaultControllerFromTransformer(
  stream: TransformStreamImpl,
  transformer: object | null,
  transformerDictionary: Transformer,
): void {
  const context = TransformStreamImpl.getContext(stream);
  const controller = context.construct(
    TransformStreamDefaultControllerImpl,
  );
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

export function setUpTransformStreamDefaultControllerFromAlgorithms(
  stream: TransformStreamImpl,
  algorithms: TransformStreamAlgorithms,
): void {
  const context = TransformStreamImpl.getContext(stream);
  const controller = context.construct(
    TransformStreamDefaultControllerImpl,
  );
  setUpTransformStreamDefaultController(
    stream,
    controller,
    (chunk) => runTransformAlgorithm(
      context,
      () => algorithms.transform(chunk, controller),
    ),
    () => runTransformAlgorithm(
      context,
      () => algorithms.flush?.(controller),
    ),
    (reason) => runTransformAlgorithm(
      context,
      () => algorithms.cancel?.(reason),
    ),
  );
}

export function transformStreamDefaultControllerGetDesiredSize(
  controller: TransformStreamDefaultControllerImpl,
): number | null {
  return readableStreamDefaultControllerGetDesiredSize(
    getReadableController(
      TransformStreamDefaultControllerImpl.getState(controller).stream,
    ),
  );
}

export function transformStreamDefaultControllerEnqueue(
  controller: TransformStreamDefaultControllerImpl,
  chunk: unknown,
): void {
  const stream = TransformStreamDefaultControllerImpl.getState(
    controller,
  ).stream;
  const context = TransformStreamImpl.getContext(stream);
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

  const desiredSize = readableStreamDefaultControllerGetDesiredSize(
    readableController,
  );
  if (desiredSize === null) {
    throw new Error('Transform stream readable side unexpectedly errored');
  }
  const backpressure = desiredSize <= 0;
  const state = TransformStreamImpl.getState(stream);
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
    TransformStreamDefaultControllerImpl.getState(controller).stream,
    error,
  );
}

export function transformStreamDefaultControllerTerminate(
  controller: TransformStreamDefaultControllerImpl,
): void {
  const stream = TransformStreamDefaultControllerImpl.getState(
    controller,
  ).stream;
  const context = TransformStreamImpl.getContext(stream);
  readableStreamDefaultControllerClose(getReadableController(stream));
  transformStreamErrorWritableAndUnblockWrite(
    stream,
    new context.realm.intrinsics.typeError(
      'TransformStream terminated',
    ),
  );
}

function setUpTransformStreamDefaultController(
  stream: TransformStreamImpl,
  controller: TransformStreamDefaultControllerImpl,
  transformAlgorithm: (chunk: unknown) => StreamPromise,
  flushAlgorithm: () => StreamPromise,
  cancelAlgorithm: (reason: unknown) => StreamPromise,
): void {
  const state = TransformStreamImpl.getState(stream);
  if (state.controller) {
    throw new Error('TransformStream already has a controller');
  }
  TransformStreamDefaultControllerImpl.setState(controller, {
    cancelAlgorithm,
    flushAlgorithm,
    stream,
    transformAlgorithm,
  });
  state.controller = controller;
}

function runTransformAlgorithm(
  context: BindingContext,
  steps: () => unknown,
): StreamPromise {
  try {
    return context.createResolvedPromise(
      steps(),
      idlType.undefined,
    );
  } catch (exception) {
    return context.createRejectedPromise(
      exception,
      idlType.undefined,
    );
  }
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
  const state = TransformStreamImpl.getState(stream);
  clearAlgorithms(requireController(state.controller));
  writableStreamDefaultControllerErrorIfNeeded(
    requireWritableController(state.writable),
    error,
  );
  transformStreamUnblockWrite(stream);
}

function transformStreamUnblockWrite(stream: TransformStreamImpl): void {
  if (TransformStreamImpl.getState(stream).backpressure) {
    transformStreamSetBackpressure(stream, false);
  }
}

function transformStreamSetBackpressure(
  stream: TransformStreamImpl,
  backpressure: boolean,
): void {
  const state = TransformStreamImpl.getState(stream);
  if (state.backpressure === backpressure) {
    throw new Error('Transform stream backpressure did not change');
  }
  const context = TransformStreamImpl.getContext(stream);
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
  const state = TransformStreamDefaultControllerImpl.getState(controller);
  const context = TransformStreamImpl.getContext(state.stream);
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
  const state = TransformStreamImpl.getState(stream);
  const writable = requireStateMember(state.writable, 'writable');
  if (getWritableStreamState(writable).state !== 'writable') {
    throw new Error('Transform stream writable side is not writable');
  }
  const controller = requireController(state.controller);
  if (!state.backpressure) {
    return transformStreamDefaultControllerPerformTransform(
      controller,
      chunk,
    );
  }

  const context = TransformStreamImpl.getContext(stream);
  return context.reactToPromise(
    requireStateMember(
      state.backpressureChangePromise,
      'backpressure change promise',
    ),
    idlType.undefined,
    {
      fulfilled() {
        if (getWritableStreamState(writable).state === 'erroring') {
          throw getWritableStreamState(writable).storedError;
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
  const state = TransformStreamImpl.getState(stream);
  const controller = requireController(state.controller);
  const controllerState = TransformStreamDefaultControllerImpl.getState(
    controller,
  );
  if (controllerState.finishPromise) return controllerState.finishPromise;

  const context = TransformStreamImpl.getContext(stream);
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
  const state = TransformStreamImpl.getState(stream);
  const controller = requireController(state.controller);
  const controllerState = TransformStreamDefaultControllerImpl.getState(
    controller,
  );
  if (controllerState.finishPromise) return controllerState.finishPromise;

  const context = TransformStreamImpl.getContext(stream);
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
  const state = TransformStreamImpl.getState(stream);
  if (!state.backpressure) {
    throw new Error('Transform stream source pulled without backpressure');
  }
  transformStreamSetBackpressure(stream, false);
  return requireStateMember(
    TransformStreamImpl.getState(stream).backpressureChangePromise,
    'backpressure change promise',
  );
}

function transformStreamDefaultSourceCancelAlgorithm(
  stream: TransformStreamImpl,
  reason: unknown,
): StreamPromise {
  const state = TransformStreamImpl.getState(stream);
  const controller = requireController(state.controller);
  const controllerState = TransformStreamDefaultControllerImpl.getState(
    controller,
  );
  if (controllerState.finishPromise) return controllerState.finishPromise;

  const context = TransformStreamImpl.getContext(stream);
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
      const writableState = getWritableStreamState(writable);
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
  const state = TransformStreamDefaultControllerImpl.getState(controller);
  state.transformAlgorithm = undefined;
  state.flushAlgorithm = undefined;
  state.cancelAlgorithm = undefined;
}

function getReadableController(
  stream: TransformStreamImpl,
): ReadableStreamDefaultControllerImpl {
  const controller = ReadableStreamImpl.getState(
    requireStateMember(
      TransformStreamImpl.getState(stream).readable,
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
    TransformStreamImpl.getState(stream).readable,
    'readable',
  ));
}

function requireWritableController(
  writable: WritableStreamImpl | undefined,
): NonNullable<ReturnType<typeof getWritableStreamState>['controller']> {
  const controller = getWritableStreamState(
    requireStateMember(writable, 'writable'),
  ).controller;
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
