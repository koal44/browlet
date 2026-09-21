import type { BlobImpl } from '../file/index';
import { HTTPCookie, type CookieSameSiteMode } from '../http/index';
import { type AbortSignalCapability, type RuntimeContext, isomorphicEncode } from '../js-engine/index';
import type { PromiseValue } from '../infra/promises';
import { TypeError } from '../infra/exceptions';
import { createReadableStreamProxy, type ReadableStreamImpl } from '../streams/index';
import {
  areSameOrigin, areSameSite, serializeOrigin, type Origin, copyURL, obtainURLOrigin, parseURL,
  serializeURL, type URLRecord,
} from '../url/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface,
  defineTypedef, dictMember, emptyDictionary, idlType, impl, nullable,
  op, reference, roAttr, union, xattr,
} from '../web-idl/index';
import type { FormDataImpl } from '../xhr/index';
import { BodyMixin, FetchBody, type BodyInitValue } from './body';
import { FetchHeaders, HeadersImpl, type HeadersGuard, type HeadersInitValue } from './headers';
import {
  getFetchEnvironmentSettingsObject, serializeInteger,
  type FetchEnvironmentSettingsObject, type FetchEnvironment, type FetchUserAgent,
  type FetchPolicyContainer, type FetchPromptTarget, type ReferrerPolicy,
} from './infrastructure';
import { isCORSSafelistedMethod, isForbiddenMethod, isMethod, normalizeMethod } from './http/methods';
import { determineNetworkPartitionKey, type NetworkPartitionKey } from './http/network-partition';
import { InternalError } from '../infra/internal-error';

/** Fetch §2.2.5. URL, client, and user agent are required inputs; the other fields have defaults. */
export class FetchRequest {
  /** HTTP method as a byte string; recognized standard methods use their canonical casing. */
  method = 'GET';
  /** Restricts fetching to local schemes such as about, blob, and data. */
  localURLsOnly = false;
  /** Ordered request headers shared with the projected Headers implementation. */
  headerList = new FetchHeaders();
  /** Enables CORS preflight checks for author-supplied methods and headers. */
  unsafeRequest = false;
  /** Extracted body, bytes awaiting extraction, or null when no body is present. */
  body: Uint8Array | FetchBody | null = null;
  /** Initiating environment settings, or null for a request without an environment client. */
  client: FetchEnvironmentSettingsObject | null;
  /** The shared networking owner, including for requests without a client. */
  userAgent: FetchUserAgent;
  /** Destination environment reserved for a navigation or worker, before it becomes active. */
  reservedClient: FetchEnvironment | null = null;
  /** Environment ID replaced by a navigation, or an empty string when none is designated. */
  replacesClientId = '';
  /** Prompt destination, undefined until selected from the client, or null to suppress prompts. */
  traversableForUserPrompts: FetchPromptTarget | null | undefined = undefined;
  /** Allows the request to continue after its initiating environment is destroyed. */
  keepalive = false;
  /** Initiating feature reported by Resource Timing, or null when unspecified. */
  initiatorType: RequestInitiator | null = null;
  /** Whether relevant service workers may intercept the request. */
  // https://fetch.spec.whatwg.org/#request-service-workers-mode (all = true, none = false)
  allowServiceWorkerInterception = true;
  /** Initiator category used by policies such as CSP and Mixed Content. */
  initiator: RequestInitiatorCategory = '';
  /** Intended resource use; an empty string denotes a general-purpose fetch, not an unset value. */
  destination: Destination = '';
  /** Scheduling hint supplied by the caller; auto leaves the choice to the user agent. */
  priority: RequestPriority = 'auto';
  /** Scheduler-owned priority state, or null before a scheduler assigns it. */
  internalPriority: RequestInternalPriority | null = null;
  /** Origin used for request policy; undefined until resolved from the initiating environment. */
  origin: Origin | undefined = undefined;
  /** Origin initiating a top-level navigation; null denotes browser initiation. */
  topLevelNavigationInitiatorOrigin: Origin | null = null;
  /** Policies attached to the request; undefined until taken from its environment. */
  policyContainer: FetchPolicyContainer | undefined = undefined;
  /** Referrer URL, null to omit it, or undefined until the client supplies the source. */
  referrer: URLRecord | null | undefined = undefined;
  // Referrer Policy supplies the enum declaration at the browser composition root.
  /** Policy controlling referrer disclosure; an empty string leaves it to the client policy. */
  referrerPolicy: ReferrerPolicy = '';
  /** Fetch mode governing origin restrictions, CORS processing, and response exposure. */
  mode: FetchMode = 'no-cors';
  /** Requires preflight when CORS processing applies, even for otherwise safelisted input. */
  useCORSPreflight = false;
  /** Controls sending credentials and accepting credentials from the response. */
  credentialsMode: RequestCredentials = 'same-origin';
  /** Prefers the URL's username and password over an existing authentication entry. */
  useURLCredentials = false;
  /** Policy for consulting, validating, and updating the HTTP cache. */
  cacheMode: RequestCache = 'default';
  /** Whether redirects are followed, rejected, or exposed for manual handling. */
  redirectMode: RequestRedirect = 'follow';
  /** Subresource Integrity metadata used to verify the response body. */
  integrityMetadata = '';
  /** Initiating element's nonce supplied to Content Security Policy checks. */
  cryptographicNonceMetadata = '';
  /** Whether the initiating element was parser-inserted; undefined when no metadata was supplied. */
  parserInserted: boolean | undefined = undefined;
  /** Marks a navigation caused by reloading the current document. */
  reloadNavigation = false;
  /** Marks a navigation caused by session-history traversal. */
  historyNavigation = false;
  /** Whether the initiating navigation carries user activation. */
  userActivation = false;
  /** WebDriver identifier for the navigation, distinct from this request's own ID. */
  webDriverNavigationId: string | null = null;
  /** Whether this request participates in HTML's render-blocking mechanism. */
  renderBlocking = false;
  /** Accepted server-certificate hashes for a WebTransport connection. */
  webTransportHashList: WebTransportHash[] = [];
  /** Initial URL followed by redirect targets; the last entry is the current URL. */
  urlList: [URLRecord, ...URLRecord[]];
  /** Number of redirects followed, used to enforce the redirect limit. */
  redirectCount = 0;
  /** Response filtering selected as origin and CORS processing progresses. */
  responseTainting: ResponseTainting = 'basic';
  /** Suppresses automatic Cache-Control: max-age=0 when cache mode is no-cache. */
  preventNoCacheCacheControlHeaderModification = false;
  /** Marks completion of the fetch's response end-of-body processing. */
  done = false;
  /** Remembers a failed timing-allow check across the request's redirect chain. */
  timingAllowFailed = false;
  /** Timing-Allow-Origin values from each redirect response in a navigation. */
  navigationTimingAllowValuesList: string[][] = [];
  /** Unique request identifier for WebDriver; cloning generates a fresh identifier. */
  webDriverId: string = crypto.randomUUID();

