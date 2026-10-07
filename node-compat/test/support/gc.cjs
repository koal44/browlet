'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { setImmediate: nextTurn } = require('node:timers/promises');

async function assertCollected(references) {
  const names = Object.keys(references);
  const start = performance.now();
  let remaining;
  let cycles = 0;
  // The deadline bounds the test; collection can take any number of turns.
  do {
    // A deref() keeps its target alive until the next turn.
    await nextTurn();
    await global.gc({ type: 'major', execution: 'async' });
    cycles++;
    remaining = names.filter(name => references[name].deref() !== undefined);
    if (!remaining.length) return;
  } while (performance.now() - start < 10_000);

  assert.fail(
    `Collection not observed after ${(performance.now() - start).toFixed(1)} ms (${cycles} GC cycles). ` +
    `Still alive: ${remaining.join(', ')}. ` +
    `Node ${process.version}, V8 ${process.versions.v8}, ${process.platform}/${process.arch}`,
  );
}

module.exports = { assertCollected };
