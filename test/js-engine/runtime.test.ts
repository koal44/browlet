import { assert, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { InternalError } from '../../src/infra/internal-error';
import {
  JSRealm, addon, createMicrotaskQueue, getAssociatedRealm, type GlobalProxy,
} from '../../src/js-engine/index';
import { getContextGlobalAllocation } from '../../src/js-engine/runtime';
import { itPassesWith } from '../test-runtime';
import { runInHostTask } from '../support/tasks';

describe('JavaScript runtime', () => {
  itPassesWith('explicitQueues')(
    'reuses a detached global proxy in a replacement Realm',
    () => {
      assert(addon.getRealm);
      const microtaskQueue = createMicrotaskQueue();
      const first = new JSRealm(microtaskQueue);
      const firstObject = first.Object;
      const retained = first.evaluate('({ nested: Object.create(null) })', 'retained.js') as {
        nested: object;
      };
      const firstReference = addon.getRealm(retained.nested);
      const globalProxy = first.detachGlobal();

      expectTypeOf(globalProxy).toEqualTypeOf<GlobalProxy>();
      expect(first.globalProxy).toBe(globalProxy);
      expect(getAssociatedRealm(globalProxy)).toBe(first);
      expect(getAssociatedRealm(retained.nested)).toBe(first);
      expect(getAssociatedRealm(firstObject)).toBe(first);

      const second = new JSRealm(microtaskQueue, {
        reuseGlobalProxyFrom: first,
      });

      expect(second.globalProxy).toBe(globalProxy);
      expect(second.globalObject).toBe(globalProxy);
      expect(getAssociatedRealm(globalProxy)).toBe(second);
      expect(second.evaluate('this', 'replacement.js')).toBe(globalProxy);
      expect(second.Object).not.toBe(firstObject);
      expect(getAssociatedRealm(retained.nested)).toBe(first);
      expect(getAssociatedRealm(firstObject)).toBe(first);
      expect(getAssociatedRealm(second.Object)).toBe(second);
      expect(addon.getRealm(retained.nested)).toBe(firstReference);
      expect(addon.getRealm(second.Object)).not.toBe(firstReference);
      expect(Reflect.ownKeys(firstReference)).toEqual(['global']);
    },
  );

  it.each(['globalObject', 'prototypeChain'])(
    'rejects a partial global allocation missing %s',
    (missing) => {
      const realm = new JSRealm(createMicrotaskQueue());
      const context = {
        realm: {},
        globalProxy: realm.globalProxy,
        globalObject: {},
        prototypeChain: [],
        detachGlobal: () => realm.globalProxy,
      };
      Reflect.deleteProperty(context, missing);

      expect(() => getContextGlobalAllocation(context)).toThrow(InternalError);
    },
  );

  it('drains promise jobs from its VM realms in shared FIFO order', async () => {
    await runInHostTask(() => {
      const microtaskQueue = createMicrotaskQueue();
      const first = new JSRealm(microtaskQueue);
      const second = new JSRealm(microtaskQueue);
      const order: string[] = [];
      const record = (value: string): void => { order.push(value); };
      Reflect.set(first.globalObject, 'record', record);
      Reflect.set(second.globalObject, 'record', record);

      first.evaluate(`
        Promise.resolve().then(() => {
          record('A1');
          Promise.resolve().then(() => record('A2'));
        });
      `, 'first-realm.js');
      second.evaluate(
        `Promise.resolve().then(() => record('B1'));`,
        'second-realm.js',
      );

      microtaskQueue.performMicrotaskCheckpoint();

      expect(order).toEqual(['A1', 'B1', 'A2']);
    });
  });

  itPassesWith('explicitQueues')(
    'isolates checkpoints from ambient Node next ticks',
    async () => {
      await runInHostTask(() => {
        const microtaskQueue = createMicrotaskQueue();
        const order: string[] = [];

        process.nextTick(() => { order.push('ambient next tick'); });
        microtaskQueue.enqueueMicrotask(() => { order.push('microtask'); });
        microtaskQueue.performMicrotaskCheckpoint();

        expect(order).toEqual(['microtask']);
      });
    },
  );

  itPassesWith('explicitQueues')('drains jobs when entered from a host microtask', async () => {
    await Promise.resolve();
    const microtaskQueue = createMicrotaskQueue();
    const order: string[] = [];

    microtaskQueue.enqueueMicrotask(() => { order.push('nested microtask'); });
    microtaskQueue.performMicrotaskCheckpoint();

    expect(order).toEqual(['nested microtask']);
  });

  itPassesWith('explicitQueues')(
    'drains jobs when a test clock runs a host task synchronously',
    () => {
      vi.useFakeTimers();
      try {
        const microtaskQueue = createMicrotaskQueue();
        const order: string[] = [];

        setImmediate(() => {
          microtaskQueue.enqueueMicrotask(() => { order.push('microtask'); });
          microtaskQueue.performMicrotaskCheckpoint();
          expect(order).toEqual(['microtask']);
        });
        vi.runAllTimers();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  itPassesWith('explicitQueues')('isolates queues owned by different agents', async () => {
    await runInHostTask(() => {
      const firstQueue = createMicrotaskQueue();
      const secondQueue = createMicrotaskQueue();
      const first = new JSRealm(firstQueue);
      const second = new JSRealm(secondQueue);
      const order: string[] = [];
      Reflect.set(first.globalObject, 'order', order);
      Reflect.set(second.globalObject, 'order', order);

      first.evaluate(
        `Promise.resolve().then(() => order.push('first'))`,
        'first-agent.js',
      );
      second.evaluate(
        `Promise.resolve().then(() => order.push('second'))`,
        'second-agent.js',
      );

      firstQueue.performMicrotaskCheckpoint();
      expect(order).toEqual(['first']);
      secondQueue.performMicrotaskCheckpoint();
      expect(order).toEqual(['first', 'second']);
    });
  });
});
