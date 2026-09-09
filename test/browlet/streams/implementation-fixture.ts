import type { StreamAbortController } from '../../../src/streams/abort';
import {
  createPromiseReactions, type InternalPromise,
} from '../../../src/js-engine/index';
import { TestRealm } from '../../web-idl/test-realm';
import type { QueuingStrategy } from '../../../src/streams/queuing-strategy';
import {
  TransformStreamImpl, type TransformerRecord,
} from '../../../src/streams/transform-stream';
import {
  WritableStreamImpl, type UnderlyingSink,
} from '../../../src/streams/writable-stream';

export function createTransformStream(
  transformer: TransformerRecord | null = {},
  writableStrategy: QueuingStrategy = {},
  readableStrategy: QueuingStrategy = {},
): TransformStreamImpl {
  return new TransformStreamImpl(
    transformer, writableStrategy, readableStrategy, createAbortController(), createReactions(),
  );
}

export function createWritableStream(
  sink: UnderlyingSink | null = {},
  strategy: QueuingStrategy = {},
): WritableStreamImpl {
  return new WritableStreamImpl(sink, strategy, createAbortController(), createReactions());
}

export function createReactions() {
  return createPromiseReactions(new TestRealm());
}

/** Observe an implementation result on the unit harness's queue. */
export function observe<T>(result: InternalPromise<T>): Promise<T> {
  const observed = Promise.withResolvers<T>();
  result.observe(observed.resolve, observed.reject, createPromiseReactions(new TestRealm()));
  return observed.promise;
}

export function createAbortController(): StreamAbortController {
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
