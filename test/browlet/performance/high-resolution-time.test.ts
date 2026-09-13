import { describe, expect, it } from 'vitest';

import {
  Clock, Moment, UnsafeMoment, monotonicClock,
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
