// Run with Node and the path to an Undici checkout/package as the next argument.
// Both built-in stores must choose the newest Date when stored variants overlap.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

assert.ok(process.argv[2], 'usage: node undici-cache-selection.mjs <undici-directory>');
const { cacheStores } = createRequire(import.meta.url)(resolve(process.argv[2]));

for (const Store of Object.values(cacheStores)) {
  test(`${Store.name}: select the newest Date among matching variants`, async () => {
    const store = new Store();
    const now = Date.now();
    const key = { origin: 'https://example.test', path: '/', method: 'GET' };
    async function put(headers, vary, date, marker, lifetime) {
      const stream = store.createWriteStream({ ...key, headers }, {
        statusCode: 200, statusMessage: 'OK',
        headers: { date: new Date(date).toUTCString(), 'cache-control': 'max-age=3600', marker },
        vary, cacheControlDirectives: { 'max-age': 3600 },
        cachedAt: now, staleAt: now + lifetime, deleteAt: now + lifetime,
      });
      const finished = once(stream, 'finish');
      stream.end(marker);
      await finished;
    }

    try {
      await put({ accept: 'text/plain', 'accept-language': 'en' },
        { accept: 'text/plain' }, now - 10000, 'older', 120000);
      await put({ accept: 'text/html', 'accept-language': 'en' },
        { 'accept-language': 'en' }, now, 'newer', 180000);
      const found = await store.get({
        ...key, headers: { accept: 'text/plain', 'accept-language': 'en' },
      });
      assert.equal(found?.headers.marker, 'newer');
    } finally {
      store.close?.();
    }
  });
}
