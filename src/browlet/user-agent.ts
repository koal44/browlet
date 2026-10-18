import { InternalError } from '../infra/internal-error';
import { internalType, type InternalPromise } from '../infra/promises';
import type { TimerHost } from '../infra/execution';
import { randomUUID } from '../js-engine/index';
import type { SelectletUserAgent } from '../selectlet/index';
import { percentageLiteral, type StyleletUserAgent } from '../stylelet/index';
import { decode } from '../encoding/index';
import {
  areSameOrigin, type Origin, type TupleOrigin, obtainURLOrigin, parseURL, URLImpl,
  type BlobURLEntry as URLBlobURLEntry, type URLParseResult, type URLRecord, type URLUserAgent,
} from '../url/index';
import { CookieStore } from '../http/index';
import type { StorageEnvironment, StorageUserAgent } from '../storage/index';
import type { MIMEType } from '../mime/index';
import type { BlobImpl } from '../file/index';
import {
  ConnectionPool, HTTPCacheStore, CORSPreflightCache, fetch, FetchRequest, isFilteredResponse, isOkStatus,
  type FetchEnvironment, type FetchController, type FetchResponse, type FetchUserAgent, type HTTPTransport,
  type Destination, type RequestInternalPriority, type ServiceWorkerTimingInfo,
} from '../fetch/index';

import { unsafeSharedCurrentTime } from './timing/index';
import type { CORSSettingsState } from './dom/nodes/html/attributes/index';
import { EventLoop, WindowAgent } from './scripting/index';
import { type ReportingEndpoint, ReportImpl } from './reporting/index';
import {
  PolicyContainer, HSTSStore, determineRequestReferrer, setRequestReferrerPolicyOnRedirect,
} from './browsing/policy/index';
import type { IntersectionObserverMargin } from './dom/intersection-observer/index';
import type { DocumentImpl } from './dom/nodes/index';
import { type BrowletEnvironment } from './environment';
import { HTTPAuthenticationStore } from './loader/index';
import { BrowsingContextGroup, type Navigable, type TopLevelTraversable } from './browsing/navigation/index';
import { NodeHTTPTransport, createContentDecoder, supportedContentCodings } from './integration/network/index';
import { BlobURLEntry, BlobURLStore } from './integration/file/index';
import {
  NodePromise, queueNodeTask, nodeTimerHost, browletDOM,
} from './integration/index';
import { createSandboxEnvironment, createWindowEnvironment } from './bindings';

/** Owns browsing contexts and shared browser services that outlive individual documents. */
export class UserAgent implements FetchUserAgent, StorageUserAgent, URLUserAgent, StyleletUserAgent, SelectletUserAgent {
  /** Implementation access shared by selector and style engines. */
  dom = browletDOM;
  /** Implementation used for Stylelet's internal stylesheet and resource URLs. */
  URL = URLImpl;
  /** Encoding's complete-input decoder used by stylesheet byte processing. */
  decodeText = decode;
  /** Related-context groups currently retained by this browser. */
  browsingContextGroupSet = new Set<BrowsingContextGroup>();
  /** Top-level windows or tabs owned by this browser. */
  topLevelTraversableSet = new Set<TopLevelTraversable>();
  /** Execution created with this user agent for work that can outlive pages. */
  sandbox: BrowletEnvironment;
  /** Browser binding factory used by browsing algorithms to create Window environments. */
  createWindowEnvironment = createWindowEnvironment;
  /** Background Fetch continuations outlive their initiating environments. */
  HostPromise = NodePromise;
  /** Background steps remain distinct from task delivery to a global. */
  runInParallel = queueNodeTask;
  /** Host wake-ups shared by this browser's globals; each global owns its timer state. */
  timerHost: TimerHost = nodeTimerHost;

