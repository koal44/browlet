import { idlType } from '../../src/web-idl/core/index';
import { internalType } from '../../src/infra/promises';
import { HostPromise, runInParallel } from '../../src/browlet/integration/scripting';
import type {
  FetchEnvironment, FetchPolicyContainer, FetchUserAgent,
} from '../../src/fetch/environment';
import { FetchGroup } from '../../src/fetch/group';
import { HTTPCacheStore } from '../../src/fetch/cache-http';
import { ConnectionPool } from '../../src/fetch/transport';
import { CORSPreflightCache } from '../../src/fetch/cache-cors';
import { CookieStore } from '../../src/http/index';
import { obtainSite, type Origin } from '../../src/url/index';
import { obtainURLOrigin, parseURL } from '../../src/url/url';
import { createEnvironment, type TestEnvironment } from '../js-engine/execution-fixture';
import type { TestRealm } from '../web-idl/test-realm';

export function createClientEnvironment(
  url = 'https://example.test/', env: TestEnvironment = createEnvironment(),
): ClientEnvironment {
  const topLevelCreationURL = parseURL(url).url!;
  return {
    ...env,
    isWindow: false,
    isServiceWorker: false,
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
    determineNetworkPartitionKey() { return [obtainSite(this.topLevelOrigin), null]; },
    policyContainer: createFetchPolicyContainer(),
    queueReport() {},
  };
}

// These test clients have known origins; reserved-record derivation is tested in HTML.
export interface ClientEnvironment extends FetchEnvironment, TestEnvironment {
  realm: TestRealm;
  topLevelOrigin: Origin;
}

export function createFetchUserAgent(): FetchUserAgent {
  return {
    HostPromise,
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
    handleFetch: () => HostPromise.try(() => null, internalType<null>('Result')),
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
      generation: 0,
      find: () => null,
      invalidate() {},
      applyProxyAuthentication() {},
      prompt: () => HostPromise.fromValue(null, Promise, internalType<null>('Result')),
      promptProxy: () => HostPromise.resolve(false, idlType.boolean),
      store() {},
    },
    httpCache: new HTTPCacheStore(),
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
