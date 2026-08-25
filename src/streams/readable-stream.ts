import {
  arg, asyncIterable, asyncSequence, ctor, defineDictionary,
  defineEnumeration, defineInterface, defineTypedef, dictMember,
  emptyDictionary, idlType, op, promise, readonlyAttr, reference, sequence,
  union, xattr,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl';
import {
  getStreamEnvironment, type StreamEnvironment, type StreamPromise,
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
  #environment?: StreamEnvironment;
  #state?: ReadableStreamState;

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
    if (!stream.#environment) {
      throw new Error('ReadableStream has no Streams environment');
    }
    return stream.#environment;
  }

  static getState(stream: ReadableStreamImpl): ReadableStreamState {
    if (!stream.#state) {
      throw new Error('ReadableStream has not been initialized');
    }
    return stream.#state;
  }

  static initializeForBinding(
    stream: ReadableStreamImpl,
    environment: StreamEnvironment,
  ): void {
    stream.#environment = environment;
    stream.#state = initializeReadableStream();
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
  ...xattr('Transferable'),
  binding: bind(ReadableStreamImpl, {
    initialize(context, value) {
      ReadableStreamImpl.initializeForBinding(
        value as ReadableStreamImpl,
        getStreamEnvironment(context),
      );
    },
  }),
  exposed: '*',
  members: [
    ctor([
      arg('underlyingSource', idlType.object, { optional: true }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ], bind({
      invoke(context, underlyingSource, strategy) {
        const stream = this as ReadableStreamImpl;
        const environment = getStreamEnvironment(context);
        const source = underlyingSource ?? null;
        const sourceDictionary = environment.dictionaries.convert(
          source,
          reference('UnderlyingSource'),
        ) as UnderlyingSource;

        if (sourceDictionary.type === 'bytes') {
          throw new TypeError('Readable byte streams are not available yet');
        }

        setUpReadableStreamDefaultControllerFromUnderlyingSource(
          stream,
          source,
          sourceDictionary,
          strategy as QueuingStrategy,
        );
      },
    })),
    op('from', reference('ReadableStream'), [
      arg('asyncIterable', asyncSequence(idlType.any)),
    ], { static: true }),
    readonlyAttr('locked', idlType.boolean),
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
    asyncIterable(idlType.any, {
      arguments: [arg(
        'options',
        reference('ReadableStreamIteratorOptions'),
        { default: emptyDictionary, optional: true },
      )],
    }),
  ],
  name: 'ReadableStream',
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
  members: [dictMember('mode', reference('ReadableStreamReaderMode'))],
  name: 'ReadableStreamGetReaderOptions',
});

export const readableStreamIteratorOptionsIDL = defineDictionary({
  members: [dictMember('preventCancel', idlType.boolean, { default: false })],
  name: 'ReadableStreamIteratorOptions',
});

export const readableWritablePairIDL = defineDictionary({
  members: [
    dictMember('readable', reference('ReadableStream'), { required: true }),
    dictMember('writable', reference('WritableStream'), { required: true }),
  ],
  name: 'ReadableWritablePair',
});

export const streamPipeOptionsIDL = defineDictionary({
  members: [
    dictMember('preventClose', idlType.boolean, { default: false }),
    dictMember('preventAbort', idlType.boolean, { default: false }),
    dictMember('preventCancel', idlType.boolean, { default: false }),
    dictMember('signal', reference('AbortSignal')),
  ],
  name: 'StreamPipeOptions',
});
