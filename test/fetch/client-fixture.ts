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
    getReportingSource: () => topLevelCreationURL,
    getTraversableForUserPrompts: () => null,
    fetchGroup: new FetchGroup(),
    userAgent: createFetchUserAgent(),
    topLevelOrigin: obtainURLOrigin(topLevelCreationURL),
    topLevelCreationURL,
    webDriverBiDiNetworkIsOffline: () => false,
    webDriverBiDiEmulatedUserAgent: () => null,
    policyContainer: createFetchPolicyContainer(),
    queueReport() {},
  };
}

export function createFetchUserAgent(): FetchUserAgent {
  return {
    defaultUserAgentValue: 'Browlet',
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
    integrityPolicy: { sources: [], blockedDestinations: [], endpoints: [] },
    reportOnlyIntegrityPolicy: { sources: [], blockedDestinations: [], endpoints: [] },
    clone() {
      return {
        ...this, embedderPolicy: { ...this.embedderPolicy },
        integrityPolicy: {
          sources: [...this.integrityPolicy.sources], blockedDestinations: [...this.integrityPolicy.blockedDestinations],
          endpoints: [...this.integrityPolicy.endpoints],
        },
        reportOnlyIntegrityPolicy: {
          sources: [...this.reportOnlyIntegrityPolicy.sources],
          blockedDestinations: [...this.reportOnlyIntegrityPolicy.blockedDestinations],
          endpoints: [...this.reportOnlyIntegrityPolicy.endpoints],
        },
      };
    },
  };
}
