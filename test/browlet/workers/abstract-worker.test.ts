import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { ServiceWorkerImpl } from '../../../src/browlet/workers/index';
import type { ServiceWorker } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('AbstractWorker (HTML §10.2.6.1)', () => {
  it('installs onerror on the includer prototype without exposing a mixin constructor', async () => {
    const { worker, window, realm } = await createWorker();
    expect(Reflect.has(window, 'AbstractWorker')).toBe(false);
    expect(worker).toBeInstanceOf(window.ServiceWorker);
    expect(worker.onerror).toBeNull();
    expect(Object.hasOwn(worker, 'onerror')).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(window.ServiceWorker.prototype, 'onerror')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberately supply an invalid getter receiver
    expect(() => { Reflect.apply(descriptor.get!, {}, []); }).toThrow(realm.TypeError);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberately supply an invalid setter receiver
    expect(() => { Reflect.apply(descriptor.set!, {}, [null]); }).toThrow(realm.TypeError);
  });

  it.each([true, false, undefined])('passes one event to onerror and applies ordinary cancellation for %s', async (returned) => {
    const { worker, window } = await createWorker();
    const calls: unknown[][] = [];
    worker.onerror = function(this: unknown, ...args: unknown[]) { calls.push([this, ...args]); return returned; };
    const event = new window.ErrorEvent('error', { cancelable: true, message: 'outside error', error: null });

    expect(worker.dispatchEvent(event)).toBe(returned !== false);
    expect(calls).toEqual([[worker, event]]);
    expect(event.defaultPrevented).toBe(returned === false);
  });

  it('preserves listener order across handler replacement and removes non-object values', async () => {
    const { worker, window } = await createWorker();
    const calls: string[] = [];
    worker.addEventListener('error', () => { calls.push('before'); });
    worker.onerror = () => { calls.push('old'); };
    worker.addEventListener('error', () => { calls.push('after'); });
    const replacement = () => { calls.push('replacement'); };
    worker.onerror = replacement;
    expect(worker.onerror).toBe(replacement);
    worker.dispatchEvent(new window.ErrorEvent('error'));
    expect(calls).toEqual(['before', 'replacement', 'after']);

    worker.onerror = null;
    worker.onerror = replacement;
    calls.length = 0;
    worker.dispatchEvent(new window.ErrorEvent('error'));
    expect(calls).toEqual(['before', 'after', 'replacement']);

    Reflect.set(worker, 'onerror', 1);
    expect(worker.onerror).toBeNull();
    calls.length = 0;
    worker.dispatchEvent(new window.ErrorEvent('error'));
    expect(calls).toEqual(['before', 'after']);
  });
});

/** ServiceWorker already includes AbstractWorker; registration and automatic error delivery remain separate. */
async function createWorker() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://creator.test/');
  const realm = getRelevantRealm(browser.window);
  const worker = realm.env.project(new ServiceWorkerImpl(realm.env)) as ServiceWorker;
  return { worker, window: browser.window, realm };
}
