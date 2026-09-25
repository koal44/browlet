import { parseDeltaSeconds } from '../../http/index';
import type { InternalPromise } from '../../infra/promises';
import { copyURL } from '../../url/index';
import { isCORSNonWildcardRequestHeaderName, parseCORSTokenList } from '../headers';
import { FetchParams } from '../params';
import { FetchRequest } from '../request';
import { FetchResponse } from '../response';
import { FetchTimingInfo } from '../timing';
import { isCORSSafelistedMethod } from './methods';
import { isOkStatus } from './statuses';

/** Check cross-origin method and header permissions before sending the actual request. */
// https://fetch.spec.whatwg.org/#cors-preflight-fetch-0
// SPEC_MISMATCH: (request) -> response
export function corsPreflightFetch(params: FetchParams): InternalPromise<FetchResponse> {
  const { request, env } = params;
  const preflight = new FetchRequest(request.url, request.client, request.userAgent);
  preflight.method = 'OPTIONS';
  preflight.urlList = [copyURL(request.url), ...request.urlList.slice(1).map(copyURL)];
  preflight.initiator = request.initiator;
  preflight.destination = request.destination;
  preflight.origin = request.origin;
  preflight.referrer = request.referrer;
  preflight.referrerPolicy = request.referrerPolicy;
  preflight.mode = 'cors';
  preflight.responseTainting = 'cors';
  preflight.webDriverId = request.webDriverId;
  // Retain the network partition and browser policy owner. CORS tainting plus
  // the default same-origin credentials mode keeps the preflight anonymous.
  preflight.reservedClient = request.reservedClient;
  preflight.policyContainer = request.policyContainer;
  preflight.traversableForUserPrompts = request.traversableForUserPrompts;
  preflight.headerList.append('Accept', '*/*');
  preflight.headerList.append('Access-Control-Request-Method', request.method);
  const unsafeNames = request.headerList.getCORSUnsafeRequestHeaderNames();
  if (unsafeNames.length > 0) preflight.headerList.append('Access-Control-Request-Headers', unsafeNames.join(','));

  // Share cancellation and scheduling, but not response callbacks or resource timing.
  const preflightParams = new FetchParams(preflight, new FetchTimingInfo(), env);
  preflightParams.controller = params.controller;
  preflightParams.taskDestination = params.taskDestination;
  preflightParams.crossOriginIsolatedCapability = params.crossOriginIsolatedCapability;
  return preflightParams.httpNetworkOrCacheFetch().then((response) => {
    const fail = () => { response.discardBody?.(); return FetchResponse.networkError(); };
    if (params.canceled) {
      response.discardBody?.();
      return FetchResponse.appropriateNetworkError(params);
    }
    // Check against the original credentials mode, although OPTIONS sends no credentials.
    if (response.isBlockedByCORS(request) || !isOkStatus(response.status)) return fail();
    let methods = response.headerList.extractValues('Access-Control-Allow-Methods', parseCORSTokenList, true);
    const headers = response.headerList.extractValues('Access-Control-Allow-Headers', parseCORSTokenList, true);
    if (methods === null || headers === null) return fail();
    if (methods === undefined && request.useCORSPreflight) methods = [request.method];
    const allowedMethods = methods ?? [];
    const allowedHeaders = (headers ?? []).map((name) => name.toLowerCase());
    const includeCredentials = request.credentialsMode === 'include';
    if (!allowedMethods.includes(request.method) && !isCORSSafelistedMethod(request.method) &&
      (includeCredentials || !allowedMethods.includes('*'))) return fail();
    // SPEC_CLASH(cors-authorization-wildcard): Follow Fetch's explicit Authorization grant; browsers still permit wildcard authorization on the wire (whatwg/fetch#1919).
    for (const [name] of request.headerList.list) {
      if (isCORSNonWildcardRequestHeaderName(name) && !allowedHeaders.includes(name.toLowerCase())) return fail();
    }
    for (const name of unsafeNames) {
      if (!allowedHeaders.includes(name) && (includeCredentials || !allowedHeaders.includes('*'))) return fail();
    }
    // SPEC_CLASH(cors-preflight-invalid-max-age): Fetch falls back to five seconds for invalid syntax; Gecko disables caching and Blink/WebKit treat negative ages as expired. Follow Fetch.
    const ages = response.headerList.extractValues('Access-Control-Max-Age', (value) => {
      const seconds = parseDeltaSeconds(value);
      return seconds === null ? null : [seconds];
    }, false);
    const maxAge = ages?.[0] ?? 5;
    const cache = request.userAgent.corsPreflightCache;
    for (const method of allowedMethods) cache.store(request, maxAge, method, null);
    for (const name of allowedHeaders) cache.store(request, maxAge, null, name);
    return response;
  });
}
