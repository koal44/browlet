import { obtainSite, sitesAreSameSite, type Site, obtainURLOrigin } from '../../url/index';
import type { FetchEnvironmentRecord } from '../infrastructure';
import { InternalError } from '../../infra/internal-error';

/** https://fetch.spec.whatwg.org/#determine-the-network-partition-key */
export function determineNetworkPartitionKey(env: FetchEnvironmentRecord): NetworkPartitionKey {
  let topLevelOrigin = env.topLevelOrigin;
  if (topLevelOrigin === null) {
    if (env.topLevelCreationURL === null) throw new InternalError('Fetch environment has no top-level origin or creation URL');
    topLevelOrigin = obtainURLOrigin(env.topLevelCreationURL);
  }
  return [obtainSite(topLevelOrigin), null];
}

/**
 * https://fetch.spec.whatwg.org/#network-partition-key
 * Browlet uses the permitted null second key, so only the site affects equality.
 */
export type NetworkPartitionKey = [topLevelSite: Site, secondKey: null];

/** Compare tuple values, preserving opaque-site identity. */
export function networkPartitionKeysEqual(a: NetworkPartitionKey, b: NetworkPartitionKey): boolean {
  return sitesAreSameSite(a[0], b[0]);
}
