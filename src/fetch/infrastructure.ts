import type { FetchGroup } from './group';
import type { ConnectionPool } from './http/connections';
import type { HTTPCachePartitions } from './http/cache/partitions';
import type { Origin } from '../url/origin';
import type { URLRecord } from '../url/url';

/** https://fetch.spec.whatwg.org/#is-offline */
export function isOffline(environment: FetchEnvironmentSettingsObject): boolean {
  return environment.userAgent.assumeNoInternetConnectivity ||
    environment.webDriverBiDiNetworkIsOffline();
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export type FetchEnvironmentSettingsObject = FetchEnvironment & {
  fetchGroup: FetchGroup;
  webDriverBiDiNetworkIsOffline(): boolean;
  policyContainer: {
    embedderPolicy: {
      value: 'unsafe-none' | 'require-corp' | 'credentialless';
    };
  };
};

/** The HTML environment, including reserved clients that do not yet have a realm. */
export type FetchEnvironment = {
  userAgent: FetchUserAgent;
  topLevelOrigin: Origin | null;
  topLevelCreationURL: URLRecord | null;
};

export type FetchUserAgent = {
  assumeNoInternetConnectivity: boolean;
  connectionPool: ConnectionPool;
  httpCachePartitions: HTTPCachePartitions;
};

/** Fetch §2, serialize an integer as its shortest decimal representation. */
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}
