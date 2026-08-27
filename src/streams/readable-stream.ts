import {
  arg, asyncIter, asyncSequence, ctor, defineDictionary,
  defineEnumeration, defineInterface, defineTypedef, dictMember,
  emptyDictionary, idlType, impl, op, promise, roAttr,
  reference, sequence, union, xattr,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
import type { QueuingStrategy } from './queuing-strategy';
import {
  acquireReadableStreamDefaultReader, initializeReadableStream,
  isReadableStreamLocked, readableStreamCancel,
  setUpReadableStreamDefaultControllerFromUnderlyingSource,
} from './readable-stream-operations';
import type { ReadableStreamDefaultControllerImpl } from './readable-stream-default-controller';
import type { ReadableStreamDefaultReaderImpl } from './readable-stream-default-reader';

export class ReadableStreamImpl {
  readonly #environment: StreamEnvironment;
  readonly #state: ReadableStreamState;

  constructor(
    environment: StreamEnvironment,
    underlyingSource?: object,
    strategy: QueuingStrategy = {},
  ) {
    this.#environment = environment;
    this.#state = initializeReadableStream();

    const source = underlyingSource ?? null;
    const sourceDictionary = environment.dictionaries.convert(
      source,
      reference('UnderlyingSource'),
    ) as UnderlyingSource;
    if (sourceDictionary.type === 'bytes') {
      throw new TypeError('Readable byte streams are not available yet');
    }

    setUpReadableStreamDefaultControllerFromUnderlyingSource(
      this,
      source,
      sourceDictionary,
      strategy,
    );
  }

  get locked(): boolean {
    return isReadableStreamLocked(this);
  }

  cancel(reason?: unknown): StreamPromise {
    const environment = ReadableStreamImpl.getEnvironment(this);
    if (isReadableStreamLocked(this)) {
      return environment.promises.createRejected(
        new TypeError('Cannot cancel a stream that already has a reader'),
        idlType.undefined,
      );
    }
    return readableStreamCancel(this, reason);
  }

  getReader(
    options: ReadableStreamGetReaderOptions,
  ): ReadableStreamDefaultReaderImpl {
    if (options.mode !== undefined) {
      throw new TypeError('BYOB readers are not available yet');
    }
    return acquireReadableStreamDefaultReader(this);
  }

  // -- Friends ----------------------------------------------------------

  static getEnvironment(stream: ReadableStreamImpl): StreamEnvironment {
    return stream.#environment;
  }

  static getState(stream: ReadableStreamImpl): ReadableStreamState {
    return stream.#state;
  }
}

export type ReadableStreamState = {
  controller?: ReadableStreamDefaultControllerImpl;
  detached: boolean;
  disturbed: boolean;
  reader?: ReadableStreamDefaultReaderImpl;
  state: 'readable' | 'closed' | 'errored';
  storedError?: unknown;
};

export type ReadableStreamGetReaderOptions = {
  readonly mode?: 'byob';
};

export type UnderlyingSource = {
  readonly autoAllocateChunkSize?: number;
  readonly cancel?: unknown;
  readonly pull?: unknown;
  readonly start?: unknown;
  readonly type?: 'bytes';
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamIDL = defineInterface({
  name: 'ReadableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(ReadableStreamImpl, {
    withArgs: [streamEnvironment],
  }),
  members: [
    ctor([
      arg('underlyingSource', idlType.object, { optional: true }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('from', reference('ReadableStream'), [
      arg('asyncIterable', asyncSequence(idlType.any)),
    ], { static: true }),
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
