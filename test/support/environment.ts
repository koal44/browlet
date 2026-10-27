import { deserialize, serialize } from 'node:v8';

import type { AbortController } from '../../src/infra/abort';
import type { FileEnvironment } from '../../src/file/index';
import { TestRealm } from './web-idl-realm';
import { BindingWorld, type BindingContext, type WebIDLEnvironment, type DOMExceptionConstructor } from '../../src/web-idl/index';
import { readableStreamReadResultIDL } from '../../src/streams/index';

/** A standalone realm environment with facilities supplied by the unit host. */
export function createEnvironment(realm = new TestRealm(), binding?: BindingContext): TestEnvironment {
  if (!binding) {
    // Implementation read promises need their result dictionary, not the Streams author API.
    return new BindingWorld<TestEnvironment>([readableStreamReadResultIDL])
      .register(realm, (ctx) => createEnvironment(realm, ctx)).getEnvironment();
  }
  return {
    realm,
    nativeLineEnding: '\n',
    InternalPromise: binding.InternalPromise,
    get DOMException() { return binding.DOMException; },
    runInParallel: (steps) => { setImmediate(steps); },
    queueTask(_source, steps) {
      const task = setImmediate(steps);
      return { remove: () => { clearImmediate(task); } };
    },
    createAbortController,
    createDependentAbortSignal() {
      throw new Error('Dependent-signal tests require the DOM runtime');
    },
    clone: (value, transferList = []) => structuredClone(value, { transfer: transferList }),
    serialize,
    deserialize: (record): unknown => deserialize(record as Uint8Array),
  };
}

export interface TestEnvironment extends FileEnvironment, WebIDLEnvironment {
  realm: TestRealm;
  DOMException: DOMExceptionConstructor;
}

function createAbortController(): AbortController {
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
