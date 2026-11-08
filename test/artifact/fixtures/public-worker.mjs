import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

// This is the browser host, not its worker bootstrap. The public constructor
// must select and reload the relocated package without any fixture wiring.
const { entryURL, extension, type } = workerData;
const { Browlet } = extension === 'mjs' ? await import(entryURL) : createRequire(entryURL)(fileURLToPath(entryURL));
const browser = new Browlet({ route: () => '' });
try {
  const result = await browser.evaluate((workerType) => new Promise((resolveResult, reject) => {
    const source = 'onmessage = event => { postMessage([name, event.data]); close(); };';
    const worker = new globalThis.Worker(`data:text/javascript,${encodeURIComponent(source)}`, {
      type: workerType, name: 'packaged worker',
    });
    globalThis.workerUnderTest = worker;
    worker.onmessage = (event) => { resolveResult(event.data); };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new Error(event.message ?? 'Worker load failed'));
    };
    worker.postMessage({ value: 42 });
  }), type);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message });
} finally {
  await browser.evaluate(() => { globalThis.workerUnderTest?.terminate(); });
  parentPort.close();
}
