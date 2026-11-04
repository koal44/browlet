import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each(['timeout', 'notify'])('preserves unrelated Node and VM Atomics %s after creating Browlet', (mode) => {
  const child = spawnSync(process.execPath, [
    '--require', resolve('test/support/register-typescript.cjs'),
    resolve('test/support/atomics-ownership-child.ts'), mode,
  ], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(0);
  expect(child.stdout).toContain(`PASS: unrelated Atomics ${mode}`);
}, 20000);
