import { parentPort, workerData } from 'node:worker_threads';

// A host importing Browlet inside its own worker must not start Browlet's worker
// runtime. This is a normal file entry, deliberately without an eval bootstrap.
const loaded = await import(workerData.entryURL);
const api = workerData.extension === 'cjs' ? loaded.default : loaded;
parentPort.postMessage({ type: 'imported', exports: Object.keys(api) });
parentPort.close();
