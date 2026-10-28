import { expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

// Chromium returns true. This also covers the Window identity used by
// unhandledrejection, independently of the native rejection hook.
// Approved expected failure: Window projection currently exposes its target
// object here instead of the public WindowProxy. See the Window roadmap.
it.fails('exposes Window event targets as the public WindowProxy identity', async () => {
  const browser = new Browlet({ route: () => '', reporting: false });
  const same = await browser.evaluate(() => {
    let result = false;
    addEventListener('test', (event) => { result = event.target === window; }, { once: true });
    dispatchEvent(new Event('test'));
    return result;
  });
  expect(same).toBe(true);
});
