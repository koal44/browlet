import { calculateCacheFreshness, type CacheTiming } from '../http/cache/freshness';
import type { ReadableStreamImpl } from '../streams/index';
import { copyURL, parseURL, serializeURL, type URLRecord } from '../url/url';
import {
  arg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable, op, reference,
  roAttr, staticOp, xattr,
} from '../web-idl/index';
import { BodyMixin, type BodyRecord } from './body';
import {
  extractHeaderListValues, getHeader, HeadersImpl, isCORSSafelistedResponseHeaderName,
  isForbiddenResponseHeaderName, type HeaderList, type HeadersGuard, type HeadersInitValue,
} from './headers';
import { isRedirectStatus } from './http/statuses';
import type { FetchParams } from './params';
import { ResponseBodyInfo, type ServiceWorkerTimingInfo } from './timing';

/** Fetch §2.2.6: response fields can continue changing after delivery. */
export class ResponseRecord {
  type: ResponseType = 'default';
  aborted = false;
  urlList: URLRecord[] = [];
  status = 200;
  statusMessage = '';
  readonly headerList: HeaderList = [];
  body: BodyRecord | null = null;
  cacheState: '' | 'local' | 'validated' = '';
  corsExposedHeaderNameList: string[] = [];
  rangeRequested = false;
  requestIncludesCredentials = true;
  timingAllowPassed = false;
  navigationTimingAllowValuesList: string[][] = [];
  bodyInfo = new ResponseBodyInfo();
  serviceWorkerTimingInfo: ServiceWorkerTimingInfo | null = null;
  redirectTaint: 'same-origin' | 'same-site' | 'cross-site' = 'same-origin';

  /** https://fetch.spec.whatwg.org/#concept-network-error */
  static networkError(): ResponseRecord {
    const response = new ResponseRecord();
    response.type = 'error';
    response.status = 0;
    return response;
  }

  /** https://fetch.spec.whatwg.org/#concept-aborted-network-error */
  static abortedNetworkError(): ResponseRecord {
    const response = ResponseRecord.networkError();
    response.aborted = true;
    return response;
  }

  /** https://fetch.spec.whatwg.org/#appropriate-network-error */
  static appropriateNetworkError(params: FetchParams): ResponseRecord {
    if (!params.canceled) throw new Error('Fetch params are not canceled');
    return params.aborted ? ResponseRecord.abortedNetworkError() : ResponseRecord.networkError();
  }

  get url(): URLRecord | null {
    return this.urlList.at(-1) ?? null;
  }

  /** https://fetch.spec.whatwg.org/#serialize-a-response-url-for-reporting */
  serializeURLForReporting(): string {
    const url = this.urlList[0];
    if (url === undefined) throw new Error('Response URL list is empty');
    return serializeURL({ ...url, username: '', password: '' }, true);
  }

  /**
   * https://fetch.spec.whatwg.org/#concept-filtered-response
   * Only the specified overrides belong to the view. Other fields continue to
   * refer to the internal response, including replacement bodies and timing updates.
   * Headers are a separate filtered list, as in Blink, Gecko, and WebKit.
   */
  filter(type: FilteredResponseType): FilteredResponseRecord {
    if (this.type === 'error' || isFilteredResponse(this)) {
      throw new Error('Cannot filter a network error or an already filtered response');
    }
    const headerList: HeaderList = type === 'basic' || type === 'cors' ? this.headerList
      .filter(([name]) => type === 'basic' ? !isForbiddenResponseHeaderName(name)
        : isCORSSafelistedResponseHeaderName(name, this.corsExposedHeaderNameList))
      .map(([name, value]) => [name, value]) : [];
    const overrides: Partial<ResponseRecord> & { internalResponse: ResponseRecord; } = {
      type, internalResponse: this, headerList,
    };
    if (type === 'opaque' || type === 'opaqueredirect') {
      Object.assign(overrides, {
        status: 0, statusMessage: '', body: null, bodyInfo: new ResponseBodyInfo(),
      });
      if (type === 'opaque') overrides.urlList = [];
    }
    // Use the view as the getter receiver so derived fields (notably url) see its overrides.
    return new Proxy<ResponseRecord>(this, {
      get(target, key, receiver) {
        return Reflect.get(Object.hasOwn(overrides, key) ? overrides : target, key, receiver) as unknown;
      },
      set(target, key, value) {
        if (Object.hasOwn(overrides, key)) throw new Error(`Cannot replace filtered response ${String(key)}`);
        return Reflect.set(target, key, value);
      },
      has(target, key) {
        return Object.hasOwn(overrides, key) || Reflect.has(target, key);
      },
    }) as FilteredResponseRecord;
  }

