import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

import { addon } from '../../src/js-engine/node-addons';

const run = promisify(execFile);

it.each(addon.createThreadControl
  ? ['task', 'reaction', 'clock', 'before-entry', 'cancel-before-entry', 'terminate', 'descendant', 'owner-error', 'owner-exit']
  : ['stock'])(
  'preserves thread suspension and teardown: %s',
  async (mode) => {
    // A process boundary bounds native-wait regressions as well as JavaScript
    // failures. The fixture exercises JSThread, its real entry, and JSRealm.
    const { stdout } = await run(process.execPath, [
      resolve('test/js-engine/fixtures/thread-suspension.cjs'), mode,
    ], { timeout: 25_000, windowsHide: true });
    expect(stdout.trim()).toBe('passed');
  },
  30_000,
);