  constructor(url: URLRecord, client: FetchEnvironmentSettingsObject | null, userAgent: FetchUserAgent) {
    this.urlList = [copyURL(url)];
    this.client = client;
    this.userAgent = userAgent;
  }

  get url(): URLRecord {
    return this.urlList[0];
  }

  get currentURL(): URLRecord {
    return this.urlList[this.urlList.length - 1]!;
  }

  /** https://fetch.spec.whatwg.org/#subresource-request */
  get isSubresource(): boolean {
    return subresourceDestinations.has(this.destination);
  }

  /** https://fetch.spec.whatwg.org/#non-subresource-request */
  get isNonSubresource(): boolean {
    return nonSubresourceDestinations.has(this.destination);
  }

  /** https://fetch.spec.whatwg.org/#navigation-request */
  get isNavigation(): boolean {
    return navigationDestinations.has(this.destination);
  }

  /** https://fetch.spec.whatwg.org/#concept-request-tainted-origin */
  get redirectTaint(): RedirectTaint {
    if (this.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
    let lastURL: URLRecord | null = null;
    let taint: 'same-origin' | 'same-site' = 'same-origin';
    for (const url of this.urlList) {
      if (lastURL === null) {
        lastURL = url;
        continue;
      }
      const origin = obtainURLOrigin(url);
      const lastOrigin = obtainURLOrigin(lastURL);
      if (!areSameSite(origin, lastOrigin) && !areSameSite(this.origin, lastOrigin)) {
        return 'cross-site';
      }
      if (!areSameOrigin(origin, lastOrigin) && !areSameOrigin(this.origin, lastOrigin)) {
        taint = 'same-site';
      }
      lastURL = url;
    }
    return taint;
  }

  /** https://fetch.spec.whatwg.org/#serializing-a-request-origin */
  serializeOrigin(): string {
    if (this.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
    return this.redirectTaint === 'same-origin' ? serializeOrigin(this.origin) : 'null';
  }

  /** https://fetch.spec.whatwg.org/#byte-serializing-a-request-origin */
  byteSerializeOrigin(): Uint8Array<ArrayBuffer> {
    return isomorphicEncode(this.serializeOrigin());
  }

  /** https://fetch.spec.whatwg.org/#concept-request-clone */
  clone(): FetchRequest {
    const request = new FetchRequest(this.url, this.client, this.userAgent);
    for (let i = 1; i < this.urlList.length; i++) request.urlList.push(copyURL(this.urlList[i]!));
    return Object.assign(request, this, {
      webDriverId: request.webDriverId,
      headerList: this.headerList.clone(),
      urlList: request.urlList,
      referrer: this.referrer && copyURL(this.referrer),
      webTransportHashList: this.webTransportHashList.map(({ algorithm, value }) => ({ algorithm, value: new Uint8Array(value) })),
      navigationTimingAllowValuesList: this.navigationTimingAllowValuesList.map((values) => [...values]),
      // Before body extraction, a byte sequence is copied as a value; a body tees its stream.
      body: this.body === null ? null : this.body instanceof FetchBody ? this.body.clone() : new Uint8Array(this.body),
    });
  }

  /** https://fetch.spec.whatwg.org/#concept-request-add-range-header */
  addRangeHeader(first: number | bigint, last?: number | bigint): void {
    if (last !== undefined && first > last) throw new InternalError('Range start exceeds its end');
    const value = `bytes=${serializeInteger(first)}-${last === undefined ? '' : serializeInteger(last)}`;
    this.headerList.append('Range', value);
  }

  /** https://fetch.spec.whatwg.org/#cross-origin-embedder-policy-allows-credentials */
  crossOriginEmbedderPolicyAllowsCredentials(): boolean {
    if (this.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
    if (this.mode !== 'no-cors' || this.client === null) return true;
    if (this.client.policyContainer.embedderPolicy.value !== 'credentialless') return true;
    return areSameOrigin(this.origin, obtainURLOrigin(this.currentURL)) &&
      this.redirectTaint === 'same-origin';
  }

  /** https://fetch.spec.whatwg.org/#request-determine-the-network-partition-key */
  determineNetworkPartitionKey(): NetworkPartitionKey | null {
    const environment = this.reservedClient ?? this.client;
    return environment === null ? null : determineNetworkPartitionKey(environment);
  }

  /** Appends the cookies selected for this request from the owning user agent's store. */
  // https://fetch.spec.whatwg.org/#append-a-request-cookie-header
  appendCookieHeader(): void {
    if (!this.userAgent.cookiesEnabled) return;
    const { scheme, host, path } = this.currentURL;
    if (host === null || host.kind === 'empty' || host.kind === 'opaque') return;
    const cookies = this.userAgent.cookieStore.retrieveCookies(
      scheme === 'https', host, path, true, this.determineSameSiteMode(), laxAllowingUnsafeMaxAge,
    );
    if (cookies.length !== 0) this.headerList.append('Cookie', HTTPCookie.serialize(cookies));
  }

  /** Selects sending restrictions, including Lax-by-default for unspecified SameSite. */
  // https://fetch.spec.whatwg.org/#determine-the-same-site-mode
  // Follow browser classification: same-site navigations allow Strict; only top-level
  // cross-site navigations receive Lax/temporarily unset cookies. Response storage differs.
  determineSameSiteMode(): CookieSameSiteMode {
    if (this.isSameSiteForCookies) return 'strict-or-less';
    if (this.destination !== 'document') return 'none';
    return safeMethods.has(this.method) ? 'lax-or-less' : 'unset-or-less';
  }

  /** Whether the initiator and client ancestry are same-site with the current URL. */
  // Chromium's default does not taint this decision with earlier redirect hops.
  // Fetch's redirectTaint still serves its separate origin/credentials algorithms.
  get isSameSiteForCookies(): boolean {
    let initiator: Origin | null;
    if (this.destination === 'document') {
      // No initiator denotes browser-initiated navigation, not a clientless subresource.
      initiator = this.topLevelNavigationInitiatorOrigin;
    } else {
      if (this.client === null || this.client.hasCrossSiteAncestor) return false;
      initiator = this.client.origin;
    }
    const targetOrigin = obtainURLOrigin(this.currentURL);
    return initiator === null || areSameSite(initiator, targetOrigin);
  }

  /** Appends the request origin, applying redirect taint and non-CORS disclosure policy. */
  // https://fetch.spec.whatwg.org/#append-a-request-origin-header
  appendOriginHeader(): void {
    if (this.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
    let serializedOrigin = this.serializeOrigin();
    if (this.responseTainting === 'cors' || this.mode === 'websocket' || this.mode === 'webtransport') {
      this.headerList.append('Origin', serializedOrigin);
      return;
    }
    if (this.method === 'GET' || this.method === 'HEAD') return;

    if (this.mode !== 'cors') {
      switch (this.referrerPolicy) {
        case 'no-referrer':
          serializedOrigin = 'null';
          break;
        case 'no-referrer-when-downgrade':
        case 'strict-origin':
        case 'strict-origin-when-cross-origin':
          if (this.origin.kind === 'tuple' && this.origin.scheme === 'https' && this.currentURL.scheme !== 'https') {
            serializedOrigin = 'null';
          }
          break;
        case 'same-origin':
          if (!areSameOrigin(this.origin, obtainURLOrigin(this.currentURL))) serializedOrigin = 'null';
          break;
      }
    }
    this.headerList.append('Origin', serializedOrigin);
  }
}

/** https://fetch.spec.whatwg.org/#request-destination-script-like */
export function isScriptLikeDestination(destination: Destination): boolean {
  return scriptLikeDestinations.has(destination);
}

/** https://fetch.spec.whatwg.org/#concept-potential-destination-translate */
export function translatePotentialDestination(destination: PotentialDestination): Destination {
  return destination === 'fetch' ? '' : destination;
}

const scriptLikeDestinations = new Set<Destination>([
  'audioworklet', 'paintworklet', 'script', 'serviceworker', 'sharedworker', 'worker',
]);
const subresourceDestinations = new Set<Destination>([
  '', 'audio', 'audioworklet', 'font', 'image', 'json', 'manifest', 'paintworklet',
  'script', 'style', 'text', 'track', 'video', 'xslt',
]);
const nonSubresourceDestinations = new Set<Destination>([
  'document', 'embed', 'frame', 'iframe', 'object', 'report', 'serviceworker', 'sharedworker', 'worker',
]);
const navigationDestinations = new Set<Destination>(['document', 'embed', 'frame', 'iframe', 'object']);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
// Chromium's Lax-allowing-unsafe compatibility window for recently created default cookies.
const laxAllowingUnsafeMaxAge = 2 * 60 * 1000;

/*
 * typedef (Request or USVString) RequestInfo;
 *
 * [Exposed=(Window,Worker)]
 * interface Request {
 *   constructor(RequestInfo input, optional RequestInit init = {});
 *
 *   readonly attribute ByteString method;
 *   readonly attribute USVString url;
 *   [SameObject] readonly attribute Headers headers;
 *
 *   readonly attribute RequestDestination destination;
 *   readonly attribute USVString referrer;
 *   readonly attribute ReferrerPolicy referrerPolicy;
 *   readonly attribute RequestMode mode;
 *   readonly attribute RequestCredentials credentials;
 *   readonly attribute RequestCache cache;
 *   readonly attribute RequestRedirect redirect;
 *   readonly attribute DOMString integrity;
 *   readonly attribute boolean keepalive;
 *   readonly attribute boolean isReloadNavigation;
 *   readonly attribute boolean isHistoryNavigation;
 *   readonly attribute AbortSignal signal;
 *   readonly attribute RequestDuplex duplex;
 *
 *   [NewObject] Request clone();
 * };
 * Request includes Body;
 *
 * dictionary RequestInit {
 *   ByteString method;
 *   HeadersInit headers;
 *   BodyInit? body;
 *   USVString referrer;
 *   ReferrerPolicy referrerPolicy;
 *   RequestMode mode;
 *   RequestCredentials credentials;
 *   RequestCache cache;
 *   RequestRedirect redirect;
 *   DOMString integrity;
 *   boolean keepalive;
 *   AbortSignal? signal;
 *   RequestDuplex duplex;
 *   RequestPriority priority;
 *   any window; // can only be set to null
 * };
 *
 * enum RequestDestination {
 *   "", "audio", "audioworklet", "document", "embed", "font", "frame", "iframe",
 *   "image", "json", "manifest", "object", "paintworklet", "report", "script",
 *   "sharedworker", "style", "text", "track", "video", "worker", "xslt"
 * };
 * enum RequestMode { "navigate", "same-origin", "no-cors", "cors" };
 * enum RequestCredentials { "omit", "same-origin", "include" };
 * enum RequestCache { "default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached" };
 * enum RequestRedirect { "follow", "error", "manual" };
 * enum RequestDuplex { "half" };
 * enum RequestPriority { "high", "low", "auto" };
 */
export class RequestImpl {
  /** Internal request state represented by this platform Request. */
  #request: FetchRequest;
  /** Stable Headers implementation sharing the request's list and enforcing its guard. */
  #headers: HeadersImpl;
  /** Abort signal associated with this Request. */
  #signal: AbortSignalCapability;
  /** Body operations reading this request's current body and headers. */
  #bodyMixin: BodyMixin;
  /** Owner's execution, allocation, and abort-construction facilities. */
  #runtime: RuntimeContext;

  // Internal allocation from a request, guard, and DOM-owned signal.
  // https://fetch.spec.whatwg.org/#request-create
  constructor(
    request: FetchRequest, guard: HeadersGuard, signal: AbortSignalCapability, runtime: RuntimeContext,
  ) {
    this.#request = request;
    this.#headers = new HeadersImpl(request.headerList, guard);
    this.#signal = signal;
    this.#bodyMixin = new BodyMixin(request, runtime);
    this.#runtime = runtime;
  }

  /** Construct a Request from converted author arguments and its relevant settings. */
  // https://fetch.spec.whatwg.org/#dom-request
  static create(
    input: FetchRequestInfo, init: FetchRequestInit,
    client: FetchEnvironmentSettingsObject, runtime: RuntimeContext,
  ): RequestImpl {
    const baseURL = client.apiBaseURL;
    let source: FetchRequest;
    let fallbackMode: RequestMode | null = null;
    let signal: AbortSignalCapability | null = null;
    if (typeof input === 'string') {
      const url = parseURL(input, baseURL).url;
      if (url === null) throw new TypeError('Invalid Request URL');
      if (url.username !== '' || url.password !== '') throw new TypeError('Request URLs cannot include credentials');
      source = new FetchRequest(url, client, client.userAgent);
      fallbackMode = 'cors';
    } else {
      source = input.#request;
      signal = input.#signal;
    }

    const origin = client.origin;
    let traversable: FetchRequest['traversableForUserPrompts'] = undefined;
    if (source.traversableForUserPrompts &&
      areSameOrigin(source.traversableForUserPrompts.origin, origin)) {
      traversable = source.traversableForUserPrompts;
    }
    if ('window' in init) {
      if (init.window !== null) throw new TypeError('RequestInit.window must be null');
      traversable = null;
    }

    const request = new FetchRequest(source.url, client, client.userAgent);
    request.method = source.method;
    request.headerList = source.headerList.clone();
    request.unsafeRequest = true;
    request.traversableForUserPrompts = traversable;
    request.internalPriority = source.internalPriority;
    request.origin = source.origin;
    request.referrer = source.referrer && copyURL(source.referrer);
    request.referrerPolicy = source.referrerPolicy;
    request.mode = source.mode;
    request.credentialsMode = source.credentialsMode;
    request.cacheMode = source.cacheMode;
    request.redirectMode = source.redirectMode;
    request.integrityMetadata = source.integrityMetadata;
    request.keepalive = source.keepalive;
    request.reloadNavigation = source.reloadNavigation;
    request.historyNavigation = source.historyNavigation;
    request.urlList = source.urlList.map(copyURL) as [URLRecord, ...URLRecord[]];
    request.initiatorType = 'fetch';

    const hasInit = Object.keys(init).length > 0;
    if (hasInit) {
      if (request.mode === 'navigate') request.mode = 'same-origin';
      request.reloadNavigation = false;
      request.historyNavigation = false;
      request.origin = undefined;
      request.referrer = undefined;
      request.referrerPolicy = '';
      request.urlList = [request.currentURL];
    }
    if (init.referrer !== undefined) {
      if (init.referrer === '') {
        request.referrer = null;
      } else {
        const referrer = parseURL(init.referrer, baseURL).url;
        if (referrer === null) throw new TypeError('Invalid Request referrer');
        request.referrer = (referrer.scheme === 'about' && referrer.path === 'client') ||
          !areSameOrigin(obtainURLOrigin(referrer), origin) ? undefined : referrer;
      }
    }
    if (init.referrerPolicy !== undefined) request.referrerPolicy = init.referrerPolicy;
    const mode = init.mode ?? fallbackMode;
    if (mode === 'navigate') throw new TypeError('Request mode cannot be navigate');
    if (mode !== null) request.mode = mode;
    if (init.credentials !== undefined) request.credentialsMode = init.credentials;
    if (init.cache !== undefined) request.cacheMode = init.cache;
    if (request.cacheMode === 'only-if-cached' && request.mode !== 'same-origin') {
      throw new TypeError('only-if-cached requires same-origin mode');
    }
    if (init.redirect !== undefined) request.redirectMode = init.redirect;
    if (init.integrity !== undefined) request.integrityMetadata = init.integrity;
    if (init.keepalive !== undefined) request.keepalive = init.keepalive;
    if (init.method !== undefined) {
      if (!isMethod(init.method) || isForbiddenMethod(init.method)) throw new TypeError('Invalid Request method');
      request.method = normalizeMethod(init.method);
    }
    if (init.signal !== undefined) signal = init.signal;
    if (init.priority !== undefined) {
      if (request.internalPriority !== null) request.internalPriority.update(init.priority);
      else request.priority = init.priority;
    }

    const result = new RequestImpl(
      request, 'request', runtime.createDependentAbortSignal(signal === null ? [] : [signal]), runtime,
    );
    if (request.mode === 'no-cors') {
      if (!isCORSSafelistedMethod(request.method)) throw new TypeError('Invalid method for no-cors mode');
      result.#headers.guard = 'request-no-cors';
    }
    if (hasInit) {
      const headers = init.headers ?? [...request.headerList.list];
      request.headerList.list.length = 0;
      result.#headers.fill(headers);
    }

    const inputBody = typeof input === 'string' ? null : input.#bodyMixin.getBody();
    const bodyInit = init.body ?? null;
    if ((bodyInit !== null || inputBody !== null) && (request.method === 'GET' || request.method === 'HEAD')) {
      throw new TypeError('GET and HEAD requests cannot have a body');
    }
    let initBody: FetchBody | null = null;
    if (bodyInit !== null) {
      const extracted = FetchBody.extract(bodyInit, request.keepalive, runtime);
      initBody = extracted.body;
      if (extracted.type !== null && !request.headerList.has('Content-Type')) {
        result.#headers.append('Content-Type', extracted.type);
      }
    }
    let body = initBody ?? inputBody;
    if (body !== null && body.source === null) {
      if (initBody !== null && init.duplex === undefined) throw new TypeError('Streaming requests require duplex');
      if (request.mode !== 'same-origin' && request.mode !== 'cors') {
        throw new TypeError('Streaming requests require same-origin or cors mode');
      }
      request.useCORSPreflight = true;
    }
    if (initBody === null && inputBody !== null) {
      if (inputBody.stream.disturbed || inputBody.stream.locked) throw new TypeError('Request body is disturbed or locked');
      body = new FetchBody(createReadableStreamProxy(inputBody.stream, runtime), runtime);
      body.source = inputBody.source;
      body.length = inputBody.length;
    }
    request.body = body;
    return result;
  }

  get method(): string { return this.#request.method; }
  get url(): string { return serializeURL(this.#request.url); }
  get headers(): HeadersImpl { return this.#headers; }
  get destination(): Destination { return this.#request.destination; }

  get referrer(): string {
    const referrer = this.#request.referrer;
    if (referrer === null) return '';
    if (referrer === undefined) return 'about:client';
    return serializeURL(referrer);
  }

  get referrerPolicy(): ReferrerPolicy { return this.#request.referrerPolicy; }
  get mode(): FetchMode { return this.#request.mode; }
  get credentials(): RequestCredentials { return this.#request.credentialsMode; }
  get cache(): RequestCache { return this.#request.cacheMode; }
  get redirect(): RequestRedirect { return this.#request.redirectMode; }
  get integrity(): string { return this.#request.integrityMetadata; }
  get keepalive(): boolean { return this.#request.keepalive; }
  get isReloadNavigation(): boolean { return this.#request.reloadNavigation; }
  get isHistoryNavigation(): boolean { return this.#request.historyNavigation; }
  get signal(): AbortSignalCapability { return this.#signal; }
  get duplex(): RequestDuplex { return 'half'; }

  // https://fetch.spec.whatwg.org/#dom-request-clone
  clone(): RequestImpl {
    if (this.#bodyMixin.unusable) throw new TypeError('Request body is disturbed or locked');
    const request = this.#request.clone();
    const signal = this.#runtime.createDependentAbortSignal([this.#signal]);
    return new RequestImpl(request, this.#headers.guard, signal, this.#runtime);
  }

  get body(): ReadableStreamImpl | null { return this.#bodyMixin.body; }
  get bodyUsed(): boolean { return this.#bodyMixin.bodyUsed; }
  arrayBuffer(): PromiseValue<Uint8Array> { return this.#bodyMixin.arrayBuffer(); }
  blob(): PromiseValue<BlobImpl> { return this.#bodyMixin.blob(); }
  bytes(): PromiseValue<Uint8Array> { return this.#bodyMixin.bytes(); }
  formData(): PromiseValue<FormDataImpl> { return this.#bodyMixin.formData(); }
  json(): PromiseValue<unknown> { return this.#bodyMixin.json(); }
  text(): PromiseValue<string> { return this.#bodyMixin.text(); }
  textStream(): ReadableStreamImpl { return this.#bodyMixin.textStream(); }

  // -- Internal ---------------------------------------------------------

  getRequest(): FetchRequest { return this.#request; }
}

export type RequestInitiator = 'audio' | 'beacon' | 'body' | 'css' | 'early-hints' |
  'embed' | 'fetch' | 'font' | 'frame' | 'iframe' | 'image' | 'img' | 'input' | 'link' |
  'object' | 'ping' | 'script' | 'track' | 'video' | 'xmlhttprequest' | 'other';

// https://fetch.spec.whatwg.org/#concept-request-initiator
export type RequestInitiatorCategory = '' | 'download' | 'imageset' | 'manifest' | 'prefetch' | 'prerender' | 'xslt';

/** Fetch's internal destination type includes values outside the public Web IDL enum. */
export type Destination = RequestDestination | 'serviceworker' | 'webidentity';

export type RequestDestination = EmptyDestination | 'audio' | 'audioworklet' | 'document' | 'embed' |
  'font' | 'frame' | 'iframe' | 'image' | 'json' | 'manifest' | 'object' | 'paintworklet' |
  'report' | 'script' | 'sharedworker' | 'style' | 'text' | 'track' | 'video' | 'worker' | 'xslt';

/**
 * No specific resource destination, as with fetch(), XHR, and beacons; not an uninitialized value.
 * https://fetch.spec.whatwg.org/#concept-request-destination
 */
export type EmptyDestination = '';

/** https://fetch.spec.whatwg.org/#concept-potential-destination */
export type PotentialDestination = 'fetch' | Exclude<Destination, EmptyDestination>;

export type RequestMode = 'navigate' | 'same-origin' | 'no-cors' | 'cors';
export type FetchMode = RequestMode | 'websocket' | 'webtransport';
export type RequestCredentials = 'omit' | 'same-origin' | 'include';
export type RequestCache = 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
export type RequestRedirect = 'follow' | 'error' | 'manual';
export type RequestDuplex = 'half';
export type RequestPriority = 'high' | 'low' | 'auto';
export type ResponseTainting = 'basic' | 'cors' | 'opaque';
export type RedirectTaint = 'same-origin' | 'same-site' | 'cross-site';
/** Priority assigned by Fetch scheduling; updates retain the scheduler's representation. */
export type RequestInternalPriority = { update(priority: RequestPriority): void; };
export type WebTransportHash = {
  /** Hash algorithm used to identify the expected server certificate. */
  algorithm: string;
  /** Expected certificate digest bytes. */
  value: Uint8Array;
};

/** Converted RequestInfo: an existing Request implementation or a URL string. */
export type FetchRequestInfo = RequestImpl | string;
export type FetchRequestInit = {
  /** HTTP method overriding the input request's method. */
  method?: string;
  /** Header entries replacing the input request's header list. */
  headers?: HeadersInitValue;
  /** Replacement body input; null leaves an input Request's body available for reuse. */
  body?: BodyInitValue | null;
  /** Referrer override; an empty string suppresses it and about:client selects the client. */
  referrer?: string;
  /** Policy overriding how much referrer information may be sent. */
  referrerPolicy?: ReferrerPolicy;
  /** Origin and CORS mode for the new request. */
  mode?: RequestMode;
  /** Policy for sending credentials and accepting credentials from the response. */
  credentials?: RequestCredentials;
  /** HTTP cache access policy. */
  cache?: RequestCache;
  /** Policy for following or exposing redirects. */
  redirect?: RequestRedirect;
  /** Subresource Integrity metadata for checking the response body. */
  integrity?: string;
  /** Whether the request may outlive its initiating environment. */
  keepalive?: boolean;
  // A DOM implementation reference, not an ambient or Node AbortSignal.
  /** Signal to follow; null disconnects the new request from an input Request's signal. */
  signal?: AbortSignalCapability | null;
  /** Required half-duplex acknowledgement when supplying a ReadableStream body. */
  duplex?: RequestDuplex;
  /** Caller-provided scheduling priority hint. */
  priority?: RequestPriority;
  /** Only null is accepted when present; it disables client-associated prompt UI. */
  window?: unknown;
};

// -- Web IDL ------------------------------------------------------------

export const requestInfoIDL = defineTypedef({
  name: 'RequestInfo',
  type: union(reference('Request'), idlType.USVString),
});

export const requestInitIDL = defineDictionary({
  name: 'RequestInit',
  members: [
    dictMember('method', idlType.ByteString),
    dictMember('headers', reference('HeadersInit')),
    dictMember('body', nullable(reference('BodyInit'))),
    dictMember('referrer', idlType.USVString),
    dictMember('referrerPolicy', reference('ReferrerPolicy')),
    dictMember('mode', reference('RequestMode')),
    dictMember('credentials', reference('RequestCredentials')),
    dictMember('cache', reference('RequestCache')),
    dictMember('redirect', reference('RequestRedirect')),
    dictMember('integrity', idlType.DOMString),
    dictMember('keepalive', idlType.boolean),
    dictMember('signal', nullable(reference('AbortSignal'))),
    dictMember('duplex', reference('RequestDuplex')),
    dictMember('priority', reference('RequestPriority')),
    dictMember('window', idlType.any),
  ],
});

export const requestIDL = defineInterface({
  name: 'Request',
  exposed: ['Window', 'Worker'],
  implementation: impl(RequestImpl, {
    constructWith: [atArg(3, (ctx) => ctx.getRuntime())],
  }),
  members: [
    ctor(
      [
        arg('input', reference('RequestInfo')),
        arg('init', reference('RequestInit'), { optional: true, default: emptyDictionary }),
      ],
      {
        construct(ctx, input, init): RequestImpl {
          return RequestImpl.create(
            input as FetchRequestInfo, init as FetchRequestInit,
            getFetchEnvironmentSettingsObject(ctx, requestIDL), ctx.getRuntime(),
          );
        },
      },
    ),
    roAttr('method', idlType.ByteString),
    roAttr('url', idlType.USVString),
    roAttr('headers', reference('Headers'), xattr('SameObject')),
    roAttr('destination', reference('RequestDestination')),
    roAttr('referrer', idlType.USVString),
    roAttr('referrerPolicy', reference('ReferrerPolicy')),
    roAttr('mode', reference('RequestMode')),
    roAttr('credentials', reference('RequestCredentials')),
    roAttr('cache', reference('RequestCache')),
    roAttr('redirect', reference('RequestRedirect')),
    roAttr('integrity', idlType.DOMString),
    roAttr('keepalive', idlType.boolean),
    roAttr('isReloadNavigation', idlType.boolean),
    roAttr('isHistoryNavigation', idlType.boolean),
    roAttr('signal', reference('AbortSignal')),
    roAttr('duplex', reference('RequestDuplex')),
    op('clone', reference('Request'), [], xattr('NewObject')),
  ],
});

export const requestIncludesBodyIDL = defineIncludes({ interface: 'Request', mixin: 'Body' });
export const requestDestinationIDL = defineEnumeration({
  name: 'RequestDestination',
  values: ['', 'audio', 'audioworklet', 'document', 'embed', 'font', 'frame', 'iframe',
    'image', 'json', 'manifest', 'object', 'paintworklet', 'report', 'script',
    'sharedworker', 'style', 'text', 'track', 'video', 'worker', 'xslt'],
});
export const requestModeIDL = defineEnumeration({ name: 'RequestMode', values: ['navigate', 'same-origin', 'no-cors', 'cors'] });
export const requestCredentialsIDL = defineEnumeration({ name: 'RequestCredentials', values: ['omit', 'same-origin', 'include'] });
export const requestCacheIDL = defineEnumeration({ name: 'RequestCache', values: ['default', 'no-store', 'reload', 'no-cache', 'force-cache', 'only-if-cached'] });
export const requestRedirectIDL = defineEnumeration({ name: 'RequestRedirect', values: ['follow', 'error', 'manual'] });
export const requestDuplexIDL = defineEnumeration({ name: 'RequestDuplex', values: ['half'] });
export const requestPriorityIDL = defineEnumeration({ name: 'RequestPriority', values: ['high', 'low', 'auto'] });
