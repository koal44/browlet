import { BrowsingContextGroup } from './browsing/browsing-context';
import { createSandboxEnvironment } from './bindings';
import type { Navigable, TopLevelTraversable } from './browsing/navigable';
import type { Environment } from './scripting/environment';
import { createPolicyContainer, type PolicyContainer } from './browsing/policy/container';
import { HSTSStore } from './browsing/policy/hsts';
import type { EventLoopOptions } from './scripting/event-loop';
import { hostPromises, requestNodeEventLoopTurn, runInParallel } from './integration/scripting';
import { unsafeSharedCurrentTime } from './performance/high-resolution-time';
import { determineRequestReferrer, setRequestReferrerPolicyOnRedirect } from './browsing/policy/referrer-policy';
import { BlobURLEntry, BlobURLStore } from './integration/file/blob-url';
import type { ReportingEndpoint } from './reporting/endpoint';
import { ReportImpl } from './reporting/report';
import type { ReportDeliveryResult } from './reporting/delivery';
import { NodeHTTPTransport } from './loader/node-transport';
import { createContentDecoder, supportedContentCodings } from './loader/node-decoder';
import {
  ConnectionPool, HTTPCachePartitions, CORSPreflightCache, fetch, FetchRequest, isOkStatus,
  type FetchController, type FetchResponse, type FetchUserAgent, type HTTPAuthentication, type HTTPTransport,
  type RequestInternalPriority, type ServiceWorkerTimingInfo,
} from '../fetch/index';
import { CookieStore } from '../http/index';
import type { BlobImpl } from '../file/index';
import type { MIMEType } from '../mime/index';
import type { JSEnvironment } from '../js-engine/index';
import type { StorageEnvironment, StorageUserAgent } from '../storage/index';
import {
  areSameOrigin, type Origin, type TupleOrigin, obtainURLOrigin, parseURL,
  type BlobURLEntry as URLBlobURLEntry, type URLParseResult, type URLRecord, type URLUserAgent,
} from '../url/index';
import { InternalError } from '../infra/internal-error';
import type { InternalPromise } from '../infra/promises';

/*
 * HTML's user agent owns browsing context groups and the top-level
 * traversables normally presented as browser windows or tabs. Browlet is one
 * such host, but these collections outlive any individual realm or Document.
 */
export class UserAgent implements FetchUserAgent, StorageUserAgent, URLUserAgent {
  browsingContextGroupSet = new Set<BrowsingContextGroup>();
  topLevelTraversableSet = new Set<TopLevelTraversable>();
  eventLoopOptions: EventLoopOptions | null;
  /** Background Fetch continuations outlive their initiating environments. */
  hostPromises = hostPromises;
  /** Background steps remain distinct from task delivery to a global. */
  runInParallel = runInParallel;

