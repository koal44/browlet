import type { StreamAbortController } from '../../../src/streams/abort';
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
    transformer, writableStrategy, readableStrategy, createAbortController(),
  );
}

export function createWritableStream(
  sink: UnderlyingSink | null = {},
  strategy: QueuingStrategy = {},
): WritableStreamImpl {
  return new WritableStreamImpl(sink, strategy, createAbortController());
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
