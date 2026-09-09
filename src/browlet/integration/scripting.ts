import { nodeRuntime } from '../../js-engine/index';

export function requestNodeEventLoopTurn(steps: () => void): void {
  // Enter from a later Node task; never run an HTML turn synchronously.
  nodeRuntime.runWithExecutionOwner(undefined, () => { setImmediate(steps); });
}

/*
 * HTML section 2.1.1 permits cooperative scheduling. Captured closures stay
 * in this isolate; true worker parallelism needs algorithm-specific data and
 * message boundaries rather than a different implementation of this alias.
 */
export const runInParallel = requestNodeEventLoopTurn;
