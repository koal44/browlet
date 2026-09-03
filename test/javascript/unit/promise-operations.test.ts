import { describe, expect, it } from 'vitest';

import {
  installPromiseReactions, NodeRealm, nodeRuntime,
} from '../../../src/javascript/index';

describe('JavaScript promise operations', () => {
  it('installs reactions through the captured realm intrinsic', async () => {
    const microtaskQueue = nodeRuntime.createMicrotaskQueue();
    const realm = new NodeRealm(microtaskQueue);
    const promise = new realm.intrinsics.promise.constructor((resolve) => {
      resolve('fulfilled');
    });
    const values: unknown[] = [];
    const onFulfilled = realm.createFunction(
      (_thisArgument, [value]) => { values.push(value); },
      { length: 1, name: '' },
    );
    expect(Reflect.defineProperty(promise, 'then', {
      value() { throw new Error('author then was called'); },
    })).toBe(true);

    installPromiseReactions(realm, promise, onFulfilled, undefined);
    microtaskQueue.performMicrotaskCheckpoint();
    await Promise.resolve();

    expect(values).toEqual(['fulfilled']);
  });

  it.fails('does not consult author-defined promise constructors', () => {
    const realm = new NodeRealm();
    const promise = new realm.intrinsics.promise.constructor(() => undefined);
    expect(Reflect.defineProperty(promise, 'constructor', {
      get() { throw new Error('author constructor was consulted'); },
    })).toBe(true);

    expect(() => installPromiseReactions(
      realm,
      promise,
      undefined,
      undefined,
    )).not.toThrow();
  });
});
