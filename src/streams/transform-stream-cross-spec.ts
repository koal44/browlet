import { idlType } from '../web-idl/declaration/index';
import type { BindingContext } from '../web-idl/projection';
import { internalStreamSetup } from './internal-methods';
import { runPromiseAlgorithm } from './promise';
import { TransformStreamDefaultControllerImpl } from './transform-stream-default-controller';
import {
  initializeTransformStream, setUpTransformStreamDefaultController,
  transformStreamDefaultControllerEnqueue,
  transformStreamDefaultControllerError,
  transformStreamDefaultControllerTerminate,
} from './transform-stream-operations';
import { TransformStreamImpl } from './transform-stream';

/** Streams §9.3, create and set up a transform stream. */
export function createTransformStream(
  context: BindingContext,
  transformAlgorithm: (chunk: unknown) => unknown,
  flushAlgorithm?: () => unknown,
  cancelAlgorithm?: (reason: unknown) => unknown,
): TransformStreamImpl {
  const stream = context.construct(
    TransformStreamImpl,
    internalStreamSetup,
  );
  initializeTransformStream(
    stream,
    context.createResolvedPromise(undefined, idlType.undefined),
    1,
    () => 1,
    0,
    () => 1,
  );
  setUpTransformStreamDefaultController(
    stream,
    context.construct(TransformStreamDefaultControllerImpl),
    (chunk) => runPromiseAlgorithm(
      context,
      () => transformAlgorithm(chunk),
    ),
    () => runPromiseAlgorithm(context, () => flushAlgorithm?.()),
    (reason) => runPromiseAlgorithm(
      context,
      () => cancelAlgorithm?.(reason),
    ),
  );
  return stream;
}

/** Streams §9.3, create an identity transform stream. */
export function createIdentityTransformStream(
  context: BindingContext,
): TransformStreamImpl {
  const stream = createTransformStream(
    context,
    (chunk) => enqueueTransformStream(stream, chunk),
  );
  return stream;
}

/** Streams §9.3, enqueue a chunk into a transform stream. */
export function enqueueTransformStream(
  stream: TransformStreamImpl,
  chunk: unknown,
): void {
  transformStreamDefaultControllerEnqueue(requireController(stream), chunk);
}

/** Streams §9.3, terminate a transform stream. */
export function terminateTransformStream(stream: TransformStreamImpl): void {
  transformStreamDefaultControllerTerminate(requireController(stream));
}

/** Streams §9.3, error a transform stream. */
export function errorTransformStream(
  stream: TransformStreamImpl,
  error: unknown,
): void {
  transformStreamDefaultControllerError(requireController(stream), error);
}

function requireController(
  stream: TransformStreamImpl,
): TransformStreamDefaultControllerImpl {
  const controller = stream.state.controller;
  if (!controller) throw new Error('TransformStream has no controller');
  return controller;
}
