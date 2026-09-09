import {
  InternalPromise, createPromiseReactions, type InternalPromiseCapability, type PromiseReactions,
} from '../js-engine/internal-promise';
import {
  arg, atArg, callback, contextValue, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, op, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import { bind, type BindingContext } from '../web-idl/projection';
import type { StreamAbortController } from './abort';
import { convertStreamCallbacks, createStreamAbortController } from './integration';
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

export class WritableStreamImpl {
  readonly state = initializeWritableStream();

  // SPEC_MISMATCH: WritableStream(underlyingSink?, strategy = {}) -> WritableStream
  constructor(
    underlyingSink: UnderlyingSink | null = {},
    strategy: QueuingStrategy = {},
    abortController: StreamAbortController,
    readonly reactions: PromiseReactions,
  ) {
    if (underlyingSink === null) return;
    const sinkDict = underlyingSink;
    if (sinkDict.type !== undefined) {
      throw new RangeError(
        'Writable stream sinks cannot specify a type',
      );
    }

    const sizeAlgorithm = extractSizeAlgorithm(strategy);
    const highWaterMark = extractHighWaterMark(strategy, 1);
    const controller = new WritableStreamDefaultControllerImpl();
    setUpWritableStreamDefaultControllerFromUnderlyingSink(
      this,
      controller,
      underlyingSink,
      sinkDict,
      highWaterMark,
      sizeAlgorithm,
      abortController,
    );
  }

  get locked(): boolean {
    return isWritableStreamLocked(this);
  }

  // SPEC_MISMATCH: abort(reason?) -> Promise<undefined>
  abort(reason?: unknown): InternalPromise<void> {
    if (isWritableStreamLocked(this)) {
      return InternalPromise.reject(new TypeError(
        'Cannot abort a stream that already has a writer',
      ));
    }
    return writableStreamAbort(this, reason);
  }

  // SPEC_MISMATCH: close() -> Promise<undefined>
  close(): InternalPromise<void> {
    if (isWritableStreamLocked(this)) {
      return InternalPromise.reject(new TypeError(
        'Cannot close a stream that already has a writer',
      ));
    }
    if (writableStreamCloseQueuedOrInFlight(this)) {
      return InternalPromise.reject(new TypeError(
        'Cannot close an already-closing stream',
      ));
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
  const writer = new WritableStreamDefaultWriterImpl();
  setUpWritableStreamDefaultWriter(writer, stream);
  return writer;
}

// SPEC_MISMATCH: CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) -> WritableStream
export function createWritableStream(
  startAlgorithm: () => InternalPromise<unknown> | void,
  writeAlgorithm: (chunk: unknown) => InternalPromise<unknown>,
  closeAlgorithm: () => InternalPromise<unknown>,
  abortAlgorithm: (reason: unknown) => InternalPromise<unknown>,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  abortController: StreamAbortController,
  reactions: PromiseReactions,
): WritableStreamImpl {
  const stream = new WritableStreamImpl(null, {}, abortController, reactions);
  const controller = new WritableStreamDefaultControllerImpl();
  setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
    abortController,
  );
  return stream;
}

export type WritableStreamState = {
  backpressure: boolean;
  closeRequest?: InternalPromiseCapability<void>;
  controller?: WritableStreamDefaultControllerImpl;
  inFlightCloseRequest?: InternalPromiseCapability<void>;
  inFlightWriteRequest?: InternalPromiseCapability<void>;
  pendingAbortRequest?: WritableStreamPendingAbortRequest;
  state: 'closed' | 'errored' | 'erroring' | 'writable';
  storedError?: unknown;
  writer?: WritableStreamDefaultWriterImpl;
  writeRequests: InternalPromiseCapability<void>[];
};

type WritableStreamPendingAbortRequest = {
  readonly promise: InternalPromiseCapability<void>;
  readonly reason: unknown;
  readonly wasAlreadyErroring: boolean;
};

export type UnderlyingSink = {
  readonly abort?: (reason?: unknown) => InternalPromise<unknown> | void;
  readonly close?: () => InternalPromise<unknown> | void;
  readonly start?: (controller: WritableStreamDefaultControllerImpl) => InternalPromise<unknown> | void;
  readonly type?: unknown;
  readonly write?: (
    chunk: unknown,
    controller: WritableStreamDefaultControllerImpl,
  ) => InternalPromise<unknown> | void;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamIDL = defineInterface({
  name: 'WritableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(WritableStreamImpl, {
    constructWith: [
      atArg(2, contextValue(createStreamAbortController)),
      atArg(3, contextValue((context: BindingContext) => createPromiseReactions(context.realm))),
    ],
  }),
  members: [
    ctor([
      arg('underlyingSink', idlType.object, {
        optional: true,
      }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ], bind({
      construct(context, sink, strategy) {
        return new WritableStreamImpl(
          convertStreamCallbacks(context, sink, 'UnderlyingSink', ['start', 'write', 'close', 'abort']),
          strategy as QueuingStrategy,
          createStreamAbortController(context),
          createPromiseReactions(context.realm),
        );
      },
    })),
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