  /** Default identification header value, shared by this user agent's environments. */
  // https://fetch.spec.whatwg.org/#default-user-agent-value
  defaultUserAgentValue = 'Mozilla/5.0 (compatible; Browlet)';
  /** Configured language preference; null leaves Accept-Language absent unless supplied or emulated. */
  defaultAcceptLanguage: string | null = null;
  /** Wire connections outlive individual documents and are closed by their browser owner. */
  connectionPool = new ConnectionPool();
  httpTransport: HTTPTransport = new NodeHTTPTransport(undefined, this.connectionPool);
  /** Credentials and authentication challenges shared by this user agent's HTTP requests. */
  // PROVISIONAL(HTTP authentication): no credentials are supplied or stored, and
  // prompting declines. RFC 9110/7617 parsing, protection spaces, and Basic follow
  // the HTTP roadmap; this placeholder does not implement an authentication scheme.
  httpAuthentication: HTTPAuthentication = {
    getAuthorization: () => null,
    applyProxyAuthentication() {},
    prompt: () => this.hostPromises.resolve(false),
    store() {},
  };
  /** Native HTTP codecs, instantiated separately for each response. */
  supportedContentCodings = new Set(supportedContentCodings);
  createContentDecoder = createContentDecoder;
  httpCachePartitions = new HTTPCachePartitions();
  /** CORS permissions are owned independently of ordinary HTTP cache entries. */
  corsPreflightCache = new CORSPreflightCache();
  cookieStore = new CookieStore();
  /** Remembered HTTPS requirements shared by this user agent's browsing contexts. */
  hstsStore = new HSTSStore();
  /** Blob URL registrations shared by this user agent's environments. */
  blobURLStore = new BlobURLStore(this);
  /** Controls both sending and accepting cookies without clearing the store. */
  cookiesEnabled = true;
  /** Allows storage APIs to obtain keys; Blob URL access checks remain available. */
  storageEnabled = true;
  /** Allows outbound report queues and delivery; local ReportingObservers remain enabled. */
  reportDeliveryEnabled = true;
  /** Maximum age of queued reports in milliseconds; Reporting suggests about two days. */
  maxReportAge = 2 * 24 * 60 * 60 * 1000;
  /** Reporting endpoints are retired after exceeding this consecutive-failure count. */
  maxReportingEndpointFailures = 5;
  // PROVISIONAL: assumes connectivity until explicitly changed; host detection is not wired.
  assumeNoInternetConnectivity = false;
  // Applies to tuple origins supplied by an authenticated protocol implementation.
  // https://w3c.github.io/webappsec-secure-contexts/#packaged-applications
  authenticatedSchemes = new Set<string>();
  /** https://w3c.github.io/webappsec-secure-contexts/#development-environments */
  trustworthyOrigins: TupleOrigin[] = [];
  #sandbox: JSEnvironment | undefined;

  constructor(eventLoopOptions: EventLoopOptions | null = null) {
    this.eventLoopOptions = eventLoopOptions;
  }

  /** Lazily allocated execution shared by this user agent's work that can outlive pages. */
  get sandbox(): JSEnvironment {
    return this.#sandbox ??= createSandboxEnvironment(this.eventLoopOptions ?? undefined);
  }

  createBrowsingContextGroup(): BrowsingContextGroup {
    const group = new BrowsingContextGroup(this);
    this.browsingContextGroupSet.add(group);
    return group;
  }

  appendTopLevelTraversable(traversable: TopLevelTraversable): void {
    this.topLevelTraversableSet.add(traversable);
  }

  removeTopLevelTraversable(traversable: TopLevelTraversable): void {
    this.topLevelTraversableSet.delete(traversable);
  }

  removeBrowsingContextGroup(group: BrowsingContextGroup): void {
    if (group.browsingContextSet.size !== 0) {
      throw new InternalError('A nonempty browsing context group cannot be removed');
    }

    this.browsingContextGroupSet.delete(group);
  }

  /** Generate a fresh canonical UUID for browser-owned registrations. */
  generateUUID(): string {
    return crypto.randomUUID();
  }

  /** Parse a browser URL and retain its Blob registration before revocation can remove it. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLParseResult {
    return parseURL(input, base, encoding, this);
  }

  /** Acquire a captured Blob entry without resolving its URL again after revocation. */
  obtainBlobObject(
    entry: URLBlobURLEntry | null,
    env: StorageEnvironment | 'top-level-navigation' | 'top-level-self-fetch',
  ): BlobImpl | null {
    if (!(entry instanceof BlobURLEntry)) return null;
    return entry.obtainObject(env);
  }

  /** Create a fresh HTML policy container, including for clientless Fetch requests. */
  createPolicyContainer(): PolicyContainer {
    return createPolicyContainer();
  }

  /** Shared Fetch timestamps use the same clock as HTML and High Resolution Time. */
  unsafeSharedCurrentTime(): number {
    return unsafeSharedCurrentTime().milliseconds;
  }

  /** Apply the browser-owned Referrer Policy algorithm for Fetch. */
  determineRequestReferrer(request: FetchRequest): URLRecord | null {
    return determineRequestReferrer(request);
  }

