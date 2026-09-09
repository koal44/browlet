import { InternalPromise, type InternalPromiseCapability, type PromiseReactions } from '../js-engine/internal-promise';
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

  // SPEC_MISMATCH: get closed() -> Promise<undefined>
  get closed(): InternalPromise<void> {
    return this.state.closedPromise.promise;
  }

  get desiredSize(): number | null {
    if (!this.state.stream) {
      throw defaultWriterLockException('get the desired size of');
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  // SPEC_MISMATCH: get ready() -> Promise<undefined>
  get ready(): InternalPromise<void> {
    return this.state.readyPromise.promise;
  }

  // SPEC_MISMATCH: abort(reason?) -> Promise<undefined>
  abort(reason?: unknown): InternalPromise<void> {
    if (!this.state.stream) {
      return InternalPromise.reject(defaultWriterLockException('abort'));
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  // SPEC_MISMATCH: close() -> Promise<undefined>
  close(): InternalPromise<void> {
    const stream = this.state.stream;
    if (!stream) {
      return InternalPromise.reject(defaultWriterLockException('close'));
    }
    if (writableStreamCloseQueuedOrInFlight(stream)) {
      return InternalPromise.reject(new TypeError(
        'Cannot close an already-closing stream',
      ));
    }
    return writableStreamDefaultWriterClose(this);
  }

  releaseLock(): void {
    if (!this.state.stream) return;
    writableStreamDefaultWriterRelease(this);
  }

  // SPEC_MISMATCH: write(chunk?) -> Promise<undefined>
  write(chunk?: unknown): InternalPromise<void> {
    if (!this.state.stream) {
      return InternalPromise.reject(defaultWriterLockException('write to'));
    }
    return writableStreamDefaultWriterWrite(this, chunk);
  }
}

export type WritableStreamDefaultWriterState = {
  readonly reactions: PromiseReactions;
  closedPromise: InternalPromiseCapability<void>;
  closedPending: boolean;
  readyPromise: InternalPromiseCapability<void>;
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
