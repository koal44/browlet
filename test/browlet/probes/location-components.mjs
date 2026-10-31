// Browser-only oracle for Location component parsing; run manually, idle outside investigations.
import { strict as assert } from 'node:assert';
import { log } from 'node:console';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const observationMs = 500;
const failures = [];
const cases = [
  { member: 'protocol', value: 'https::::' },
  { member: 'protocol', value: '', outcome: 'SyntaxError', navigates: false },
  { member: 'protocol', value: 'ftp', navigates: false },
  { member: 'protocol', value: 'mailto' },
  { member: 'host', value: 'bad host' },
  { member: 'host', value: 'other.test:99999', url: (url) => url.replace('location-components.test', 'other.test') },
  { member: 'hostname', value: 'other.test:1234' },
  { member: 'port', value: '1234abc', url: (url) => url.replace(':8443', ':1234') },
  { member: 'port', value: ':1234' },
  { member: 'port', value: '99999' },
  { member: 'pathname', value: '/next?x#y', url: (url) => url.replace(/\/case-\d+\/path/u, '/next%3Fx%23y') },
  // HTML PR 8309 and WPT 36019 require UTF-8; the current HTML passage still contains Document encoding.
  { member: 'search', value: '?q=\u00e9', url: (url) => url.replace('?old', '?q=%C3%A9') },
  { member: 'hash', value: '#same', navigates: false },
  { member: 'hash', value: '', url: (url) => url.replace('#same', '#') },
];

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({
      contentType: 'text/html; charset=windows-1252', body: '<!doctype html><body>',
    }));
    await page.goto('https://location-components.test:8443/root');
    log(JSON.stringify({ browser: name, version: browser.version(), observationMs }));
    for (const [index, test] of cases.entries()) {
      const { member, value } = test;
      const id = `case-${index}`;
      const before = await page.evaluate(async ({ id }) => {
        const { document } = globalThis;
        const frame = document.createElement('iframe');
        frame.name = id;
        frame.src = `https://location-components.test:8443/${id}/path?old#same`;
        const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
        document.body.append(frame);
        await loaded;
        globalThis.componentFrame = frame;
        return { url: frame.contentWindow.location.href, encoding: frame.contentDocument.characterSet };
      }, { id });
      assert.equal(before.encoding, 'windows-1252');
      const frame = page.frames().find((frame) => frame.name() === id);
      const requests = [];
      const commits = [];
      const request = (request) => { if (request.isNavigationRequest() && request.frame() === frame) requests.push(request.url()); };
      const navigated = (target) => { if (target === frame) commits.push(target.url()); };
      page.on('request', request);
      page.on('framenavigated', navigated);
      const outcome = await page.evaluate(({ member, value }) => {
        try {
          globalThis.componentFrame.contentWindow.location[member] = value;
          return 'returned';
        } catch (error) { return error.name; }
      }, { member, value });
      // A no-op has no completion event; the pathname case supplies a live navigation control.
      await page.waitForTimeout(observationMs);
      page.off('request', request);
      page.off('framenavigated', navigated);
      const expected = {
        url: test.url?.(before.url) ?? before.url, outcome: test.outcome ?? 'returned', navigated: test.navigates ?? true,
      };
      const actual = { url: frame.url(), outcome, navigated: requests.length > 0 || commits.length > 0 };
      log(JSON.stringify({ member, value, before, expected, actual, requests, commits }));
      if (actual.url !== expected.url || actual.outcome !== expected.outcome || actual.navigated !== expected.navigated) {
        failures.push({ browser: name, member, value, expected, actual });
      }
      if (member === 'pathname') assert.ok(requests.some((url) => url.includes('/next%3Fx%23y')));
      await page.evaluate(() => { globalThis.componentFrame.remove(); delete globalThis.componentFrame; });
    }
  } finally { await browser.close(); }
}
if (failures.length > 0) {
  log(JSON.stringify({ specificationFailures: failures }));
  process.exitCode = 1;
}
