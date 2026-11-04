import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

import { isWebAssemblyModule } from '../../src/js-engine/built-in-primitives';

it('avoids export enumeration natively and reuses successful fallback checks', () => {
  // This probe must instrument an intrinsic before JS Engine captures it.
  // Resetting the shared worker's modules would lose HTML's installation guard
  // while its native host hooks remain installed, breaking subsequent imports.
  execFileSync(process.execPath, [
    '--require', join(__dirname, '../support/register-typescript.cjs'),
    join(__dirname, 'fixtures/wasm-module-brand.cjs'),
  ], { encoding: 'utf8' });
});

it('recognizes Module brands across realms and rejects impostors without author code', () => {
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
