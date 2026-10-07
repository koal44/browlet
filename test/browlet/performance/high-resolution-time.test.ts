import { describe, expect, it, vi } from 'vitest';

import {
  Clock, Moment, UnsafeMoment, monotonicClock, wallClock,
} from '../../../src/browlet/performance/clock';
import {
  EnvironmentTiming, initializeEstimatedMonotonicTimeOfUnixEpoch,
} from '../../../src/browlet/performance/high-resolution-time';

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
    const estimatedEpoch = new Moment(monotonicClock, -925);
    const timing = new EnvironmentTiming({
      crossOriginIsolatedCapability: false,
      timeOrigin: new Moment(monotonicClock, 75),
    }, estimatedEpoch);

    expect(timing.getTimeOriginTimestamp().milliseconds)
      .toBe(1_000);
  });

  it.each([-60_000, 60_000])(
    'preserves the time origin and elapsed time after a %i ms wall-clock adjustment',
    (adjustment) => {
      const wall = vi.spyOn(Date, 'now').mockReturnValue(1_000);
      const monotonic = vi.spyOn(globalThis.performance, 'now').mockReturnValue(25);
      try {
        const estimatedEpoch = initializeEstimatedMonotonicTimeOfUnixEpoch(wallClock, monotonicClock);
        const timing = new EnvironmentTiming({
          crossOriginIsolatedCapability: false,
          timeOrigin: monotonicClock.unsafeCurrentTime().coarsen(),
        }, estimatedEpoch);

        expect(timing.getTimeOriginTimestamp().milliseconds).toBe(1_000);
        expect(timing.currentHighResolutionTime().milliseconds).toBe(0);

        wall.mockReturnValue(1_000 + adjustment);
        monotonic.mockReturnValue(65);

        expect(timing.currentWallTime().milliseconds).toBe(1_000 + adjustment);
        expect(timing.getTimeOriginTimestamp().milliseconds).toBe(1_000);
        expect(timing.currentHighResolutionTime().milliseconds).toBe(40);
      } finally {
        monotonic.mockRestore();
        wall.mockRestore();
      }
    },
  );

  it('reports relative time from the settings-object origin', () => {
    const timing = new EnvironmentTiming({
      crossOriginIsolatedCapability: false,
      timeOrigin: new Moment(monotonicClock, 10),
    });
    const unsafeTime = new UnsafeMoment(monotonicClock, 14.567);

    expect(timing.relativeHighResolutionTime(unsafeTime).milliseconds)
      .toBeCloseTo(4.5, 10);
  });
});
