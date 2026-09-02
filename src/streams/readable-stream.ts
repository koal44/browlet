// @rollup-cycle streams-readable
import {
  arg, asyncIter, asyncSequence, callback, ctor, defineCallbackFunction,
  defineDictionary, defineEnumeration, defineInterface, defineTypedef,
  dictMember, emptyDictionary, idlType, impl, invokeWith, op, promise, roAttr,
  reference, sequence, union, xattr,
} from '../web-idl/declaration/index';
import type { IDLAsyncSequence } from '../web-idl/async-sequence';
import { bindingContext, type BindingContext } from '../web-idl/projection';
import type { StreamAbortSignal } from './abort';
import type { StreamPromise } from './promise';
import {
  extractHighWaterMark, type QueuingStrategy,
} from './queuing-strategy';
import {
  acquireReadableStreamDefaultReader, initializeReadableStream,
  initializeReadableStreamAsyncIterator,
  isReadableStreamLocked, readableStreamCancel, readableStreamPipeTo,
  readableStreamAsyncIteratorGetNext, readableStreamAsyncIteratorReturn,
  readableStreamDefaultTee, readableStreamFromIterable,
  setUpReadableStreamDefaultControllerFromUnderlyingSource,
} from './readable-stream-operations';
import type { ReadableStreamDefaultControllerImpl } from './readable-stream-default-controller';
import type { ReadableStreamDefaultReaderImpl } from './readable-stream-default-reader';
import { ReadableByteStreamControllerImpl } from './readable-byte-stream-controller';
import type { ReadableStreamBYOBReaderImpl } from './readable-stream-byob-reader';
import {
  acquireReadableStreamBYOBReader,
  readableByteStreamTee,
  setUpReadableByteStreamControllerFromUnderlyingSource,
} from './readable-byte-stream-operations';
import type { WritableStreamImpl } from './writable-stream';
import { isWritableStreamLocked } from './writable-stream-operations';
import { internalStreamSetup } from './internal-methods';

export class ReadableStreamImpl {
  readonly #context: BindingContext;
  readonly #state: ReadableStreamState;

  constructor(
    context: BindingContext,
    underlyingSource?: object | typeof internalStreamSetup,
    strategy: QueuingStrategy = {},
  ) {
    this.#context = context;
    this.#state = initializeReadableStream();
    if (underlyingSource === internalStreamSetup) return;

    const source = underlyingSource ?? null;
    const sourceDictionary = context.convert(
      source,
      reference('UnderlyingSource'),
    ) as UnderlyingSource;
    if (sourceDictionary.type === 'bytes') {
      if (strategy.size !== undefined) {
        throw new context.realm.intrinsics.rangeError(
          'A byte stream strategy must not provide a size algorithm',
        );
      }
      const highWaterMark = extractHighWaterMark(
        strategy,
        0,
        context.realm.intrinsics.rangeError,
      );
      setUpReadableByteStreamControllerFromUnderlyingSource(
        this,
        source,
        sourceDictionary,
        highWaterMark,
      );
      return;
    }

    setUpReadableStreamDefaultControllerFromUnderlyingSource(
      this,
      source,
      sourceDictionary,
      strategy,
    );
  }

  static from(
    context: BindingContext,
    asyncIterable: IDLAsyncSequence,
  ): ReadableStreamImpl {
    return readableStreamFromIterable(context, asyncIterable);
  }

  get locked(): boolean {
    return isReadableStreamLocked(this);
  }

