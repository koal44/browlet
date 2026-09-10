import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import {
  installPromiseReactions, NodeRealm, nodeRuntime,
} from '../../src/js-engine/index';

describe('JavaScript promise operations', () => {
  it('installs reactions without consulting the promise then property', async () => {
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

  itPassesWith('v26+', 'explicitQueues')('does not consult author-defined promise constructors', () => {
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

  itPassesWith('v26+', 'explicitQueues')('places native observation of a Node promise on the supplied realm queue', async () => {
    const queue = nodeRuntime.createMicrotaskQueue();
    const realm = new NodeRealm(queue);
    const { promise, resolve } = Promise.withResolvers<string>();
    const seen: unknown[] = [];
    expect(Reflect.defineProperty(promise, 'constructor', {
      get() { throw new Error('author constructor was consulted'); },
    })).toBe(true);
    installPromiseReactions(realm, promise, (value) => { seen.push(value); }, undefined);
    resolve('observed');
    void Promise.resolve().then(() => seen.push('Node'));
    expect(seen).toEqual([]);
    queue.performMicrotaskCheckpoint();
    expect(seen).toEqual(['observed']);
    await Promise.resolve();
    expect(seen).toEqual(['observed', 'Node']);
  });
});
