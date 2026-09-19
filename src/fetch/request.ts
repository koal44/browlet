import { isomorphicEncode } from '../js-engine/byte-string';
import type { ReadableStreamImpl } from '../streams/index';
import { areSameOrigin, areSameSite, serializeOrigin, type Origin } from '../url/origin';
import { copyURL, obtainURLOrigin, serializeURL, type URLRecord } from '../url/url';
import {
  arg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface,
  defineTypedef, dictMember, emptyDictionary, idlType, impl, nullable,
  op, reference, roAttr, union, xattr,
} from '../web-idl/index';
import { BodyMixin, BodyRecord, type BodyInitValue } from './body';
import { appendHeader, HeadersImpl, type HeaderList, type HeadersGuard, type HeadersInitValue } from './headers';
import { serializeInteger, type FetchClientSettings } from './infrastructure';

/** Fetch §2.2.5. URL and client are required inputs; the other fields have defaults. */
export class RequestRecord {
  method = 'GET';
  localURLsOnly = false;
  readonly headerList: HeaderList = [];
  unsafeRequest = false;
  body: Uint8Array | BodyRecord | null = null;
  client: FetchClientSettings | null;
  // Other HTML-owned references remain opaque until client/policy integration (§4.1).
  reservedClient: object | null = null;
  replacesClientId = '';
  traversableForUserPrompts: 'no-traversable' | 'client' | object = 'client';
  keepalive = false;
  initiatorType: RequestInitiator | null = null;
  serviceWorkersMode: 'all' | 'none' = 'all';
  initiator: '' | 'download' | 'imageset' | 'manifest' | 'prefetch' | 'prerender' | 'xslt' = '';
  destination: Destination = '';
  priority: RequestPriority = 'auto';
  internalPriority: object | null = null;
  origin: Origin | 'client' = 'client';
  topLevelNavigationInitiatorOrigin: Origin | null = null;
  policyContainer: object | 'client' = 'client';
  referrer: URLRecord | 'no-referrer' | 'client' = 'client';
  // Referrer Policy owns this enum; its declaration joins the API family later.
  referrerPolicy = '';
  mode: RequestMode | 'websocket' | 'webtransport' = 'no-cors';
  useCORSPreflight = false;
  credentialsMode: RequestCredentials = 'same-origin';
  useURLCredentials = false;
  cacheMode: RequestCache = 'default';
  redirectMode: RequestRedirect = 'follow';
  integrityMetadata = '';
  cryptographicNonceMetadata = '';
  parserMetadata: '' | 'parser-inserted' | 'not-parser-inserted' = '';
  reloadNavigation = false;
  historyNavigation = false;
  userActivation = false;
  webDriverNavigationId: string | null = null;
  renderBlocking = false;
  webTransportHashList: WebTransportHash[] = [];
  urlList: [URLRecord, ...URLRecord[]];
  redirectCount = 0;
  responseTainting: 'basic' | 'cors' | 'opaque' = 'basic';
  preventNoCacheCacheControlHeaderModification = false;
  done = false;
  timingAllowFailed = false;
  navigationTimingAllowValuesList: string[][] = [];
  webDriverId: string = crypto.randomUUID();

