import { describe, expect, it } from 'vitest';
import {
  InternalPromise, createPromiseReactions, NodeRealm, nodeRuntime,
} from '../../src/js-engine/index';

describe('internal Promise results', () => {
  it('maps one retained payload in separate destinations without thenable adoption', () => {
    const a = createTarget();
    const b = createTarget();
    const pending = InternalPromise.withResolvers<{ then: never; value: number; }>();
    const values: unknown[] = [];
    const payload = { value: 7, get then(): never { throw new Error('Payload is not a thenable'); } };
    pending.promise.map((value) => value.value + 1, a.reactions)
      .observe((value) => { values.push(value); }, fail, a.reactions);
    pending.promise.observe((value) => { values.push(value); }, fail, b.reactions);
    pending.resolve(payload);
    pending.reject('late rejection');
    expect('then' in pending.promise).toBe(false);
    expect(values).toEqual([]);
    a.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([8]);
    b.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([8, payload]);
  });

  it('rejects a mapped result with the original thrown value', () => {
    const { queue, reactions } = createTarget();
    const pending = InternalPromise.withResolvers<number>();
    const failure = { reason: 'original' };
    const reasons: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Preserve arbitrary thrown values.
    pending.promise.map(() => { throw failure; }, reactions)
      .observe(fail, (reason) => { reasons.push(reason); }, reactions);
    pending.resolve(1);
    queue.performMicrotaskCheckpoint();
    expect(reasons).toEqual([failure]);
  });

  it('adopts an internal chain result without adopting its payload', () => {
    const first = createTarget();
    const second = createTarget();
    const pending = InternalPromise.withResolvers<object>();
    const payload = { get then(): never { throw new Error('Not a thenable'); } };
    const values: unknown[] = [];
    const result = InternalPromise.resolve(1).chain(() => pending.promise, undefined, first.reactions);
    result.observe((value) => { values.push(value); }, fail, second.reactions);
    pending.resolve(payload);
    second.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    first.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    second.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([payload]);
    expect(InternalPromise.resolve(pending.promise)).toBe(pending.promise);
  });

  it('captures a thrown failure and adopts an asynchronous recovery', () => {
    const { queue, reactions } = createTarget();
    const failure = new Error('failed step');
    const recovery = InternalPromise.withResolvers<number>();
    const values: unknown[] = [];
    InternalPromise.try(() => { throw failure; })
      .chain(undefined, (reason) => {
        expect(reason).toBe(failure);
        return recovery.promise;
      }, reactions)
      .observe((value) => { values.push(value); }, fail, reactions);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    recovery.resolve(7);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([7]);
  });

  it('joins out-of-order results and forwards a rejection unchanged', () => {
    const { queue, reactions } = createTarget();
    const first = InternalPromise.withResolvers<number>();
    const second = InternalPromise.withResolvers<number>();
    const values: unknown[] = [];
    const failure = new Error('failed input');
    InternalPromise.all([first.promise, second.promise], reactions)
      .observe((value) => { values.push(value); }, fail, reactions);
    InternalPromise.all([], reactions)
      .observe((value) => { values.push(value); }, fail, reactions);
    InternalPromise.all([first.promise, InternalPromise.reject<number>(failure)], reactions)
      .observe(fail, (reason) => { values.push(reason); }, reactions);
    second.resolve(2);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([[], failure]);
    first.resolve(1);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([[], failure, [1, 2]]);
  });
});

function createTarget() {
  const queue = nodeRuntime.createMicrotaskQueue();
  return { queue, reactions: createPromiseReactions(new NodeRealm(queue)) };
}

function fail(value: unknown): never { throw new Error(`Unexpected completion: ${String(value)}`); }
