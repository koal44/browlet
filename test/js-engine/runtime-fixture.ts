import {
  createRuntimeBuffers, type AbortControllerCapability, type RuntimeContext,
} from '../../src/js-engine/index';
import { TestRealm } from '../web-idl/test-realm';

/** Real engine facilities; task, abort, and clone effects controlled by the unit host. */
export function createRuntime(realm = new TestRealm()): RuntimeContext {
  return {
    promises: realm.promises,
    buffers: createRuntimeBuffers(realm),
    queueMicrotask: (steps) => { realm.queueMicrotask(steps); },
    fileReading: {
      queueTask(steps) {
        const task = setImmediate(steps);
        return { remove: () => { clearImmediate(task); } };
      },
      runInParallel: (steps) => { setImmediate(steps); },
    },
    networking: {
      queueGlobalTask: (_global, steps) => { setImmediate(steps); },
      runInParallel: (steps) => { setImmediate(steps); },
    },
    createAbortController,
    clone: structuredClone,
  };
}

function createAbortController(): AbortControllerCapability {
  const algorithms = new Set<() => void>();
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    addAlgorithm(algorithm: () => void) {
      if (signal.aborted) return null;
      algorithms.add(algorithm);
      return { remove: () => { algorithms.delete(algorithm); } };
    },
  };
  return {
    signal,
    abort(reason) {
      if (signal.aborted) return;
      signal.aborted = true;
      signal.reason = reason;
      for (const algorithm of algorithms) algorithm();
      algorithms.clear();
    },
  };
}
