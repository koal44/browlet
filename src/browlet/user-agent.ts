import { BrowsingContextGroup } from './browsing/browsing-context';
import type { TopLevelTraversable } from './browsing/navigable';
import type { EventLoopOptions } from './scripting/event-loop';
import { ConnectionPool, HTTPCachePartitions, type FetchUserAgent } from '../fetch/index';
import { areSameOrigin, type Origin, type TupleOrigin } from '../url/origin';
import { obtainURLOrigin, type URLRecord } from '../url/url';

/*
 * HTML's user agent owns browsing context groups and the top-level
 * traversables normally presented as browser windows or tabs. Browlet is one
 * such host, but these collections outlive any individual realm or Document.
 */
export class UserAgent implements FetchUserAgent {
  browsingContextGroupSet = new Set<BrowsingContextGroup>();
  topLevelTraversableSet = new Set<TopLevelTraversable>();
  eventLoopOptions: EventLoopOptions | null;

  connectionPool = new ConnectionPool();
  httpCachePartitions = new HTTPCachePartitions();
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
      throw new Error('A nonempty browsing context group cannot be removed');
    }

    this.browsingContextGroupSet.delete(group);
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
