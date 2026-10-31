import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { Moment, UnsafeMoment, wallClock } from '../../../src/browlet/timing/clock';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('HTML HostSystemUTCEpochNanoseconds calculation', () => {
  it('reads and coarsens the owning environment\'s live wall clock', () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const clock = vi.spyOn(wallClock, 'unsafeCurrentTime');
    clock.mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(12_300_000n);
    clock.mockReturnValue(new UnsafeMoment(wallClock, 23.456_789));
    expect(env.getSystemUTCEpochNanoseconds()).toBe(23_400_000n);
  });

  it('uses the environment\'s isolation capability when selecting precision', () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(wallClock, 'unsafeCurrentTime').mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));
    // Supply the policy result at its existing boundary; Permissions Policy
    // evaluation itself remains unfinished and is not supplied by this fixture.
    const isolated = vi.spyOn(env, 'crossOriginIsolatedCapability', 'get').mockReturnValue(true);

    expect(env.getSystemUTCEpochNanoseconds()).toBe(12_345_000n);
    isolated.mockReturnValue(false);
    expect(env.getSystemUTCEpochNanoseconds()).toBe(12_300_000n);
  });

  it.each([
    [0, 0n],
    [0.000_001_4, 1n],
    [0.000_001_6, 2n],
    [-0.000_001_4, -1n],
    [-0.000_001_6, -2n],
    [1_761_694_200_001, 1_761_694_200_001_000_000n],
    [-1_761_694_200_001, -1_761_694_200_001_000_000n],
  ])('converts coarsened %s milliseconds to %s nanoseconds', (milliseconds, nanoseconds) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, milliseconds));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(nanoseconds);
  });

  it.each([
    [-8_640_000_000_000_001, -8_640_000_000_000_000_000_000n],
    [-8_640_000_000_000_000, -8_640_000_000_000_000_000_000n],
    [8_640_000_000_000_000, 8_640_000_000_000_000_000_000n],
    [8_640_000_000_000_001, 8_640_000_000_000_000_000_000n],
  ])('clamps %s milliseconds to Temporal\'s Instant range', (milliseconds, nanoseconds) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, milliseconds));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(nanoseconds);
  });
});
