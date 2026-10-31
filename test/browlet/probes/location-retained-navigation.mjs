// Browser-only observations for HTML's retained-Location navigation gap; run manually.
import { strict as assert } from 'node:assert';
import { log } from 'node:console';
import { chromium, firefox, webkit } from 'playwright';

const observationMs = 750;
const controlFailures = [];
const members = ['href', 'assign', 'replace'];
const cases = [
  ...members.flatMap((member) => ['retained', 'old-function-current-receiver', 'current-function-retained-receiver', 'current']
    .map((receiver) => ({ transition: 'same-origin', member, receiver }))),
  ...members.map((member) => ({ transition: 'same-origin', member, receiver: 'retained', invalidURL: true })),
  ...members.flatMap((member) => ['retained', 'saved-function-retained-receiver']
    .map((receiver) => ({ transition: 'cross-origin', member, receiver }))),
  ...['href', 'replace'].map((member) => ({ transition: 'cross-origin', member, receiver: 'current' })),
  ...members.map((member) => ({ transition: 'detached', member, receiver: 'retained' })),
];

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    // All documents are local fulfillments; requests and commits independently reveal navigation.
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>' }));
    await page.goto('https://location-retained.test/root');
    log(JSON.stringify({ browser: name, version: browser.version(), observationMs }));
    for (const [index, test] of cases.entries()) {
      const id = `case-${index}`;
      const destination = `https://location-retained.test/${id}/destination`;
      const before = await page.evaluate(async ({ id, transition }) => {
        const { document } = globalThis;
        const capture = (steps) => { try { return steps(); } catch (error) { return error.name; } };
        const frame = document.createElement('iframe');
        frame.name = id;
        const load = async (url) => {
          const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
          frame.src = url;
          if (!frame.isConnected) document.body.append(frame);
          await loaded;
        };
        await load(`https://location-retained.test/${id}/old`);
        const retained = frame.contentWindow.location;
        const oldDocument = frame.contentDocument;
        const oldFunctions = {
          href: Object.getOwnPropertyDescriptor(retained, 'href').set,
          assign: retained.assign,
          replace: retained.replace,
        };
        const origin = transition === 'cross-origin' ? 'https://foreign-retained.test' : 'https://location-retained.test';
        await load(`${origin}/${id}/new`);
        const current = frame.contentWindow.location;
        const currentFunctions = capture(() => ({
          href: Object.getOwnPropertyDescriptor(current, 'href').set,
          assign: current.assign,
          replace: current.replace,
        }));
        globalThis.retainedProbe = { frame, retained, current, oldDocument, oldFunctions, currentFunctions };
        if (transition === 'detached') frame.remove();
        return {
          distinctLocations: retained !== current,
          retainedHref: capture(() => retained.href),
          currentHref: capture(() => current.href),
          oldDocumentLocation: capture(() => oldDocument.location === null ? null : 'non-null'),
          oldDocumentURL: oldDocument.URL,
          oldDocumentDefaultView: capture(() => oldDocument.defaultView === null ? null
            : oldDocument.defaultView === frame.contentWindow ? 'current-window-proxy' : 'other'),
          frameConnected: frame.isConnected,
        };
      }, { id, transition: test.transition });
      assert.equal(before.distinctLocations, true, `${name} ${id}: navigation must replace Window/Location`);
      const frame = page.frames().find((frame) => frame.name() === id);
      const requests = [];
      const commits = [];
      const request = (request) => { if (request.isNavigationRequest() && request.url().includes(`/${id}/`)) requests.push(request.url()); };
      const navigated = (target) => { if (target === frame) commits.push(target.url()); };
      page.on('request', request);
      page.on('framenavigated', navigated);
      const invocation = await page.evaluate(({ member, receiver, url }) => {
        const { retained, current, oldFunctions, currentFunctions } = globalThis.retainedProbe;
        let conversions = 0;
        const input = { toString() { conversions++; return url; } };
        try {
          if (receiver === 'old-function-current-receiver') Reflect.apply(oldFunctions[member], current, [input]);
          else if (receiver === 'current-function-retained-receiver') Reflect.apply(currentFunctions[member], retained, [input]);
          else if (receiver === 'saved-function-retained-receiver') Reflect.apply(oldFunctions[member], retained, [input]);
          else {
            const target = receiver === 'retained' ? retained : current;
            if (member === 'href') target.href = input;
            else target[member](input);
          }
          return { outcome: 'returned', conversions };
        } catch (error) {
          return { outcome: error.name, conversions };
        }
      }, { member: test.member, receiver: test.receiver, url: test.invalidURL ? 'http://[' : destination });
      // A no-op cannot supply a load event; observe a fixed window and verify the live controls below.
      await page.waitForTimeout(observationMs);
      const after = await page.evaluate(() => {
        const { frame, retained } = globalThis.retainedProbe;
        const capture = (steps) => { try { return steps(); } catch (error) { return error.name; } };
        return { retainedHref: capture(() => retained.href), currentHref: capture(() => frame.contentWindow?.location.href ?? null) };
      });
      const finalURL = frame?.url() ?? null;
      page.off('request', request);
      page.off('framenavigated', navigated);
      log(JSON.stringify({ ...test, before, invocation, requests, commits, finalURL, after }));
      if (test.receiver === 'current' || test.receiver === 'old-function-current-receiver') {
        // Retain failed controls and finish the other engines/cases before failing the command.
        if (finalURL !== destination || !requests.includes(destination)) {
          controlFailures.push({ browser: name, id, ...test, expected: destination, actual: finalURL, invocation });
        }
      }
      await page.evaluate(() => {
        globalThis.retainedProbe.frame.remove();
        delete globalThis.retainedProbe;
      });
    }
  } finally {
    await browser.close();
  }
}
assert.deepEqual(controlFailures, [], 'Expected fresh-receiver navigation controls did not commit');
