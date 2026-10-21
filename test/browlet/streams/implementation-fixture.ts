import { createEnvironment } from '../../js-engine/execution-fixture';
import type { InternalPromise } from '../../../src/infra/promises';
import { TestRealm } from '../../support/web-idl-realm';
import {
  type QueuingStrategy, TransformStreamImpl, type Transformer,
  WritableStreamImpl, type UnderlyingSink,
} from '../../../src/streams/index';

export function createTransformStream(
  transformer: Transformer | null = {},
  writableStrategy: QueuingStrategy = {},
  readableStrategy: QueuingStrategy = {},
): TransformStreamImpl {
  return new TransformStreamImpl(
    transformer, writableStrategy, readableStrategy, createEnvironment(),
  );
}

export function createWritableStream(
  sink: UnderlyingSink | null = {},
  strategy: QueuingStrategy = {},
): WritableStreamImpl {
  return new WritableStreamImpl(sink, strategy, createEnvironment());
}

export function createPromiseConstructor() {
  return new TestRealm().Promise;
}

/** Observe an implementation result on the unit harness's queue. */
export function observe<T>(result: InternalPromise<T>): Promise<T> {
  const observed = Promise.withResolvers<T>();
  result.observe(observed.resolve, observed.reject);
  return observed.promise;
}
