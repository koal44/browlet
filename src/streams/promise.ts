import { idlType } from '../web-idl/declaration/index';
import type { BindingContext } from '../web-idl/projection';

/** A promise capability retained by Streams algorithms. */
export type StreamPromise = object;

/** Run a potentially promise-returning specification algorithm. */
export function runPromiseAlgorithm(
  context: BindingContext,
  steps: () => unknown,
): StreamPromise {
  try {
    return context.createResolvedPromise(steps(), idlType.any);
  } catch (error) {
    return context.createRejectedPromise(error, idlType.undefined);
  }
}
