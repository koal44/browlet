import { InternalError } from '../../infra/internal-error';
import { coarsenTime } from '../../infra/time';

/*
 * A clock tracks the passage of time and reports the unsafe current time at
 * which an algorithm step executes. Clock identity is significant: moments
 * created by different clocks are not comparable.
 *
 * High Resolution Time §2.1, clocks.
 */
export class Clock {
  #readUnsafeCurrentTime: () => number;

  constructor(readUnsafeCurrentTime: () => number) {
    this.#readUnsafeCurrentTime = readUnsafeCurrentTime;
  }

  unsafeCurrentTime(): UnsafeMoment {
    return new UnsafeMoment(this, this.#readUnsafeCurrentTime());
  }
}

export const wallClock = new Clock(() => Date.now());

export const monotonicClock = new Clock(() => globalThis.performance.now());

/*
 * Unsafe moments are raw points reported by clocks. Coarsening converts them
 * to Moments before specifications calculate observable durations.
 *
 * High Resolution Time §2.2, moments and durations.
 */
export class UnsafeMoment {
  clock: Clock;
  coarsened = false as const;
  milliseconds: number;

  constructor(clock: Clock, milliseconds: number) {
    this.clock = clock;
    this.milliseconds = milliseconds;
  }

  /** High Resolution Time, coarsen time. */
  coarsen(crossOriginIsolatedCapability = false): Moment {
    return new Moment(this.clock, coarsenTime(this.milliseconds, crossOriginIsolatedCapability));
  }
}

export class Moment {
  clock: Clock;
  coarsened = true as const;
  milliseconds: number;

  constructor(clock: Clock, milliseconds: number) {
    this.clock = clock;
    this.milliseconds = milliseconds;
  }

  /** High Resolution Time §2.2, the duration from this moment to another. */
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

export class Duration {
  milliseconds: number;

  constructor(milliseconds: number) {
    this.milliseconds = milliseconds;
  }

  /** High Resolution Time §2.2, implicitly convert a duration to a timestamp. */
  toTimestamp(): DOMHighResTimeStamp {
    return this.milliseconds;
  }
}
