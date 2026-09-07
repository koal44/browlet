import type { ReadableStreamImpl } from '../streams/index';
import type { Origin } from '../url/origin';
import { serializeURL, type URLRecord } from '../url/url';
import {
  arg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface,
  defineTypedef, dictMember, emptyDictionary, idlType, impl, invokeWith, nullable,
  op, reference, roAttr, union, xattr,
} from '../web-idl/declaration/index';
import { bind, bindingContext, type BindingContext } from '../web-idl/projection';
import { BodyMixin, type BodyInitValue, type BodyRecord } from './body';
import { HeadersImpl, type HeaderList, type HeadersGuard, type HeadersInitValue } from './headers';

/** Fetch §2.2.5. URL and client are required inputs; the other fields have defaults. */
export class RequestRecord {
  method = 'GET';
  localURLsOnly = false;
  readonly headerList: HeaderList = [];
  unsafeRequest = false;
  body: Uint8Array | BodyRecord | null = null;
  // HTML-owned references remain opaque until client/policy integration (§4.1).
  client: object | null;
  reservedClient: object | null = null;
  replacesClientId = '';
  traversableForUserPrompts: 'no-traversable' | 'client' | object = 'client';
  keepalive = false;
  initiatorType: RequestInitiatorType | null = null;
  serviceWorkersMode: 'all' | 'none' = 'all';
  initiator: '' | 'download' | 'imageset' | 'manifest' | 'prefetch' | 'prerender' | 'xslt' = '';
  destination: RequestDestination | 'serviceworker' | 'webidentity' = '';
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

  constructor(url: URLRecord, client: object | null) {
    // URL/current URL point into this list. Copy mutable URL components while
    // retaining the File API's blob URL entry identity.
    this.urlList = [{
      ...url,
      path: typeof url.path === 'string' ? url.path : [...url.path],
      host: url.host === null ? null : url.host.kind === 'ipv6'
        ? { ...url.host, pieces: [...url.host.pieces] } : { ...url.host },
    }];
    this.client = client;
  }

  get url(): URLRecord {
    return this.urlList[0];
  }

  get currentURL(): URLRecord {
    return this.urlList[this.urlList.length - 1]!;
  }

  clone(): RequestRecord {
    throw new Error('Fetch request cloning is not implemented');
  }
}

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
  readonly #request: RequestRecord;
  readonly #headers: HeadersImpl;
  readonly #signal: object;
  readonly #bodyMixin: BodyMixin;

  // Internal allocation from a request, guard, and DOM-owned signal.
  // Author RequestInfo/RequestInit processing belongs to the deferred constructor.
  constructor(context: BindingContext, request: RequestRecord, guard: HeadersGuard, signal: object) {
    this.#request = request;
    this.#headers = context.construct(HeadersImpl, request.headerList, guard);
    this.#signal = signal;
    this.#bodyMixin = new BodyMixin(request);
  }

  get method(): string { return this.#request.method; }
  get url(): string { return serializeURL(this.#request.url); }
  get headers(): HeadersImpl { return this.#headers; }
  get destination(): RequestRecord['destination'] { return this.#request.destination; }

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

  clone(_context: BindingContext): RequestImpl {
    throw new Error('Request.clone and dependent abort signals are not implemented');
  }

  get body(): ReadableStreamImpl | null { return this.#bodyMixin.body; }
  get bodyUsed(): boolean { return this.#bodyMixin.bodyUsed; }
  arrayBuffer(context: BindingContext): object { return this.#bodyMixin.arrayBuffer(context); }
  blob(context: BindingContext): object { return this.#bodyMixin.blob(context); }
  bytes(context: BindingContext): object { return this.#bodyMixin.bytes(context); }
  formData(context: BindingContext): object { return this.#bodyMixin.formData(context); }
  json(context: BindingContext): object { return this.#bodyMixin.json(context); }
  text(context: BindingContext): object { return this.#bodyMixin.text(context); }
  textStream(context: BindingContext): ReadableStreamImpl { return this.#bodyMixin.textStream(context); }

  static getRequest(request: RequestImpl): RequestRecord { return request.#request; }
}

export type RequestInitiatorType = 'audio' | 'beacon' | 'body' | 'css' | 'early-hints' |
  'embed' | 'fetch' | 'font' | 'frame' | 'iframe' | 'image' | 'img' | 'input' | 'link' |
  'object' | 'ping' | 'script' | 'track' | 'video' | 'xmlhttprequest' | 'other';

export type RequestDestination = '' | 'audio' | 'audioworklet' | 'document' | 'embed' |
  'font' | 'frame' | 'iframe' | 'image' | 'json' | 'manifest' | 'object' | 'paintworklet' |
  'report' | 'script' | 'sharedworker' | 'style' | 'text' | 'track' | 'video' | 'worker' | 'xslt';
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
  implementation: impl(RequestImpl, { constructWith: [bindingContext] }),
  members: [
    ctor([
      arg('input', reference('RequestInfo')),
      arg('init', reference('RequestInit'), { optional: true, default: emptyDictionary }),
    ], bind({ invoke() { throw new Error('Request construction from RequestInfo is not implemented'); } })),
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
    op('clone', reference('Request'), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
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
