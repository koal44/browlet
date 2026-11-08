import { Session } from 'node:inspector/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { getHeapStatistics } from 'node:v8';
import { beforeAll } from 'vitest';

// A collection trigger, not a heap limit: the next file can allocate beyond it.
// Four-worker trials at 512 and 768 MiB collected equally often; 512 had lower peaks.
const collectionThreshold = 512 * 2 ** 20;

beforeAll(async () => {
  if (getHeapStatistics().used_heap_size < collectionThreshold) return;

  // The preceding file has completed cleanup. Leave its job before collecting
  // so WeakRefs observed during that job no longer keep their targets alive.
  await nextTurn();
  const session = new Session();
  session.connect();
  try {
    // Memory-reducing collection can release cached code holding retired VM
    // contexts; ordinary gc() retained those contexts in the focused controls.
    await session.post('HeapProfiler.collectGarbage');
  } finally {
    session.disconnect();
  }
});
