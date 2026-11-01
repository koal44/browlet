import assert from 'node:assert/strict';

import { Browlet } from '../../src/browlet/browlet';

async function main(): Promise<void> {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.evaluate(() => {
    const state = { cleanup: false, reaction: false };
    Reflect.set(globalThis, 'cleanupState', state);
    const registry = new FinalizationRegistry(() => {
      state.cleanup = true;
      void Promise.resolve().then(() => { state.reaction = true; });
    });
    Reflect.set(globalThis, 'cleanupRegistry', registry);
    registry.register({}, 1);
  });

  // Read realm-owned state directly: polling evaluate() or using an author-to-
  // host callback could supply the missing checkpoint and hide the regression.
  const state = Reflect.get(browser.window, 'cleanupState') as {
    cleanup: boolean;
    reaction: boolean;
  };
  const deadline = performance.now() + 5000;
  do {
    global.gc!();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (!state.cleanup && performance.now() < deadline);
  assert.equal(state.cleanup, true, 'GC must deliver the cleanup callback');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(state.reaction, true,
    'cleanup Promise reactions must progress without an unrelated HTML task');
  console.log('PASS: idle cleanup Promise reaction');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
