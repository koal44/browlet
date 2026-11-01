import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('wakes the owning loop for Promise reactions queued by idle native cleanup', () => {
  const child = spawnSync(process.execPath, [
    '--expose-gc', '--import', 'tsx',
    resolve('test/support/finalization-wakeup-child.ts'),
  ], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(0);
  expect(child.stdout).toContain('PASS: idle cleanup Promise reaction');
}, 25000);