  constructor(url: URLRecord, client: FetchClientSettings | null) {
    this.urlList = [copyURL(url)];
    this.client = client;
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
  get redirectTaint(): 'same-origin' | 'same-site' | 'cross-site' {
    if (this.origin === 'client') throw new Error('Fetch request origin is still "client"');
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
    if (this.origin === 'client') throw new Error('Fetch request origin is still "client"');
    return this.redirectTaint === 'same-origin' ? serializeOrigin(this.origin) : 'null';
  }

  /** https://fetch.spec.whatwg.org/#byte-serializing-a-request-origin */
  byteSerializeOrigin(): Uint8Array<ArrayBuffer> {
    return isomorphicEncode(this.serializeOrigin());
  }

  /** https://fetch.spec.whatwg.org/#concept-request-clone */
  clone(): RequestRecord {
    const request = new RequestRecord(this.url, this.client);
    return Object.assign(request, this, {
      webDriverId: request.webDriverId,
      headerList: this.headerList.map(([name, value]) => [name, value]),
      urlList: [request.url, ...this.urlList.slice(1).map(copyURL)],
      referrer: typeof this.referrer === 'string' ? this.referrer : copyURL(this.referrer),
      webTransportHashList: this.webTransportHashList.map(({ algorithm, value }) => ({ algorithm, value: new Uint8Array(value) })),
      navigationTimingAllowValuesList: this.navigationTimingAllowValuesList.map((values) => [...values]),
      // Before body extraction, a byte sequence is copied as a value; a body tees its stream.
      body: this.body === null ? null : this.body instanceof BodyRecord ? this.body.clone() : new Uint8Array(this.body),
    });
  }

  /** https://fetch.spec.whatwg.org/#concept-request-add-range-header */
  addRangeHeader(first: number | bigint, last?: number | bigint): void {
    if (last !== undefined && first > last) throw new Error('Range start exceeds its end');
    const value = `bytes=${serializeInteger(first)}-${last === undefined ? '' : serializeInteger(last)}`;
    appendHeader(['Range', value], this.headerList);
  }

  /** https://fetch.spec.whatwg.org/#cross-origin-embedder-policy-allows-credentials */
  crossOriginEmbedderPolicyAllowsCredentials(): boolean {
    if (this.origin === 'client') throw new Error('Fetch request origin is still "client"');
    if (this.mode !== 'no-cors' || this.client === null) return true;
    if (this.client.policyContainer.embedderPolicy.value !== 'credentialless') return true;
    return areSameOrigin(this.origin, obtainURLOrigin(this.currentURL)) &&
      this.redirectTaint === 'same-origin';
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
  #request: RequestRecord;
  #headers: HeadersImpl;
  #signal: object;
  #bodyMixin: BodyMixin;

  // Internal allocation from a request, guard, and DOM-owned signal.
  // Author RequestInfo/RequestInit processing belongs to the deferred constructor.
  // SPEC_MISMATCH: create a Request object(request, guard, signal, realm) -> Request
  constructor(request: RequestRecord, guard: HeadersGuard, signal: object) {
    this.#request = request;
    this.#headers = new HeadersImpl(request.headerList, guard);
    this.#signal = signal;
    this.#bodyMixin = new BodyMixin(request);
  }

  get method(): string { return this.#request.method; }
  get url(): string { return serializeURL(this.#request.url); }
  get headers(): HeadersImpl { return this.#headers; }
  get destination(): Destination { return this.#request.destination; }

  get referrer(): string {
    const referrer = this.#request.referrer;
    if (referrer === 'no-referrer') return '';
    if (referrer === 'client') return 'about:client';
    return serializeURL(referrer);
  }

  get referrerPolicy(): string { return this.#request.referrerPolicy; }
  get mode(): RequestRecord['mode'] { return this.#request.mode; }
  get credentials(): RequestCredentials { return this.#request.credentialsMode; }
  get cache(): RequestCache { return this.#request.cacheMode; }
  get redirect(): RequestRedirect { return this.#request.redirectMode; }
  get integrity(): string { return this.#request.integrityMetadata; }
  get keepalive(): boolean { return this.#request.keepalive; }
  get isReloadNavigation(): boolean { return this.#request.reloadNavigation; }
  get isHistoryNavigation(): boolean { return this.#request.historyNavigation; }
  get signal(): object { return this.#signal; }
  get duplex(): RequestDuplex { return 'half'; }

  clone(): RequestImpl {
    throw new Error('Request.clone and dependent abort signals are not implemented');
  }

  get body(): ReadableStreamImpl | null { return this.#bodyMixin.body; }
  get bodyUsed(): boolean { return this.#bodyMixin.bodyUsed; }
  arrayBuffer(): object { return this.#bodyMixin.arrayBuffer(); }
  blob(): object { return this.#bodyMixin.blob(); }
  bytes(): object { return this.#bodyMixin.bytes(); }
  formData(): object { return this.#bodyMixin.formData(); }
  json(): object { return this.#bodyMixin.json(); }
  text(): object { return this.#bodyMixin.text(); }
  textStream(): ReadableStreamImpl { return this.#bodyMixin.textStream(); }

  // -- Internal ---------------------------------------------------------

  getRequest(): RequestRecord { return this.#request; }
}

export type RequestInitiator = 'audio' | 'beacon' | 'body' | 'css' | 'early-hints' |
  'embed' | 'fetch' | 'font' | 'frame' | 'iframe' | 'image' | 'img' | 'input' | 'link' |
  'object' | 'ping' | 'script' | 'track' | 'video' | 'xmlhttprequest' | 'other';

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
export type RequestCredentials = 'omit' | 'same-origin' | 'include';
export type RequestCache = 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
export type RequestRedirect = 'follow' | 'error' | 'manual';
export type RequestDuplex = 'half';
export type RequestPriority = 'high' | 'low' | 'auto';
export type WebTransportHash = { algorithm: string; value: Uint8Array; };

export type RequestInfoValue = RequestImpl | string;
export type RequestInitRecord = {
  method?: string;
  headers?: HeadersInitValue;
  body?: BodyInitValue | null;
  referrer?: string;
  referrerPolicy?: string;
  mode?: RequestMode;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  integrity?: string;
  keepalive?: boolean;
  // A DOM implementation reference, not an ambient or Node AbortSignal.
  signal?: object | null;
  duplex?: RequestDuplex;
  priority?: RequestPriority;
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
  implementation: impl(RequestImpl),
  members: [
    ctor([
      arg('input', reference('RequestInfo')),
      arg('init', reference('RequestInit'), { optional: true, default: emptyDictionary }),
    ], { invoke() { throw new Error('Request construction from RequestInfo is not implemented'); } }),
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
