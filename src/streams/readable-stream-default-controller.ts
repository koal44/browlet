import {
  arg, defineInterface, idlType, nullable, op, readonlyAttr,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl';
import {
  getStreamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
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
  #environment?: StreamEnvironment;
  #state?: ReadableStreamDefaultControllerState;

  get desiredSize(): number | null {
    return readableStreamDefaultControllerGetDesiredSize(this);
  }

  close(): void {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
      throw new TypeError('The stream is not in a state that permits close');
    }
    readableStreamDefaultControllerClose(this);
  }

  enqueue(chunk?: unknown): void {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
      throw new TypeError('The stream is not in a state that permits enqueue');
    }
    readableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(error?: unknown): void {
    readableStreamDefaultControllerError(this, error);
  }

  [cancelSteps](reason: unknown): StreamPromise {
    const state = ReadableStreamDefaultControllerImpl.getState(this);
    state.queue = [];
    state.queueTotalSize = 0;
    const result = requireAlgorithm(state.cancelAlgorithm, 'cancel')(reason);
    readableStreamDefaultControllerClearAlgorithms(this);
    return result;
  }

  [pullSteps](request: ReadRequest): void {
    readableStreamDefaultControllerPull(this, request);
  }

  [releaseSteps](): void {}

  // -- Friends ----------------------------------------------------------

  static getEnvironment(
    controller: ReadableStreamDefaultControllerImpl,
  ): StreamEnvironment {
    if (!controller.#environment) {
      throw new Error('ReadableStreamDefaultController has no environment');
    }
    return controller.#environment;
  }

  static getState(
    controller: ReadableStreamDefaultControllerImpl,
  ): ReadableStreamDefaultControllerState {
    if (!controller.#state) {
      throw new Error('ReadableStreamDefaultController is not set up');
    }
    return controller.#state;
  }

  static initializeForBinding(
    controller: ReadableStreamDefaultControllerImpl,
    environment: StreamEnvironment,
  ): void {
    controller.#environment = environment;
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
    cancelAlgorithm?: (reason: unknown) => StreamPromise;
    closeRequested: boolean;
    pullAgain: boolean;
    pullAlgorithm?: () => StreamPromise;
    pulling: boolean;
    started: boolean;
    strategyHighWaterMark: number;
    strategySizeAlgorithm?: QueuingStrategySize;
    stream: ReadableStreamImpl;
  };

// -- Web IDL ------------------------------------------------------------

export const readableStreamDefaultControllerIDL = defineInterface({
  binding: bind(ReadableStreamDefaultControllerImpl, {
    initialize(context, value) {
      ReadableStreamDefaultControllerImpl.initializeForBinding(
        value as ReadableStreamDefaultControllerImpl,
        getStreamEnvironment(context),
      );
    },
  }),
  exposed: '*',
  members: [
    readonlyAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('close', idlType.undefined),
    op('enqueue', idlType.undefined, [
      arg('chunk', idlType.any, { optional: true }),
    ]),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
  name: 'ReadableStreamDefaultController',
});

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Readable stream ${name} algorithm is gone`);
  return algorithm;
}
