import { idlType, sequence } from '../../src/web-idl/core/index';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';
import { JSRealm, createMicrotaskQueue } from '../../src/js-engine/index';
import { internalType, type InternalPromise } from '../../src/infra/promises';

describe('Promise dependencies', () => {
  it('eventually delivers fulfillment and recovery through the selected queue backend', async () => {
    const { queue, Promise: P } = createTarget();
    const source = P.withResolvers(idlType.double);
    const values: number[] = [];
    const reasons: unknown[] = [];
    const failure = new Error('recoverable');
    source.promise.then((value) => value + 1).observe((value) => { values.push(value); }, fail);
    P.reject(failure, idlType.double).catch((reason) => {
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
    const first = a.Promise.withResolvers(idlType.object);
    const second = b.Promise.withResolvers(idlType.object);
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
    const source = b.Promise.withResolvers(idlType.double);
    if (state === 'settled') source.resolve(7);
    const observed: number[] = [];
    a.Promise.resolve(1, idlType.double).then(() => source.promise).then((value) => value + 1)
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
    a.Promise.fromNative(source.promise, (value) => Number(value), idlType.double).then((value) => `A: ${value}`, undefined, idlType.DOMString)
      .observe((value) => { observed.push(value); }, fail);
    b.Promise.fromNative(source.promise, (value) => Number(value), idlType.double).then((value) => `B: ${value}`, undefined, idlType.DOMString)
      .observe((value) => { observed.push(value); }, fail);
    source.resolve(7);
    a.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['A: 7']);
    b.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['A: 7', 'B: 7']);
  });

  itPassesWith('explicitQueues')('keeps thrown values intact and adopts asynchronous recovery', () => {
    const { queue, Promise: P } = createTarget();
    const failure = new Error('original failure');
    const recovery = P.withResolvers(idlType.double);
    const observed: unknown[] = [];
    P.resolve(1, idlType.double).then(() => { throw failure; }).catch((reason) => {
      observed.push(reason);
      return recovery.promise;
    }).observe((value) => { observed.push(value); }, fail);
    queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([failure]);
    recovery.resolve(7);
    queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([failure, 7]);
  });

  itPassesWith('explicitQueues')('retains source conversion when an imported view changes reaction destination', () => {
    const a = createTarget();
    const b = createTarget();
    const source = a.Promise.fromNative(Promise.resolve(7), (value) => `source: ${String(value)}`, idlType.DOMString);
    const imported = b.Promise.fromInternal(source);
    const observed: string[] = [];
    expect(imported.backing).toBe(source.backing);
    imported.then((value) => value + '; destination').observe((value) => { observed.push(value); }, fail);
    a.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual([]);
    b.queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['source: 7; destination']);
  });

  itPassesWith('explicitQueues')('adopts an author thenable once and calls then asynchronously', () => {
    const { queue, realm, Promise: P } = createTarget();
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
    const result = P.fromValue(value, realm.intrinsics.promise.constructor, idlType.any);
    expect(result.backing).toBeInstanceOf(realm.intrinsics.promise.constructor);
    result.observe((value) => { observed.push(value); }, fail);
    expect(observed).toEqual(['get then']);
    queue.performMicrotaskCheckpoint();
    expect(observed).toEqual(['get then', 'call then', 7]);
  });

  itPassesWith('explicitQueues')('rejects self-resolution instead of leaving a chain pending', () => {
    const { queue, Promise: P } = createTarget();
    const errors: unknown[] = [];
    const result: InternalPromise<unknown> = P.resolve(1, idlType.double).then(() => result, undefined, idlType.any);
    result.observe(fail, (reason) => { errors.push(reason); });
    queue.performMicrotaskCheckpoint();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ name: 'TypeError', message: 'Promise cannot resolve itself' });
  });
});

