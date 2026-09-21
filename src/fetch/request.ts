import type { BlobImpl } from '../file/index';
import type { AbortSignalCapability, PromiseValue, RuntimeContext } from '../js-engine/index';
import { TypeError } from '../js-engine/exceptions';
import { isomorphicEncode } from '../js-engine/byte-string';
import { createReadableStreamProxy, type ReadableStreamImpl } from '../streams/index';
import { areSameOrigin, areSameSite, serializeOrigin, type Origin } from '../url/origin';
import { copyURL, obtainURLOrigin, parseURL, serializeURL, type URLRecord } from '../url/url';
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
  type FetchEnvironmentSettingsObject, type FetchEnvironment,
} from './infrastructure';
import { isCORSSafelistedMethod, isForbiddenMethod, isMethod, normalizeMethod } from './http/methods';
import { determineNetworkPartitionKey, type NetworkPartitionKey } from './http/network-partition';
import { InternalError } from '../infra/internal-error';

/** Fetch §2.2.5. URL and client are required inputs; the other fields have defaults. */
export class FetchRequest {
  method = 'GET';
  localURLsOnly = false;
  headerList = new FetchHeaders();
  unsafeRequest = false;
  body: Uint8Array | FetchBody | null = null;
  client: FetchEnvironmentSettingsObject | null;
  reservedClient: FetchEnvironment | null = null;
  replacesClientId = '';
  traversableForUserPrompts: 'no-traversable' | 'client' | FetchEnvironmentSettingsObject = 'client';
  keepalive = false;
  initiatorType: RequestInitiator | null = null;
  serviceWorkersMode: 'all' | 'none' = 'all';
  initiator: '' | 'download' | 'imageset' | 'manifest' | 'prefetch' | 'prerender' | 'xslt' = '';
  destination: Destination = '';
  priority: RequestPriority = 'auto';
  internalPriority: RequestInternalPriority | null = null;
  origin: Origin | 'client' = 'client';
  topLevelNavigationInitiatorOrigin: Origin | null = null;
  policyContainer: object | 'client' = 'client';
  referrer: URLRecord | 'no-referrer' | 'client' = 'client';
  // Referrer Policy supplies the enum declaration at the browser composition root.
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

  constructor(url: URLRecord, client: FetchEnvironmentSettingsObject | null) {
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
    if (this.origin === 'client') throw new InternalError('Fetch request origin is still "client"');
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
    if (this.origin === 'client') throw new InternalError('Fetch request origin is still "client"');
    return this.redirectTaint === 'same-origin' ? serializeOrigin(this.origin) : 'null';
  }

  /** https://fetch.spec.whatwg.org/#byte-serializing-a-request-origin */
  byteSerializeOrigin(): Uint8Array<ArrayBuffer> {
    return isomorphicEncode(this.serializeOrigin());
  }

  /** https://fetch.spec.whatwg.org/#concept-request-clone */
  clone(): FetchRequest {
    const request = new FetchRequest(this.url, this.client);
    for (let i = 1; i < this.urlList.length; i++) request.urlList.push(copyURL(this.urlList[i]!));
    return Object.assign(request, this, {
      webDriverId: request.webDriverId,
      headerList: this.headerList.clone(),
      urlList: request.urlList,
      referrer: typeof this.referrer === 'string' ? this.referrer : copyURL(this.referrer),
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
    if (this.origin === 'client') throw new InternalError('Fetch request origin is still "client"');
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
  #request: FetchRequest;
  #headers: HeadersImpl;
  #signal: AbortSignalCapability;
  #bodyMixin: BodyMixin;
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
      source = new FetchRequest(url, client);
      fallbackMode = 'cors';
    } else {
      source = input.#request;
      signal = input.#signal;
    }

    const origin = client.origin;
    let traversable: FetchRequest['traversableForUserPrompts'] = 'client';
    if (typeof source.traversableForUserPrompts === 'object' &&
      areSameOrigin(source.traversableForUserPrompts.origin, origin)) {
      traversable = source.traversableForUserPrompts;
    }
    if ('window' in init) {
      if (init.window !== null) throw new TypeError('RequestInit.window must be null');
      traversable = 'no-traversable';
    }

    const request = new FetchRequest(source.url, client);
    request.method = source.method;
    request.headerList = source.headerList.clone();
    request.unsafeRequest = true;
    request.traversableForUserPrompts = traversable;
    request.internalPriority = source.internalPriority;
    request.origin = source.origin;
    request.referrer = typeof source.referrer === 'string' ? source.referrer : copyURL(source.referrer);
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
      request.origin = 'client';
      request.referrer = 'client';
      request.referrerPolicy = '';
      request.urlList = [request.currentURL];
    }
    if (init.referrer !== undefined) {
      if (init.referrer === '') {
        request.referrer = 'no-referrer';
      } else {
        const referrer = parseURL(init.referrer, baseURL).url;
        if (referrer === null) throw new TypeError('Invalid Request referrer');
        request.referrer = (referrer.scheme === 'about' && referrer.path === 'client') ||
          !areSameOrigin(obtainURLOrigin(referrer), origin) ? 'client' : referrer;
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
    if (referrer === 'no-referrer') return '';
    if (referrer === 'client') return 'about:client';
    return serializeURL(referrer);
  }

  get referrerPolicy(): string { return this.#request.referrerPolicy; }
  get mode(): FetchRequest['mode'] { return this.#request.mode; }
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
/** Priority assigned by Fetch scheduling; updates retain the scheduler's representation. */
export type RequestInternalPriority = { update(priority: RequestPriority): void; };
export type WebTransportHash = { algorithm: string; value: Uint8Array; };

/** Converted RequestInfo: an existing Request implementation or a URL string. */
export type FetchRequestInfo = RequestImpl | string;
export type FetchRequestInit = {
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
  signal?: AbortSignalCapability | null;
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
