import { createEnvironment } from '../../js-engine/execution-fixture';
import type { PromiseValue } from '../../../src/infra/promises';
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
    transformer, writableStrategy, readableStrategy, createEnvironment(),
  );
}

export function createWritableStream(
  sink: UnderlyingSink | null = {},
  strategy: QueuingStrategyRecord = {},
): WritableStreamImpl {
  return new WritableStreamImpl(sink, strategy, createEnvironment());
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
