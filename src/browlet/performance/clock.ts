/*
 * A clock tracks the passage of time and reports the unsafe current time at
 * which an algorithm step executes. Clock identity is significant: moments
 * created by different clocks are not comparable.
 *
 * High Resolution Time section 3.1
 */
export class Clock {
  readonly #readUnsafeCurrentTime: () => number;

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
 * High Resolution Time section 3.2
 */
export class UnsafeMoment {
  readonly clock: Clock;
  readonly coarsened = false;
  readonly milliseconds: number;

  constructor(clock: Clock, milliseconds: number) {
    this.clock = clock;
    this.milliseconds = milliseconds;
  }
}

export class Moment {
  readonly clock: Clock;
  readonly coarsened = true;
  readonly milliseconds: number;

  constructor(clock: Clock, milliseconds: number) {
    this.clock = clock;
    this.milliseconds = milliseconds;
  }
}

export class Duration {
  readonly milliseconds: number;

  constructor(milliseconds: number) {
    this.milliseconds = milliseconds;
  }
}

export function durationFrom(a: Moment, b: Moment): Duration {
  if (a.clock !== b.clock) {
    throw new Error('Moments from different clocks are not comparable');
  }

  return new Duration(b.milliseconds - a.milliseconds);
}

export function addDurationToMoment(
  moment: Moment,
  duration: Duration,
): Moment {
  return new Moment(
    moment.clock,
    moment.milliseconds + duration.milliseconds,
  );
}

export function implicitlyConvertDurationToTimestamp(
  duration: Duration,
): DOMHighResTimeStamp {
  return duration.milliseconds;
}
