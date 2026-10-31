import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect } from 'vitest';

import { itPassesWith } from '../../test-runtime';

// Approved stock-only failure: without the addon, Node owns native error reports.
const it = itPassesWith('exceptionReporting');

it('reports native cleanup exceptions to Window before the next cleanup callback', () => {
  const child = spawnSync(process.execPath, [
    '--expose-gc', '--import', 'tsx',
    resolve('test/support/finalization-error-child.ts'),
  ], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(0);
  expect(child.stdout).toContain('PASS: Window cleanup error reporting');
}, 25000);
