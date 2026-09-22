import type { BlobImpl } from '../file/index';
import { utf8Encode } from '../encoding/index';
import { calculateCacheFreshness, type CacheTiming } from '../http/index';
import type { PromiseValue } from '../infra/promises';
import type { RealmExecution } from '../js-engine/index';
import { RangeError, TypeError } from '../infra/exceptions';
import type { ReadableStreamImpl } from '../streams/index';
import {
  areSameOrigin, areSchemelesslySameSite, copyURL, obtainURLOrigin, parseURL, serializeURL,
  type Origin, type URLRecord,
} from '../url/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable, op, reference,
  roAttr, staticOp, invokeWith, xattr,
} from '../web-idl/index';
import type { FormDataImpl } from '../xhr/index';
import { BodyMixin, FetchBody, type BodyInitValue, type BodyWithType } from './body';
import {
  FetchHeaders, HeadersImpl, isCORSSafelistedResponseHeaderName,
  isForbiddenResponseHeaderName, type HeadersGuard, type HeadersInitValue,
} from './headers';
import { isNullBodyStatus, isRedirectStatus } from './http/statuses';
import {
  getFetchEnvironment, type FetchEmbedderPolicyValue, type FetchEnvironment,
} from './infrastructure';
import type { FetchRequest, RedirectTaint } from './request';
import type { FetchParams } from './params';
import { ResponseBodyInfo, type ServiceWorkerTimingInfo } from './timing';
import { InternalError } from '../infra/internal-error';

/** Fetch §2.2.6: response fields can continue changing after delivery. */
export class FetchResponse {
  /** Response category determining filtering and author-visible exposure. */
  type: ResponseType = 'default';
  /** Distinguishes an aborted network error from other network errors. */
  aborted = false;
  /** Response URL history; empty when no response URL has been assigned. */
  urlList: URLRecord[] = [];
  /** HTTP status code, or zero for a network error or opaque response view. */
  status = 200;
  /** HTTP reason phrase as a byte string; it may be empty. */
  statusMessage = '';
  /** Ordered response headers, or the exposed subset for a filtered response. */
  headerList = new FetchHeaders();
  /** Response body stream and replay metadata, or null when no body is present. */
  body: FetchBody | null = null;
  /** How the cache supplied this response; undefined when there is no cache classification. */
  cacheUsage: CacheUsage | undefined = undefined;
  /** Additional header names exposed by a CORS filtered response. */
  corsExposedHeaderNameList: string[] = [];
  /** Records that a Range header was sent, to prevent unintended exposure of partial content. */
  rangeRequested = false;
  /** Whether the request that produced this response was allowed to include credentials. */
  requestIncludesCredentials = true;
  /** Whether detailed timing may be exposed after checks across the redirect chain. */
  timingAllowPassed = false;
  /** Redirect Timing-Allow-Origin values retained for checks against the navigation's final origin. */
  navigationTimingAllowValuesList: string[][] = [];
  /** Body sizes and content metadata collected for timing reports. */
  bodyInfo = new ResponseBodyInfo();
  /** Service-worker processing times, or null when no worker timing is attached. */
  serviceWorkerTimingInfo: ServiceWorkerTimingInfo | null = null;
  /** Origin/site classification of the request's redirect chain retained on the response. */
  redirectTaint: RedirectTaint = 'same-origin';

  /** https://fetch.spec.whatwg.org/#concept-network-error */
  static networkError(): FetchResponse {
    const response = new FetchResponse();
    response.type = 'error';
    response.status = 0;
    return response;
  }

  /** https://fetch.spec.whatwg.org/#concept-aborted-network-error */
  static abortedNetworkError(): FetchResponse {
    const response = FetchResponse.networkError();
    response.aborted = true;
    return response;
  }

  /** https://fetch.spec.whatwg.org/#appropriate-network-error */
  static appropriateNetworkError(params: FetchParams): FetchResponse {
    if (!params.canceled) throw new InternalError('Fetch params are not canceled');
    return params.aborted ? FetchResponse.abortedNetworkError() : FetchResponse.networkError();
  }

  get url(): URLRecord | null {
    return this.urlList.at(-1) ?? null;
  }

  /** https://fetch.spec.whatwg.org/#serialize-a-response-url-for-reporting */
  serializeURLForReporting(): string {
    const url = this.urlList[0];
    if (url === undefined) throw new InternalError('Response URL list is empty');
    return serializeURL({ ...url, username: '', password: '' }, true);
  }

