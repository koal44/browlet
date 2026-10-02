import { deserialize, serialize } from 'node:v8';

import {
  queueNetworkingTask, type AbortControllerCapability, type JSEnvironment, type RealmExecution,
} from '../../src/js-engine/index';
import { TestRealm } from '../web-idl/test-realm';
import { BindingWorld, type BindingContext, type WebIDLEnvironment } from '../../src/web-idl/index';
import { webIDLCommonDefinitions } from '../../src/web-idl/core/common';
import { streamsIDLDefinitions } from '../../src/streams/index';

/** A standalone realm environment with facilities supplied by the unit host. */
export function createEnvironment(realm = new TestRealm(), binding?: BindingContext): TestEnvironment {
  if (!binding) {
    return new BindingWorld<TestEnvironment>([...webIDLCommonDefinitions, ...streamsIDLDefinitions])
      .register(realm, (ctx) => createEnvironment(realm, ctx)).getEnvironment();
  }
  return { realm, exec: createExecution(realm, binding), queueNetworkingTask };
}

export interface TestEnvironment extends JSEnvironment, WebIDLEnvironment {
  realm: TestRealm;
}

/** Real engine facilities; task, abort, and structured-data effects controlled by the unit host. */
export function createExecution(realm = new TestRealm(), binding?: BindingContext): RealmExecution {
  if (!binding) return createEnvironment(realm).exec;
  return {
    global: realm.global,
    nativeLineEnding: '\n',
    Promise: binding.Promise,
    NativePromise: realm.intrinsics.promise.constructor,
    TypeError: realm.intrinsics.typeError,
    RangeError: realm.intrinsics.rangeError,
    get DOMException() { return binding.DOMException; },
    buffers: realm.createRuntimeBuffers(),
    queueMicrotask: (steps) => { realm.queueMicrotask(steps); },
    runInParallel: (steps) => { setImmediate(steps); },
    queueTask(_source, steps) {
      const task = setImmediate(steps);
      return { remove: () => { clearImmediate(task); } };
    },
    networking: {
      queueGlobalTask: (_global, steps) => { setImmediate(steps); },
    },
    createAbortController,
    createDependentAbortSignal() {
      throw new Error('Dependent-signal tests require the DOM runtime');
    },
    parseJSON: (text) => realm.parseJSON(text),
    stringifyJSON: (value) => realm.stringifyJSON(value),
    clone: (value, transferList = []) => structuredClone(value, { transfer: transferList }),
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
