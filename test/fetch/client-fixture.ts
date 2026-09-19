import { FetchGroup } from '../../src/fetch/group';
import { ConnectionPool } from '../../src/fetch/http/connections';
import { HTTPCachePartitions } from '../../src/fetch/http/cache/partitions';
import type { FetchEnvironmentSettingsObject } from '../../src/fetch/infrastructure';
import { obtainURLOrigin, parseURL } from '../../src/url/url';

export function createClientSettings(url = 'https://example.test/'): FetchEnvironmentSettingsObject {
  const topLevelCreationURL = parseURL(url).url!;
  return {
    fetchGroup: new FetchGroup(),
    userAgent: {
      assumeNoInternetConnectivity: false,
      connectionPool: new ConnectionPool(),
      httpCachePartitions: new HTTPCachePartitions(),
    },
    topLevelOrigin: obtainURLOrigin(topLevelCreationURL),
    topLevelCreationURL,
    webDriverBiDiNetworkIsOffline: () => false,
    policyContainer: { embedderPolicy: { value: 'unsafe-none' } },
  };
}