  /**
   * https://fetch.spec.whatwg.org/#concept-filtered-response
   * Only the specified overrides belong to the view. Other fields continue to
   * refer to the internal response, including replacement bodies and timing updates.
   * Headers are a separate filtered list, as in Blink, Gecko, and WebKit.
   */
  filter(type: FilteredResponseType): FilteredFetchResponse {
    if (this.type === 'error' || isFilteredResponse(this)) {
      throw new InternalError('Cannot filter a network error or an already filtered response');
    }
    const headerList = new FetchHeaders();
    if (type === 'basic' || type === 'cors') {
      for (const [name, value] of this.headerList) {
        if (type === 'basic' ? !isForbiddenResponseHeaderName(name)
          : isCORSSafelistedResponseHeaderName(name, this.corsExposedHeaderNameList)) {
          headerList.list.push([name, value]);
        }
      }
    }
    const overrides: Partial<FetchResponse> & { internalResponse: FetchResponse; } = {
      type, internalResponse: this, headerList,
    };
    if (type === 'opaque' || type === 'opaqueredirect') {
      Object.assign(overrides, {
        status: 0, statusMessage: '', body: null, bodyInfo: new ResponseBodyInfo(),
      });
      if (type === 'opaque') overrides.urlList = [];
    }
    // Use the view as the getter receiver so derived fields (notably url) see its overrides.
    return new Proxy<FetchResponse>(this, {
      get(target, key, receiver) {
        return Reflect.get(Object.hasOwn(overrides, key) ? overrides : target, key, receiver) as unknown;
      },
      set(target, key, value) {
        if (Object.hasOwn(overrides, key)) throw new InternalError(`Cannot replace filtered response ${String(key)}`);
        return Reflect.set(target, key, value);
      },
      has(target, key) {
        return Object.hasOwn(overrides, key) || Reflect.has(target, key);
      },
    }) as FilteredFetchResponse;
  }

  /** https://fetch.spec.whatwg.org/#concept-response-clone */
  clone(): FetchResponse {
    if (isFilteredResponse(this)) return this.internalResponse.clone().filter(this.type);
    return Object.assign(new FetchResponse(), this, {
      headerList: this.headerList.clone(),
      urlList: this.urlList.map(copyURL),
      corsExposedHeaderNameList: [...this.corsExposedHeaderNameList],
      navigationTimingAllowValuesList: this.navigationTimingAllowValuesList.map((values) => [...values]),
      bodyInfo: Object.assign(new ResponseBodyInfo(), this.bodyInfo),
      serviceWorkerTimingInfo: this.serviceWorkerTimingInfo === null ? null : { ...this.serviceWorkerTimingInfo },
      body: this.body?.clone() ?? null,
    });
  }

  /**
   * https://fetch.spec.whatwg.org/#concept-fresh-response
   * https://fetch.spec.whatwg.org/#concept-stale-while-revalidate-response
   * https://fetch.spec.whatwg.org/#concept-stale-response
   * The cache transaction supplies its timestamps; this record does not read a clock.
   */
  getFreshness(timing: CacheTiming): 'fresh' | 'stale-while-revalidate' | 'stale' {
    const freshness = calculateCacheFreshness({
      cacheControl: this.headerList.get('Cache-Control') ?? undefined,
      date: this.headerList.get('Date') ?? undefined,
      age: this.headerList.get('Age') ?? undefined,
      expires: this.headerList.get('Expires') ?? undefined,
      lastModified: this.headerList.get('Last-Modified') ?? undefined,
    }, this.status, timing);
    if (freshness.fresh) return 'fresh';
    return freshness.staleWhileRevalidate ? 'stale-while-revalidate' : 'stale';
  }

  /**
   * https://fetch.spec.whatwg.org/#concept-response-location-url
   * Undefined means absent; null means extraction or URL parsing failed.
   */
  getLocationURL(requestFragment: string | null): URLRecord | undefined | null {
    if (!isRedirectStatus(this.status)) return undefined;
    const values = this.headerList.extractValues('Location', (value) => [value], false);
    if (values === undefined || values === null) return values;
    const url = parseURL(values[0]!, this.url).url;
    if (url !== null && url.fragment === null) url.fragment = requestFragment;
    return url;
  }

