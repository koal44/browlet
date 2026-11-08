import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('reports unexpected internal observer failures to the host without exposing them to author rejection handling', () => {
  // A separate process observes actual host errors without installing exception
  // handlers in Vitest or changing the Promise implementation under test.
  const child = runObserverChild();
  expect(child.error).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(0);
  expect(child.stdout).toContain('PASS: internal observer failure ownership');
}, 25000);

it('terminates on an escaped observer exception when the host has no exception handler', () => {
  const child = runObserverChild('--fatal');
  expect(child.error).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(1);
  expect(child.stderr).toContain('Error: unhandled internal observer failure');
}, 25000);

/** Exercise native host failure policy without installing listeners in the test runner. */
function runObserverChild(...args: string[]) {
  return spawnSync(process.execPath, [
    '--require', resolve('test/support/register-typescript.cjs'),
    resolve('test/support/promise-observer-errors-child.ts'), ...args,
  ], { env: { ...process.env, TSX_DISABLE_CACHE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 20000 });
}
