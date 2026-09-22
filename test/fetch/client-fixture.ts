import { FetchGroup } from '../../src/fetch/group';
import { ConnectionPool } from '../../src/fetch/http/connections';
import { HTTPCachePartitions } from '../../src/fetch/http/cache/partitions';
import type {
  FetchEnvironmentSettingsObject, FetchPolicyContainer, FetchUserAgent,
} from '../../src/fetch/infrastructure';
import { CookieStore } from '../../src/http/index';
import { obtainURLOrigin, parseURL } from '../../src/url/url';

export function createClientSettings(url = 'https://example.test/'): FetchEnvironmentSettingsObject {
  const topLevelCreationURL = parseURL(url).url!;
  return {
    apiBaseURL: topLevelCreationURL,
    origin: obtainURLOrigin(topLevelCreationURL),
    hasCrossSiteAncestor: false,
    getReferrerSource: () => topLevelCreationURL,
    getTraversableForUserPrompts: () => null,
    fetchGroup: new FetchGroup(),
    userAgent: createFetchUserAgent(),
    topLevelOrigin: obtainURLOrigin(topLevelCreationURL),
    topLevelCreationURL,
    webDriverBiDiNetworkIsOffline: () => false,
    policyContainer: createFetchPolicyContainer(),
    queueReport() {},
  };
}

export function createFetchUserAgent(): FetchUserAgent {
  return {
    assumeNoInternetConnectivity: false,
    connectionPool: new ConnectionPool(),
    httpCachePartitions: new HTTPCachePartitions(),
    cookieStore: new CookieStore(),
    cookiesEnabled: true,
    // Tests exercising browser trust policy use Browlet's real UserAgent instead.
    isURLPotentiallyTrustworthy: (url) => url.scheme === 'https' || url.scheme === 'wss',
    createPolicyContainer: createFetchPolicyContainer,
  };
}

function createFetchPolicyContainer(): FetchPolicyContainer {
  return {
    embedderPolicy: {
      value: 'unsafe-none', reportingEndpoint: '', reportOnlyValue: 'unsafe-none', reportOnlyReportingEndpoint: '',
    },
    referrerPolicy: 'strict-origin-when-cross-origin',
    clone() {
      return { ...this, embedderPolicy: { ...this.embedderPolicy } };
    },
  };
}
