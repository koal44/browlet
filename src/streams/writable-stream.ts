import type { RuntimeContext } from '../js-engine/runtime-context';
import type { PromiseValue, PromiseValueCapability } from '../js-engine/promises';
import {
  arg, atArg, callback, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, op, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import { bind, runtimeContext } from '../web-idl/projection';
import { convertStreamCallbacks } from './integration';
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
    readonly runtime: RuntimeContext,
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
    );
  }

  get locked(): boolean {
    return isWritableStreamLocked(this);
  }

  // SPEC_MISMATCH: abort(reason?) -> Promise<undefined>
  abort(reason?: unknown): PromiseValue<void> {
    if (isWritableStreamLocked(this)) {
      return this.runtime.promises.reject(new TypeError(
        'Cannot abort a stream that already has a writer',
      ));
    }
    return writableStreamAbort(this, reason);
  }

  // SPEC_MISMATCH: close() -> Promise<undefined>
  close(): PromiseValue<void> {
    if (isWritableStreamLocked(this)) {
      return this.runtime.promises.reject(new TypeError(
        'Cannot close a stream that already has a writer',
      ));
    }
    if (writableStreamCloseQueuedOrInFlight(this)) {
      return this.runtime.promises.reject(new TypeError(
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
  startAlgorithm: () => PromiseValue<unknown> | void,
  writeAlgorithm: (chunk: unknown) => PromiseValue<unknown>,
  closeAlgorithm: () => PromiseValue<unknown>,
  abortAlgorithm: (reason: unknown) => PromiseValue<unknown>,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  runtime: RuntimeContext,
): WritableStreamImpl {
  const stream = new WritableStreamImpl(null, {}, runtime);
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
  );
  return stream;
}

export type WritableStreamState = {
  backpressure: boolean;
  closeRequest?: PromiseValueCapability<void>;
  controller?: WritableStreamDefaultControllerImpl;
  inFlightCloseRequest?: PromiseValueCapability<void>;
  inFlightWriteRequest?: PromiseValueCapability<void>;
  pendingAbortRequest?: WritableStreamPendingAbortRequest;
  state: 'closed' | 'errored' | 'erroring' | 'writable';
  storedError?: unknown;
  writer?: WritableStreamDefaultWriterImpl;
  writeRequests: PromiseValueCapability<void>[];
};

type WritableStreamPendingAbortRequest = {
  readonly promise: PromiseValueCapability<void>;
  readonly reason: unknown;
  readonly wasAlreadyErroring: boolean;
};

export type UnderlyingSink = {
  readonly abort?: (reason?: unknown) => PromiseValue<unknown> | void;
  readonly close?: () => PromiseValue<unknown> | void;
  readonly start?: (controller: WritableStreamDefaultControllerImpl) => PromiseValue<unknown> | void;
  readonly type?: unknown;
  readonly write?: (
    chunk: unknown,
    controller: WritableStreamDefaultControllerImpl,
  ) => PromiseValue<unknown> | void;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamIDL = defineInterface({
  name: 'WritableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(WritableStreamImpl, {
    constructWith: [
      atArg(2, runtimeContext),
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
          context.getRuntime(),
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