  /** Update Fetch's referrer policy using the browser-owned header parser. */
  setRequestReferrerPolicyOnRedirect(request: FetchRequest, response: FetchResponse): void {
    setRequestReferrerPolicyOnRedirect(request, response);
  }

  /** Supply a browser-policy response, or null to continue normal Fetch dispatch. */
  // https://fetch.spec.whatwg.org/#potentially-override-response-for-a-request
  potentiallyOverrideResponse(_request: FetchRequest, _env: JSEnvironment): FetchResponse | null {
    // Fetch's default implementation lets the request proceed unchanged.
    return null;
  }

  /** Offer a request to a matching Service Worker, retaining completion on the browser's host queue. */
  // https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm
  handleFetch(
    _request: FetchRequest, _controller: FetchController, _useHighResPerformanceTimers: boolean,
  ): InternalPromise<FetchResponse | ServiceWorkerTimingInfo | null> {
    // PROVISIONAL(Service Workers): no registrations or active workers exist yet.
    // Handle Fetch returns null when no worker handles the request.
    return this.hostPromises.try(() => null);
  }

  /** Select internal network scheduling state for a request. */
  determineFetchPriority(_request: FetchRequest): RequestInternalPriority {
    // PROVISIONAL(Fetch 9): no transport scheduler exists. Select and update
    // priority using the request's hint, initiator, destination, and render-blocking state there.
    return { update() {} };
  }

  /** Whether a MIME type can be exposed as supported in Resource Timing. */
  supportsMIMEType(_type: MIMEType): boolean {
    // PROVISIONAL: no browser-wide support policy exists yet. MIME Sniffing still
    // minimizes JavaScript, JSON, SVG, and XML independently; other types remain unexposed.
    return false;
  }

  /** Run browser-owned reporting work on a later host turn, yielding to runnable page tasks. */
  queueReportingTask(steps: () => void): void {
    requestNodeEventLoopTurn(() => {
      for (const group of this.browsingContextGroupSet) {
        for (const cluster of group.agentClusterMap.values()) {
          for (const agent of cluster.agents) {
            const { eventLoop } = agent;
            // Manually driven loops do not request turns that could unblock us.
            if (eventLoop.started && eventLoop.hasRunnableTasks()) {
              this.queueReportingTask(steps);
              return;
            }
          }
        }
      }
      steps();
    });
  }

  /** Attempt delivery and return its outcome without changing endpoint bookkeeping. */
  // https://w3c.github.io/reporting/#try-delivery
  // The internal Promise represents the draft's "wait for a response" step.
  // Its continuations belong to the browser, not the report's retiring Window.
  attemptReportDelivery(
    endpoint: ReportingEndpoint, origin: Origin, reports: ReportImpl[],
  ): InternalPromise<ReportDeliveryResult> {
    const request = new FetchRequest(endpoint.url, null, this);
    request.method = 'POST';
    request.origin = origin;
    request.headerList.append('Content-Type', 'application/reports+json');
    request.traversableForUserPrompts = null;
    request.allowServiceWorkerInterception = false;
    request.destination = 'report';
    request.mode = 'cors';
    request.unsafeRequest = true;
    request.credentialsMode = 'same-origin';
    request.priority = 'low';
    // Bytes need no stream or execution owner from the retiring Window.
    request.body = ReportImpl.serialize(reports);
    for (const report of reports) report.attempts++;
    const result = hostPromises.withResolvers<ReportDeliveryResult>();
    // This clientless request has no Window to receive response callbacks.
    // The sandbox owns stream execution; the request retains the report's
    // original origin and remains clientless.
    fetch(request, {
      processResponse: (response) => {
        if (isOkStatus(response.status)) result.resolve('success');
        else if (response.status === 410) result.resolve('remove-endpoint');
        else result.resolve('failure');
      },
      useParallelQueue: true,
    }, this.sandbox);
    return result.promise;
  }

