import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { InternalPromise, internalType } from '../../src/infra/promises';

describe('private Promise results', () => {
  it.each([undefined, null, false, 0, '', Symbol('value')])('retains %s as the fulfillment value', async (payload) => {
    class OtherPromise<T> extends InternalPromise<T> {}
    const source = InternalPromise.resolve(payload, internalType<typeof payload>());
    const values: unknown[] = [];
    OtherPromise.fromInternal(source).observe((value) => { values.push(value); }, fail);
    await nextTurn();
    expect(values).toEqual([payload]);
  });

  it.each(['pending', 'fulfilled'] as const)('shares a %s value across frozen imported views without reading then', async (state) => {
    class OtherPromise<T> extends InternalPromise<T> {}
    class ThirdPromise<T> extends InternalPromise<T> {}
    const source = InternalPromise.withResolvers(internalType<object>());
    const payload = Object.freeze({ get then(): never { throw new Error('Private data is not a thenable'); } });
    if (state === 'fulfilled') source.resolve(payload);
    const view = ThirdPromise.fromInternal(OtherPromise.fromInternal(source.promise));
    Object.freeze(source.promise);
    Object.freeze(view);
    const values: object[] = [];
    source.promise.observe((value) => { values.push(value); }, fail);
    view.observe((value) => { values.push(value); }, fail);
    if (state === 'pending') source.resolve(payload);
    source.resolve({});
    source.reject('too late');
    await nextTurn();
    expect(values).toEqual([payload, payload]);
    expect(values.every((value) => value === payload)).toBe(true);
    const later: object[] = [];
    view.observe((value) => { later.push(value); }, fail);
    await nextTurn();
    expect(later[0]).toBe(payload);
  });
});

function fail(reason: unknown): never { throw reason; }
