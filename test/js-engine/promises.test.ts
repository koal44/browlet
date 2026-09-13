import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';
import { JSRealm, createMicrotaskQueue, type PromiseValue } from '../../src/js-engine/index';

describe('Promise dependencies', () => {
  it('eventually delivers fulfillment and recovery through the selected queue backend', async () => {
    const { queue, promises } = createTarget();
    const source = promises.withResolvers<number>();
    const values: number[] = [];
    const reasons: unknown[] = [];
    const failure = new Error('recoverable');
    source.promise.then((value) => value + 1).observe((value) => { values.push(value); }, fail);
    promises.reject(failure).catch((reason) => {
      reasons.push(reason);
      return source.promise;
    }).observe((value) => { values.push(value); }, fail);
    source.resolve(7);
    queue.performMicrotaskCheckpoint();
    await nextTurn();
    expect(values).toEqual([8, 7]);
    expect(reasons).toEqual([failure]);
  });

  itPassesWith('explicitQueues')('retains the destination through chains without adopting internal payloads', () => {
    const a = createTarget();
    const b = createTarget();
    const first = a.promises.withResolvers<object>();
    const second = b.promises.withResolvers<object>();
    const value = { get then(): never { throw new Error('Not an author thenable'); } };
    const observed: unknown[] = [];
    first.promise.then((item) => ({ item })).observe((item) => { observed.push(item); }, fail);
    second.promise.observe((item) => { observed.push(item); }, fail);
    first.resolve(value);
    second.resolve(value);
    expect(observed).toEqual([]);
    a.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([{ item: value }]);
    b.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([{ item: value }, value]);
  });

  itPassesWith('explicitQueues').each(['pending', 'settled'] as const)('adopts a %s result from another destination', (state) => {
    const a = createTarget();
    const b = createTarget();
    const source = b.promises.withResolvers<number>();
    if (state === 'settled') source.resolve(7);
    const observed: number[] = [];
    a.promises.resolve(1).then(() => source.promise).then((value) => value + 1)
      .observe((value) => { observed.push(value); }, fail);
    a.queue.performMicrotaskCheckpoint();
    if (state === 'pending') {
      expect(observed).toEqual([]);
      source.resolve(7);
      a.queue.performMicrotaskCheckpoint();
    }
    expect(observed).toEqual([8]);
  });

  itPassesWith('explicitQueues')('imports one host result independently for two consumers', () => {
    const a = createTarget();
    const b = createTarget();
    const source = Promise.withResolvers<number>();
    const observed: string[] = [];
    a.promises.import(source.promise, (value) => Number(value)).then((value) => `A: ${value}`)
      .observe((value) => { observed.push(value); }, fail);
    b.promises.import(source.promise, (value) => Number(value)).then((value) => `B: ${value}`)
      .observe((value) => { observed.push(value); }, fail);
    source.resolve(7);
    a.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['A: 7']);
    b.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['A: 7', 'B: 7']);
  });

  itPassesWith('explicitQueues')('keeps thrown values intact and adopts asynchronous recovery', () => {
    const { queue, promises } = createTarget();
    const failure = new Error('original failure');
    const recovery = promises.withResolvers<number>();
    const observed: unknown[] = [];
    promises.resolve(1).then(() => { throw failure; }).catch((reason) => {
      observed.push(reason);
      return recovery.promise;
    }).observe((value) => { observed.push(value); }, fail);
    queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([failure]);
    recovery.resolve(7);
    queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([failure, 7]);
  });

  itPassesWith('explicitQueues')('adopts an author thenable once and calls then asynchronously', () => {
    const { queue, realm, promises } = createTarget();
    const observed: unknown[] = [];
    const then = realm.createFunction((_receiver, [resolve]) => {
      observed.push('call then');
      (resolve as (value: number) => void)(7);
    }, { length: 1, name: 'then' });
    const value = {
      get then() {
        observed.push('get then');
        return then;
      },
    };
    promises.resolve(value).observe((value) => { observed.push(value); }, fail);
    expect(observed).toEqual(['get then']);
    queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['get then', 'call then', 7]);
  });

  itPassesWith('explicitQueues')('rejects self-resolution instead of leaving a chain pending', () => {
    const { queue, promises } = createTarget();
    const errors: unknown[] = [];
    const result: PromiseValue<unknown> = promises.resolve(1).then(() => result);
    result.observe(fail, (reason) => { errors.push(reason); });
    queue.performMicrotaskCheckpoint();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ name: 'TypeError', message: 'Promise cannot resolve itself' });
  });
});