  /** Processes each Set-Cookie field independently using the request's URL and cookie policy. */
  // https://fetch.spec.whatwg.org/#parse-and-store-response-set-cookie-headers
  parseAndStoreCookies(request: FetchRequest): void {
    const { userAgent } = request;
    if (!userAgent.cookiesEnabled) return;
    const { scheme, host, path } = request.currentURL;
    if (host === null || host.kind === 'empty' || host.kind === 'opaque' || typeof path === 'string') return;
    // Browsers accept Strict/Lax cookies on top-level navigation responses even
    // when those cookies could not have been sent on the initiating request.
    const sameSiteStrictOrLaxAllowed = request.destination === 'document' || request.isSameSiteForCookies;
    for (const [name, value] of this.headerList) {
      if (name.toLowerCase() !== 'set-cookie') continue;
      userAgent.cookieStore.parseAndStoreCookie(value, scheme === 'https', host, path, true, false, sameSiteStrictOrLaxAllowed);
      userAgent.cookieStore.garbageCollectCookies(host);
    }
  }

  /** Whether CORP blocks this response, reporting violations of the client's embedder policies. */
  // https://fetch.spec.whatwg.org/#cross-origin-resource-policy-check
  isBlockedByCORP(
    origin: Origin, settings: FetchEnvironment, destination: string, forNavigation = false,
  ): boolean {
    const policy = settings.policyContainer.embedderPolicy;
    if (this.isBlockedByCORPInternal(origin, 'unsafe-none', forNavigation)) {
      return true;
    }
    if (this.isBlockedByCORPInternal(origin, policy.reportOnlyValue, forNavigation)) {
      this.queueCORPViolationReport(settings, destination, true);
    }
    if (!this.isBlockedByCORPInternal(origin, policy.value, forNavigation)) {
      return false;
    }
    this.queueCORPViolationReport(settings, destination, false);
    return true;
  }

  /** Whether CORP blocks this response under one embedder policy, without reporting violations. */
  // https://fetch.spec.whatwg.org/#cross-origin-resource-policy-internal-check
  isBlockedByCORPInternal(
    origin: Origin, embedderPolicyValue: FetchEmbedderPolicyValue, forNavigation: boolean,
  ): boolean {
    if (forNavigation && embedderPolicyValue === 'unsafe-none') return false;
    let policy = this.headerList.get('Cross-Origin-Resource-Policy');
    if (policy !== 'same-origin' && policy !== 'same-site' && policy !== 'cross-origin') policy = null;
    if (policy === null && (embedderPolicyValue === 'require-corp' ||
      (embedderPolicyValue === 'credentialless' && (this.requestIncludesCredentials || forNavigation)))) {
      policy = 'same-origin';
    }
    if (policy === null || policy === 'cross-origin') return false;
    const url = this.url;
    if (url === null) throw new InternalError('CORP origin comparison requires a response URL');
    const responseOrigin = obtainURLOrigin(url);
    if (policy === 'same-origin') return !areSameOrigin(origin, responseOrigin);
    return origin.kind !== 'tuple' || !areSchemelesslySameSite(origin, responseOrigin) ||
      (origin.scheme !== 'https' && url.scheme === 'https');
  }

  /** Queue a COEP violation with the selected endpoint and sanitized original response URL. */
  // https://fetch.spec.whatwg.org/#queue-a-cross-origin-embedder-policy-corp-violation-report
  queueCORPViolationReport(
    settings: FetchEnvironment, destination: string, reportOnly: boolean,
  ): void {
    const policy = settings.policyContainer.embedderPolicy;
    const endpoint = reportOnly ? policy.reportOnlyReportingEndpoint : policy.reportingEndpoint;
    settings.queueReport('coep', endpoint, {
      type: 'corp', blockedURL: this.serializeURLForReporting(), destination,
      disposition: reportOnly ? 'reporting' : 'enforce',
    });
  }
}

export type ResponseType = 'default' | 'error' | FilteredResponseType;
export type FilteredResponseType = 'basic' | 'cors' | 'opaque' | 'opaqueredirect';
export type CacheUsage = 'local' | 'validated';

export type FilteredFetchResponse = FetchResponse & {
  /** Filtering policy applied by this response view. */
  type: FilteredResponseType;
  /** Underlying response whose unmasked state remains live through the view. */
  readonly internalResponse: FetchResponse;
};

function isFilteredResponse(response: FetchResponse): response is FilteredFetchResponse {
  return 'internalResponse' in response;
}

