import { FetchGroup } from '../../src/fetch/group';
import { ConnectionPool } from '../../src/fetch/http/connections';
import { HTTPCachePartitions } from '../../src/fetch/http/cache/partitions';
import type { FetchEnvironmentSettingsObject, FetchUserAgent } from '../../src/fetch/infrastructure';
import { CookieStore } from '../../src/http/index';
import { obtainURLOrigin, parseURL } from '../../src/url/url';

export function createClientSettings(url = 'https://example.test/'): FetchEnvironmentSettingsObject {
  const topLevelCreationURL = parseURL(url).url!;
  return {
    apiBaseURL: topLevelCreationURL,
    origin: obtainURLOrigin(topLevelCreationURL),
    hasCrossSiteAncestor: false,
    fetchGroup: new FetchGroup(),
    userAgent: createFetchUserAgent(),
    topLevelOrigin: obtainURLOrigin(topLevelCreationURL),
    topLevelCreationURL,
    webDriverBiDiNetworkIsOffline: () => false,
    policyContainer: { embedderPolicy: { value: 'unsafe-none' } },
  };
}

export function createFetchUserAgent(): FetchUserAgent {
  return {
    assumeNoInternetConnectivity: false,
    connectionPool: new ConnectionPool(),
    httpCachePartitions: new HTTPCachePartitions(),
    cookieStore: new CookieStore(),
    cookiesEnabled: true,
  };
}
