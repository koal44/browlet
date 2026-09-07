import {
  streamAbortController, type StreamAbortController,
} from '../../../src/streams/abort';
import { streamsIDLDefinitions } from '../../../src/streams/index';
import type { StreamPromise } from '../../../src/streams/promise';
import { streamStructuredData } from '../../../src/streams/structured-data';
import {
  createBindings, defineInterface, xattr,
  type BindingContext,
} from '../../../src/web-idl/index';
import { isPromiseValue } from '../../../src/web-idl/promise-value';
import { TestRealm } from '../../web-idl/test-realm';

export function createTestContext(
  options: TestContextOptions = {},
): BindingContext {
  const bindings = createBindings(testDefinitions, {
    capabilities: [
      streamAbortController.for(testGlobalIDL, {
        create: () => (
          options.createAbortController?.() ?? createTestAbortController()
        ),
      }),
      streamStructuredData.for(testGlobalIDL, {
        clone: (_global, value) =>
          (options.structuredClone ?? structuredClone)(value),
      }),
    ],
  });
  const realm = new TestRealm();
  const realmBindings = bindings.register(realm);
  realmBindings.projectGlobalObject(realm.global, testGlobalIDL.name);
  return realmBindings.context;
}

export function unwrapStreamPromise<Value = unknown>(
  value: StreamPromise,
): Promise<Value> {
  if (!isPromiseValue(value)) {
    throw new TypeError('Expected an internal Web IDL promise record');
  }
  return value.promise as Promise<Value>;
}

type TestContextOptions = {
  readonly createAbortController?: () => StreamAbortController;
  readonly structuredClone?: (value: unknown) => unknown;
};

type TestAbortSignal = {
  aborted: boolean;
  reason: unknown;
  addAlgorithm(algorithm: () => void): { remove(): void; } | null;
};

function createTestAbortController(): StreamAbortController {
  const algorithms = new Set<() => void>();
  const signal: TestAbortSignal = {
    aborted: false,
    reason: undefined,
    addAlgorithm(algorithm) {
      if (signal.aborted) return null;
      algorithms.add(algorithm);
      return { remove: () => { algorithms.delete(algorithm); } };
    },
  };
  return {
    abort(reason) {
      if (signal.aborted) return;
      signal.aborted = true;
      signal.reason = reason;
      for (const algorithm of algorithms) algorithm();
      algorithms.clear();
    },
    signal,
  };
}

const testGlobalIDL = defineInterface({
  name: 'TestStreamGlobal',
  exposed: 'Window',
  ...xattr(['Global', 'Window']),
  members: [],
});

const abortSignalIDL = defineInterface({
  name: 'AbortSignal',
  exposed: '*',
  members: [],
});

const testDefinitions = [
  testGlobalIDL,
  abortSignalIDL,
  ...streamsIDLDefinitions,
];
