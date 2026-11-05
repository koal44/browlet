import { defineTypedef, idlType } from '../web-idl/core/index';

import { UnsafeMoment, monotonicClock, wallClock } from './clock';
import type { Clock, Duration, Moment } from './clock';
import type { TimingEnvironment } from './environment';

/** Millisecond duration, interpreted relative to the origin selected by its consumer. */
// https://w3c.github.io/hr-time/#sec-domhighrestimestamp
export type DOMHighResTimeStamp = number;

/** Current coarsened monotonic time relative to the environment's origin. */
// https://w3c.github.io/hr-time/#dfn-current-high-resolution-time
export function currentHighResolutionTime(env: TimingEnvironment): Duration {
  return relativeHighResolutionTime(unsafeSharedCurrentTime(), env);
}

/** Coarsen a raw reading and measure it from the environment's origin. */
// https://w3c.github.io/hr-time/#dfn-relative-high-resolution-time
export function relativeHighResolutionTime(time: UnsafeMoment, env: TimingEnvironment): Duration {
  return relativeHighResolutionCoarseTime(time.coarsen(env.crossOriginIsolatedCapability), env);
}

/** Measure an already-coarsened reading from the environment's origin. */
// https://w3c.github.io/hr-time/#dfn-relative-high-resolution-coarse-time
export function relativeHighResolutionCoarseTime(coarseTime: Moment, env: TimingEnvironment): Duration {
  return env.timeOrigin.durationUntil(coarseTime);
}

/** Translate the environment's monotonic origin to an epoch-relative timestamp. */
// https://w3c.github.io/hr-time/#get-time-origin-timestamp
export function getTimeOriginTimestamp(env: TimingEnvironment): Duration {
  return sharedEstimatedMonotonicTimeOfUnixEpoch.durationUntil(env.timeOrigin);
}

/** Read wall-clock time at the precision allowed by the environment. */
export function currentWallTime(env: TimingEnvironment): Moment {
  return wallClock.unsafeCurrentTime().coarsen(env.crossOriginIsolatedCapability);
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
// https://w3c.github.io/hr-time/#dfn-coarsened-shared-current-time
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

/*
 * typedef double DOMHighResTimeStamp;
 */
export const domHighResTimeStampIDL = defineTypedef({
  name: 'DOMHighResTimeStamp',
  type: idlType.double,
});

/*
 * typedef unsigned long long EpochTimeStamp;
 */
export const epochTimeStampIDL = defineTypedef({
  name: 'EpochTimeStamp',
  type: idlType.unsignedLongLong,
});

const sharedEstimatedMonotonicTimeOfUnixEpoch =
  initializeEstimatedMonotonicTimeOfUnixEpoch(wallClock, monotonicClock);
