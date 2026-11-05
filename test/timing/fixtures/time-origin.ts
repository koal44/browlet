import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import type * as Timing from '../../../src/timing/index';
import type { TimingEnvironment } from '../../../src/timing/index';

let wallTime = 1_000;
let monotonicTime = 75;
Date.now = () => wallTime;
Object.defineProperty(globalThis.performance, 'now', { value: () => monotonicTime });

// Load the production module only after setting the clocks it reads at startup.
const load = createRequire(__filename);
const timing = load('../../../src/timing/index') as typeof Timing;
const env: TimingEnvironment = {
  timeOrigin: timing.monotonicClock.unsafeCurrentTime().coarsen(),
  crossOriginIsolatedCapability: false,
  currentHighResolutionTime() { return timing.currentHighResolutionTime(this); },
  relativeHighResolutionTime(time) { return timing.relativeHighResolutionTime(time, this); },
  relativeHighResolutionCoarseTime(time) { return timing.relativeHighResolutionCoarseTime(time, this); },
  getTimeOriginTimestamp() { return timing.getTimeOriginTimestamp(this); },
  currentWallTime() { return timing.currentWallTime(this); },
};

assert.equal(env.getTimeOriginTimestamp().milliseconds, 1_000);
assert.equal(env.currentHighResolutionTime().milliseconds, 0);

const adjustment = Number(process.argv[2]);
wallTime += adjustment;
monotonicTime += 40;

assert.equal(env.currentWallTime().milliseconds, 1_000 + adjustment);
assert.equal(env.getTimeOriginTimestamp().milliseconds, 1_000);
assert.equal(env.currentHighResolutionTime().milliseconds, 40);
console.log('PASS: initialized time origin');
