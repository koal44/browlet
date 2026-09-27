import type { BlobImpl } from '../file/index';
import type { CookieStore } from '../http/index';
import { InternalError } from '../infra/internal-error';
import type { InternalPromise } from '../infra/promises';
import type { JSEnvironment } from '../js-engine/index';
import type { MIMEType } from '../mime/index';
import type { StorageEnvironment, StorageUserAgent } from '../storage/index';
import type { BlobURLEntry, Host, Origin, URLParseResult, URLRecord } from '../url/index';
import { defineCapability, type BindingContext, type InterfaceDefinition } from '../web-idl/index';
import type { FetchController } from './controller';
import type { FetchGroup } from './group';
import type { HTTPCacheStore } from './cache-http';
import type { CORSPreflightCache } from './cache-cors';
import type {
  ConnectionPool, HTTPContentDecoder, HTTPContentDecoderListener, HTTPTransport, NetworkPartitionKey,
} from './transport';
import type { FetchIntegrityPolicy } from './policy';
import type { Destination, FetchMode, FetchRequest, RequestCredentials, RequestInternalPriority } from './request';
import type { CacheUsage, FetchResponse } from './response';
import type { FetchTimingInfo, ResponseBodyInfo, ServiceWorkerTimingInfo } from './timing';

/** Combine browser-wide connectivity state with the client's emulated offline state. */
// https://fetch.spec.whatwg.org/#is-offline
export function isOffline(env: FetchEnvironment): boolean {
  return env.userAgent.assumeNoInternetConnectivity ||
    env.userAgent.webDriverBiDiNetworkIsOffline(env);
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export interface FetchEnvironment extends FetchEnvironmentRecord, JSEnvironment {
  /** Whether this environment belongs to a Window, which can consume Document preloads. */
  isWindow: boolean;
  /** Whether this global is a ServiceWorkerGlobalScope, which cannot intercept its own fetches. */
  isServiceWorker: boolean;
  /** Whether the client's Window has a navigable whose parent is null. */
  isTopLevelWindow: boolean;
  /** Whether secure-context-only response timing headers can be retained. */
  isSecureContext: boolean;
  /** Timing precision allowed for this client's fetches. */
  crossOriginIsolatedCapability: boolean;
  /** Coarsen a shared monotonic timestamp and express it relative to this environment's origin. */
  relativeHighResolutionTime(time: number): number;
  /** Record this environment's resource entry after Fetch applies timing-exposure checks. */
  markResourceTiming(
    timingInfo: FetchTimingInfo, requestedURL: URLRecord, initiatorType: string,
    cacheUsage: CacheUsage | undefined, bodyInfo: ResponseBodyInfo, responseStatus: number,
  ): void;
  /** Consume a matching Document preload; notify when available, or return false for a miss. */
  consumePreloadedResource(
    url: URLRecord, destination: Destination, mode: FetchMode, credentialsMode: RequestCredentials,
    integrityMetadata: string, onResponseAvailable: (response: FetchResponse) => void,
  ): boolean;
  /** Current base URL used to resolve relative URLs supplied through Fetch APIs. */
  apiBaseURL: URLRecord;
  /** Parse a URL using this environment's browser and Blob URL store. */
  parseURL(input: string, base?: URLRecord | null, encoding?: string): URLParseResult;
  /** Client origin used by Fetch's origin and policy checks. */
  origin: Origin;
  /** Whether the client has cross-site ancestry or cannot establish a same-site ancestor context. */
  hasCrossSiteAncestor: boolean;
  /** Whether this client's origin or a Window ancestor prohibits mixed content. */
  prohibitsMixedSecurityContexts(): boolean;
  /** Upgrade policy and navigation targets inherited or enabled for this client. */
  insecureRequestsPolicy: FetchInsecureRequestsPolicy;
  /** Source URL selected by the client's global, or null when disclosure is prohibited. */
  getReferrerSource(): URLRecord | null;
  /** Document or worker URL for reports, or null for a global outside those categories. */
  getReportingSource(): URLRecord | null;
  /** Traversable belonging to this client's Window, or null when no Window navigable exists. */
  getTraversableForUserPrompts(): FetchPromptTarget | null;
  /** Requests tracked for this environment's lifetime. */
  fetchGroup: FetchGroup;
  /** Client's live policy container, exposing the policies currently consumed by Fetch. */
  policyContainer: FetchPolicyContainer;
  /** Submit a policy report for this client, retaining each field's JSON value type. */
  queueReport(type: string, endpoint: string, body: Record<string, string | boolean>): void;
}

/** An opaque reference to the HTML traversable selected for user prompts. */
export type FetchPromptTarget = {
  [fetchPromptTargetBrand]: true;
};

/** Type-only marker declared by HTML traversables; it has no runtime value. */
export declare const fetchPromptTargetBrand: unique symbol;

/** Upgrade Insecure Requests state supplied by the client's environment. */
export interface FetchInsecureRequestsPolicy {
  /** Whether the client upgrades insecure subresource and nested navigation requests. */
  upgrade: boolean;
  /** Whether this top-level navigation matches an opted-in host and port. */
  shouldUpgradeNavigation(url: URLRecord): boolean;
}

/** HTML's policy container, exposing the policies currently consumed by Fetch. */
export type FetchPolicyContainer = {
  /** CSP checks, absent until the resource's origin and policy list have been established. */
  cspList?: FetchCSPList;
  /** Cross-origin embedder policy applied by the client. */
  embedderPolicy: FetchEmbedderPolicy;
  /** Default referrer disclosure policy inherited by requests. */
  referrerPolicy: ReferrerPolicy;
  /** Enforced integrity requirements for outgoing requests. */
  integrityPolicy: FetchIntegrityPolicy;
  /** Integrity requirements checked for reporting without blocking requests. */
  reportOnlyIntegrityPolicy: FetchIntegrityPolicy;
  /** Copy the HTML-owned policy state for an independently populated request. */
  clone(): FetchPolicyContainer;
};

/** Embedder policy retained independently of the environment that receives its reports. */
// https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy
export type FetchEmbedderPolicy = {
  /** Enforced COEP mode, including credentialless restrictions on no-cors requests. */
  value: FetchEmbedderPolicyValue;
  /** Endpoint name for violations of the enforced policy. */
  reportingEndpoint: string;
  /** COEP mode checked for reporting without blocking responses. */
  reportOnlyValue: FetchEmbedderPolicyValue;
  /** Endpoint name for violations of the report-only policy. */
  reportOnlyReportingEndpoint: string;
};

/** CSP-owned behavior used by Fetch without importing HTML's policy implementation. */
export interface FetchCSPList {
  /** Report request violations of monitored policies before URL upgrades. */
  reportRequestViolations(request: FetchRequest): void;
  /** Enforce request policies after URL upgrades, reporting every violation. */
  isRequestBlocked(request: FetchRequest): boolean;
  /** Check the received response against enforced and monitored policies. */
  isResponseBlocked(response: FetchResponse, request: FetchRequest): boolean;
}

// https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy-value
export type FetchEmbedderPolicyValue = 'unsafe-none' | 'require-corp' | 'credentialless';

// https://w3c.github.io/webappsec-referrer-policy/#referrer-policies
export type ReferrerPolicy = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'same-origin' |
  'origin' | 'strict-origin' | 'origin-when-cross-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';

/** The HTML environment, including reserved clients that do not yet have a realm. */
export interface FetchEnvironmentRecord extends StorageEnvironment {
  /** Shared user agent owning this environment's networking state. */
  userAgent: FetchUserAgent;
  /** Top-level origin used for network partitioning, or null when it must be derived. */
  topLevelOrigin: Origin | null;
  /** Top-level creation URL used to derive an unavailable top-level origin, or null. */
  topLevelCreationURL: URLRecord | null;
  /** Network isolation key available even for a reserved client without a realm. */
  determineNetworkPartitionKey(): NetworkPartitionKey;
}

export interface FetchUserAgent extends StorageUserAgent {
  /** Browser-owned wire transport, shared across environments and isolated by network partition. */
  httpTransport: HTTPTransport;
  /** Supported HTTP codings, in the order advertised by Accept-Encoding. */
  supportedContentCodings: Set<string>;
  /** Create one decoder per response; codings are applied in reverse order. */
  createContentDecoder(codings: string[], listener: HTTPContentDecoderListener): HTTPContentDecoder;
  /** Browser-owned continuations, independent of any client's realm or lifetime. */
  HostPromise: typeof InternalPromise;
  /** Schedule background processing without entering an HTML global task. */
  runInParallel(this: void, steps: () => void): void;
  /** Read the browser's shared monotonic clock in milliseconds. */
  unsafeSharedCurrentTime(): number;
  /** Apply Referrer Policy to the request's resolved policy and selected source. */
  determineRequestReferrer(request: FetchRequest): URLRecord | null;
  /** Apply a redirect response's Referrer-Policy header before the next main-fetch pass. */
  setRequestReferrerPolicyOnRedirect(request: FetchRequest, response: FetchResponse): void;
  /** Supply a browser-policy response, or null to continue normal Fetch dispatch. */
  potentiallyOverrideResponse(request: FetchRequest, env: JSEnvironment): FetchResponse | null;
  /** Select interception from request metadata; prepare its copy only when needed. */
  // https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm
  // Null and timing-only results continue to the network with the original request.
  handleFetch(
    request: FetchRequest, controller: FetchController, useHighResPerformanceTimers: boolean,
    prepareRequest: () => InternalPromise<FetchRequest>,
  ): InternalPromise<FetchResponse | ServiceWorkerTimingInfo | null>;
  /** Select the browser's scheduling state from the request's priority and resource hints. */
  determineFetchPriority(request: FetchRequest): RequestInternalPriority;
  /** Whether the browser supports this MIME type for Resource Timing's content-type exposure. */
  supportsMIMEType(type: MIMEType): boolean;
  /** Default identification header value before an environment-specific override. */
  defaultUserAgentValue: string;
  /** Configured Accept-Language value, or null when no language preference is configured. */
  defaultAcceptLanguage: string | null;
  /** Browser-wide assumption of no internet access, separate from per-client emulation. */
  assumeNoInternetConnectivity: boolean;
  /** Whether WebDriver BiDi emulates an offline network for the given environment. */
  webDriverBiDiNetworkIsOffline(env: FetchEnvironment): boolean;
  /** Identification override for the given environment, or null when BiDi supplies none. */
  webDriverBiDiEmulatedUserAgent(env: FetchEnvironment): string | null;
  /** Language override for the given environment, or null when BiDi supplies none. */
  webDriverBiDiEmulatedLanguage(env: FetchEnvironment): string | null;
  /** Retain the outgoing body for automation when an active session requests it. */
  webDriverBiDiCloneNetworkRequestBody(request: FetchRequest): void;
  /** Notify automation immediately before an HTTP request is sent. */
  webDriverBiDiBeforeRequestSent(request: FetchRequest): void;
  /** Retain an incoming body when an active automation session requires it. */
  webDriverBiDiCloneNetworkResponseBody(request: FetchRequest, response: FetchResponse): void;
  /** Notify automation of a failed request. */
  webDriverBiDiFetchError(request: FetchRequest): void;
  /** Notify automation that an intercepted or network response has started. */
  webDriverBiDiResponseStarted(request: FetchRequest, response: FetchResponse): void;
  /** Notify automation that the response has reached Fetch's completion hook. */
  webDriverBiDiResponseCompleted(request: FetchRequest, response: FetchResponse): void;
  /** Shared reusable connections, isolated by network partition, origin, and credentials. */
  connectionPool: ConnectionPool;
  /** Browser-owned HTTP credentials and challenge handling, independent of a client's lifetime. */
  httpAuthentication: HTTPAuthentication;
  /** Shared logical HTTP caches, separated by network partition key. */
  httpCache: HTTPCacheStore;
  /** Cached CORS permissions, including invalidation after a failed preflight fetch. */
  corsPreflightCache: CORSPreflightCache;
  /** Cookie state shared by requests belonging to this user agent. */
  cookieStore: CookieStore;
  /** Enables sending and accepting cookies without deleting the store when disabled. */
  cookiesEnabled: boolean;
  /** Browser-owned transport-security state shared by this user agent's requests. */
  hstsStore: {
    /** Whether a URL host has an unexpired exact or inherited HTTPS requirement. */
    requiresHTTPS(host: Host | null): boolean;
    /** Learn HSTS only from an authenticated transport response. */
    processResponse(response: FetchResponse, hasValidTLS: boolean): void;
  };
  /** Applies this user agent's trust policy to a URL, including loopback and configured origins. */
  isURLPotentiallyTrustworthy(url: URLRecord): boolean;
  /** Create HTML's default policy container for a request without a client. */
  createPolicyContainer(): FetchPolicyContainer;
  /** Browser URL parsing, including capture of the current Blob URL registration. */
  parseURL(input: string, base?: URLRecord | null, encoding?: string): URLParseResult;
  /** Acquire an already-captured File API entry with the caller-selected access context. */
  obtainBlobObject(
    entry: BlobURLEntry | null,
    env: StorageEnvironment | 'top-level-navigation' | 'top-level-self-fetch',
  ): BlobImpl | null;
}

/** Credentials returned by the browser's authentication prompt. */
export type AuthenticationCredentials = {
  username: string;
  password: string;
};

// https://fetch.spec.whatwg.org/#authentication-entries
export interface AuthenticationEntry extends AuthenticationCredentials {
  /** HTTP protection-space label, not a JavaScript realm. */
  realm: string;
}

/** Browser authentication state and prompting required by Fetch's HTTP transaction. */
export interface HTTPAuthentication {
  /** Changes when credentials are cleared, preventing an older exchange from restoring them. */
  generation: number;
  /** Find a known realm, or infer one from the URL's directory scope. */
  find(url: URLRecord, realm?: string): AuthenticationEntry | null;
  /** Remove rejected credentials without removing a concurrent replacement. */
  invalidate(url: URLRecord, entry: AuthenticationEntry): void;
  /** Retain an accepted exchange, including its challenge and authenticated path. */
  store(url: URLRecord, entry: AuthenticationEntry, generation: number): void;
  /** Obtain credentials or null; cancellation settles a pending prompt. */
  prompt(
    request: FetchRequest, realm: string, previous: AuthenticationEntry | null, controller: FetchController,
  ): InternalPromise<AuthenticationEntry | null>;

  // PROVISIONAL: proxy authentication awaits a configured proxy identity and transport route.
  /** Apply configured proxy credentials independently of the request's credentials mode. */
  applyProxyAuthentication(request: FetchRequest): void;
  promptProxy(request: FetchRequest, response: FetchResponse): InternalPromise<boolean>;
}

/** Binding integration: HTML supplies the relevant browser environment and its execution facilities. */
export const fetchEnvironment =
  defineCapability<(context: BindingContext) => FetchEnvironment>('Fetch environment');

export function getFetchEnvironment(
  context: BindingContext, definition: InterfaceDefinition<never>,
): FetchEnvironment {
  const getEnvironment = context.getCapability(definition, fetchEnvironment);
  if (!getEnvironment) throw new InternalError('Fetch API requires HTML environment settings');
  return getEnvironment(context);
}