describe('internal Promise results', () => {
  itPassesWith('explicitQueues')('maps one retained payload in separate destinations without thenable adoption', () => {
    const a = createTarget();
    const b = createTarget();
    const pending = a.promises.withResolvers<{ then: never; value: number; }>();
    const values: unknown[] = [];
    const payload = { value: 7, get then(): never { throw new Error('Payload is not a thenable'); } };
    pending.promise.then((value) => value.value + 1)
      .observe((value) => { values.push(value); }, fail);
    b.promises.import(pending.promise).observe((value) => { values.push(value); }, fail);
    pending.resolve(payload);
    pending.reject('late rejection');
    expect(values).toEqual([]);
    a.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([8]);
    b.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([8, payload]);
  });

  itPassesWith('explicitQueues')('rejects a mapped result with the original thrown value', () => {
    const { queue, promises } = createTarget();
    const pending = promises.withResolvers<number>();
    const failure = { reason: 'original' };
    const reasons: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Preserve arbitrary thrown values.
    pending.promise.then(() => { throw failure; })
      .observe(fail, (reason) => { reasons.push(reason); });
    pending.resolve(1);
    queue.performMicrotaskCheckpoint();
    expect(reasons).toEqual([failure]);
  });

  itPassesWith('explicitQueues')('adopts an internal chain result without adopting its payload', () => {
    const first = createTarget();
    const second = createTarget();
    const pending = second.promises.withResolvers<object>();
    const payload = { get then(): never { throw new Error('Not a thenable'); } };
    const values: unknown[] = [];
    const result = first.promises.resolve(1).then(() => pending.promise);
    result.observe((value) => { values.push(value); }, fail);
    pending.resolve(payload);
    second.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    first.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([payload]);
    expect(second.promises.import(pending.promise)).toBe(pending.promise);
  });

  itPassesWith('explicitQueues')('captures a thrown failure and adopts an asynchronous recovery', () => {
    const { queue, promises } = createTarget();
    const failure = new Error('failed step');
    const recovery = promises.withResolvers<number>();
    const values: unknown[] = [];
    promises.try(() => { throw failure; })
      .then(undefined, (reason) => {
        expect(reason).toBe(failure);
        return recovery.promise;
      })
      .observe((value) => { values.push(value); }, fail);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    recovery.resolve(7);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([7]);
  });

  itPassesWith('explicitQueues')('joins out-of-order results and forwards a rejection unchanged', () => {
    const { queue, promises } = createTarget();
    const first = promises.withResolvers<number>();
    const second = promises.withResolvers<number>();
    const values: unknown[] = [];
    const failure = new Error('failed input');
    promises.all([first.promise, second.promise])
      .observe((value) => { values.push(value); }, fail);
    promises.all([])
      .observe((value) => { values.push(value); }, fail);
    promises.all([first.promise, promises.reject(failure)])
      .observe(fail, (reason) => { values.push(reason); });
    second.resolve(2);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([[], failure]);
    first.resolve(1);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([[], failure, [1, 2]]);
  });
});

function createTarget() {
  const queue = createMicrotaskQueue();
  const realm = new JSRealm(queue);
  return { queue, realm, promises: realm.promises };
}

function fail(value: unknown): never { throw new Error(`Unexpected completion: ${String(value)}`); }
