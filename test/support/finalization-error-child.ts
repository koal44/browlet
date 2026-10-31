import assert from 'node:assert/strict';

import { Browlet } from '../../src/browlet/browlet';

async function main(): Promise<void> {
  const hostErrors: unknown[] = [];
  const monitored: unknown[] = [];
  process.on('uncaughtException', (error) => { hostErrors.push(error); });
  process.on('uncaughtExceptionMonitor', (error) => { monitored.push(error); });

  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.evaluate(() => {
    const state = {
      errors: [] as unknown[], calls: 0, same: false, canceled: false, unregistered: false, token: {},
      registry: null as FinalizationRegistry<unknown> | null, error: new Error('page cleanup'),
    };
    Reflect.set(globalThis, 'finalizationErrors', state);
    addEventListener('error', (event) => {
      state.errors.push(event.error);
      state.same = event.error === state.error;
      state.unregistered = state.registry!.unregister(state.token);
      event.preventDefault();
      state.canceled = event.cancelable && event.defaultPrevented;
    });
    state.registry = new FinalizationRegistry(() => {
      state.calls++;
      throw state.error;
    });
    state.registry.register({}, 'resource 1', state.token);
    state.registry.register({}, 'resource 2', state.token);
  });

  const deadline = performance.now() + 5000;
  let result;
  do {
    global.gc!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await browser.evaluate(() => {
      const state = Reflect.get(globalThis, 'finalizationErrors') as CleanupState;
      return {
        count: state.errors.length, calls: state.calls, same: state.same,
        canceled: state.canceled, unregistered: state.unregistered,
      };
    });
  } while (result.calls === 0 && performance.now() < deadline);

  assert(result.calls >= 1, 'must observe native cleanup');
  assert.equal(result.count, 1, 'native cleanup failure must reach the Window error event');
  assert.equal(result.calls, 1, 'error reporting must allow unregister before the next cleanup callback');
  assert.equal(result.same, true, 'preserve the thrown value identity');
  assert.equal(result.canceled, true, 'dispatch a cancelable Window error event');
  assert.equal(result.unregistered, true);
  assert.deepEqual(hostErrors, [], 'browser errors must not reach Node uncaughtException');
  assert.deepEqual(monitored, [], 'browser errors must not reach Node uncaughtExceptionMonitor');
  console.log('PASS: Window cleanup error reporting');
}

// The test's host listener must not swallow an assertion and produce exit 0.
main().catch((error) => { console.error(error); process.exitCode = 1; });

interface CleanupState {
  errors: unknown[];
  calls: number;
  same: boolean;
  canceled: boolean;
  unregistered: boolean;
}
