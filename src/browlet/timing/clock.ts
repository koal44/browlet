import { InternalError } from '../../infra/internal-error';
import { coarsenTime } from '../../infra/time';
import type { DOMHighResTimeStamp } from './high-resolution-time';

/** Supplies raw timestamps whose clock identity determines whether they can be compared. */
// https://w3c.github.io/hr-time/#sec-clocks
export class Clock {
  #readUnsafeCurrentTime: () => number;

  constructor(readUnsafeCurrentTime: () => number) {
    this.#readUnsafeCurrentTime = readUnsafeCurrentTime;
  }

  /** Read a timestamp before applying the environment's precision limit. */
  unsafeCurrentTime(): UnsafeMoment {
    return new UnsafeMoment(this, this.#readUnsafeCurrentTime());
  }
}

/** System time measured in milliseconds since the Unix epoch. */
export const wallClock = new Clock(() => Date.now());

/** Shared monotonic source for elapsed-time measurements. */
export const monotonicClock = new Clock(() => globalThis.performance.now());

/** Raw clock reading that must be coarsened before calculating observable durations. */
// https://w3c.github.io/hr-time/#sec-moments-and-durations
export class UnsafeMoment {
  /** Clock whose origin and rate give this reading its meaning. */
  clock: Clock;
  /** Distinguishes raw readings from precision-limited moments. */
  coarsened = false as const;
  /** Elapsed milliseconds in the source clock's coordinate system. */
  milliseconds: number;

  constructor(clock: Clock, milliseconds: number) {
    this.clock = clock;
    this.milliseconds = milliseconds;
  }

  /** Apply the precision limit selected by cross-origin isolation. */
  // https://w3c.github.io/hr-time/#dfn-coarsen-time
  coarsen(crossOriginIsolatedCapability = false): Moment {
    return new Moment(this.clock, coarsenTime(this.milliseconds, crossOriginIsolatedCapability));
  }
}

/** Precision-limited point on a particular clock. */
// https://w3c.github.io/hr-time/#sec-moments-and-durations
export class Moment {
  /** Clock shared by moments that may be subtracted from this one. */
  clock: Clock;
  /** Marks this reading as already precision-limited. */
  coarsened = true as const;
  /** Coarsened milliseconds in the source clock's coordinate system. */
  milliseconds: number;

  constructor(clock: Clock, milliseconds: number) {
    this.clock = clock;
    this.milliseconds = milliseconds;
  }

  /** Measure elapsed time to another moment on the same clock. */
  durationUntil(other: Moment): Duration {
    if (this.clock !== other.clock) {
      throw new InternalError('Moments from different clocks are not comparable');
    }

    return new Duration(other.milliseconds - this.milliseconds);
  }

  /** Return the translated point in time, preserving the original moment. */
  addDuration(duration: Duration): Moment {
    return new Moment(this.clock, this.milliseconds + duration.milliseconds);
  }
}

/** Millisecond difference between two moments on the same clock. */
// https://w3c.github.io/hr-time/#sec-moments-and-durations
export class Duration {
  /** Signed elapsed time, independent of the source clock's origin. */
  milliseconds: number;

  constructor(milliseconds: number) {
    this.milliseconds = milliseconds;
  }

  /** Expose the measured duration as a DOM timestamp. */
  toTimestamp(): DOMHighResTimeStamp {
    return this.milliseconds;
  }
}
