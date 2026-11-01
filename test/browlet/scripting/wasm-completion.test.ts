import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

// Exercise the existing native WebAssembly global, without API adapters.
// No timer or unrelated HTML task may rescue these completions.
describe('native WebAssembly completion and idle checkpoints', () => {
  it('delivers a successful compilation without another HTML task', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });

    expect(await browser.evaluate(async (bytes) => {
      const module = await WebAssembly.compile(new Uint8Array(bytes));
      return module instanceof WebAssembly.Module;
    }, emptyModule)).toBe(true);
  });

  it('delivers a compilation error without another HTML task', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });

    expect(await browser.evaluate(async () => {
      try {
        await WebAssembly.compile(new Uint8Array([0]));
      } catch (error) {
        return error instanceof WebAssembly.CompileError;
      }
      return false;
    })).toBe(true);
  });

  it('delivers native instantiation completion without another HTML task', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });

    expect(await browser.evaluate(async (bytes) => {
      const { module, instance } = await WebAssembly.instantiate(new Uint8Array(bytes));
      const second = await WebAssembly.instantiate(module);
      return instance instanceof WebAssembly.Instance && second instanceof WebAssembly.Instance;
    }, emptyModule)).toBe(true);
  });

  it('runs module thenable assimilation before the compilation Promise can settle', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });

    expect(await browser.evaluate(async (bytes) => {
      const trace: string[] = [];
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() {
          trace.push('get then');
          return (resolve: (value: number) => void) => {
            trace.push('call then');
            resolve(5);
          };
        },
      });
      const result: unknown = await WebAssembly.compile(new Uint8Array(bytes));
      return { result, trace };
    }, emptyModule)).toEqual({ result: 5, trace: ['get then', 'call then'] });
  });

  it('delivers native completion once the owning loop receives a microtask notification', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const loop = getRelevantRealm(browser.window).agent.eventLoop;
    const compiling = Promise.withResolvers<void>();
    Reflect.set(browser.window, 'compilationReachedResolution', compiling.resolve);

    const result = browser.evaluate(async (bytes) => {
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() {
          // Resolution reads then synchronously; calling it needs a microtask.
          // Signal that native compilation has finished without pumping HTML.
          const report = Reflect.get(globalThis, 'compilationReachedResolution') as () => void;
          report();
          return (resolve: (value: number) => void) => { resolve(5); };
        },
      });
      return await WebAssembly.compile(new Uint8Array(bytes));
    }, emptyModule);

    await compiling.promise;
    // A single notification, after native resolution returns, is enough. This
    // control exercises the existing wake-up; it does not poll or drain by hand.
    await runInHostTask(() => { loop.queueMicrotask(() => {}); });
    expect(await result).toBe(5);
  });
});

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
