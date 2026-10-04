import { UnsafeMoment, monotonicClock, wallClock } from './clock';
import type { Clock, Duration, Moment } from './clock';

/** Millisecond duration, interpreted relative to the origin selected by its consumer. */
// https://w3c.github.io/hr-time/#sec-domhighrestimestamp
export type DOMHighResTimeStamp = number;

/** Converts shared clock readings into timestamps for one environment. */
// https://w3c.github.io/hr-time/#time-origin
export class EnvironmentTiming {
  #host: EnvironmentTimingHost;
  #estimatedMonotonicTimeOfUnixEpoch: Moment;

  constructor(
    host: EnvironmentTimingHost,
    estimatedMonotonicTimeOfUnixEpoch =
      sharedEstimatedMonotonicTimeOfUnixEpoch,
  ) {
    this.#host = host;
    this.#estimatedMonotonicTimeOfUnixEpoch =
      estimatedMonotonicTimeOfUnixEpoch;
  }

  /** Current coarsened monotonic time relative to the environment's origin. */
  currentRelativeTimestamp(): Duration {
    return this.#host.timeOrigin.durationUntil(this.currentMonotonicTime());
  }

  currentMonotonicTime(): Moment {
    return unsafeSharedCurrentTime().coarsen(
      this.#host.crossOriginIsolatedCapability,
    );
  }

  currentWallTime(): Moment {
    return wallClock.unsafeCurrentTime().coarsen(
      this.#host.crossOriginIsolatedCapability,
    );
  }

  /** Translate the environment's monotonic origin to an epoch-relative timestamp. */
  // https://w3c.github.io/hr-time/#get-time-origin-timestamp
  getTimeOriginTimestamp(): Duration {
    return this.#estimatedMonotonicTimeOfUnixEpoch.durationUntil(
      this.#host.timeOrigin,
    );
  }

  /** Coarsen a raw reading and measure it from the environment's origin. */
  // https://w3c.github.io/hr-time/#dfn-relative-high-resolution-time
  relativeHighResolutionTime(time: UnsafeMoment): Duration {
    return this.relativeHighResolutionCoarseTime(time.coarsen(
      this.#host.crossOriginIsolatedCapability,
    ));
  }

  relativeHighResolutionCoarseTime(coarseTime: Moment): Duration {
    return this.#host.timeOrigin.durationUntil(coarseTime);
  }

  currentHighResolutionTime(): Duration {
    return this.relativeHighResolutionTime(unsafeSharedCurrentTime());
  }

}

/** Read wall-clock time with the default non-isolated precision limit. */
export function currentCoarsenedWallTime(): Moment {
  return wallClock.unsafeCurrentTime().coarsen();
}

/** Estimate the Unix epoch's position on a monotonic clock. */
export function initializeEstimatedMonotonicTimeOfUnixEpoch(
  wall: Clock,
  monotonic: Clock,
): Moment {
  const wallTime = wall.unsafeCurrentTime();
  const monotonicTime = monotonic.unsafeCurrentTime();
  const epochTime = new UnsafeMoment(
    monotonic,
    monotonicTime.milliseconds - wallTime.milliseconds,
  );

  return epochTime.coarsen();
}

/** Read monotonic time at the precision allowed by the isolation capability. */
export function coarsenedSharedCurrentTime(
  crossOriginIsolatedCapability = false,
): Moment {
  return unsafeSharedCurrentTime().coarsen(crossOriginIsolatedCapability);
}

/** Read the shared monotonic clock without exposing an uncoarsened author timestamp. */
// https://w3c.github.io/hr-time/#dfn-unsafe-shared-current-time
export function unsafeSharedCurrentTime(): UnsafeMoment {
  return monotonicClock.unsafeCurrentTime();
}

type EnvironmentTimingHost = {
  /** Whether the owner may use the finer cross-origin-isolated precision. */
  readonly crossOriginIsolatedCapability: boolean;
  /** Monotonic point from which this environment measures elapsed time. */
  readonly timeOrigin: Moment;
};

const sharedEstimatedMonotonicTimeOfUnixEpoch =
  initializeEstimatedMonotonicTimeOfUnixEpoch(wallClock, monotonicClock);
