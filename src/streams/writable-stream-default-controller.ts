import {
  arg, defineInterface, idlType, impl, op, roAttr, reference,
} from '../web-idl/declaration/index';
import {
  type StreamAbortController, type StreamAbortSignal,
} from './abort';
import type { StreamPromise } from './promise';
import type { QueueContainer } from './queue-with-sizes';
import type { QueuingStrategySize } from './queuing-strategy';
import type { WritableStreamImpl } from './writable-stream';
import {
  isWritableStreamWritable,
  writableStreamDefaultControllerError,
} from './writable-stream-operations';
import {
  getWritableStreamDefaultControllerState,
  initializeWritableStreamDefaultControllerSlots,
} from './writable-stream-slots';

export class WritableStreamDefaultControllerImpl {
  constructor() {
    initializeWritableStreamDefaultControllerSlots(this);
  }

  get signal(): StreamAbortSignal {
    return getWritableStreamDefaultControllerState(this).abortController.signal;
  }

  error(error?: unknown): void {
    if (!isWritableStreamWritable(
      getWritableStreamDefaultControllerState(this).stream,
    )) return;
    writableStreamDefaultControllerError(this, error);
  }
}

export type WritableStreamDefaultControllerState =
  QueueContainer<unknown> & {
    abortAlgorithm?: (reason: unknown) => StreamPromise;
    abortController: StreamAbortController;
    closeAlgorithm?: () => StreamPromise;
    started: boolean;
    strategyHighWaterMark: number;
    strategySizeAlgorithm?: QueuingStrategySize;
    stream: WritableStreamImpl;
    writeAlgorithm?: (chunk: unknown) => StreamPromise;
  };

// -- Web IDL ------------------------------------------------------------

export const writableStreamDefaultControllerIDL = defineInterface({
  name: 'WritableStreamDefaultController',
  exposed: '*',
  implementation: impl(WritableStreamDefaultControllerImpl),
  members: [
    roAttr('signal', reference('AbortSignal')),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
});
