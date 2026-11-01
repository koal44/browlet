import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';

import { Browlet } from '../../src/browlet/browlet';

async function main(): Promise<void> {
  const errors: unknown[] = [];
  process.on('uncaughtException', (error) => { errors.push(error); });
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.evaluate(() => 0);

  const buffer = new SharedArrayBuffer(8);
  const values = new Int32Array(buffer);
  const notify = process.argv[2] === 'notify';
  const timeout = notify ? Infinity : 10;
  const context = createContext({ buffer, timeout });
  const nodeWait = Atomics.waitAsync(values, 0, 0, timeout);
  const vmWait = runInContext('Atomics.waitAsync(new Int32Array(buffer), 1, 0, timeout)', context) as typeof nodeWait;
  assert.ok(nodeWait.async);
  assert.ok(vmWait.async);
  const results: (string | null)[] = [null, null];
  void nodeWait.value.then((value) => { results[0] = value; });
  void vmWait.value.then((value) => { results[1] = value; });
  if (notify) {
    assert.equal(Atomics.notify(values, 0), 1);
    assert.equal(Atomics.notify(values, 1), 1);
  }

  const deadline = performance.now() + 2000;
  while (results.includes(null) && errors.length === 0 && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(errors, [], 'HTML hooks must decline unrelated Node and VM jobs');
  const expected = notify ? 'ok' : 'timed-out';
  assert.deepEqual(results, [expected, expected], 'both non-HTML realms must retain native Atomics delivery');
  console.log(`PASS: unrelated Atomics ${process.argv[2]}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
