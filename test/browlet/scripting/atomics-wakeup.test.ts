import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('native Atomics completion and idle checkpoints', () => {
  it.each(['timeout', 'notification'] as const)('delivers %s without another HTML task', async (completion) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const realm = getRelevantRealm(browser.window);
    // The fixture supplies shared memory; unisolated Windows must not expose
    // SharedArrayBuffer merely to exercise the engine's asynchronous completion.
    const array = new Int32Array(new SharedArrayBuffer(4));
    const state = Object.assign(new realm.Object(), { value: '' });
    Reflect.set(realm.globalObject, 'waitArray', array);
    Reflect.set(realm.globalObject, 'waitState', state);
    await browser.evaluate((notification) => {
      const array = Reflect.get(globalThis, 'waitArray') as Int32Array;
      const state = Reflect.get(globalThis, 'waitState') as { value: string; };
      const wait = Atomics.waitAsync(array, 0, 0, notification ? Infinity : 20);
      if (!wait.async) throw new Error('Expected an asynchronous Atomics wait');
      void wait.value.then((value) => { state.value = value; });
    }, completion === 'notification');

    if (completion === 'notification') expect(Atomics.notify(array, 0)).toBe(1);
    // Read only data: repeated evaluation or a Window timer would rescue the
    // idle queue and conceal the missing native completion notification.
    await expect.poll(() => state.value, { timeout: 1000 })
      .toBe(completion === 'notification' ? 'ok' : 'timed-out');
  });
});