  /** Default identification header value, shared by this user agent's environments. */
  // https://fetch.spec.whatwg.org/#default-user-agent-value
  defaultUserAgentValue = 'Mozilla/5.0 (compatible; Browlet)';
  /** Configured language preference; null leaves Accept-Language absent unless supplied or emulated. */
  defaultAcceptLanguage: string | null = null;
  /** Wire connections outlive individual documents and are closed by their browser owner. */
  connectionPool = new ConnectionPool();
  /** HTTP wire operations using the browser's shared connection pool. */
  httpTransport: HTTPTransport = new NodeHTTPTransport(this);
  /** Credentials and authentication challenges shared by this user agent's HTTP requests. */
  httpAuthentication = new HTTPAuthenticationStore(this);
  /** Native HTTP codecs, instantiated separately for each response. */
  supportedContentCodings = new Set(supportedContentCodings);
  /** Construct the decoder chain for one response's content codings. */
  createContentDecoder = createContentDecoder;
  /** Partitioned response storage shared across this browser's Fetches. */
  httpCache = new HTTPCacheStore();
  /** CORS permissions are owned independently of ordinary HTTP cache entries. */
  corsPreflightCache = new CORSPreflightCache();
  /** Stored cookies shared by this browser's documents and requests. */
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
  /** User preference for scripting; Browlet itself always has JavaScript support. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-environment-script
  scriptingEnabled = true;
  /** Scroll-container expansion used when a document creates its lazy-loading observer. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-root-margin
  // Implementation-defined: use WebKit's image-observer "100%" fallback until measurements justify tuning.
  lazyLoadScrollMargin: IntersectionObserverMargin = [
    percentageLiteral(100), percentageLiteral(100), percentageLiteral(100), percentageLiteral(100),
  ];
  /** Render-blocking cutoff in milliseconds from the relevant global's time origin. */
  // https://html.spec.whatwg.org/multipage/dom.html#render-blocked
  renderBlockingTimeout = 5000;
  /** Maximum age of queued reports in milliseconds; Reporting suggests about two days. */
  maxReportAge = 2 * 24 * 60 * 60 * 1000;
  /** Reporting endpoints are retired after exceeding this consecutive-failure count. */
  maxReportingEndpointFailures = 5;
  /** Whether network-dependent work should treat the browser as offline. */
  // PROVISIONAL: assumes connectivity until explicitly changed; host detection is not wired.
  assumeNoInternetConnectivity = false;
  /** Schemes whose tuple origins come from an authenticated protocol implementation. */
  // https://w3c.github.io/webappsec-secure-contexts/#packaged-applications
  authenticatedSchemes = new Set<string>();
  /** Development origins explicitly configured as potentially trustworthy. */
  // https://w3c.github.io/webappsec-secure-contexts/#development-environments
  trustworthyOrigins: TupleOrigin[] = [];

  constructor() {
    this.sandbox = createSandboxEnvironment(this);
  }

