import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  Clock, Moment, UnsafeMoment, monotonicClock, initializeEstimatedMonotonicTimeOfUnixEpoch,
  currentHighResolutionTime, relativeHighResolutionTime, relativeHighResolutionCoarseTime,
  getTimeOriginTimestamp, currentWallTime, type TimingEnvironment,
} from '../../src/timing/index';

describe('High Resolution Time algorithms', () => {
  it('coarsens moments using the isolation-sensitive resolution', () => {
    const clock = new Clock(() => 0);
    const unsafeMoment = new UnsafeMoment(clock, 12.345_678);

    const coarse = unsafeMoment.coarsen();
    const isolated = unsafeMoment.coarsen(true);

    expect(coarse.clock).toBe(clock);
    expect(coarse.coarsened).toBe(true);
    expect(coarse.milliseconds).toBeCloseTo(12.3, 10);
    expect(isolated.milliseconds).toBeCloseTo(12.345, 10);
  });

  it('estimates the Unix epoch in monotonic-clock coordinates', () => {
    const wallClock = new Clock(() => 1_000);
    const localMonotonicClock = new Clock(() => 25);

    const estimatedEpoch = initializeEstimatedMonotonicTimeOfUnixEpoch(
      wallClock,
      localMonotonicClock,
    );

    expect(estimatedEpoch.clock).toBe(localMonotonicClock);
    expect(estimatedEpoch.milliseconds).toBe(-975);
  });

  it('converts a time origin to an epoch-relative duration', () => {
    checkInitializedClocks(0);
  });

  it.each([-60_000, 60_000])(
    'preserves the time origin and elapsed time after a %i ms wall-clock adjustment',
    (adjustment) => {
      checkInitializedClocks(adjustment);
    },
  );

  it('reports relative time from the settings-object origin', () => {
    const env = createEnvironment(new Moment(monotonicClock, 10));
    const unsafeTime = new UnsafeMoment(monotonicClock, 14.567);

    expect(env.relativeHighResolutionTime(unsafeTime).milliseconds)
      .toBeCloseTo(4.5, 10);
  });
});

function checkInitializedClocks(adjustment: number): void {
  // Unit files share modules. Start fresh so clock initialization is deterministic
  // without replacing the epoch or affecting another suite's shared clocks.
  const child = spawnSync(process.execPath, [
    '--require', resolve('test/support/register-typescript.cjs'),
    resolve('test/timing/fixtures/time-origin.ts'), String(adjustment),
  ], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(0);
  expect(child.stdout).toContain('PASS: initialized time origin');
}

function createEnvironment(timeOrigin: Moment): TimingEnvironment {
  return {
    timeOrigin,
    crossOriginIsolatedCapability: false,
    currentHighResolutionTime() { return currentHighResolutionTime(this); },
    relativeHighResolutionTime(time) { return relativeHighResolutionTime(time, this); },
    relativeHighResolutionCoarseTime(time) { return relativeHighResolutionCoarseTime(time, this); },
    getTimeOriginTimestamp() { return getTimeOriginTimestamp(this); },
    currentWallTime() { return currentWallTime(this); },
  };
}
