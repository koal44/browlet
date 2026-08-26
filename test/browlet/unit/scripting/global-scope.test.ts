import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';

describe('WindowOrWorkerGlobalScope', () => {
  it('queues its callback after synchronous code', async () => {
    const { window } = createBrowlet();
    const order = ['synchronous'];

    window.queueMicrotask(() => { order.push('microtask'); });
    const promise = Promise.resolve().then(() => { order.push('promise'); });
    order.push('still synchronous');

    expect(order).toEqual(['synchronous', 'still synchronous']);
    await promise;
    expect(order).toEqual([
      'synchronous',
      'still synchronous',
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
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}
