import type { InternalPromise } from './promises';

/** An opened asynchronous iterator supplying values to implementation algorithms. */
export interface AsyncIterator<T> {
  /** Advance to the next value, or report completion with endOfIteration. */
  next(): InternalPromise<T | typeof endOfIteration>;
  /** Close the iterator with the supplied reason. */
  return(reason: unknown): InternalPromise<void>;
}

/** Completion marker shared by iterator producers and consumers. */
export const endOfIteration: unique symbol = Symbol('end of iteration');