  /** Whether automation emulates an offline network for the given environment. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-network-is-offline
  webDriverBiDiNetworkIsOffline(_env: Environment): boolean {
    // PROVISIONAL: no BiDi sessions; select scoped network conditions when implemented.
    return false;
  }

  /** Identification override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-user-agent
  webDriverBiDiEmulatedUserAgent(_env: Environment): string | null {
    // PROVISIONAL: no BiDi sessions; select scoped emulation when implemented.
    return null;
  }

  /** Language override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-language
  webDriverBiDiEmulatedLanguage(_env: Environment): string | null {
    // PROVISIONAL: no BiDi sessions; select scoped language emulation when implemented.
    return null;
  }

  /** Retain an outgoing body if automation requests its contents. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-clone-network-request-body
  webDriverBiDiCloneNetworkRequestBody(_request: FetchRequest): void {
    // PROVISIONAL: no BiDi sessions request network body collection.
  }

  /** WebDriver BiDi's HTTP request notification. */
  // PROVISIONAL: no active BiDi network sessions are implemented yet.
  webDriverBiDiBeforeRequestSent(_request: FetchRequest): void {}

  /** WebDriver BiDi's optional incoming-body retention. */
  // PROVISIONAL: no active BiDi network sessions are implemented yet.
  webDriverBiDiCloneNetworkResponseBody(_request: FetchRequest, _response: FetchResponse): void {}

  /** Notify automation of a network fetch error. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-fetch-error
  webDriverBiDiFetchError(_request: FetchRequest): void {
    // PROVISIONAL: no BiDi sessions receive network events.
  }

  /** Notify automation that Fetch has received a response. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-response-started
  webDriverBiDiResponseStarted(_request: FetchRequest, _response: FetchResponse): void {
    // PROVISIONAL: no BiDi sessions receive network events.
  }

  /** Notify automation that Fetch has completed a response. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-response-completed
  webDriverBiDiResponseCompleted(_request: FetchRequest, _response: FetchResponse): void {
    // PROVISIONAL: no BiDi sessions receive network events.
  }

  /** Notify automation that an identified navigation was canceled. */
  // PROVISIONAL: no WebDriver BiDi sessions exist to receive this notification.
  webDriverBiDiNavigationAborted(
    _navigable: Navigable | null,
    _status: { id: string; status: 'canceled'; url: URLRecord; },
  ): void {
    // Connect the BiDi navigation-aborted algorithm when sessions are implemented.
  }

  /*
   * Secure Contexts: Is origin potentially trustworthy?
   * https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
   */
  isOriginPotentiallyTrustworthy(origin: Origin): boolean {
    // Preserve an explicit trust decision when the origin has lost its tuple,
    // as with Browlet's file origins. Other opaque origins start untrusted.
    if (origin.kind === 'opaque') return origin.potentiallyTrustworthy;
    if (origin.scheme === 'https' || origin.scheme === 'wss') return true;

    const host = origin.host;
    if (host.kind === 'ipv4' && host.value >>> 24 === 127) return true;
    if (host.kind === 'ipv6' && host.pieces.every((piece, i) => piece === (i === 7 ? 1 : 0))) return true;

    // Fetch's resolveOrigin confines these names to loopback without DNS.
    // https://w3c.github.io/webappsec-secure-contexts/#localhost
    if (host.kind === 'domain' && (
      host.value === 'localhost' || host.value === 'localhost.' ||
      host.value.endsWith('.localhost') || host.value.endsWith('.localhost.')
    )) return true;

    if (origin.scheme === 'file' || this.authenticatedSchemes.has(origin.scheme)) return true;
    return this.trustworthyOrigins.some((trustedOrigin) => areSameOrigin(origin, trustedOrigin));
  }

  /*
   * Secure Contexts: Is url potentially trustworthy?
   * https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy
   */
  isURLPotentiallyTrustworthy(url: URLRecord): boolean {
    if (url.scheme === 'about' && (url.path === 'blank' || url.path === 'srcdoc')) return true;
    if (url.scheme === 'data') return true;
    return this.isOriginPotentiallyTrustworthy(obtainURLOrigin(url));
  }
}
