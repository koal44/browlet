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
});

function createTarget() {
  const queue = nodeRuntime.createMicrotaskQueue();
  return { queue, reactions: createPromiseReactions(new NodeRealm(queue)) };
}

function fail(value: unknown): never { throw new Error(`Unexpected completion: ${String(value)}`); }
