import { FetchGroup } from '../../src/fetch/group';
import { ConnectionPool } from '../../src/fetch/http/connections';
import { HTTPCachePartitions } from '../../src/fetch/http/cache/partitions';
import { CORSPreflightCache } from '../../src/fetch/http/cors-preflight-cache';
import type {
  FetchEnvironment, FetchPolicyContainer, FetchUserAgent,
} from '../../src/fetch/environment';
import { CookieStore } from '../../src/http/index';
import { obtainURLOrigin, parseURL } from '../../src/url/url';
import { createEnvironment } from '../js-engine/execution-fixture';
import { hostPromises, runInParallel } from '../../src/browlet/integration/scripting';

export function createClientEnvironment(url = 'https://example.test/'): FetchEnvironment {
  const topLevelCreationURL = parseURL(url).url!;
  return {
    ...createEnvironment(),
    isWindow: false,
    isTopLevelWindow: false,
    isSecureContext: true,
    crossOriginIsolatedCapability: false,
    relativeHighResolutionTime: (time) => time,
    markResourceTiming() {},
    consumePreloadedResource: () => false,
    parseURL(input, base, encoding) { return this.userAgent.parseURL(input, base, encoding); },
    apiBaseURL: topLevelCreationURL,
    creationURL: topLevelCreationURL,
    origin: obtainURLOrigin(topLevelCreationURL),
    hasCrossSiteAncestor: false,
    prohibitsMixedSecurityContexts() { return this.userAgent.isURLPotentiallyTrustworthy(topLevelCreationURL); },
    insecureRequestsPolicy: { upgrade: false, shouldUpgradeNavigation: () => false },
    getReferrerSource: () => topLevelCreationURL,
    getReportingSource: () => topLevelCreationURL,
    getTraversableForUserPrompts: () => null,
    fetchGroup: new FetchGroup(),
    userAgent: createFetchUserAgent(),
    topLevelOrigin: obtainURLOrigin(topLevelCreationURL),
    topLevelCreationURL,
    policyContainer: createFetchPolicyContainer(),
    queueReport() {},
  };
}

export function createFetchUserAgent(): FetchUserAgent {
  return {
    hostPromises,
    httpTransport: {
      dispatch() { throw new Error('This fixture has no network transport'); },
      async close() {},
    },
    supportedContentCodings: new Set(),
    createContentDecoder() { throw new Error('This fixture has no HTTP codecs'); },
    runInParallel,
    unsafeSharedCurrentTime: () => performance.now(),
    determineRequestReferrer: () => null,
    setRequestReferrerPolicyOnRedirect() {},
    potentiallyOverrideResponse: () => null,
    handleFetch: () => hostPromises.try(() => null),
    determineFetchPriority: () => ({ update() {} }),
    supportsMIMEType: () => false,
    defaultUserAgentValue: 'Browlet',
    defaultAcceptLanguage: null,
    assumeNoInternetConnectivity: false,
    webDriverBiDiNetworkIsOffline: () => false,
    webDriverBiDiEmulatedUserAgent: () => null,
    webDriverBiDiEmulatedLanguage: () => null,
    webDriverBiDiCloneNetworkRequestBody() {},
    webDriverBiDiBeforeRequestSent() {},
    webDriverBiDiCloneNetworkResponseBody() {},
    webDriverBiDiFetchError() {},
    webDriverBiDiResponseStarted() {},
    webDriverBiDiResponseCompleted() {},
    connectionPool: new ConnectionPool(),
    httpAuthentication: {
      getAuthorization: () => null,
      applyProxyAuthentication() {},
      prompt: () => hostPromises.resolve(false),
      store() {},
    },
    httpCachePartitions: new HTTPCachePartitions(),
    corsPreflightCache: new CORSPreflightCache(),
    cookieStore: new CookieStore(),
    cookiesEnabled: true,
    storageEnabled: true,
    generateUUID: () => crypto.randomUUID(),
    parseURL,
    // Blob URL tests use Browlet's actual store and acquisition boundary.
    obtainBlobObject: () => null,
    hstsStore: { requiresHTTPS: () => false, processResponse() {} },
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