  cancel(reason?: unknown): StreamPromise {
    const context = ReadableStreamImpl.getContext(this);
    if (isReadableStreamLocked(this)) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.typeError(
          'Cannot cancel a stream that already has a reader',
        ),
        idlType.undefined,
      );
    }
    return readableStreamCancel(this, reason);
  }

  getReader(
    options: { readonly mode: 'byob'; },
  ): ReadableStreamBYOBReaderImpl;
  getReader(
    options?: { readonly mode?: undefined; },
  ): ReadableStreamDefaultReaderImpl;
  getReader(
    options: ReadableStreamGetReaderOptions = {},
  ): ReadableStreamBYOBReaderImpl | ReadableStreamDefaultReaderImpl {
    return options.mode === 'byob'
      ? acquireReadableStreamBYOBReader(this)
      : acquireReadableStreamDefaultReader(this);
  }

  pipeThrough(
    transform: ReadableWritablePair,
    options: StreamPipeOptions,
  ): ReadableStreamImpl {
    if (isReadableStreamLocked(this)) {
      throw new this.#context.realm.intrinsics.typeError(
        'ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream',
      );
    }
    if (isWritableStreamLocked(transform.writable)) {
      throw new this.#context.realm.intrinsics.typeError(
        'ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream',
      );
    }

    const promise = readableStreamPipeTo(
      this,
      transform.writable,
      options.preventClose,
      options.preventAbort,
      options.preventCancel,
      options.signal,
    );
    this.#context.markPromiseHandled(promise);
    return transform.readable;
  }

  pipeTo(
    destination: WritableStreamImpl,
    options: StreamPipeOptions,
  ): StreamPromise {
    if (isReadableStreamLocked(this)) {
      return this.#context.createRejectedPromise(
        new this.#context.realm.intrinsics.typeError(
          'ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream',
        ),
        idlType.undefined,
      );
    }
    if (isWritableStreamLocked(destination)) {
      return this.#context.createRejectedPromise(
        new this.#context.realm.intrinsics.typeError(
          'ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream',
        ),
        idlType.undefined,
      );
    }

    return readableStreamPipeTo(
      this,
      destination,
      options.preventClose,
      options.preventAbort,
      options.preventCancel,
      options.signal,
    );
  }

  tee(): [ReadableStreamImpl, ReadableStreamImpl] {
    return ReadableByteStreamControllerImpl.is(
      ReadableStreamImpl.getController(this),
    )
      ? readableByteStreamTee(this)
      : readableStreamDefaultTee(this, false);
  }

  // -- Friends ----------------------------------------------------------

  static getContext(stream: ReadableStreamImpl): BindingContext {
    return stream.#context;
  }

  static getController(
    stream: ReadableStreamImpl,
  ): NonNullable<ReadableStreamState['controller']> {
    const controller = stream.#state.controller;
    if (!controller) throw new Error('ReadableStream has no controller');
    return controller;
  }

  static getState(stream: ReadableStreamImpl): ReadableStreamState {
    return stream.#state;
  }
}

export type ReadableStreamState = {
  controller?: ReadableByteStreamControllerImpl |
    ReadableStreamDefaultControllerImpl;
  detached: boolean;
  disturbed: boolean;
  reader?: ReadableStreamBYOBReaderImpl | ReadableStreamDefaultReaderImpl;
  state: 'readable' | 'closed' | 'errored';
  storedError?: unknown;
};

export type ReadableStreamGetReaderOptions = {
  readonly mode?: 'byob';
};

export type ReadableStreamIteratorOptions = {
  readonly preventCancel: boolean;
};

export type ReadableWritablePair = {
  readonly readable: ReadableStreamImpl;
  readonly writable: WritableStreamImpl;
};

export type StreamPipeOptions = {
  readonly preventAbort: boolean;
  readonly preventCancel: boolean;
  readonly preventClose: boolean;
  readonly signal?: StreamAbortSignal;
};