/*
 * [Exposed=(Window,Worker)]
 * interface Response {
 *   constructor(optional BodyInit? body = null, optional ResponseInit init = {});
 *
 *   [NewObject] static Response error();
 *   [NewObject] static Response redirect(USVString url, optional unsigned short status = 302);
 *   [NewObject] static Response json(any data, optional ResponseInit init = {});
 *
 *   readonly attribute ResponseType type;
 *
 *   readonly attribute USVString url;
 *   readonly attribute boolean redirected;
 *   readonly attribute unsigned short status;
 *   readonly attribute boolean ok;
 *   readonly attribute ByteString statusText;
 *   [SameObject] readonly attribute Headers headers;
 *
 *   [NewObject] Response clone();
 * };
 * Response includes Body;
 *
 * dictionary ResponseInit {
 *   unsigned short status = 200;
 *   ByteString statusText = "";
 *   HeadersInit headers;
 * };
 *
 * enum ResponseType { "basic", "cors", "default", "error", "opaque", "opaqueredirect" };
 */
export class ResponseImpl {
  /** Internal response or filtered response view represented by this platform Response. */
  #response: FetchResponse;
  /** Stable Headers implementation sharing the response's list and enforcing its guard. */
  #headers: HeadersImpl;
  /** Body operations reading this response's current body and headers. */
  #bodyMixin: BodyMixin;
  /** Owner's execution and allocation facilities, retained by cloned Responses. */
  #exec: RealmExecution;

  // Internal allocation from an existing response and header guard.
  // https://fetch.spec.whatwg.org/#response-create
  constructor(
    response: FetchResponse, guard: HeadersGuard, exec: RealmExecution,
  ) {
    this.#response = response;
    this.#headers = new HeadersImpl(response.headerList, guard);
    this.#bodyMixin = new BodyMixin(response, exec);
    this.#exec = exec;
  }

  /** Construct a Response from converted author arguments. */
  // https://fetch.spec.whatwg.org/#dom-response
  static create(body: BodyInitValue | null, init: FetchResponseInit, exec: RealmExecution): ResponseImpl {
    const response = new ResponseImpl(new FetchResponse(), 'response', exec);
    const extracted = body === null ? null : FetchBody.extract(body, false, exec);
    response.#initialize(init, extracted);
    return response;
  }

  // https://fetch.spec.whatwg.org/#dom-response-error
  static error(exec: RealmExecution): ResponseImpl {
    return new ResponseImpl(FetchResponse.networkError(), 'immutable', exec);
  }

  // https://fetch.spec.whatwg.org/#dom-response-redirect
  // SPEC_MISMATCH: Response.redirect(url, status) -> Response
  static redirect(url: string, status: number, baseURL: URLRecord, exec: RealmExecution): ResponseImpl {
    const parsedURL = parseURL(url, baseURL).url;
    if (parsedURL === null) throw new TypeError('Invalid redirect URL');
    if (!isRedirectStatus(status)) throw new RangeError('Invalid redirect status');
    const response = new FetchResponse();
    response.status = status;
    response.headerList.append('Location', serializeURL(parsedURL));
    return new ResponseImpl(response, 'immutable', exec);
  }

  // https://fetch.spec.whatwg.org/#dom-response-json
  static json(data: unknown, init: FetchResponseInit, exec: RealmExecution): ResponseImpl {
    // https://infra.spec.whatwg.org/#serialize-a-javascript-value-to-json-bytes
    const json = exec.stringifyJSON(data);
    if (json === undefined) throw new TypeError('Value cannot be serialized as JSON');
    const body = FetchBody.fromBytes(utf8Encode(json), exec);
    const response = new ResponseImpl(new FetchResponse(), 'response', exec);
    response.#initialize(init, { body, type: 'application/json' });
    return response;
  }

