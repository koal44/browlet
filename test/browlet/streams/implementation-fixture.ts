import { createRuntime } from '../../js-engine/runtime-fixture';
import type { PromiseValue } from '../../../src/js-engine/index';
import { TestRealm } from '../../web-idl/test-realm';
import {
  type QueuingStrategyRecord, TransformStreamImpl, type TransformerRecord,
  WritableStreamImpl, type UnderlyingSink,
} from '../../../src/streams/index';

export function createTransformStream(
  transformer: TransformerRecord | null = {},
  writableStrategy: QueuingStrategyRecord = {},
  readableStrategy: QueuingStrategyRecord = {},
): TransformStreamImpl {
  return new TransformStreamImpl(
    transformer, writableStrategy, readableStrategy, createRuntime(),
  );
}

export function createWritableStream(
  sink: UnderlyingSink | null = {},
  strategy: QueuingStrategyRecord = {},
): WritableStreamImpl {
  return new WritableStreamImpl(sink, strategy, createRuntime());
}

export function createPromises() {
  return new TestRealm().promises;
}

/** Observe an implementation result on the unit harness's queue. */
export function observe<T>(result: PromiseValue<T>): Promise<T> {
  const observed = Promise.withResolvers<T>();
  result.observe(observed.resolve, observed.reject);
  return observed.promise;
}
