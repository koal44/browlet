import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { performTestMicrotaskCheckpoint } from '../test-runtime';

describe('WindowOrWorkerGlobalScope', () => {
  it('orders explicit microtasks alongside page Promise jobs', async () => {
    const browlet = createBrowlet();
    const order = await browlet.evaluate(() => {
      const order: string[] = [];
      queueMicrotask(() => order.push('microtask'));
      void Promise.resolve().then(() => order.push('promise'));
      order.push('synchronous');
      return order;
    });

    expect(order).toEqual([
      'synchronous',
      'microtask',
      'promise',
    ]);
  });

  it('accepts WindowProxy and the implicit global as receivers', async () => {
    const { window } = createBrowlet();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the implicit-global call is the behavior under test
    const queueMicrotask = window.queueMicrotask;
    const throughProxy = vi.fn();
    const throughImplicitGlobal = vi.fn();

    Reflect.apply(queueMicrotask, window, [throughProxy]);
    Reflect.apply(queueMicrotask, undefined, [throughImplicitGlobal]);
    performTestMicrotaskCheckpoint(window);
    await Promise.resolve();

    expect(throughProxy).toHaveBeenCalledOnce();
    expect(throughImplicitGlobal).toHaveBeenCalledOnce();
  });

  it('requires a callable callback through Web IDL', () => {
    const { window } = createBrowlet();
    const TypeErrorConstructor = Reflect.get(window, 'TypeError') as
      typeof TypeError;

    expect(() => {
      window.queueMicrotask(null as never);
    }).toThrow(TypeErrorConstructor);
  });

  it('reports callback exceptions without rejecting the host turn', async () => {
    const { window } = createBrowlet();
    const exception = new Error('microtask failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});

    window.queueMicrotask(() => { throw exception; });
    performTestMicrotaskCheckpoint(window);
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith(exception);
    report.mockRestore();
  });

  it('invokes timer callbacks with arguments and the WindowProxy receiver', async () => {
    const { window } = createBrowlet();
    const fired = Promise.withResolvers<void>();
    let receivedWindowProxy = false;
    let received: unknown[] = [];

    window.setTimeout(function(this: unknown, ...argumentsList: unknown[]) {
      receivedWindowProxy = this === window;
      received = argumentsList;
      fired.resolve();
    }, 0, 'first', 2);
    await fired.promise;

    expect(receivedWindowProxy).toBe(true);
    expect(received).toEqual(['first', 2]);
  });

  it('repeats intervals until either clearing operation removes their ID', async () => {
    const { window } = createBrowlet();
    const fired = Promise.withResolvers<void>();
    const callback = vi.fn(() => {
      window.clearTimeout(id);
      fired.resolve();
    });
    const id = window.setInterval(callback, 0);

    await fired.promise;
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });

    expect(callback).toHaveBeenCalledOnce();
  });

  it('exposes isSecureContext as a readonly attribute in both secure and insecure Windows', async () => {
    const insecure = createBrowlet();
    const secure = createBrowlet();
    await secure.navigate('https://example.test/');

    for (const [browlet, expected] of [[secure, true], [insecure, false]] as const) {
      const result = await browlet.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext')!;
        return {
          value: isSecureContext,
          getter: typeof descriptor.get,
          setter: typeof descriptor.set,
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable,
          assigned: Reflect.set(window, 'isSecureContext', !isSecureContext),
        };
      });
      expect(result).toEqual({
        value: expected, getter: 'function', setter: 'undefined',
        enumerable: true, configurable: true, assigned: false,
      });
    }
  });

  it('uses the receiver\'s secure context when another Window\'s getter is borrowed', async () => {
    const insecure = createBrowlet();
    const secure = createBrowlet();
    await secure.navigate('https://example.test/');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- borrowing the getter tests receiver ownership
    const getter = Object.getOwnPropertyDescriptor(secure.window, 'isSecureContext')!.get!;

    expect(Reflect.apply(getter, insecure.window, [])).toBe(false);
    expect(Reflect.apply(getter, secure.window, [])).toBe(true);
    expect(() => { Reflect.apply(getter, {}, []); })
      .toThrow(getRelevantRealm(secure.window).intrinsics.typeError);
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}