export type UnderlyingSource = {
  readonly autoAllocateChunkSize?: number;
  readonly cancel?: (reason?: unknown) => StreamPromise;
  readonly pull?: (
    controller: ReadableByteStreamControllerImpl |
      ReadableStreamDefaultControllerImpl,
  ) => StreamPromise;
  readonly start?: (
    controller: ReadableByteStreamControllerImpl |
      ReadableStreamDefaultControllerImpl,
  ) => unknown;
  readonly type?: 'bytes';
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamIDL = defineInterface({
  name: 'ReadableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(ReadableStreamImpl, {
    constructWith: [bindingContext],
  }),
  members: [
    ctor([
      arg('underlyingSource', idlType.object, { optional: true }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('from', reference('ReadableStream'),
      [arg('asyncIterable', asyncSequence(idlType.any))],
      { ...invokeWith(bindingContext), static: true }
    ),
    roAttr('locked', idlType.boolean),
    op('cancel', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('getReader', reference('ReadableStreamReader'), [
      arg('options', reference('ReadableStreamGetReaderOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('pipeThrough', reference('ReadableStream'), [
      arg('transform', reference('ReadableWritablePair')),
      arg('options', reference('StreamPipeOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('pipeTo', promise(idlType.undefined), [
      arg('destination', reference('WritableStream')),
      arg('options', reference('StreamPipeOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('tee', sequence(reference('ReadableStream'))),
    asyncIter(idlType.any, {
      arguments: [arg(
        'options',
        reference('ReadableStreamIteratorOptions'),
        { default: emptyDictionary, optional: true },
      )],
      binding: {
        getNext: (target, iterator) => readableStreamAsyncIteratorGetNext(
          target as ReadableStreamImpl,
          iterator,
        ),
        initialize(target, iterator, [options]) {
          initializeReadableStreamAsyncIterator(
            target as ReadableStreamImpl,
            iterator,
            options as ReadableStreamIteratorOptions,
          );
        },
        return: (target, iterator, value) =>
          readableStreamAsyncIteratorReturn(
            target as ReadableStreamImpl,
            iterator,
            value,
          ),
      },
    }),
  ],
});

export const readableStreamReaderIDL = defineTypedef({
  name: 'ReadableStreamReader',
  type: union(
    reference('ReadableStreamDefaultReader'),
    reference('ReadableStreamBYOBReader'),
  ),
});

export const readableStreamReaderModeIDL = defineEnumeration({
  name: 'ReadableStreamReaderMode',
  values: ['byob'],
});

export const readableStreamGetReaderOptionsIDL = defineDictionary({
  name: 'ReadableStreamGetReaderOptions',
  members: [dictMember('mode', reference('ReadableStreamReaderMode'))],
});

export const readableStreamIteratorOptionsIDL = defineDictionary({
  name: 'ReadableStreamIteratorOptions',
  members: [dictMember('preventCancel', idlType.boolean, { default: false })],
});

export const readableWritablePairIDL = defineDictionary({
  name: 'ReadableWritablePair',
  members: [
    dictMember('readable', reference('ReadableStream'), { required: true }),
    dictMember('writable', reference('WritableStream'), { required: true }),
  ],
});

export const streamPipeOptionsIDL = defineDictionary({
  name: 'StreamPipeOptions',
  members: [
    dictMember('preventClose', idlType.boolean, { default: false }),
    dictMember('preventAbort', idlType.boolean, { default: false }),
    dictMember('preventCancel', idlType.boolean, { default: false }),
    dictMember('signal', reference('AbortSignal')),
  ],
});

export const underlyingSourceStartCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSourceStartCallback',
  returns: idlType.any,
  arguments: [arg('controller', reference('ReadableStreamController'))],
});

export const underlyingSourcePullCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSourcePullCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('controller', reference('ReadableStreamController'))],
});

export const underlyingSourceCancelCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSourceCancelCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('reason', idlType.any, { optional: true })],
});

export const readableStreamTypeIDL = defineEnumeration({
  name: 'ReadableStreamType',
  values: ['bytes'],
});

export const readableStreamControllerIDL = defineTypedef({
  name: 'ReadableStreamController',
  type: union(
    reference('ReadableStreamDefaultController'),
    reference('ReadableByteStreamController'),
  ),
});

export const underlyingSourceIDL = defineDictionary({
  name: 'UnderlyingSource',
  members: [
    dictMember('start', reference('UnderlyingSourceStartCallback'),
      callback('rethrow')),
    dictMember('pull', reference('UnderlyingSourcePullCallback')),
    dictMember('cancel', reference('UnderlyingSourceCancelCallback')),
    dictMember('type', reference('ReadableStreamType')),
    dictMember('autoAllocateChunkSize', idlType.unsignedLongLong, {
      ...xattr('EnforceRange'),
    }),
  ],
});
