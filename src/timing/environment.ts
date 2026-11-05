import type { Duration, Moment, UnsafeMoment } from './clock';

/** Timing state and operations supplied by the existing environment. */
export interface TimingEnvironment {
  /** HTML's boolean permission to use APIs requiring cross-origin isolation, including finer timers. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-settings-object-cross-origin-isolated-capability
  readonly crossOriginIsolatedCapability: boolean;
  /** Monotonic point from which this environment measures elapsed time. */
  readonly timeOrigin: Moment;
  /** Current coarsened monotonic time relative to this environment's origin. */
  currentHighResolutionTime(): Duration;
  /** Coarsen a raw reading and express it relative to this environment's origin. */
  relativeHighResolutionTime(time: UnsafeMoment): Duration;
  /** Express an already-coarsened reading relative to this environment's origin. */
  relativeHighResolutionCoarseTime(time: Moment): Duration;
  /** This environment's time origin expressed relative to the Unix epoch. */
  getTimeOriginTimestamp(): Duration;
  /** Current wall-clock time at this environment's permitted precision. */
  currentWallTime(): Moment;
}
