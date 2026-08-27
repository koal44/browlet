import {
  arg, ctor, defineInterface, idlType, impl, nullable, op, promise, roAttr,
  reference,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
import type { WritableStreamImpl } from './writable-stream';
import {
  setUpWritableStreamDefaultWriter, writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterAbort, writableStreamDefaultWriterClose,
  writableStreamDefaultWriterGetDesiredSize,
  writableStreamDefaultWriterRelease, writableStreamDefaultWriterWrite,
} from './writable-stream-operations';
import {
  getWritableStreamDefaultWriterEnvironment,
  getWritableStreamDefaultWriterState,
  initializeWritableStreamDefaultWriterSlots,
} from './writable-stream-slots';

export class WritableStreamDefaultWriterImpl {
  constructor(
    environment: StreamEnvironment,
    stream?: WritableStreamImpl,
  ) {
    initializeWritableStreamDefaultWriterSlots(this, environment);
    if (stream) setUpWritableStreamDefaultWriter(this, stream);
  }

  get closed(): StreamPromise {
    return getWritableStreamDefaultWriterState(this).closedPromise;
  }

  get desiredSize(): number | null {
    if (!getWritableStreamDefaultWriterState(this).stream) {
      throw defaultWriterLockException('get the desired size of');
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready(): StreamPromise {
    return getWritableStreamDefaultWriterState(this).readyPromise;
  }

  abort(reason?: unknown): StreamPromise {
    if (!getWritableStreamDefaultWriterState(this).stream) {
      return getWritableStreamDefaultWriterEnvironment(this).promises
        .createRejected(
          defaultWriterLockException('abort'),
          idlType.undefined,
        );
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  close(): StreamPromise {
    const stream = getWritableStreamDefaultWriterState(this).stream;
    if (!stream) {
      return getWritableStreamDefaultWriterEnvironment(this).promises
        .createRejected(
          defaultWriterLockException('close'),
          idlType.undefined,
        );
    }
    if (writableStreamCloseQueuedOrInFlight(stream)) {
      return getWritableStreamDefaultWriterEnvironment(this).promises
        .createRejected(
          new TypeError('Cannot close an already-closing stream'),
          idlType.undefined,
        );
    }
    return writableStreamDefaultWriterClose(this);
  }

  releaseLock(): void {
    if (!getWritableStreamDefaultWriterState(this).stream) return;
    writableStreamDefaultWriterRelease(this);
  }

  write(chunk?: unknown): StreamPromise {
    if (!getWritableStreamDefaultWriterState(this).stream) {
      return getWritableStreamDefaultWriterEnvironment(this).promises
        .createRejected(
          defaultWriterLockException('write to'),
          idlType.undefined,
        );
    }
    return writableStreamDefaultWriterWrite(this, chunk);
  }
}

export type WritableStreamDefaultWriterState = {
  closedPromise: StreamPromise;
  readyPromise: StreamPromise;
  stream?: WritableStreamImpl;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamDefaultWriterIDL = defineInterface({
  name: 'WritableStreamDefaultWriter',
  exposed: '*',
  implementation: impl(WritableStreamDefaultWriterImpl, {
    withArgs: [streamEnvironment],
  }),
  members: [
    ctor([arg('stream', reference('WritableStream'))]),
    roAttr('closed', promise(idlType.undefined)),
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    roAttr('ready', promise(idlType.undefined)),
    op('abort', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('close', promise(idlType.undefined)),
    op('releaseLock', idlType.undefined),
    op('write', promise(idlType.undefined), [
      arg('chunk', idlType.any, { optional: true }),
    ]),
  ],
});

function defaultWriterLockException(operation: string): TypeError {
  return new TypeError(
    `Cannot ${operation} a stream using a released writer`,
  );
}
