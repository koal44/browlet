import {
  arg, ctor, defineInterface, idlType, impl, nullable, op, promise, roAttr,
  reference,
} from '../web-idl/declaration/index';
import { TypeError } from '../js-engine/simple-exception';
import type { WritableStreamImpl } from './writable-stream';
import {
  setUpWritableStreamDefaultWriter, writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterAbort, writableStreamDefaultWriterClose,
  writableStreamDefaultWriterGetDesiredSize,
  writableStreamDefaultWriterRelease, writableStreamDefaultWriterWrite,
} from './writable-stream-operations';

export class WritableStreamDefaultWriterImpl {
  state!: WritableStreamDefaultWriterState;

  // SPEC_MISMATCH: WritableStreamDefaultWriter(stream) -> WritableStreamDefaultWriter
  constructor(
    stream?: WritableStreamImpl,
  ) {
    if (stream) setUpWritableStreamDefaultWriter(this, stream);
  }

  get closed(): Promise<void> {
    return this.state.closedPromise.promise;
  }

  get desiredSize(): number | null {
    if (!this.state.stream) {
      throw defaultWriterLockException('get the desired size of');
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready(): Promise<void> {
    return this.state.readyPromise.promise;
  }

  abort(reason?: unknown): Promise<void> {
    if (!this.state.stream) {
      return Promise.reject(defaultWriterLockException('abort'));
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  close(): Promise<void> {
    const stream = this.state.stream;
    if (!stream) {
      return Promise.reject(defaultWriterLockException('close'));
    }
    if (writableStreamCloseQueuedOrInFlight(stream)) {
      return Promise.reject(new TypeError(
        'Cannot close an already-closing stream',
      ));
    }
    return writableStreamDefaultWriterClose(this);
  }

  releaseLock(): void {
    if (!this.state.stream) return;
    writableStreamDefaultWriterRelease(this);
  }

  write(chunk?: unknown): Promise<void> {
    if (!this.state.stream) {
      return Promise.reject(defaultWriterLockException('write to'));
    }
    return writableStreamDefaultWriterWrite(this, chunk);
  }
}

export type WritableStreamDefaultWriterState = {
  closedPromise: PromiseWithResolvers<void>;
  closedPending: boolean;
  readyPromise: PromiseWithResolvers<void>;
  readyPending: boolean;
  stream?: WritableStreamImpl;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamDefaultWriterIDL = defineInterface({
  name: 'WritableStreamDefaultWriter',
  exposed: '*',
  implementation: impl(WritableStreamDefaultWriterImpl),
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

function defaultWriterLockException(
  operation: string,
): TypeError {
  return new TypeError(
    `Cannot ${operation} a stream using a released writer`,
  );
}
