import { idlType } from '../web-idl/declaration/index';
import type { StreamEnvironment, StreamPromise } from './environment';
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
  const environment = TransformStreamImpl.getEnvironment(stream);
  const state = TransformStreamImpl.getState(stream);
  state.writable = createWritableStream(
    environment,
    () => undefined,
    (chunk) => transformStreamDefaultSinkWriteAlgorithm(stream, chunk),
    () => transformStreamDefaultSinkCloseAlgorithm(stream),
    (reason) => transformStreamDefaultSinkAbortAlgorithm(stream, reason),
    writableHighWaterMark,
    writableSizeAlgorithm,
    startPromise,
  );
  state.readable = createReadableStream(
    environment,
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
  const environment = TransformStreamImpl.getEnvironment(stream);
  const controller = environment.objects.create(
    TransformStreamDefaultControllerImpl,
  );
  const transformAlgorithm = transformerDictionary.transform === undefined
    ? (chunk: unknown) => {
      try {
        transformStreamDefaultControllerEnqueue(controller, chunk);
        return environment.promises.createResolved(
          undefined,
          idlType.undefined,
        );
      } catch (exception) {
        return environment.promises.createRejected(
          exception,
          idlType.undefined,
        );
      }
    }
    : (chunk: unknown) => requirePromise(environment.callbacks.invoke(
      transformerDictionary.transform,
      [chunk, controller],
      undefined,
      transformer,
    ));
  const flushAlgorithm = transformerDictionary.flush === undefined
    ? () => environment.promises.createResolved(
      undefined,
      idlType.undefined,
    )
    : () => requirePromise(environment.callbacks.invoke(
      transformerDictionary.flush,
      [controller],
      undefined,
      transformer,
    ));
  const cancelAlgorithm = transformerDictionary.cancel === undefined
    ? () => environment.promises.createResolved(
      undefined,
      idlType.undefined,
    )
    : (reason: unknown) => requirePromise(environment.callbacks.invoke(
      transformerDictionary.cancel,
      [reason],
      undefined,
      transformer,
    ));

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
  const environment = TransformStreamImpl.getEnvironment(stream);
  const controller = environment.objects.create(
    TransformStreamDefaultControllerImpl,
  );
  setUpTransformStreamDefaultController(
    stream,
    controller,
    (chunk) => runTransformAlgorithm(
      environment,
      () => algorithms.transform(chunk, controller),
    ),
    () => runTransformAlgorithm(
      environment,
      () => algorithms.flush?.(controller),
    ),
    (reason) => runTransformAlgorithm(
      environment,
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
  const readableController = getReadableController(stream);
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(readableController)) {
    throw new TypeError('Readable side is not in a state that permits enqueue');
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
  readableStreamDefaultControllerClose(getReadableController(stream));
  transformStreamErrorWritableAndUnblockWrite(
    stream,
    new TypeError('TransformStream terminated'),
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
  environment: StreamEnvironment,
  steps: () => unknown,
): StreamPromise {
  try {
    return environment.promises.createResolved(
      steps(),
      idlType.undefined,
    );
  } catch (exception) {
    return environment.promises.createRejected(
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
  const environment = TransformStreamImpl.getEnvironment(stream);
  if (state.backpressureChangePromise) {
    environment.promises.resolve(state.backpressureChangePromise, undefined);
  }
  state.backpressureChangePromise = environment.promises.create(
    idlType.undefined,
  );
  state.backpressure = backpressure;
}

function transformStreamDefaultControllerPerformTransform(
  controller: TransformStreamDefaultControllerImpl,
  chunk: unknown,
): StreamPromise {
  const state = TransformStreamDefaultControllerImpl.getState(controller);
  const environment = TransformStreamImpl.getEnvironment(state.stream);
  return environment.promises.react(
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

  const environment = TransformStreamImpl.getEnvironment(stream);
  return environment.promises.react(
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

  const environment = TransformStreamImpl.getEnvironment(stream);
  const readable = requireStateMember(state.readable, 'readable');
  const finishPromise = environment.promises.create(idlType.undefined);
  controllerState.finishPromise = finishPromise;
  const cancelPromise = requireAlgorithm(
    controllerState.cancelAlgorithm,
    'cancel',
  )(reason);
  clearAlgorithms(controller);
  environment.promises.react(cancelPromise, idlType.undefined, {
    fulfilled() {
      const readableState = ReadableStreamImpl.getState(readable);
      if (readableState.state === 'errored') {
        environment.promises.reject(finishPromise, readableState.storedError);
      } else {
        readableStreamDefaultControllerError(
          getReadableController(stream),
          reason,
        );
        environment.promises.resolve(finishPromise, undefined);
      }
    },
    rejected(error) {
      readableStreamDefaultControllerError(getReadableController(stream), error);
      environment.promises.reject(finishPromise, error);
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

  const environment = TransformStreamImpl.getEnvironment(stream);
  const readable = requireStateMember(state.readable, 'readable');
  const finishPromise = environment.promises.create(idlType.undefined);
  controllerState.finishPromise = finishPromise;
  const flushPromise = requireAlgorithm(
    controllerState.flushAlgorithm,
    'flush',
  )();
  clearAlgorithms(controller);
  environment.promises.react(flushPromise, idlType.undefined, {
    fulfilled() {
      const readableState = ReadableStreamImpl.getState(readable);
      if (readableState.state === 'errored') {
        environment.promises.reject(finishPromise, readableState.storedError);
      } else {
        readableStreamDefaultControllerClose(getReadableController(stream));
        environment.promises.resolve(finishPromise, undefined);
      }
    },
    rejected(error) {
      readableStreamDefaultControllerError(getReadableController(stream), error);
      environment.promises.reject(finishPromise, error);
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

  const environment = TransformStreamImpl.getEnvironment(stream);
  const writable = requireStateMember(state.writable, 'writable');
  const finishPromise = environment.promises.create(idlType.undefined);
  controllerState.finishPromise = finishPromise;
  const cancelPromise = requireAlgorithm(
    controllerState.cancelAlgorithm,
    'cancel',
  )(reason);
  clearAlgorithms(controller);
  environment.promises.react(cancelPromise, idlType.undefined, {
    fulfilled() {
      const writableState = getWritableStreamState(writable);
      if (writableState.state === 'errored') {
        environment.promises.reject(finishPromise, writableState.storedError);
      } else {
        writableStreamDefaultControllerErrorIfNeeded(
          requireWritableController(writable),
          reason,
        );
        transformStreamUnblockWrite(stream);
        environment.promises.resolve(finishPromise, undefined);
      }
    },
    rejected(error) {
      writableStreamDefaultControllerErrorIfNeeded(
        requireWritableController(writable),
        error,
      );
      transformStreamUnblockWrite(stream);
      environment.promises.reject(finishPromise, error);
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

function requirePromise(value: unknown): StreamPromise {
  if ((typeof value !== 'object' || value === null) &&
    typeof value !== 'function') {
    throw new TypeError('Transformer callback did not return a Web IDL promise');
  }
  return value;
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
