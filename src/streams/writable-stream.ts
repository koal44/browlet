import {
  arg, callback, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, op, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import type { StreamPromise } from './promise';
import {
  extractHighWaterMark, extractSizeAlgorithm, type QueuingStrategy,
  type QueuingStrategySize,
} from './queuing-strategy';
import {
  initializeWritableStream, isWritableStreamLocked,
  setUpWritableStreamDefaultController,
  setUpWritableStreamDefaultControllerFromUnderlyingSink,
  setUpWritableStreamDefaultWriter, writableStreamAbort, writableStreamClose,
  writableStreamCloseQueuedOrInFlight,
} from './writable-stream-operations';
import {
  WritableStreamDefaultControllerImpl,
} from './writable-stream-default-controller';
import { WritableStreamDefaultWriterImpl } from './writable-stream-default-writer';
import { internalStreamSetup } from './internal-methods';

export class WritableStreamImpl {
  readonly state = initializeWritableStream();

  // SPEC_MISMATCH: WritableStream(underlyingSink?, strategy = {}) -> WritableStream
  constructor(
    readonly context: BindingContext,
    underlyingSink?: object | typeof internalStreamSetup,
    strategy: QueuingStrategy = {},
  ) {
    if (underlyingSink === internalStreamSetup) return;

    const sinkObject = underlyingSink ?? null;
    const sink = context.convert(
      sinkObject,
      reference('UnderlyingSink'),
    ) as UnderlyingSink;
    if (Object.hasOwn(sink, 'type')) {
      throw new context.realm.intrinsics.rangeError(
        'Writable stream sinks cannot specify a type',
      );
    }

    const sizeAlgorithm = extractSizeAlgorithm(strategy);
    const highWaterMark = extractHighWaterMark(
      strategy,
      1,
      context.realm.intrinsics.rangeError,
    );
    const controller = context.construct(
      WritableStreamDefaultControllerImpl,
    );
    setUpWritableStreamDefaultControllerFromUnderlyingSink(
      this,
      controller,
      sinkObject,
      sink,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  get locked(): boolean {
    return isWritableStreamLocked(this);
  }

  abort(reason?: unknown): StreamPromise {
    const context = this.context;
    if (isWritableStreamLocked(this)) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.typeError(
          'Cannot abort a stream that already has a writer',
        ),
        idlType.undefined,
      );
    }
    return writableStreamAbort(this, reason);
  }

  close(): StreamPromise {
    const context = this.context;
    if (isWritableStreamLocked(this)) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.typeError(
          'Cannot close a stream that already has a writer',
        ),
        idlType.undefined,
      );
    }
    if (writableStreamCloseQueuedOrInFlight(this)) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.typeError(
          'Cannot close an already-closing stream',
        ),
        idlType.undefined,
      );
    }
    return writableStreamClose(this);
  }

  getWriter(): WritableStreamDefaultWriterImpl {
    return acquireWritableStreamDefaultWriter(this);
  }
}

export function acquireWritableStreamDefaultWriter(
  stream: WritableStreamImpl,
): WritableStreamDefaultWriterImpl {
  const context = stream.context;
  const writer = context.construct(WritableStreamDefaultWriterImpl);
  setUpWritableStreamDefaultWriter(writer, stream);
  return writer;
}

// SPEC_MISMATCH: CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) -> WritableStream
export function createWritableStream(
  context: BindingContext,
  startAlgorithm: () => unknown,
  writeAlgorithm: (chunk: unknown) => StreamPromise,
  closeAlgorithm: () => StreamPromise,
  abortAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
): WritableStreamImpl {
  const stream = context.construct(
    WritableStreamImpl,
    internalStreamSetup,
  );
  const controller = context.construct(
    WritableStreamDefaultControllerImpl,
  );
  setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
  return stream;
}

export type WritableStreamState = {
  backpressure: boolean;
  closeRequest?: StreamPromise;
  controller?: WritableStreamDefaultControllerImpl;
  inFlightCloseRequest?: StreamPromise;
  inFlightWriteRequest?: StreamPromise;
  pendingAbortRequest?: WritableStreamPendingAbortRequest;
  state: 'closed' | 'errored' | 'erroring' | 'writable';
  storedError?: unknown;
  writer?: WritableStreamDefaultWriterImpl;
  writeRequests: StreamPromise[];
};

type WritableStreamPendingAbortRequest = {
  readonly promise: StreamPromise;
  readonly reason: unknown;
  readonly wasAlreadyErroring: boolean;
};

export type UnderlyingSink = {
  readonly abort?: (reason?: unknown) => StreamPromise;
  readonly close?: () => StreamPromise;
  readonly start?: (controller: WritableStreamDefaultControllerImpl) => unknown;
  readonly type?: unknown;
  readonly write?: (
    chunk: unknown,
    controller: WritableStreamDefaultControllerImpl,
  ) => StreamPromise;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamIDL = defineInterface({
  name: 'WritableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(WritableStreamImpl, {
    constructWith: [bindingContext],
  }),
  members: [
    ctor([
      arg('underlyingSink', idlType.object, { optional: true }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('locked', idlType.boolean),
    op('abort', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('close', promise(idlType.undefined)),
    op('getWriter', reference('WritableStreamDefaultWriter')),
  ],
});

export const underlyingSinkStartCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkStartCallback',
  returns: idlType.any,
  arguments: [
    arg('controller', reference('WritableStreamDefaultController')),
  ],
});

export const underlyingSinkWriteCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkWriteCallback',
  returns: promise(idlType.undefined),
  arguments: [
    arg('chunk', idlType.any),
    arg('controller', reference('WritableStreamDefaultController')),
  ],
});

export const underlyingSinkCloseCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkCloseCallback',
  returns: promise(idlType.undefined),
  arguments: [],
});

export const underlyingSinkAbortCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkAbortCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('reason', idlType.any, { optional: true })],
});

export const underlyingSinkIDL = defineDictionary({
  name: 'UnderlyingSink',
  members: [
    dictMember('start', reference('UnderlyingSinkStartCallback'),
      callback('rethrow')),
    dictMember('write', reference('UnderlyingSinkWriteCallback')),
    dictMember('close', reference('UnderlyingSinkCloseCallback')),
    dictMember('abort', reference('UnderlyingSinkAbortCallback')),
    dictMember('type', idlType.any),
  ],
});