  get type(): ResponseType { return this.#response.type; }
  get url(): string { return this.#response.url === null ? '' : serializeURL(this.#response.url, true); }
  get redirected(): boolean { return this.#response.urlList.length > 1; }
  get status(): number { return this.#response.status; }
  get ok(): boolean { return this.#response.status >= 200 && this.#response.status <= 299; }
  get statusText(): string { return this.#response.statusMessage; }
  get headers(): HeadersImpl { return this.#headers; }

  // https://fetch.spec.whatwg.org/#dom-response-clone
  clone(): ResponseImpl {
    if (this.#bodyMixin.unusable) throw new TypeError('Response body is disturbed or locked');
    return new ResponseImpl(this.#response.clone(), this.#headers.guard, this.#exec);
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

  getResponse(): FetchResponse { return this.#response; }

  // https://fetch.spec.whatwg.org/#initialize-a-response
  #initialize(init: FetchResponseInit, body: BodyWithType | null): void {
    if (init.status < 200 || init.status > 599) throw new RangeError('Response status must be between 200 and 599');
    if (invalidStatusText.test(init.statusText)) throw new TypeError('Invalid Response status text');
    this.#response.status = init.status;
    this.#response.statusMessage = init.statusText;
    if (init.headers !== undefined) this.#headers.fill(init.headers);
    if (body !== null) {
      if (isNullBodyStatus(init.status)) throw new TypeError('This response status cannot have a body');
      this.#response.body = body.body;
      if (body.type !== null && !this.#response.headerList.has('Content-Type')) {
        this.#response.headerList.append('Content-Type', body.type);
      }
    }
  }
}

// RFC 9112 reason-phrase = *( HTAB / SP / VCHAR / obs-text ).
// eslint-disable-next-line no-control-regex -- The HTTP production names byte ranges explicitly.
const invalidStatusText = /[^\x09\x20-\x7e\x80-\xff]/;

/** Post-conversion dictionary; Web IDL supplies status and statusText defaults. */
export type FetchResponseInit = {
  /** Response status in the inclusive range 200 through 599. */
  status: number;
  /** HTTP reason phrase, restricted to the permitted byte-string characters. */
  statusText: string;
  /** Initial header entries, before any inferred body Content-Type is appended. */
  headers?: HeadersInitValue;
};

// -- Web IDL ------------------------------------------------------------

export const responseInitIDL = defineDictionary({
  name: 'ResponseInit',
  members: [
    dictMember('status', idlType.unsignedShort, { default: integer(200) }),
    dictMember('statusText', idlType.ByteString, { default: '' }),
    dictMember('headers', reference('HeadersInit')),
  ],
});

export const responseTypeIDL = defineEnumeration({
  name: 'ResponseType',
  values: ['basic', 'cors', 'default', 'error', 'opaque', 'opaqueredirect'],
});

export const responseIDL = defineInterface({
  name: 'Response',
  exposed: ['Window', 'Worker'],
  implementation: impl(ResponseImpl, {
    constructWith: [atArg(2, (ctx) => ctx.getExecution())],
  }),
  members: [
    ctor(
      [
        arg('body', nullable(reference('BodyInit')), { optional: true, default: null }),
        arg('init', reference('ResponseInit'), { optional: true, default: emptyDictionary }),
      ],
      {
        construct(ctx, body, init) {
          return ResponseImpl.create(body as BodyInitValue | null, init as FetchResponseInit, ctx.getExecution());
        },
      },
    ),
    staticOp('error', reference('Response'),
      [],
      { ...xattr('NewObject'), ...invokeWith(atArg(0, (ctx) => ctx.getExecution())) },
    ),
    staticOp('redirect', reference('Response'),
      [
        arg('url', idlType.USVString),
        arg('status', idlType.unsignedShort, { optional: true, default: integer(302) }),
      ],
      {
        ...xattr('NewObject'),
        ...invokeWith(
          atArg(2, (ctx): URLRecord => getFetchEnvironment(ctx, responseIDL).apiBaseURL),
          atArg(3, (ctx) => ctx.getExecution()),
        ),
      },
    ),
    staticOp('json', reference('Response'),
      [
        arg('data', idlType.any),
        arg('init', reference('ResponseInit'), { optional: true, default: emptyDictionary }),
      ],
      { ...xattr('NewObject'), ...invokeWith(atArg(2, (ctx) => ctx.getExecution())) },
    ),
    roAttr('type', reference('ResponseType')),
    roAttr('url', idlType.USVString),
    roAttr('redirected', idlType.boolean),
    roAttr('status', idlType.unsignedShort),
    roAttr('ok', idlType.boolean),
    roAttr('statusText', idlType.ByteString),
    roAttr('headers', reference('Headers'), xattr('SameObject')),
    op('clone', reference('Response'), [], xattr('NewObject')),
  ],
});

export const responseIncludesBodyIDL = defineIncludes({ interface: 'Response', mixin: 'Body' });
