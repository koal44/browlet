import type { ReadableStreamImpl } from '../streams/index';
import { serializeURL, type URLRecord } from '../url/url';
import {
  arg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface,
  dictMember, emptyDictionary, idlType, impl, integer, invokeWith, nullable, op, reference,
  roAttr, xattr,
} from '../web-idl/declaration/index';
import { bind, bindingContext, type BindingContext } from '../web-idl/projection';
import { BodyMixin, type BodyRecord } from './body';
import { HeadersImpl, type HeaderList, type HeadersGuard, type HeadersInitValue } from './headers';
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

  get url(): URLRecord | null {
    return this.urlList.at(-1) ?? null;
  }

  clone(): ResponseRecord {
    throw new Error('Fetch response cloning is not implemented');
  }
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
  readonly #response: ResponseRecord;
  readonly #headers: HeadersImpl;
  readonly #bodyMixin: BodyMixin;

  // Internal allocation from an existing response and header guard.
  // SPEC_MISMATCH: create a Response object(response, guard, realm) -> Response
  constructor(context: BindingContext, response: ResponseRecord, guard: HeadersGuard) {
    this.#response = response;
    this.#headers = context.construct(HeadersImpl, response.headerList, guard);
    this.#bodyMixin = new BodyMixin(response);
  }

  static error(_context: BindingContext): ResponseImpl {
    throw new Error('Response.error is not implemented');
  }

  static redirect(_context: BindingContext, _url: string, _status: number): ResponseImpl {
    throw new Error('Response.redirect is not implemented');
  }

  static json(_context: BindingContext, _data: unknown, _init: ResponseInitRecord): ResponseImpl {
    throw new Error('Response.json is not implemented');
  }

  get type(): ResponseType { return this.#response.type; }
  get url(): string { return this.#response.url === null ? '' : serializeURL(this.#response.url, true); }
  get redirected(): boolean { return this.#response.urlList.length > 1; }
  get status(): number { return this.#response.status; }
  get ok(): boolean { return this.#response.status >= 200 && this.#response.status <= 299; }
  get statusText(): string { return this.#response.statusMessage; }
  get headers(): HeadersImpl { return this.#headers; }

  clone(_context: BindingContext): ResponseImpl {
    throw new Error('Response.clone is not implemented');
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

  static getResponse(response: ResponseImpl): ResponseRecord { return response.#response; }
}

/**
 * Filtered responses must refer to their internal response's changing fields.
 * Building that view is deferred; copying a record and setting type is not filtering.
 */
export function createFilteredResponse(
  _response: ResponseRecord,
  _type: FilteredResponseRecord['type'],
): FilteredResponseRecord {
  throw new Error('Fetch response filtering is not implemented');
}

export type ResponseType = 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect';

export type FilteredResponseRecord = ResponseRecord & {
  type: 'basic' | 'cors' | 'opaque' | 'opaqueredirect';
  readonly internalResponse: ResponseRecord;
};

/** Post-conversion dictionary; Web IDL supplies status and statusText defaults. */
export type ResponseInitRecord = {
  status: number;
  statusText: string;
  headers?: HeadersInitValue;
};

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
  implementation: impl(ResponseImpl, { constructWith: [bindingContext] }),
  members: [
    ctor([
      arg('body', nullable(reference('BodyInit')), { optional: true, default: null }),
      arg('init', reference('ResponseInit'), { optional: true, default: emptyDictionary }),
    ], bind({ invoke() { throw new Error('Response construction from BodyInit is not implemented'); } })),
    op('error', reference('Response'), [], { static: true, ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('redirect', reference('Response'), [
      arg('url', idlType.USVString),
      arg('status', idlType.unsignedShort, { optional: true, default: integer(302) }),
    ], { static: true, ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('json', reference('Response'), [
      arg('data', idlType.any),
      arg('init', reference('ResponseInit'), { optional: true, default: emptyDictionary }),
    ], { static: true, ...invokeWith(bindingContext), ...xattr('NewObject') }),
    roAttr('type', reference('ResponseType')),
    roAttr('url', idlType.USVString),
    roAttr('redirected', idlType.boolean),
    roAttr('status', idlType.unsignedShort),
    roAttr('ok', idlType.boolean),
    roAttr('statusText', idlType.ByteString),
    roAttr('headers', reference('Headers'), xattr('SameObject')),
    op('clone', reference('Response'), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
  ],
});

export const responseIncludesBodyIDL = defineIncludes({ interface: 'Response', mixin: 'Body' });
