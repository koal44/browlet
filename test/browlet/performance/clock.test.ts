import { describe, expect, it } from 'vitest';

import {
  Clock, Duration, Moment, addDurationToMoment, durationFrom,
  implicitlyConvertDurationToTimestamp,
} from '../../../src/browlet/performance/clock';

describe('High Resolution Time concepts', () => {
  it('reports unsafe moments in a clock-specific coordinate system', () => {
    let currentTime = 12.5;
    const clock = new Clock(() => currentTime);

    const first = clock.unsafeCurrentTime();
    currentTime = 18.75;
    const second = clock.unsafeCurrentTime();

    expect(first.clock).toBe(clock);
    expect(first.milliseconds).toBe(12.5);
    expect(second.clock).toBe(clock);
    expect(second.milliseconds).toBe(18.75);
  });

  it('calculates positive and negative durations on one clock', () => {
    const clock = new Clock(() => 0);
    const earlier = new Moment(clock, 10);
    const later = new Moment(clock, 25.5);

    expect(durationFrom(earlier, later).milliseconds).toBe(15.5);
    expect(durationFrom(later, earlier).milliseconds).toBe(-15.5);
  });

  it('rejects duration calculations across clocks', () => {
    const firstClock = new Clock(() => 0);
    const secondClock = new Clock(() => 0);

    expect(() => durationFrom(
      new Moment(firstClock, 10),
      new Moment(secondClock, 20),
    )).toThrow('Moments from different clocks are not comparable');
  });

  it('applies a duration from one clock to a moment on another', () => {
    const sourceClock = new Clock(() => 0);
    const targetClock = new Clock(() => 0);
    const duration = durationFrom(
      new Moment(sourceClock, 10),
      new Moment(sourceClock, 14.5),
    );

    const translated = addDurationToMoment(
      new Moment(targetClock, 100),
      duration,
    );

    expect(translated.clock).toBe(targetClock);
    expect(translated.milliseconds).toBe(104.5);
  });

  it('converts clock-neutral durations to millisecond timestamps', () => {
    const duration = new Duration(-0.125);

    expect(implicitlyConvertDurationToTimestamp(duration)).toBe(-0.125);
  });
});
