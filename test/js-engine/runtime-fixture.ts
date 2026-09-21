import { deserialize, serialize } from 'node:v8';

import type {
  AbortControllerCapability, RuntimeContext,
} from '../../src/js-engine/index';
import { TestRealm } from '../web-idl/test-realm';

/** Real engine facilities; task, abort, and structured-data effects controlled by the unit host. */
export function createRuntime(realm = new TestRealm()): RuntimeContext {
  return {
    global: realm.global,
    nativeLineEnding: '\n',
    promises: realm.promises,
    buffers: realm.createRuntimeBuffers(),
    queueMicrotask: (steps) => { realm.queueMicrotask(steps); },
    runInParallel: (steps) => { setImmediate(steps); },
    fileReading: {
      queueTask(steps) {
        const task = setImmediate(steps);
        return { remove: () => { clearImmediate(task); } };
      },
    },
    networking: {
      queueGlobalTask: (_global, steps) => { setImmediate(steps); },
    },
    // Tests of timing policy use Browlet's actual runtime or supply their own clock.
    timing: { coarsenTime: (timestamp) => timestamp },
    createAbortController,
    createDependentAbortSignal() {
      throw new Error('Dependent-signal tests require the DOM runtime');
    },
    parseJSON: (text) => realm.parseJSON(text),
    stringifyJSON: (value) => realm.stringifyJSON(value),
    clone: structuredClone,
    serialize,
    deserialize: (record): unknown => deserialize(record as Uint8Array),
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
