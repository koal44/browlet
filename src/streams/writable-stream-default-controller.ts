import {
  arg, defineInterface, idlType, impl, op, roAttr, reference,
} from '../web-idl/declaration/index';
import {
  type StreamAbortController, type StreamAbortSignal,
} from './abort';
import type { QueueContainer } from './queue-with-sizes';
import type { QueuingStrategySize } from './queuing-strategy';
import type { WritableStreamImpl } from './writable-stream';
import {
  isWritableStreamWritable,
  writableStreamDefaultControllerError,
} from './writable-stream-operations';

export class WritableStreamDefaultControllerImpl {
  state!: WritableStreamDefaultControllerState;

  get signal(): StreamAbortSignal {
    return this.state.abortController.signal;
  }

  error(error?: unknown): void {
    if (!isWritableStreamWritable(this.state.stream)) return;
    writableStreamDefaultControllerError(this, error);
  }
}

export type WritableStreamDefaultControllerState =
  QueueContainer<unknown> & {
    abortAlgorithm?: (reason: unknown) => Promise<unknown>;
    abortController: StreamAbortController;
    closeAlgorithm?: () => Promise<unknown>;
    started: boolean;
    strategyHighWaterMark: number;
    strategySizeAlgorithm?: QueuingStrategySize;
    stream: WritableStreamImpl;
    writeAlgorithm?: (chunk: unknown) => Promise<unknown>;
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