  /** Create an Agent with its own microtask queue and running browser event loop. */
  createWindowAgent(): WindowAgent {
    return new WindowAgent(new EventLoop({ requestTurn: queueNodeTask }));
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

  /** Refresh browser UI displaying URLs or derived data affected by this document's base URL. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes
  updateURLDisplays(_document: DocumentImpl): void {
    // PROVISIONAL: no browser UI is attached; retain this notification for a future UI host.
  }

  /** Generate a fresh canonical UUID for browser-owned registrations. */
  generateUUID(): string {
    return randomUUID();
  }

  /** Parse a browser URL and retain its Blob registration before revocation can remove it. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLParseResult {
    return parseURL(input, base, encoding, this);
  }

  /**
   * Create an element resource request using its interpreted CORS setting.
   * The calling HTML algorithm supplies the client and other resource-specific fields afterward.
   */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#create-a-potential-cors-request
  createPotentialCORSRequest(
    url: URLRecord, destination: Destination, corsAttributeState: CORSSettingsState,
    sameOriginFallback = false,
  ): FetchRequest {
    const request = new FetchRequest(url, null, this);
    request.destination = destination;
    request.mode = corsAttributeState === 'no-cors'
      ? sameOriginFallback ? 'same-origin' : 'no-cors'
      : 'cors';
    request.credentialsMode = corsAttributeState === 'anonymous' ? 'same-origin' : 'include';
    request.useURLCredentials = true;
    return request;
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
    return new PolicyContainer();
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
  potentiallyOverrideResponse(_request: FetchRequest, _env: FetchEnvironment): FetchResponse | null {
    // Fetch's default implementation lets the request proceed unchanged.
    return null;
  }

  /** Offer a request to a matching Service Worker, retaining completion on the browser's host queue. */
  // https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm
  handleFetch(
    _request: FetchRequest, _controller: FetchController, _useHighResPerformanceTimers: boolean,
    _prepareRequest: () => InternalPromise<FetchRequest>,
  ): InternalPromise<FetchResponse | ServiceWorkerTimingInfo | null> {
    // PROVISIONAL(Service Workers): no registrations or active workers exist yet.
    // Return without preparing an unused request/body branch.
    return this.HostPromise.try(() => null, internalType<FetchResponse | ServiceWorkerTimingInfo | null>());
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

  /** Group and queue copied reports using the generating global's endpoint configuration. */
  // https://w3c.github.io/reporting/#send-reports
  // Accept the endpoint list directly so delivery does not retain the generating environment.
  sendReports(reports: ReportImpl[], configuration: ReportingEndpoint[]): void {
    if (!this.reportDeliveryEnabled) return;
    const cutoff = Date.now() - this.maxReportAge;
    const endpointMap = new Map<ReportingEndpoint, ReportImpl[]>();
    for (const report of reports) {
      if (report.timestamp < cutoff) continue;
      const endpoint = configuration.find((candidate) => candidate.name === report.destination);
      if (endpoint === undefined || endpoint.failures > this.maxReportingEndpointFailures) continue;
      const group = endpointMap.get(endpoint);
      const copy = report.cloneForDelivery();
      if (group === undefined) endpointMap.set(endpoint, [copy]);
      else group.push(copy);
    }

    for (const [endpoint, group] of endpointMap) {
      const originGroups: [ReportImpl, ...ReportImpl[]][] = [];
      for (const report of group) {
        const originGroup = originGroups.find((candidate) => areSameOrigin(candidate[0].origin, report.origin));
        if (originGroup === undefined) originGroups.push([report]);
        else originGroup.push(report);
      }
      for (const originGroup of originGroups) {
        this.#queueReportDelivery(endpoint, originGroup[0].origin, originGroup, configuration);
      }
    }
  }

  /** Run browser-owned reporting work on a later host turn, yielding to runnable page tasks. */
  queueReportingTask(steps: () => void): void {
    queueNodeTask(() => {
      for (const group of this.browsingContextGroupSet) {
        for (const cluster of group.agentClusterMap.values()) {
          for (const agent of cluster.agents) {
            const { eventLoop } = agent;
            if (eventLoop.hasRunnableTasks()) {
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
    const result = this.HostPromise.withResolvers(internalType<ReportDeliveryResult>());
    // This clientless request has no Window to receive response callbacks.
    // The sandbox owns stream execution; the request retains the report's
    // original origin and remains clientless.
    fetch(request, {
      processResponse: (response) => {
        if (isOkStatus(response.status)) result.resolve('success');
        else if (response.status === 410) result.resolve('remove-endpoint');
        else result.resolve('failure');
        // Reporting uses only the status; no consumer will drain this body.
        const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
        internalResponse.discardBody?.();
      },
      useParallelQueue: true,
    }, this.sandbox);
    return result.promise;
  }

  /** Whether automation permits scripting for the given environment. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-scripting-is-enabled
  webDriverBiDiScriptingIsEnabled(_env: BrowletEnvironment): boolean {
    // PROVISIONAL: no BiDi sessions; select top-level traversable/user-context overrides when implemented.
    return true;
  }

  /** Whether automation emulates an offline network for the given environment. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-network-is-offline
  webDriverBiDiNetworkIsOffline(_env: BrowletEnvironment): boolean {
    // PROVISIONAL: no BiDi sessions; select scoped network conditions when implemented.
    return false;
  }

  /** Identification override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-user-agent
  webDriverBiDiEmulatedUserAgent(_env: BrowletEnvironment): string | null {
    // PROVISIONAL: no BiDi sessions; select scoped emulation when implemented.
    return null;
  }

  /** Language override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-language
  webDriverBiDiEmulatedLanguage(_env: BrowletEnvironment): string | null {
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

  // Secure Contexts: Is origin potentially trustworthy?
  // https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
  isOriginPotentiallyTrustworthy(origin: Origin): boolean {
    // Preserve an explicit trust decision when the origin has lost its tuple,
    // as with Browlet's file origins. Other opaque origins start untrusted.
    if (origin.kind === 'opaque') return origin.potentiallyTrustworthy;
    if (origin.scheme === 'https' || origin.scheme === 'wss') return true;

    const host = origin.host;
    if (host.kind === 'ipv4' && host.value >>> 24 === 127) return true;
    if (host.kind === 'ipv6' && host.pieces.every((piece, i) => piece === (i === 7 ? 1 : 0))) return true;

    // The Node transport confines these names to loopback without DNS.
    // https://w3c.github.io/webappsec-secure-contexts/#localhost
    if (host.kind === 'domain' && (
      host.value === 'localhost' || host.value === 'localhost.' ||
      host.value.endsWith('.localhost') || host.value.endsWith('.localhost.')
    )) return true;

    if (origin.scheme === 'file' || this.authenticatedSchemes.has(origin.scheme)) return true;
    return this.trustworthyOrigins.some((trustedOrigin) => areSameOrigin(origin, trustedOrigin));
  }

  // Secure Contexts: Is url potentially trustworthy?
  // https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy
  isURLPotentiallyTrustworthy(url: URLRecord): boolean {
    if (url.scheme === 'about' && (url.path === 'blank' || url.path === 'srcdoc')) return true;
    if (url.scheme === 'data') return true;
    return this.isOriginPotentiallyTrustworthy(obtainURLOrigin(url));
  }

  /** Retain copied reports and their original endpoint configuration until delivery finishes. */
  #queueReportDelivery(
    endpoint: ReportingEndpoint, origin: Origin, reports: ReportImpl[],
    configuration: ReportingEndpoint[],
  ): void {
    this.queueReportingTask(() => {
      if (!this.reportDeliveryEnabled) return;
      if (endpoint.failures > this.maxReportingEndpointFailures) {
        const index = configuration.indexOf(endpoint);
        if (index !== -1) configuration.splice(index, 1);
      }
      if (!configuration.includes(endpoint)) return;
      const cutoff = Date.now() - this.maxReportAge;
      const currentReports = reports.filter((report) => report.timestamp >= cutoff);
      if (currentReports.length === 0) return;
      this.attemptReportDelivery(endpoint, origin, currentReports).observe((result) => {
        if (result === 'success') {
          endpoint.failures = 0;
        } else if (result === 'remove-endpoint') {
          const index = configuration.indexOf(endpoint);
          if (index !== -1) configuration.splice(index, 1);
        } else {
          endpoint.failures++;
        }
        // The draft leaves retries unresolved. Finishing this callback releases
        // the attempt; later reports may still use a surviving endpoint.
      }, (error) => { throw error; });
    });
  }
}

/** Outcome of one delivery attempt; the caller applies endpoint bookkeeping. */
export type ReportDeliveryResult = 'success' | 'remove-endpoint' | 'failure';
