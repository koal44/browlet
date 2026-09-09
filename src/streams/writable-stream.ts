import {
  arg, atArg, callback, contextValue, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, op, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import { checkCallback } from './miscellaneous';
import type { StreamAbortController } from './abort';
import { createStreamAbortController } from './integration';
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
  ) {
    if (underlyingSink === null) return;
    const sinkDict: UnderlyingSink = {
      abort: checkCallback(underlyingSink.abort),
      close: checkCallback(underlyingSink.close),
      start: checkCallback(underlyingSink.start),
      type: underlyingSink.type,
      write: checkCallback(underlyingSink.write),
    };
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

  abort(reason?: unknown): Promise<void> {
    if (isWritableStreamLocked(this)) {
      return Promise.reject(new TypeError(
        'Cannot abort a stream that already has a writer',
      ));
    }
    return writableStreamAbort(this, reason);
  }

  close(): Promise<void> {
    if (isWritableStreamLocked(this)) {
      return Promise.reject(new TypeError(
        'Cannot close a stream that already has a writer',
      ));
    }
    if (writableStreamCloseQueuedOrInFlight(this)) {
      return Promise.reject(new TypeError(
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
  startAlgorithm: () => unknown,
  writeAlgorithm: (chunk: unknown) => Promise<unknown>,
  closeAlgorithm: () => Promise<unknown>,
  abortAlgorithm: (reason: unknown) => Promise<unknown>,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  abortController: StreamAbortController,
): WritableStreamImpl {
  const stream = new WritableStreamImpl(null, {}, abortController);
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
  closeRequest?: PromiseWithResolvers<void>;
  controller?: WritableStreamDefaultControllerImpl;
  inFlightCloseRequest?: PromiseWithResolvers<void>;
  inFlightWriteRequest?: PromiseWithResolvers<void>;
  pendingAbortRequest?: WritableStreamPendingAbortRequest;
  state: 'closed' | 'errored' | 'erroring' | 'writable';
  storedError?: unknown;
  writer?: WritableStreamDefaultWriterImpl;
  writeRequests: PromiseWithResolvers<void>[];
};

type WritableStreamPendingAbortRequest = {
  readonly promise: PromiseWithResolvers<void>;
  readonly reason: unknown;
  readonly wasAlreadyErroring: boolean;
};

export type UnderlyingSink = {
  readonly abort?: (reason?: unknown) => unknown;
  readonly close?: () => unknown;
  readonly start?: (controller: WritableStreamDefaultControllerImpl) => unknown;
  readonly type?: unknown;
  readonly write?: (
    chunk: unknown,
    controller: WritableStreamDefaultControllerImpl,
  ) => unknown;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamIDL = defineInterface({
  name: 'WritableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(WritableStreamImpl, {
    constructWith: [atArg(2, contextValue(createStreamAbortController))],
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
