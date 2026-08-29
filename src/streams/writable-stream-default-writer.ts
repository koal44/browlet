import {
  arg, ctor, defineInterface, idlType, impl, nullable, op, promise, roAttr,
  reference,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import type { StreamPromise } from './promise';
import type { WritableStreamImpl } from './writable-stream';
import {
  setUpWritableStreamDefaultWriter, writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterAbort, writableStreamDefaultWriterClose,
  writableStreamDefaultWriterGetDesiredSize,
  writableStreamDefaultWriterRelease, writableStreamDefaultWriterWrite,
} from './writable-stream-operations';
import {
  getWritableStreamDefaultWriterContext,
  getWritableStreamDefaultWriterState,
  initializeWritableStreamDefaultWriterSlots,
} from './writable-stream-slots';

export class WritableStreamDefaultWriterImpl {
  constructor(
    context: BindingContext,
    stream?: WritableStreamImpl,
  ) {
    initializeWritableStreamDefaultWriterSlots(this, context);
    if (stream) setUpWritableStreamDefaultWriter(this, stream);
  }

  get closed(): StreamPromise {
    return getWritableStreamDefaultWriterState(this).closedPromise;
  }

  get desiredSize(): number | null {
    if (!getWritableStreamDefaultWriterState(this).stream) {
      throw defaultWriterLockException(this, 'get the desired size of');
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready(): StreamPromise {
    return getWritableStreamDefaultWriterState(this).readyPromise;
  }

  abort(reason?: unknown): StreamPromise {
    const context = getWritableStreamDefaultWriterContext(this);
    if (!getWritableStreamDefaultWriterState(this).stream) {
      return context.createRejectedPromise(
        defaultWriterLockException(this, 'abort'),
        idlType.undefined,
      );
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  close(): StreamPromise {
    const context = getWritableStreamDefaultWriterContext(this);
    const stream = getWritableStreamDefaultWriterState(this).stream;
    if (!stream) {
      return context.createRejectedPromise(
        defaultWriterLockException(this, 'close'),
        idlType.undefined,
      );
    }
    if (writableStreamCloseQueuedOrInFlight(stream)) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.typeError(
          'Cannot close an already-closing stream',
        ),
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
    const context = getWritableStreamDefaultWriterContext(this);
    if (!getWritableStreamDefaultWriterState(this).stream) {
      return context.createRejectedPromise(
        defaultWriterLockException(this, 'write to'),
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
    constructWith: [bindingContext],
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

function defaultWriterLockException(
  writer: WritableStreamDefaultWriterImpl,
  operation: string,
): TypeError {
  const context = getWritableStreamDefaultWriterContext(writer);
  return new context.realm.intrinsics.typeError(
    `Cannot ${operation} a stream using a released writer`,
  );
}
