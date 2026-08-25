import {
  Moment, UnsafeMoment, durationFrom, monotonicClock, wallClock,
} from './clock';
import type { Clock, Duration } from './clock';

const COARSE_RESOLUTION_MICROSECONDS = 100;
const FINE_RESOLUTION_MICROSECONDS = 5;

export class EnvironmentTiming {
  readonly #host: EnvironmentTimingHost;
  readonly #estimatedMonotonicTimeOfUnixEpoch: Moment;

  constructor(
    host: EnvironmentTimingHost,
    estimatedMonotonicTimeOfUnixEpoch =
      sharedEstimatedMonotonicTimeOfUnixEpoch,
  ) {
    this.#host = host;
    this.#estimatedMonotonicTimeOfUnixEpoch =
      estimatedMonotonicTimeOfUnixEpoch;
  }

  currentRelativeTimestamp(): Duration {
    return durationFrom(
      this.#host.timeOrigin,
      this.currentMonotonicTime(),
    );
  }

  currentMonotonicTime(): Moment {
    return coarsenTime(
      unsafeSharedCurrentTime(),
      this.#host.crossOriginIsolatedCapability,
    );
  }

  currentWallTime(): Moment {
    return coarsenTime(
      wallClock.unsafeCurrentTime(),
      this.#host.crossOriginIsolatedCapability,
    );
  }

  getTimeOriginTimestamp(): Duration {
    return durationFrom(
      this.#estimatedMonotonicTimeOfUnixEpoch,
      this.#host.timeOrigin,
    );
  }

  relativeHighResolutionTime(time: UnsafeMoment): Duration {
    return this.relativeHighResolutionCoarseTime(coarsenTime(
      time,
      this.#host.crossOriginIsolatedCapability,
    ));
  }

  relativeHighResolutionCoarseTime(coarseTime: Moment): Duration {
    return durationFrom(this.#host.timeOrigin, coarseTime);
  }

  currentHighResolutionTime(): Duration {
    return this.relativeHighResolutionTime(unsafeSharedCurrentTime());
  }
}

export function currentCoarsenedWallTime(): Moment {
  return coarsenTime(wallClock.unsafeCurrentTime());
}

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

  return coarsenTime(epochTime);
}

export function coarsenTime(
  timestamp: UnsafeMoment,
  crossOriginIsolatedCapability = false,
): Moment {
  const resolution = crossOriginIsolatedCapability
    ? FINE_RESOLUTION_MICROSECONDS
    : COARSE_RESOLUTION_MICROSECONDS;
  const microseconds = timestamp.milliseconds * 1_000;
  const coarseMicroseconds = Math.trunc(microseconds / resolution) *
    resolution;

  return new Moment(timestamp.clock, coarseMicroseconds / 1_000);
}

export function coarsenedSharedCurrentTime(
  crossOriginIsolatedCapability = false,
): Moment {
  return coarsenTime(
    unsafeSharedCurrentTime(),
    crossOriginIsolatedCapability,
  );
}

export function unsafeSharedCurrentTime(): UnsafeMoment {
  return monotonicClock.unsafeCurrentTime();
}

type EnvironmentTimingHost = {
  readonly crossOriginIsolatedCapability: boolean;
  readonly timeOrigin: Moment;
};

const sharedEstimatedMonotonicTimeOfUnixEpoch =
  initializeEstimatedMonotonicTimeOfUnixEpoch(wallClock, monotonicClock);
