import { obtainSite, sitesAreSameSite, type Site } from '../../url/origin';
import { obtainURLOrigin } from '../../url/url';
import type { FetchEnvironment } from '../infrastructure';
import { InternalError } from '../../infra/internal-error';

/** https://fetch.spec.whatwg.org/#determine-the-network-partition-key */
export function determineNetworkPartitionKey(environment: FetchEnvironment): NetworkPartitionKey {
  let topLevelOrigin = environment.topLevelOrigin;
  if (topLevelOrigin === null) {
    if (environment.topLevelCreationURL === null) throw new InternalError('Fetch environment has no top-level origin or creation URL');
    topLevelOrigin = obtainURLOrigin(environment.topLevelCreationURL);
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
