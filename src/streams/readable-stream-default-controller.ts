// @rollup-cycle streams-readable
import type { PromiseValue } from '../js-engine/promises';
import {
  arg, defineInterface, idlType, impl, nullable, op, roAttr,
} from '../web-idl/declaration/index';
import { TypeError } from '../js-engine/simple-exception';
import {
  cancelSteps, pullSteps, releaseSteps,
} from './internal-methods';
import type { QueueContainer } from './queue-with-sizes';
import type { QueuingStrategySize } from './queuing-strategy';
import type { ReadRequest } from './readable-stream-default-reader';
import type { ReadableStreamImpl } from './readable-stream';
import {
  readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerClearAlgorithms,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerPull,
} from './readable-stream-operations';

export class ReadableStreamDefaultControllerImpl {
  #state?: ReadableStreamDefaultControllerState;

  get desiredSize(): number | null {
    return readableStreamDefaultControllerGetDesiredSize(this);
  }

  close(): void {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
      throw new TypeError(
        'The stream is not in a state that permits close',
      );
    }
    readableStreamDefaultControllerClose(this);
  }

  enqueue(chunk?: unknown): void {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
      throw new TypeError(
        'The stream is not in a state that permits enqueue',
      );
    }
    readableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(error?: unknown): void {
    readableStreamDefaultControllerError(this, error);
  }

  readonly [cancelSteps] = (reason: unknown): PromiseValue<unknown> => {
    const state = ReadableStreamDefaultControllerImpl.getState(this);
    state.queue = [];
    state.queueTotalSize = 0;
    const result = requireAlgorithm(state.cancelAlgorithm, 'cancel')(reason);
    readableStreamDefaultControllerClearAlgorithms(this);
    return result;
  };

  readonly [pullSteps] = (request: ReadRequest): void => {
    readableStreamDefaultControllerPull(this, request);
  };

  readonly [releaseSteps] = (): void => {};

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is ReadableStreamDefaultControllerImpl {
    return typeof value === 'object' && value !== null && #state in value;
  }

  static getState(
    controller: ReadableStreamDefaultControllerImpl,
  ): ReadableStreamDefaultControllerState {
    if (!controller.#state) {
      throw new Error('ReadableStreamDefaultController is not set up');
    }
    return controller.#state;
  }

  static setState(
    controller: ReadableStreamDefaultControllerImpl,
    state: ReadableStreamDefaultControllerState,
  ): void {
    controller.#state = state;
  }
}

export type ReadableStreamDefaultControllerState =
  QueueContainer<unknown> & {
    cancelAlgorithm?: (reason: unknown) => PromiseValue<unknown>;
    closeRequested: boolean;
    pullAgain: boolean;
    pullAlgorithm?: () => PromiseValue<unknown>;
    pulling: boolean;
    started: boolean;
    strategyHighWaterMark: number;
    strategySizeAlgorithm?: QueuingStrategySize;
    stream: ReadableStreamImpl;
  };

// -- Web IDL ------------------------------------------------------------

export const readableStreamDefaultControllerIDL = defineInterface({
  name: 'ReadableStreamDefaultController',
  exposed: '*',
  implementation: impl(ReadableStreamDefaultControllerImpl),
  members: [
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('close', idlType.undefined),
    op('enqueue', idlType.undefined, [
      arg('chunk', idlType.any, { optional: true }),
    ]),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
});

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Readable stream ${name} algorithm is gone`);
  return algorithm;
}
