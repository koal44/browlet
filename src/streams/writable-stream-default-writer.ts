import type { PromiseValue, PromiseValueCapability, Promises } from '../js-engine/promises';
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
  get closed(): PromiseValue<void> {
    return this.state.closedPromise.promise;
  }

  get desiredSize(): number | null {
    if (!this.state.stream) {
      throw defaultWriterLockException('get the desired size of');
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  // SPEC_MISMATCH: get ready() -> Promise<undefined>
  get ready(): PromiseValue<void> {
    return this.state.readyPromise.promise;
  }

  // SPEC_MISMATCH: abort(reason?) -> Promise<undefined>
  abort(reason?: unknown): PromiseValue<void> {
    if (!this.state.stream) {
      return this.state.promises.reject(defaultWriterLockException('abort'));
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  // SPEC_MISMATCH: close() -> Promise<undefined>
  close(): PromiseValue<void> {
    const stream = this.state.stream;
    if (!stream) {
      return this.state.promises.reject(defaultWriterLockException('close'));
    }
    if (writableStreamCloseQueuedOrInFlight(stream)) {
      return this.state.promises.reject(new TypeError(
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
  write(chunk?: unknown): PromiseValue<void> {
    if (!this.state.stream) {
      return this.state.promises.reject(defaultWriterLockException('write to'));
    }
    return writableStreamDefaultWriterWrite(this, chunk);
  }
}

export type WritableStreamDefaultWriterState = {
  readonly promises: Promises;
  closedPromise: PromiseValueCapability<void>;
  readyPromise: PromiseValueCapability<void>;
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
