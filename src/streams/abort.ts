import { defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';

/** DOM-owned AbortController construction required by Streams algorithms. */
export const streamAbortController = defineCapability<
  StreamAbortControllerCapability
>('Streams AbortController');

export type StreamAbortControllerCapability = {
  create(global: object): StreamAbortController;
};

export type StreamAbortController = {
  abort(reason?: unknown): void;
  readonly signal: StreamAbortSignal;
};

export type StreamAbortAlgorithmHandle = {
  remove(): void;
};

export type StreamAbortSignal = {
  readonly aborted: boolean;
  readonly reason: unknown;
  addAlgorithm(
    algorithm: () => void,
  ): StreamAbortAlgorithmHandle | null;
};

export function createStreamAbortController(
  context: BindingContext,
): StreamAbortController {
  const global = context.resolvePlatformObject(context.realm.global);
  const capability = global && context.getCapability(
    global.primaryInterface.definition,
    streamAbortController,
  );
  if (!global || !capability) {
    throw new Error('The stream realm has no AbortController capability');
  }
  return capability.create(global.implementation);
}
