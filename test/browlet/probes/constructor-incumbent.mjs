// Browser-only evidence for constructor callback capture; run manually.
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { chromium, firefox, webkit } from 'playwright';

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>' }));
    await page.goto('https://constructor.test/a');
    const result = await page.evaluate(async () => {
      const { document, window } = globalThis;
      const frames = await Promise.all(['b', 'c'].map((name) => new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.onload = () => resolve(frame.contentWindow);
        frame.src = `/${name}`;
        document.body.append(frame);
      })));
      const [b, c] = frames;
      // A bound platform method exposes the saved incumbent without an intervening author function.
      const callback = window.postMessage.bind(window, 'mutation', '*', []);
      const sources = [];
      for (const caller of [window, b]) {
        const delivered = new Promise((resolve) => window.addEventListener('message', (event) => {
          resolve(event.source === window ? 'A' : event.source === b ? 'B' : 'other');
        }, { once: true }));
        // Ordinary author code from B enters C's constructor without another script entry from HTML.
        const construct = caller.eval('(Constructor, callback) => new Constructor(callback)');
        const observer = construct(c.MutationObserver, callback);
        observer.observe(document.body, { attributes: true });
        document.body.setAttribute('data-probe', String(sources.length));
        sources.push(await delivered);
        observer.disconnect();
      }
      return sources;
    });
    log(name, result);
    assert.deepEqual(result, ['A', 'B']);
  } finally {
    await browser.close();
  }
}
