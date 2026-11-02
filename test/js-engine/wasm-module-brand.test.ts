import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('avoids export enumeration natively and reuses successful fallback checks', async () => {
  vi.resetModules();
  // Instrument the intrinsic before JS Engine captures it; leave the selected backend real.
  const exports = vi.spyOn(WebAssembly.Module, 'exports');
  try {
    const { isWebAssemblyModule } = await import('../../src/js-engine/built-in-primitives.js');
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const foreign = runInNewContext('new WebAssembly.Module(bytes)', { bytes }) as object;
    for (const module of [new WebAssembly.Module(bytes), foreign]) {
      expect(isWebAssemblyModule(module)).toBe(true);
      Object.setPrototypeOf(module, null);
      Object.freeze(module);
      expect(isWebAssemblyModule(module)).toBe(true);
      expect(isWebAssemblyModule(module)).toBe(true);
    }
    expect(exports).toHaveBeenCalledTimes(process.env.BROWLET_NODE_ADDON ? 0 : 2);
  } finally {
    exports.mockRestore();
  }
});

it('recognizes Module brands across realms and rejects impostors without author code', async () => {
  vi.resetModules();
  const { isWebAssemblyModule } = await import('../../src/js-engine/built-in-primitives.js');
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const module = new WebAssembly.Module(bytes);
  const foreign = runInNewContext('new WebAssembly.Module(bytes)', { bytes }) as object;
  const fail = (): never => { throw new Error('Author code ran'); };
  for (const value of [module, foreign]) {
    for (const key of ['exports', 'constructor', Symbol.toStringTag]) {
      Object.defineProperty(value, key, { get: fail });
    }
    Object.setPrototypeOf(value, new Proxy({}, {
      get: fail, getPrototypeOf: fail, ownKeys: fail,
    }));
    Object.freeze(value);
    expect(isWebAssemblyModule(value)).toBe(true);
    expect(isWebAssemblyModule(value)).toBe(true);
  }
  const revoked = Proxy.revocable(module, {});
  revoked.revoke();
  for (const value of [
    undefined, null, true, 1, 1n, 'text', Symbol(), () => {}, [], {},
    new WebAssembly.Instance(module), new Uint8Array(), new ArrayBuffer(0),
    Object.create(WebAssembly.Module.prototype), { [Symbol.toStringTag]: 'WebAssembly.Module' },
    new Proxy(module, { get: fail, getPrototypeOf: fail, ownKeys: fail }), revoked.proxy,
  ]) {
    expect(isWebAssemblyModule(value)).toBe(false);
    expect(isWebAssemblyModule(value)).toBe(false);
  }
});