describe('internal Promise results', () => {
  it('keeps the result descriptor through rejection, same-type chaining, and import', () => {
    const a = createTarget();
    const b = createTarget();
    const type = internalType<number>();
    const result = a.Promise.withResolvers(type);
    expect(result.promise.type).toBe(type);
    expect(result.promise.then().type).toBe(type);
    expect(b.Promise.fromInternal(result.promise).type).toBe(type);
    expect(result.promise.then(String, undefined, idlType.DOMString).type).toBe(idlType.DOMString);
    const rejected = a.Promise.reject('failed', type);
    rejected.observe(fail, () => {});
    expect(rejected.type).toBe(type);
    a.queue.performMicrotaskCheckpoint();
  });

  it('requires a runtime descriptor even from an untyped caller', () => {
    const { Promise: P } = createTarget();
    expect(() => {
      // @ts-expect-error JavaScript can omit the required descriptor.
      P.withResolvers();
    }).toThrow('A Promise result type is required');
  });

  itPassesWith('explicitQueues').each(['fulfill', 'reject'] as const)('keeps the first adoption when its source later %ss', (mode) => {
    const { queue, Promise: P } = createTarget();
    const result = P.withResolvers(idlType.DOMString);
    const source = P.withResolvers(idlType.DOMString);
    const values: unknown[] = [];
    const errors: unknown[] = [];
    result.promise.observe((value) => { values.push(value); }, (reason) => { errors.push(reason); });
    result.resolve(source.promise);
    expect(result.isResolved).toBe(true);
    result.reject('late rejection');
    result.resolve('late fulfillment');
    if (mode === 'fulfill') source.resolve('first');
    else source.reject('first');
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual(mode === 'fulfill' ? ['first'] : []);
    expect(errors).toEqual(mode === 'reject' ? ['first'] : []);
  });

  itPassesWith('explicitQueues')('rejects the derived result when fulfillment conversion throws', () => {
    const { queue, Promise: P } = createTarget();
    const failure = new Error('conversion failed');
    const recovered: unknown[] = [];
    const rejected: unknown[] = [];
    P.fromNative(Promise.resolve(1), () => { throw failure; }, idlType.undefined)
      .then(undefined, (reason) => { recovered.push(reason); })
      .observe(() => { recovered.push('fulfilled'); }, (reason) => { rejected.push(reason); });
    queue.performMicrotaskCheckpoint();
    expect(recovered).toEqual([]);
    expect(rejected).toEqual([failure]);
  });

  itPassesWith('explicitQueues')('maps one retained payload in separate destinations without thenable adoption', () => {
    const a = createTarget();
    const b = createTarget();
    const pending = a.Promise.withResolvers(internalType<{ then: never; value: number; }>());
    const values: unknown[] = [];
    const payload = { value: 7, get then(): never { throw new Error('Payload is not a thenable'); } };
    pending.promise.then((value) => value.value + 1, undefined, idlType.double)
      .observe((value) => { values.push(value); }, fail);
    b.Promise.fromInternal(pending.promise).observe((value) => { values.push(value); }, fail);
    pending.resolve(payload);
    pending.reject('late rejection');
    expect(values).toEqual([]);
    a.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([8]);
    b.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([8, payload]);
  });

  itPassesWith('explicitQueues')('rejects a mapped result with the original thrown value', () => {
    const { queue, Promise: P } = createTarget();
    const pending = P.withResolvers(idlType.double);
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
    const pending = second.Promise.withResolvers(idlType.object);
    const payload = { get then(): never { throw new Error('Not a thenable'); } };
    const values: unknown[] = [];
    const result = first.Promise.resolve(1, idlType.double).then(() => pending.promise, undefined, idlType.object);
    result.observe((value) => { values.push(value); }, fail);
    pending.resolve(payload);
    second.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    first.queue.performMicrotaskCheckpoint();
    expect(values).toEqual([payload]);
    expect(second.Promise.fromInternal(pending.promise)).toBe(pending.promise);
  });

  itPassesWith('explicitQueues')('captures a thrown failure and adopts an asynchronous recovery', () => {
    const { queue, Promise: P } = createTarget();
    const failure = new Error('failed step');
    const recovery = P.withResolvers(idlType.DOMString);
    const values: unknown[] = [];
    P.try(() => { throw failure; }, idlType.double)
      .then(String, (reason) => {
        expect(reason).toBe(failure);
        return recovery.promise;
      }, idlType.DOMString)
      .observe((value) => { values.push(value); }, fail);
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual([]);
    recovery.resolve('recovered');
    queue.performMicrotaskCheckpoint();
    expect(values).toEqual(['recovered']);
  });

  itPassesWith('explicitQueues')('joins out-of-order results and forwards a rejection unchanged', () => {
    const { queue, Promise: P } = createTarget();
    const first = P.withResolvers(idlType.double);
    const second = P.withResolvers(idlType.double);
    const values: unknown[] = [];
    const failure = new Error('failed input');
    P.all([first.promise, second.promise], sequence(idlType.double))
      .observe((value) => { values.push(value); }, fail);
    P.all([], internalType<unknown[]>())
      .observe((value) => { values.push(value); }, fail);
    P.all([first.promise, P.reject(failure, idlType.double)], sequence(idlType.double))
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
  return { queue, realm, Promise: realm.Promise };
}

function fail(value: unknown): never { throw new Error(`Unexpected completion: ${String(value)}`); }