  /** https://fetch.spec.whatwg.org/#concept-response-clone */
  clone(): ResponseRecord {
    if (isFilteredResponse(this)) return this.internalResponse.clone().filter(this.type);
    return Object.assign(new ResponseRecord(), this, {
      headerList: this.headerList.map(([name, value]) => [name, value]),
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
      cacheControl: getHeader('Cache-Control', this.headerList) ?? undefined,
      date: getHeader('Date', this.headerList) ?? undefined,
      age: getHeader('Age', this.headerList) ?? undefined,
      expires: getHeader('Expires', this.headerList) ?? undefined,
      lastModified: getHeader('Last-Modified', this.headerList) ?? undefined,
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
    const values = extractHeaderListValues('Location', this.headerList, (value) => [value], false);
    if (values === undefined || values === null) return values;
    const url = parseURL(values[0]!, this.url).url;
    if (url !== null && url.fragment === null) url.fragment = requestFragment;
    return url;
  }
}

export type ResponseType = 'default' | 'error' | FilteredResponseType;
export type FilteredResponseType = 'basic' | 'cors' | 'opaque' | 'opaqueredirect';

export type FilteredResponseRecord = ResponseRecord & {
  type: FilteredResponseType;
  readonly internalResponse: ResponseRecord;
};

function isFilteredResponse(response: ResponseRecord): response is FilteredResponseRecord {
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
  #response: ResponseRecord;
  #headers: HeadersImpl;
  #bodyMixin: BodyMixin;

  // Internal allocation from an existing response and header guard.
  // SPEC_MISMATCH: create a Response object(response, guard, realm) -> Response
  constructor(response: ResponseRecord, guard: HeadersGuard) {
    this.#response = response;
    this.#headers = new HeadersImpl(response.headerList, guard);
    this.#bodyMixin = new BodyMixin(response);
  }

  static error(): ResponseImpl {
    throw new Error('Response.error is not implemented');
  }

  static redirect(_url: string, _status: number): ResponseImpl {
    throw new Error('Response.redirect is not implemented');
  }

  static json(_data: unknown, _init: ResponseInitRecord): ResponseImpl {
    throw new Error('Response.json is not implemented');
  }

  get type(): ResponseType { return this.#response.type; }
  get url(): string { return this.#response.url === null ? '' : serializeURL(this.#response.url, true); }
  get redirected(): boolean { return this.#response.urlList.length > 1; }
  get status(): number { return this.#response.status; }
  get ok(): boolean { return this.#response.status >= 200 && this.#response.status <= 299; }
  get statusText(): string { return this.#response.statusMessage; }
  get headers(): HeadersImpl { return this.#headers; }

  clone(): ResponseImpl {
    throw new Error('Response.clone is not implemented');
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

  getResponse(): ResponseRecord { return this.#response; }
}

/** Post-conversion dictionary; Web IDL supplies status and statusText defaults. */
export type ResponseInitRecord = {
  status: number;
  statusText: string;
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
  implementation: impl(ResponseImpl),
  members: [
    ctor([
      arg('body', nullable(reference('BodyInit')), { optional: true, default: null }),
      arg('init', reference('ResponseInit'), { optional: true, default: emptyDictionary }),
    ], { invoke() { throw new Error('Response construction from BodyInit is not implemented'); } }),
    staticOp('error', reference('Response'), [], xattr('NewObject')),
    staticOp('redirect', reference('Response'),
      [
        arg('url', idlType.USVString),
        arg('status', idlType.unsignedShort, { optional: true, default: integer(302) }),
      ],
      xattr('NewObject'),
    ),
    staticOp('json', reference('Response'),
      [
        arg('data', idlType.any),
        arg('init', reference('ResponseInit'), { optional: true, default: emptyDictionary }),
      ],
      xattr('NewObject'),
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
