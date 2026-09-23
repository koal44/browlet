import { BrowsingContextGroup } from './browsing/browsing-context';
import type { Navigable, TopLevelTraversable } from './browsing/navigable';
import type { Environment } from './scripting/environment';
import { createPolicyContainer, type PolicyContainer } from './browsing/policy/container';
import type { EventLoopOptions } from './scripting/event-loop';
import { hostPromises, requestNodeEventLoopTurn } from './integration/scripting';
import type { ReportingEndpoint } from './reporting/endpoint';
import { ReportImpl } from './reporting/report';
import type { ReportDeliveryResult } from './reporting/delivery';
import {
  ConnectionPool, HTTPCachePartitions, fetch, FetchRequest, isOkStatus, type FetchUserAgent,
} from '../fetch/index';
import { CookieStore } from '../http/index';
import { areSameOrigin, type Origin, type TupleOrigin, obtainURLOrigin, type URLRecord } from '../url/index';
import { InternalError } from '../infra/internal-error';
import type { PromiseValue } from '../infra/promises';

/*
 * HTML's user agent owns browsing context groups and the top-level
 * traversables normally presented as browser windows or tabs. Browlet is one
 * such host, but these collections outlive any individual realm or Document.
 */
export class UserAgent implements FetchUserAgent {
  browsingContextGroupSet = new Set<BrowsingContextGroup>();
  topLevelTraversableSet = new Set<TopLevelTraversable>();
  eventLoopOptions: EventLoopOptions | null;

  /** Default identification header value, shared by this user agent's environments. */
  // https://fetch.spec.whatwg.org/#default-user-agent-value
  defaultUserAgentValue = 'Mozilla/5.0 (compatible; Browlet)';
  connectionPool = new ConnectionPool();
  httpCachePartitions = new HTTPCachePartitions();
  cookieStore = new CookieStore();
  /** Browser-owned Blob URL storage used by environment teardown. */
  // PROVISIONAL: the storage-keys/Blob-URLs detour will supply the real store.
  blobURLStore = {
    removeForEnvironment(_environment: Environment): void {
      // No Blob URLs are registered until their store is implemented.
    },
  };
  /** Controls both sending and accepting cookies without clearing the store. */
  cookiesEnabled = true;
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

  constructor(eventLoopOptions: EventLoopOptions | null = null) {
    this.eventLoopOptions = eventLoopOptions;
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

  /** Create a fresh HTML policy container, including for clientless Fetch requests. */
  createPolicyContainer(): PolicyContainer {
    return createPolicyContainer();
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
  ): PromiseValue<ReportDeliveryResult> {
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
    fetch(request, {
      processResponse: (response) => {
        if (isOkStatus(response.status)) result.resolve('success');
        else if (response.status === 410) result.resolve('remove-endpoint');
        else result.resolve('failure');
      },
      useParallelQueue: true,
    });
    return result.promise;
  }

  /** Whether automation emulates an offline network for the given environment. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-network-is-offline
  webDriverBiDiNetworkIsOffline(_environment: Environment): boolean {
    // PROVISIONAL: no BiDi sessions; select scoped network conditions when implemented.
    return false;
  }

  /** Identification override selected for the given environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-user-agent
  webDriverBiDiEmulatedUserAgent(_environment: Environment): string | null {
    // PROVISIONAL: no BiDi sessions; select scoped emulation when implemented.
    return null;
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
