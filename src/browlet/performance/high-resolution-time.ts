import { UnsafeMoment, monotonicClock, wallClock } from './clock';
import type { Clock, Duration, Moment } from './clock';

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

  getTimeOriginTimestamp(): Duration {
    return this.#estimatedMonotonicTimeOfUnixEpoch.durationUntil(
      this.#host.timeOrigin,
    );
  }

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

export function currentCoarsenedWallTime(): Moment {
  return wallClock.unsafeCurrentTime().coarsen();
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

  return epochTime.coarsen();
}

export function coarsenedSharedCurrentTime(
  crossOriginIsolatedCapability = false,
): Moment {
  return unsafeSharedCurrentTime().coarsen(crossOriginIsolatedCapability);
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
