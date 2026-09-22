/** Reduce a millisecond timestamp to the precision selected by isolation capability. */
// High Resolution Time, coarsen time: https://w3c.github.io/hr-time/#dfn-coarsen-time
export function coarsenTime(timestamp: number, crossOriginIsolatedCapability = false): number {
  const resolution = crossOriginIsolatedCapability
    ? FINE_RESOLUTION_MICROSECONDS
    : COARSE_RESOLUTION_MICROSECONDS;
  const microseconds = timestamp * 1_000;
  const coarseMicroseconds = Math.trunc(microseconds / resolution) * resolution;
  return coarseMicroseconds / 1_000;
}

const COARSE_RESOLUTION_MICROSECONDS = 100;
const FINE_RESOLUTION_MICROSECONDS = 5;
