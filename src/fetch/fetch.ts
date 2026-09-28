import { utf8DecodeWithoutBOM } from '../encoding/index';
import {
  CacheControl, encodeBasicCredentials, evaluateCacheRequest, isHTTPToken, parseAuthenticationChallenges,
  parseDeltaSeconds, selectBasicChallenge, shouldInvalidateCache,
} from '../http/index';
import { TypeError } from '../infra/exceptions';
import { InternalError } from '../infra/internal-error';
import { ParallelQueue } from '../infra/parallel-queue';
import { type PromiseResultType, internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../infra/promises';
import { coarsenTime } from '../infra/time';
import { getBufferSourceCopy, getBufferTypeName, type JSEnvironment } from '../js-engine/index';
import { minimizeSupportedMIMEType, serializeMIMEType } from '../mime/index';
import { ReadableStreamImpl, TransformStreamImpl, type ReadableStreamDefaultReaderImpl } from '../streams/index';
import {
  areSameOrigin, copyURL, obtainURLOrigin, percentDecodeString, serializeURL, setURLPassword, setURLUsername,
  urlsEqual, type URLRecord,
} from '../url/index';
import { idlType, isDOMException } from '../web-idl/index';
import { FetchBody } from './body';
import type { HTTPCacheEntry, HTTPCachePartition } from './cache-http';
import { deserializeAbortReason, type FetchController } from './controller';
import { processDataURL } from './data-url';
import { isOffline, type AuthenticationCredentials, type AuthenticationEntry } from './environment';
import {
  convertHeaderNamesToSortedLowercaseSet, documentAcceptHeaderValue, isCORSNonWildcardRequestHeaderName, isCORSSafelistedMethod,
  isNullBodyStatus, isOkStatus, isRangeStatus, isRedirectStatus, isRequestBodyHeaderName,
  parseCORSTokenList, parseSingleRangeHeaderValue, serializeInteger,
} from './headers';
import { bytesMatchIntegrityMetadata } from './integrity';
import { FetchParams } from './params';
import { isBlockedByBadPort, isBlockedByMIMEType, isBlockedByNosniff } from './policy';
import { FetchRequest } from './request';
import { FetchResponse, isFilteredResponse } from './response';
import { FetchTimingInfo, type ServiceWorkerTimingInfo } from './timing';
import type { HTTPContentDecoder, HTTPTransportControl, HTTPUploadSource } from './transport';
import { isHTTPScheme, isLocalURL } from './url';

/** Populate a request, select callback delivery, and start its fetch without waiting for a response. */
// https://fetch.spec.whatwg.org/#concept-fetch
export function fetch(
  request: FetchRequest, options: FetchOptions = {}, env: JSEnvironment,
): FetchController {
  if (request.mode !== 'navigate' && options.processEarlyHintsResponse !== undefined && options.processEarlyHintsResponse !== null) {
    throw new InternalError('Early Hints processing requires a navigation request');
  }

  request.populateFromClient();
  const { client, userAgent } = request;
  const isolated = client?.crossOriginIsolatedCapability ?? false;
  const timing = new FetchTimingInfo();
  timing.startTime = timing.postRedirectStartTime = coarsenTime(userAgent.unsafeSharedCurrentTime(), isolated);
  timing.renderBlocking = request.renderBlocking;
  const params = new FetchParams(request, timing, env);
  params.taskDestination = options.useParallelQueue
    ? new ParallelQueue(userAgent.runInParallel)
    : client?.exec.global ?? null;
  params.crossOriginIsolatedCapability = isolated;
  params.processRequestBodyChunkLength = options.processRequestBodyChunkLength ?? null;
  params.processRequestEndOfBody = options.processRequestEndOfBody ?? null;
  params.processEarlyHintsResponse = options.processEarlyHintsResponse ?? null;
  params.processResponse = options.processResponse ?? null;
  params.processResponseEndOfBody = options.processResponseEndOfBody ?? null;
  params.processResponseConsumeBody = options.processResponseConsumeBody ?? null;

  if (request.body instanceof Uint8Array) request.body = FetchBody.fromBytes(request.body, env);
  userAgent.webDriverBiDiCloneNetworkRequestBody(request);

  if (isHTTPScheme(request.url.scheme) &&
    (request.mode === 'same-origin' || request.mode === 'cors' || request.mode === 'no-cors') &&
    client?.isWindow && request.method === 'GET' &&
    (!request.unsafeRequest || request.headerList.list.length === 0)) {
    if (request.origin === undefined || !areSameOrigin(request.origin, client.origin)) {
      throw new InternalError('Preload consumption requires the client origin');
    }
    const pending = userAgent.HostPromise.withResolvers(responseType);
    const found = client.consumePreloadedResource(
      request.url, request.destination, request.mode, request.credentialsMode, request.integrityMetadata,
      (response: FetchResponse) => {
        params.preloadedResponseCandidate = response;
        pending.resolve(response);
      },
    );
    if (found && params.preloadedResponseCandidate === null) {
      params.preloadedResponseCandidate = pending.promise;
    }
  }

  if (!request.headerList.has('Accept')) {
    let value = '*/*';
    if (request.initiator === 'prefetch') {
      value = documentAcceptHeaderValue;
    } else {
      switch (request.destination) {
        case 'document': case 'frame': case 'iframe': value = documentAcceptHeaderValue; break;
        case 'image': value = 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'; break;
        case 'json': value = 'application/json,*/*;q=0.5'; break;
        case 'style': value = 'text/css,*/*;q=0.1'; break;
        case 'text': value = 'text/plain,*/*;q=0.5'; break;
      }
    }
    request.headerList.append('Accept', value);
  }
  if (!request.headerList.has('Accept-Language') && client !== null) {
    const language = userAgent.webDriverBiDiEmulatedLanguage(client);
    if (language !== null) request.headerList.append('Accept-Language', language);
  }
  if (!request.headerList.has('Accept-Language') && userAgent.defaultAcceptLanguage !== null) {
    request.headerList.append('Accept-Language', userAgent.defaultAcceptLanguage);
  }
  if (request.internalPriority === null) {
    request.internalPriority = userAgent.determineFetchPriority(request);
  }
  if (request.isSubresource) {
    if (client === null) throw new InternalError('A subresource request requires a client');
    client.fetchGroup.fetchRecords.push({ request, controller: params.controller });
  }
  mainFetch(params);
  return params.controller;
}

/** Optional processing steps and callback destination for a fetch. */
export interface FetchOptions {
  processRequestBodyChunkLength?: ((length: number) => void) | null;
  processRequestEndOfBody?: (() => void) | null;
  processEarlyHintsResponse?: ((response: FetchResponse) => void) | null;
  processResponse?: ((response: FetchResponse) => void) | null;
  processResponseEndOfBody?: ((response: FetchResponse) => void) | null;
  processResponseConsumeBody?: ((response: FetchResponse, body: Uint8Array | null | 'failure') => void) | null;
  /** Deliver processing steps on a parallel queue instead of the client's global. */
  useParallelQueue?: boolean;
}

/** Apply main-fetch policy, dispatch, and hand over the resulting response. */
// https://fetch.spec.whatwg.org/#concept-main-fetch
// Recursive dispatch waits for a response using the browser's internal Promise destination.
function mainFetch(params: FetchParams, recursive?: false): void;
function mainFetch(params: FetchParams, recursive: true): InternalPromise<FetchResponse>;
function mainFetch(params: FetchParams, recursive = false): InternalPromise<FetchResponse> | void {
  const { request } = params;
  const { userAgent } = request;
  let response: FetchResponse | null = null;
  if (request.localURLsOnly && !isLocalURL(request.currentURL)) response = FetchResponse.networkError();

  request.reportCSPViolations();
  request.upgradeInsecureRequest();
  request.upgradeMixedContent();
  if (isBlockedByBadPort(request) || request.isBlockedByMixedContent() ||
    request.isBlockedByCSP() || request.isBlockedByIntegrityPolicy()) {
    response = FetchResponse.networkError();
  }
  if (request.policyContainer === undefined) throw new InternalError('Main fetch requires populated request policies');
  if (request.referrerPolicy === '') request.referrerPolicy = request.policyContainer.referrerPolicy;
  if (request.referrer !== null) request.referrer = userAgent.determineRequestReferrer(request);
  request.upgradeForHSTS();
  // Fetch permits HTTPS DNS-record upgrading during connection establishment.
  // TODO: consume HTTPS RR results in the transport; an upgrade must never retry HTTP.

  const getResponse = () => response ?? dispatchFetch(params);
  if (recursive) return userAgent.HostPromise.try(getResponse, responseType);
  userAgent.runInParallel(() => {
    userAgent.HostPromise.try(getResponse, responseType).observe(
      // Body/Streams operations must enter their owner's task and checkpoint.
      (result) => params.env.queueNetworkingTask(() => processFetchResponse(params, result), params.env.exec.global),
      (error) => params.env.queueNetworkingTask(() => { throw error; }, params.env.exec.global),
    );
  });
}

/** Select an overridden response or dispatch to scheme/HTTP fetch. */
// https://fetch.spec.whatwg.org/#concept-override-fetch
// The internal Promise carries the response produced by downstream dispatch.
function overrideFetch(params: FetchParams, type: 'scheme-fetch' | 'http-fetch', makeCORSPreflight = false): InternalPromise<FetchResponse> {
  const { request, env } = params;
  return request.userAgent.HostPromise.try(() => {
    const response = request.userAgent.potentiallyOverrideResponse(request, env);
    if (response !== null) return response;

    switch (type) {
      case 'scheme-fetch': return schemeFetch(params);
      case 'http-fetch': return httpFetch(params, makeCORSPreflight);
    }
  }, responseType);
}

/** Obtain a response from the request's current URL scheme. */
// https://fetch.spec.whatwg.org/#concept-scheme-fetch
function schemeFetch(params: FetchParams): InternalPromise<FetchResponse> {
  return params.request.userAgent.HostPromise.try(() => {
    if (params.canceled) return FetchResponse.appropriateNetworkError(params);
    const url = params.request.currentURL;
    switch (url.scheme) {
      case 'about': {
        if (url.path !== 'blank') break;
        const response = new FetchResponse();
        response.statusMessage = 'OK';
        response.headerList.append('Content-Type', 'text/html;charset=utf-8');
        response.body = FetchBody.fromBytes(new Uint8Array(), params.env);
        return response;
      }
      case 'blob': return blobFetch(params);
      case 'data': {
        const data = processDataURL(url);
        if (data === null) return FetchResponse.networkError();
        const response = new FetchResponse();
        response.statusMessage = 'OK';
        response.headerList.append('Content-Type', serializeMIMEType(data.mimeType));
        response.body = FetchBody.fromBytes(data.body, params.env);
        return response;
      }
      // Fetch leaves file: implementation-defined and permits a network error.
      case 'file': break;
      case 'http': case 'https': return httpFetch(params);
    }
    return FetchResponse.networkError();
  }, responseType);
}

/** Obtain an HTTP response, performing a CORS preflight when requested. */
// https://fetch.spec.whatwg.org/#concept-http-fetch
function httpFetch(params: FetchParams, makeCORSPreflight = false): InternalPromise<FetchResponse> {
  const { request } = params;
  const { userAgent } = request;
  return userAgent.HostPromise.try(() => request.allowServiceWorkerInterception
    ? fetchFromServiceWorker(params) : null, optionalResponseType).then((response) => {
    return response ?? fetchFromNetwork(params, makeCORSPreflight);
  }, undefined, responseType).then((response) => {
    if (response.type === 'error') return response;
    const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
    if (request.responseTainting === 'opaque' || response.type === 'opaque') {
      if (request.origin === undefined) throw new InternalError('HTTP fetch requires a populated request origin');
      // SPEC_CLASH(corp-clientless-policy): Fetch passes a nullable client to a settings-only check.
      // Clientless requests retain policy state; a missing reporting owner does not bypass CORP.
      const policyContainer = request.client?.policyContainer ?? request.policyContainer;
      if (policyContainer === undefined) throw new InternalError('HTTP fetch requires populated request policies');
      if (internalResponse.isBlockedByCORP(
        request.origin, policyContainer.embedderPolicy, request.destination, false, request.client,
      )) {
        internalResponse.discardBody?.();
        return FetchResponse.networkError();
      }
    }
    if (!isRedirectStatus(internalResponse.status)) return response;
    if (request.isNavigation) {
      request.navigationTimingAllowValuesList.push(internalResponse.headerList.getDecodeAndSplit('Timing-Allow-Origin') ?? []);
    }
    switch (request.redirectMode) {
      case 'error':
        internalResponse.discardBody?.();
        return FetchResponse.networkError();
      case 'manual':
        if (request.mode !== 'navigate') return internalResponse.filter('opaqueredirect');
        params.controller.nextManualRedirectSteps = () => {
          httpRedirectFetch(params, response).observe(
            // Invalid redirect targets finish here; a valid navigation restarts nonrecursive main fetch.
            (result) => {
              if (result !== undefined) params.env.queueNetworkingTask(() => processFetchResponse(params, result), params.env.exec.global);
            },
            (error) => params.env.queueNetworkingTask(() => { throw error; }, params.env.exec.global),
          );
        };
        return response;
      case 'follow':
        userAgent.webDriverBiDiResponseCompleted(request, response);
        return httpRedirectFetch(params, response).then((result) => {
          if (result === undefined) throw new InternalError('An automatic redirect must return a response');
          return result;
        }, undefined, responseType);
    }
  });
}

/** Follow an HTTP redirect, or restart delivery for a manually continued navigation. */
// https://fetch.spec.whatwg.org/#concept-http-redirect-fetch
// Undefined denotes a manual navigation whose nonrecursive main fetch now owns delivery.
function httpRedirectFetch(params: FetchParams, response: FetchResponse): InternalPromise<FetchResponse | undefined> {
  const { request, timingInfo, env } = params;
  const { userAgent } = request;
  return userAgent.HostPromise.try(() => {
    const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
    const location = internalResponse.getLocationURL(request.currentURL.fragment, userAgent);
    if (location === undefined) return response;
    // Following or rejecting Location makes this exchange's body unnecessary.
    // Release it without canceling the controller that owns the whole redirect chain.
    internalResponse.discardBody?.();
    if (location === null || !isHTTPScheme(location.scheme) || request.redirectCount === 20) {
      return FetchResponse.networkError();
    }
    request.redirectCount++;
    const hasCredentials = location.username !== '' || location.password !== '';
    if (request.origin === undefined) throw new InternalError('HTTP redirect requires a populated request origin');
    if (hasCredentials && ((request.mode === 'cors' && !areSameOrigin(request.origin, obtainURLOrigin(location))) ||
      request.responseTainting === 'cors')) {
      return FetchResponse.networkError();
    }
    if (request.body !== null && !(request.body instanceof FetchBody)) {
      throw new InternalError('HTTP redirect requires an extracted request body');
    }
    if (internalResponse.status !== 303 && request.body?.source === null) return FetchResponse.networkError();
    if (((internalResponse.status === 301 || internalResponse.status === 302) && request.method === 'POST') ||
      (internalResponse.status === 303 && request.method !== 'GET' && request.method !== 'HEAD')) {
      request.method = 'GET';
      request.body = null;
      request.headerList.list = request.headerList.list.filter(([name]) => !isRequestBodyHeaderName(name));
    }
    if (!areSameOrigin(obtainURLOrigin(request.currentURL), obtainURLOrigin(location))) {
      request.headerList.list = request.headerList.list.filter(([name]) => !isCORSNonWildcardRequestHeaderName(name));
    }
    const follow = () => {
      const now = coarsenTime(userAgent.unsafeSharedCurrentTime(), params.crossOriginIsolatedCapability);
      timingInfo.redirectEndTime = timingInfo.postRedirectStartTime = now;
      if (timingInfo.redirectStartTime === 0) timingInfo.redirectStartTime = timingInfo.startTime;
      request.urlList.push(location);
      userAgent.setRequestReferrerPolicyOnRedirect(request, internalResponse);
      if (request.redirectMode === 'manual') {
        if (request.mode !== 'navigate') throw new InternalError('Manual redirect continuation requires a navigation');
        mainFetch(params);
        return undefined;
      }
      return mainFetch(params, true);
    };
    if (request.body === null) return follow();
    const source = request.body.source;
    if (source === null) throw new InternalError('Redirect body replay requires a retained source');
    return runBodySteps(params, () => {
      request.body = FetchBody.fromSource(source, env);
    }, idlType.undefined).then(follow, undefined, redirectResponseType);
  }, redirectResponseType);
}

/** Prepare an HTTP attempt, consult the cache, and handle authentication or connection retries. */
// https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
function httpNetworkOrCacheFetch(
  params: FetchParams, isAuthenticationFetch = false, isNewConnectionFetch = false,
): InternalPromise<FetchResponse> {
  const { request, env } = params;
  const { userAgent } = request;
  const authentication = userAgent.httpAuthentication;
  const generation = authentication.generation;
  const rejectedCredentials = new Map<string, Set<string>>();
  let retryEntry: AuthenticationEntry | null = null;
  return attempt(isAuthenticationFetch, isNewConnectionFetch);

  // Retain the challenge across retries; successful responses need not repeat it.
  function attempt(isAuthenticationFetch: boolean, isNewConnectionFetch: boolean): InternalPromise<FetchResponse> {
    return runBodySteps(params, () => {
      if (params.canceled) return FetchResponse.appropriateNetworkError(params);
      if (request.body !== null && !(request.body instanceof FetchBody)) {
        throw new InternalError('HTTP transaction requires an extracted request body');
      }
      if (request.traversableForUserPrompts === undefined) {
        throw new InternalError('HTTP transaction requires a populated prompt target');
      }
      // Keep wire fields separate even with redirect:error: a 421 can still retry.
      // Consume the original stream once; reconstruct retained sources only for retries.
      const copy = request.clone(request.body);
      const httpParams = Object.assign(new FetchParams(copy, params.timingInfo, env), params, { request: copy });
      const httpRequest = httpParams.request;
      const includeCredentials = (request.credentialsMode === 'include' ||
        (request.credentialsMode === 'same-origin' && request.responseTainting === 'basic')) &&
        request.crossOriginEmbedderPolicyAllowsCredentials();
      const contentLength = request.body?.length ?? null;
      if (contentLength !== null) {
        httpRequest.headerList.append('Content-Length', String(contentLength));
      } else if (request.body === null && (request.method === 'POST' || request.method === 'PUT')) {
        httpRequest.headerList.append('Content-Length', '0');
      }
      if (request.keepalive && contentLength !== null) {
        if (request.client === null) throw new InternalError('Keepalive body accounting requires a client fetch group');
        let inflightBytes = 0;
        for (const record of request.client.fetchGroup.fetchRecords) {
        // SPEC_CLASH(keepalive-current-request-accounting): the draft counts the registered current request twice; browsers count it once.
          if (record.request !== request && record.request.keepalive && !record.request.done && record.request.body instanceof FetchBody) {
            inflightBytes += record.request.body.length ?? 0;
          }
        }
        if (contentLength + inflightBytes > 64 * 1024) return FetchResponse.networkError();
      }
      if (httpRequest.referrer) httpRequest.headerList.append('Referer', serializeURL(httpRequest.referrer));
      httpRequest.appendOriginHeader();
      httpRequest.appendMetadataHeadersIfTrustworthy();
      if (httpRequest.initiator === 'prefetch') httpRequest.headerList.set('Sec-Purpose', 'prefetch');
      httpRequest.appendUserAgentHeader();
      if (httpRequest.cacheMode === 'default' && conditionalHeaderNames.some((name) => httpRequest.headerList.has(name))) {
        httpRequest.cacheMode = 'no-store';
      }
      if (httpRequest.cacheMode === 'no-cache' && !httpRequest.preventNoCacheCacheControlHeaderModification &&
        !httpRequest.headerList.has('Cache-Control')) {
        httpRequest.headerList.append('Cache-Control', 'max-age=0');
      }
      if (httpRequest.cacheMode === 'no-store' || httpRequest.cacheMode === 'reload') {
        if (!httpRequest.headerList.has('Pragma')) httpRequest.headerList.append('Pragma', 'no-cache');
        if (!httpRequest.headerList.has('Cache-Control')) httpRequest.headerList.append('Cache-Control', 'no-cache');
      }
      if (httpRequest.headerList.has('Range')) httpRequest.headerList.append('Accept-Encoding', 'identity');
      if (!httpRequest.headerList.has('Accept-Encoding')) {
        httpRequest.headerList.append('Accept-Encoding', [...userAgent.supportedContentCodings].join(', '));
      }
      // Host/Connection and message framing stay with the negotiated transport protocol.
      let sentEntry: AuthenticationEntry | null = null;
      if (includeCredentials) {
        httpRequest.appendCookieHeader();
        if (!httpRequest.headerList.has('Authorization')) {
          const url = httpRequest.currentURL;
          const hasURLCredentials = url.username !== '' || url.password !== '';
          sentEntry = retryEntry ?? (!(request.useURLCredentials && hasURLCredentials) ? authentication.find(url) : null);
          const credentials = sentEntry ?? (isAuthenticationFetch && hasURLCredentials ? urlCredentials(url) : null);
          const authorization = credentials === null ? null : encodeBasicCredentials(credentials.username, credentials.password);
          if (authorization !== null) httpRequest.headerList.append('Authorization', authorization);
        }
      }
      authentication.applyProxyAuthentication(httpRequest);
      userAgent.webDriverBiDiBeforeRequestSent(request);
      return { httpParams, httpRequest, includeCredentials, sentEntry };
    }, attemptType).then((prepared) => {
      if (prepared instanceof FetchResponse) return prepared;
      if (params.canceled) return FetchResponse.appropriateNetworkError(params);
      const { httpParams, httpRequest, includeCredentials, sentEntry } = prepared;
      return fetchWithCache(httpParams, includeCredentials, isNewConnectionFetch, request).then((response) => {
        if (response.type === 'error') return response;
        if (params.canceled) { response.discardBody?.(); return FetchResponse.appropriateNetworkError(params); }
        response.urlList = [...httpRequest.urlList];
        response.rangeRequested = httpRequest.headerList.has('Range');
        response.requestIncludesCredentials = includeCredentials;
        const canPrompt = request.traversableForUserPrompts !== null;
        const needsOriginAuthentication = response.status === 401 && request.responseTainting !== 'cors' && includeCredentials && canPrompt;
        const challenges = response.status === 401
        ? parseAuthenticationChallenges(response.headerList.list.filter(([name]) => name.toLowerCase() === 'www-authenticate').map(([, value]) => value))
        : null;
        const challenge = challenges === null ? null : selectBasicChallenge(challenges);
        if (response.status === 401 && sentEntry !== null && (challenge === null || challenge.realm === sentEntry.realm)) {
          authentication.invalidate(request.currentURL, sentEntry);
        }
        if (needsOriginAuthentication && challenge !== null && request.headerList.has('Authorization')) {
          // SPEC_CLASH(basic-authored-authorization): Fetch can retry the unchanged authored header; return the 401 like Gecko.
          return response;
        }
        if (needsOriginAuthentication || response.status === 407) {
          if (!canPrompt) { response.discardBody?.(); return FetchResponse.networkError(); }
          if (request.body instanceof FetchBody && request.body.source === null) {
            response.discardBody?.();
            return FetchResponse.networkError();
          }
          const retry = () => {
            response.discardBody?.();
            return runBodySteps(params, () => {
              if (request.body instanceof FetchBody && request.body.source !== null) {
                request.body = FetchBody.fromSource(request.body.source, env);
              }
            }, idlType.undefined).then(() => attempt(needsOriginAuthentication, isNewConnectionFetch), undefined, responseType);
          };
          if (response.status === 407) {
            return authentication.promptProxy(request, response).then((accepted) => accepted ? retry() : response, undefined, responseType);
          }
          if (challenge === null) return response;
          const url = request.currentURL;
          let rejected = rejectedCredentials.get(challenge.realm);
          const authorization = httpRequest.headerList.get('Authorization');
          if (sentEntry?.realm === challenge.realm && authorization !== null) {
            if (!rejected) rejectedCredentials.set(challenge.realm, rejected = new Set<string>());
            rejected.add(authorization);
          }
          let candidate: AuthenticationEntry | null;
          if (request.useURLCredentials && !isAuthenticationFetch && (url.username !== '' || url.password !== '')) {
            candidate = { ...urlCredentials(url), realm: challenge.realm };
          } else {
            candidate = authentication.find(url, challenge.realm);
          }
          const cachedValue = candidate === null ? null : encodeBasicCredentials(candidate.username, candidate.password);
          // Rejected credentials cannot retry automatically; a fresh prompt may still supply them.
          const answer = candidate !== null && cachedValue !== null && !rejected?.has(cachedValue)
          ? userAgent.HostPromise.resolve(candidate, internalType<AuthenticationEntry>('AuthenticationEntry'))
          : authentication.prompt(request, challenge.realm, sentEntry, params.controller).then((entry) => {
            if (entry !== null && !params.canceled && generation === authentication.generation) {
              setURLUsername(url, entry.username);
              setURLPassword(url, entry.password);
            }
            return entry;
          });
          return answer.then((entry) => {
            if (params.canceled) { response.discardBody?.(); return FetchResponse.appropriateNetworkError(params); }
            if (entry === null || generation !== authentication.generation) return response;
            const value = encodeBasicCredentials(entry.username, entry.password);
            if (value === null) return response;
            retryEntry = entry;
            return retry();
          }, () => {
            response.discardBody?.();
            return params.canceled ? FetchResponse.appropriateNetworkError(params) : FetchResponse.networkError();
          }, responseType);
        }
        if (response.status === 421 && !isNewConnectionFetch &&
          (request.body === null || (request.body instanceof FetchBody && request.body.source !== null))) {
          response.discardBody?.();
          return runBodySteps(params, () => {
            if (request.body instanceof FetchBody && request.body.source !== null) {
              request.body = FetchBody.fromSource(request.body.source, env);
            }
          }, idlType.undefined).then(() => attempt(isAuthenticationFetch, true), undefined, responseType);
        }
        if (isAuthenticationFetch && sentEntry !== null && response.status !== 401 && response.status !== 407 && response.status !== 421) {
          authentication.store(request.currentURL, sentEntry, generation);
        }
        return response;
      });
    }, undefined, responseType);
  }
}

/** Perform the wire exchange, streaming response bytes to the body and optional cache. */
// https://fetch.spec.whatwg.org/#http-network-fetch
function httpNetworkFetch(
  params: FetchParams, includeCredentials = false, forceNewConnection = false, cache?: HTTPCachePartition,
): InternalPromise<FetchResponse> {
  const { request, env, controller, timingInfo } = params;
  const generation = cache?.generation;
  const result = request.userAgent.HostPromise.withResolvers(responseType);
  if (params.canceled) {
    result.resolve(FetchResponse.appropriateNetworkError(params));
    return result.promise;
  }
  if (request.userAgent.assumeNoInternetConnectivity || (request.client !== null && isOffline(request.client))) {
    result.resolve(FetchResponse.networkError());
    return result.promise;
  }
  if (request.body !== null && !(request.body instanceof FetchBody)) {
    throw new InternalError('HTTP network fetch requires an extracted request body');
  }
  if (request.mode === 'websocket' || request.mode === 'webtransport') {
    throw new InternalError('WebSocket and WebTransport connection establishment is not implemented');
  }

  // Stream creation and all subsequent stream mutations belong to this execution owner.
  env.queueNetworkingTask(() => {
    if (params.canceled) {
      result.resolve(FetchResponse.appropriateNetworkError(params));
      return;
    }
    const response = new FetchResponse();
    response.urlList = [...request.urlList];
    response.requestIncludesCredentials = includeCredentials;
    let removeCancellation = () => {};
    let discarded = false;
    let decoder: HTTPContentDecoder | undefined;
    let control: HTTPTransportControl | undefined;
    let decoderBlocked = false;
    let outputPaused = false;
    let transmitted = 0;
    let uploadEnded = false;
    let cacheEntry: HTTPCacheEntry | undefined;
    const upload = request.body instanceof FetchBody ? new NetworkUpload(request.body, params) : null;
    const body = new NetworkBody(params, () => {
      removeCancellation();
      response.discardBody = null;
    });
    response.body = new FetchBody(body.stream, env);
    body.setControl({
      pause() { outputPaused = true; decoder?.pause(); control?.pause(); },
      resume() {
        outputPaused = false;
        decoder?.resume();
        if (!decoderBlocked) control?.resume();
      },
      abort() {
        if (cacheEntry) cache!.owner.remove(cacheEntry);
        decoder?.abort(); upload?.cancel(); control?.abort();
      },
    });
    response.discardBody = () => {
      discarded = true;
      body.fail(() => new TypeError('Unused HTTP response body was discarded'));
    };
    const cancel = () => {
      response.aborted = params.aborted;
      body.fail(() => params.aborted
        ? deserializeAbortReason(controller.serializedAbortReason, env)
        : new TypeError('Network request was terminated'));
      if (!result.isResolved) result.resolve(FetchResponse.appropriateNetworkError(params));
    };
    removeCancellation = controller.addCancellationSteps(cancel);
    const requestTime = Date.now();
    try {
      control = request.userAgent.httpTransport.dispatch({
        url: request.currentURL,
        method: request.method,
        headers: request.headerList,
        body: upload,
        partitionKey: request.determineNetworkPartitionKey(),
        includeCredentials,
        forceNewConnection,
      }, {
        onConnection(connection) {
          timingInfo.finalConnectionTimingInfo = connection.timingInfo.clampAndCoarsen(
            timingInfo.postRedirectStartTime, params.crossOriginIsolatedCapability,
          );
          if (connection.protocol === 'http/1.1' && request.body instanceof FetchBody && request.body.source === null) {
            return false;
          }
          timingInfo.finalNetworkRequestStartTime = now();
          return !params.canceled;
        },
        onRequestBodyChunkLength(length) {
          transmitted += length;
          queueCallback(() => params.processRequestBodyChunkLength?.(length));
          // The peer can finish a known-length response before Undici observes upload EOF.
          if (request.body instanceof FetchBody && transmitted === request.body.length) endUpload();
        },
        onRequestEnd: endUpload,
        onResponseStarted() { timingInfo.finalNetworkResponseStartTime = now(); },
        onHeaders(status, statusMessage, headers, hasValidTLS) {
          if (params.canceled || discarded) return;
          if (status < 200) {
            if (timingInfo.firstInterimNetworkResponseStartTime === 0) {
              timingInfo.firstInterimNetworkResponseStartTime = timingInfo.finalNetworkResponseStartTime;
            }
            const interim = new FetchResponse();
            interim.status = status;
            interim.headerList = headers;
            request.userAgent.webDriverBiDiResponseStarted(request, interim);
            if (status === 103 && params.processEarlyHintsResponse !== null) {
              queueCallback(() => params.processEarlyHintsResponse?.(interim));
            }
            return;
          }
          response.status = status;
          response.statusMessage = statusMessage;
          response.headerList = headers;
          request.userAgent.webDriverBiDiResponseStarted(request, response);
          request.userAgent.hstsStore.processResponse(response, hasValidTLS);
          if (includeCredentials) response.parseAndStoreCookies(request);
          request.userAgent.webDriverBiDiCloneNetworkResponseBody(request, response);
          if (request.method !== 'HEAD' && !isNullBodyStatus(status)) {
            // https://fetch.spec.whatwg.org/#handle-content-codings
            const codings = headers.getDecodeAndSplit('Content-Encoding')?.filter((coding) => coding !== '');
            if (codings?.length && codings.every(isHTTPToken)) {
              // RFC 9110 treats x-gzip as gzip. Keep the received name
              // in response metadata and use the canonical name for decoding.
              // https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1.3
              const normalized = codings.map((coding) => {
                const name = coding.toLowerCase();
                return name === 'x-gzip' ? 'gzip' : name;
              });
              const supported = normalized.every((coding) => request.userAgent.supportedContentCodings.has(coding));
              response.bodyInfo.contentEncoding = normalized.length > 1 ? 'multiple' : supported ? codings[0]!.toLowerCase() : '@unknown';
              if (supported) {
                decoder = request.userAgent.createContentDecoder(normalized, {
                  onData: receiveDecoded,
                  onEnd: endResponse,
                  onError() { if (!discarded && !params.canceled) controller.terminate(); },
                  onDrain() {
                    decoderBlocked = false;
                    if (!outputPaused && !params.canceled && !discarded) control?.resume();
                  },
                });
              }
            }
          }
          if (cache && generation === cache.generation) cacheEntry = cache.begin(request, response, requestTime, Date.now());
          result.resolve(response);
        },
        onData(bytes) {
          if (params.canceled || discarded) return;
          response.bodyInfo.encodedSize += bytes.byteLength;
          if (decoder) {
            if (!decoder.write(bytes)) { decoderBlocked = true; control?.pause(); }
          } else {
            receiveDecoded(bytes);
          }
        },
        onEnd() { upload?.cancel(); if (decoder) decoder.end(); else endResponse(); },
        onError() {
          // Native transport errors do not become page-owned exception objects.
          if (!params.canceled && !discarded) controller.terminate();
        },
      });
      synchronizeControl();
    } catch (error) {
      removeCancellation();
      body.fail(() => new TypeError('Network request failed'));
      result.reject(error);
    }

    function receiveDecoded(bytes: Uint8Array): void {
      if (params.canceled || discarded) return;
      response.bodyInfo.decodedSize += bytes.byteLength;
      cacheEntry?.append(bytes);
      body.receive(bytes);
    }
    function endResponse(): void {
      if (params.canceled || discarded) return;
      cacheEntry?.finish(response.bodyInfo);
      cacheEntry = undefined;
      body.end();
    }
    // dispatch() may synchronously deliver callbacks before returning its control.
    function synchronizeControl(): void {
      if (params.canceled || discarded) control!.abort();
      else if (decoderBlocked || outputPaused) control!.pause();
    }
    function now(): number {
      return coarsenTime(request.userAgent.unsafeSharedCurrentTime(), params.crossOriginIsolatedCapability);
    }
    function queueCallback(steps: () => void): void {
      env.queueNetworkingTask(() => { if (!params.canceled && !discarded) steps(); }, params.taskDestination ?? env.exec.global);
    }
    function endUpload(): void {
      if (uploadEnded) return;
      uploadEnded = true;
      queueCallback(() => params.processRequestEndOfBody?.());
    }
  }, env.exec.global);
  return result.promise;
}

/** Check cross-origin method and header permissions before sending the actual request. */
// https://fetch.spec.whatwg.org/#cors-preflight-fetch-0
function corsPreflightFetch(params: FetchParams): InternalPromise<FetchResponse> {
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
  return httpNetworkOrCacheFetch(preflightParams).then((response) => {
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

/** Deliver headers and observe/consume the body, entered on the body's execution owner's task. */
// https://fetch.spec.whatwg.org/#fetch-finale
function fetchFinale(params: FetchParams, response: FetchResponse): void {
  const { request, timingInfo } = params;
  const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
  if (response.type !== 'error' && request.client?.isSecureContext) {
    timingInfo.serverTimingHeaders = internalResponse.headerList.getDecodeAndSplit('Server-Timing') ?? [];
  }
  if (request.destination === 'document') params.controller.fullTimingInfo = timingInfo;
  const endOfBody = () => endResponseBody(params, response);
  if (params.processResponse !== null) {
    const processResponse = params.processResponse;
    queueTask(params, () => processResponse(response));
  }
  if (response.type === 'error') request.userAgent.webDriverBiDiFetchError(request);
  else request.userAgent.webDriverBiDiResponseCompleted(request, response);

  if (internalResponse.body === null) {
    endOfBody();
  } else {
    // SPEC_CLASH(fetch-finale-byte-stream): The draft's identity transform loses BYOB.
    // Observe the original stream instead, as Undici does; browsers retain byte streams.
    // SPEC_CLASH(fetch-body-completion): Flush covers normal EOF only; finish on error/cancel too.
    internalResponse.body.stream.onCompletion(endOfBody, endOfBody);
  }
  if (params.processResponseConsumeBody !== null) {
    const consume = params.processResponseConsumeBody;
    if (internalResponse.body === null) {
      queueTask(params, () => consume(response, null));
    } else {
      internalResponse.body.readAll(
        (bytes) => consume(response, bytes), () => consume(response, 'failure'), params.taskDestination,
      );
    }
  }
}

/** Fetch a captured Blob URL registration, enforcing partition access and an optional byte range. */
// The blob: branch of https://fetch.spec.whatwg.org/#concept-scheme-fetch
function blobFetch(params: FetchParams): FetchResponse {
  const { request, env } = params;
  const entry = request.currentURL.blobURLEntry;
  if (request.method !== 'GET' || entry === null) return FetchResponse.networkError();

  const requestEnv = request.determineEnvironment();
  const isTopLevelSelfFetch = request.client?.isTopLevelWindow &&
    requestEnv !== null && urlsEqual(requestEnv.creationURL, request.currentURL);
  const access = request.destination === 'document' ? 'top-level-navigation'
    : isTopLevelSelfFetch ? 'top-level-self-fetch' : requestEnv;
  // SPEC_CLASH(blob-clientless-access-context): Fetch permits null; File API requires a context or exemption.
  // Clientless requests are valid, but ordinary Blob access still needs a partition context.
  // Unlike CORP's retained policy, a request origin is not a retained storage-partition context.
  // A future browser-owned Blob consumer must supply that authorization explicitly.
  if (access === null) throw new InternalError('Blob fetch requires an access context');
  const blob = request.userAgent.obtainBlobObject(entry, access);
  if (blob === null) return FetchResponse.networkError();

  const response = new FetchResponse();
  const fullLength = BigInt(blob.size);
  const rangeHeader = request.headerList.get('Range');
  let responseBlob = blob;
  let contentRange: string | null = null;
  response.statusMessage = 'OK';
  if (rangeHeader !== null) {
    response.rangeRequested = true;
    const range = parseSingleRangeHeaderValue(rangeHeader, true);
    // SPEC_CLASH(blob-suffix-range-bounds): the draft can produce negative or inverted bounds.
    // Clamp oversized suffixes like Chromium/WebKit, and reject ranges with no bytes.
    // Gecko rejects oversized suffixes; the reviewed choice is in the Fetch roadmap.
    if (range === null || fullLength === 0n) return FetchResponse.networkError();
    let [start, end] = range;
    if (start === undefined) {
      if (end === 0n) return FetchResponse.networkError();
      start = end! >= fullLength ? 0n : fullLength - end!;
      end = fullLength - 1n;
    } else {
      if (start >= fullLength) return FetchResponse.networkError();
      if (end === undefined || end >= fullLength) end = fullLength - 1n;
    }
    responseBlob = blob.slice(Number(start), Number(end + 1n), blob.type);
    response.status = 206;
    response.statusMessage = 'Partial Content';
    // https://fetch.spec.whatwg.org/#build-a-content-range
    contentRange = `bytes ${start}-${end}/${fullLength}`;
  }
  response.body = FetchBody.extract(responseBlob, false, env).body;
  response.headerList.append('Content-Length', serializeInteger(responseBlob.size));
  response.headerList.append('Content-Type', blob.type);
  if (contentRange !== null) response.headerList.append('Content-Range', contentRange);
  return response;
}

// HTTP fetch's service-workers-mode "all" branch, including response validation.
// https://fetch.spec.whatwg.org/#concept-http-fetch
function fetchFromServiceWorker(params: FetchParams): InternalPromise<FetchResponse | null> {
  const { request, env, timingInfo, controller } = params;
  const { userAgent } = request;
  // SPEC_GAP(service-worker-unused-body): Fetch clones before Handle Fetch,
  // whose no-worker returns omit cleanup of that unused body branch.
  // Let the worker owner select interception before requesting its copy.
  const prepare = () => {
    const copy = request.clone();
    if (copy.body !== null) {
      if (!(copy.body instanceof FetchBody)) throw new InternalError('HTTP fetch requires an extracted request body');
      const transform = new TransformStreamImpl(null, {}, {}, env);
      transform.setUp((chunk) => {
        if (params.canceled) return;
        if (typeof chunk !== 'object' || chunk === null || getBufferTypeName(chunk) !== 'Uint8Array') {
          controller.terminate();
        } else {
          transform.enqueue(chunk);
        }
      });
      copy.body.stream = copy.body.stream.pipeThroughTransform(transform);
    }
    return copy;
  };
  // Call once, after selecting interception and before consuming or changing the request.
  const prepareRequest = () => request.body === null ? userAgent.HostPromise.try(prepare, requestType) : runBodySteps(params, prepare, requestType);
  const startTime = coarsenTime(userAgent.unsafeSharedCurrentTime(), params.crossOriginIsolatedCapability);
  return userAgent.handleFetch(request, controller, params.crossOriginIsolatedCapability, prepareRequest).then(
    (result: FetchResponse | ServiceWorkerTimingInfo | null) => {
      if (!(result instanceof FetchResponse)) {
        if (result !== null) timingInfo.serviceWorkerTimingInfo = result;
        return null;
      }
      timingInfo.finalServiceWorkerStartTime = startTime;
      timingInfo.serviceWorkerTimingInfo = result.serviceWorkerTimingInfo;
      const validate = () => {
        userAgent.webDriverBiDiResponseStarted(request, result);
        if (result.type === 'error' ||
          (request.mode === 'same-origin' && result.type === 'cors') ||
          (request.mode !== 'no-cors' && result.type === 'opaque') ||
          (request.redirectMode !== 'manual' && result.type === 'opaqueredirect') ||
          (request.redirectMode !== 'follow' && result.urlList.length > 1)) {
          return FetchResponse.networkError();
        }
        return result;
      };
      if (request.body === null) return validate();
      return runBodySteps(params, () => {
        if (!(request.body instanceof FetchBody)) throw new InternalError('HTTP fetch requires an extracted request body');
        // Cancellation does not wait for the source's cancellation promise.
        request.body.stream.cancelInternal(undefined).observe(() => {}, () => {});
        return validate();
      }, responseType);
    }, undefined, optionalResponseType,
  );
}

// HTTP fetch's response-is-null branch: preflight, HTTP, CORS, and TAO.
// https://fetch.spec.whatwg.org/#concept-http-fetch
function fetchFromNetwork(params: FetchParams, makeCORSPreflight: boolean): InternalPromise<FetchResponse> {
  const { request } = params;
  const { HostPromise, corsPreflightCache } = request.userAgent;
  const needsPreflight = makeCORSPreflight &&
    ((!corsPreflightCache.matchesMethod(request.method, request) &&
      (!isCORSSafelistedMethod(request.method) || request.useCORSPreflight)) ||
      request.headerList.getCORSUnsafeRequestHeaderNames().some((name) => !corsPreflightCache.matchesHeaderName(name, request)));
  const preflight: InternalPromise<FetchResponse | null> = needsPreflight
    ? corsPreflightFetch(params) : HostPromise.resolve(null, optionalResponseType);
  return preflight.then((preflightResponse: FetchResponse | null) => {
    if (preflightResponse?.type === 'error') return preflightResponse;
    preflightResponse?.discardBody?.();
    if (request.redirectMode === 'follow') request.allowServiceWorkerInterception = false;
    return httpNetworkOrCacheFetch(params).then((response: FetchResponse) => {
      if (request.responseTainting === 'cors' && response.isBlockedByCORS(request)) {
        response.discardBody?.();
        return FetchResponse.networkError();
      }
      if (response.isTimingBlocked(request)) request.timingAllowFailed = true;
      return response;
    });
  }, undefined, responseType);
}

// Main fetch's response selection, beginning with the preloaded-response check.
// https://fetch.spec.whatwg.org/#concept-main-fetch
function dispatchFetch(params: FetchParams): FetchResponse | InternalPromise<FetchResponse> {
  if (params.preloadedResponseCandidate !== null) return params.preloadedResponseCandidate;
  const { request } = params;
  if (request.origin === undefined) throw new InternalError('Main fetch requires a populated request origin');
  if ((areSameOrigin(obtainURLOrigin(request.currentURL), request.origin) && request.responseTainting === 'basic') ||
    request.currentURL.scheme === 'data' || request.mode === 'navigate' ||
    request.mode === 'websocket' || request.mode === 'webtransport') {
    request.responseTainting = 'basic';
    return overrideFetch(params, 'scheme-fetch');
  }
  if (request.mode === 'same-origin') return FetchResponse.networkError();
  if (request.mode === 'no-cors') {
    if (request.redirectMode !== 'follow') return FetchResponse.networkError();
    request.responseTainting = 'opaque';
    return overrideFetch(params, 'scheme-fetch');
  }
  if (!isHTTPScheme(request.currentURL.scheme)) return FetchResponse.networkError();
  request.responseTainting = 'cors';
  if (request.useCORSPreflight || (request.unsafeRequest &&
    (!isCORSSafelistedMethod(request.method) || request.headerList.getCORSUnsafeRequestHeaderNames().length > 0))) {
    return overrideFetch(params, 'http-fetch', true).then((response: FetchResponse) => {
      if (response.type === 'error') request.userAgent.corsPreflightCache.clearEntries(request);
      return response;
    });
  }
  return overrideFetch(params, 'http-fetch');
}

// Main fetch after the recursive return: filtering, blocking, integrity, handover.
// https://fetch.spec.whatwg.org/#concept-main-fetch
function processFetchResponse(params: FetchParams, response: FetchResponse): void {
  const { request } = params;
  if (response.type !== 'error' && !isFilteredResponse(response)) {
    if (request.responseTainting === 'cors') {
      const names = response.headerList.extractValues('Access-Control-Expose-Headers', parseCORSTokenList, true);
      if (request.credentialsMode !== 'include' && names?.includes('*')) {
        response.corsExposedHeaderNameList = convertHeaderNamesToSortedLowercaseSet(
          response.headerList.list.map(([name]) => name),
        );
      } else if (names !== null && names !== undefined) {
        response.corsExposedHeaderNameList = names;
      }
    }
    response = response.filter(request.responseTainting);
  }
  let internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
  if (internalResponse.urlList.length === 0) internalResponse.urlList = [...request.urlList];
  internalResponse.redirectTaint = request.redirectTaint;
  if (request.isNavigation) {
    internalResponse.navigationTimingAllowValuesList = request.navigationTimingAllowValuesList.map((values) => [...values]);
  }
  if (!request.timingAllowFailed) internalResponse.timingAllowPassed = true;
  if (response.type !== 'error' && (internalResponse.isBlockedByMixedContent(request) || internalResponse.isBlockedByCSP(request) ||
    isBlockedByMIMEType(internalResponse, request) || isBlockedByNosniff(internalResponse, request))) {
    internalResponse.discardBody?.();
    response = internalResponse = FetchResponse.networkError();
  }
  if (response.type === 'opaque' && isRangeStatus(internalResponse.status) && internalResponse.rangeRequested &&
    !request.headerList.has('Range')) {
    internalResponse.discardBody?.();
    response = internalResponse = FetchResponse.networkError();
  }
  if (response.type !== 'error' && (request.method === 'HEAD' || request.method === 'CONNECT' ||
    isNullBodyStatus(internalResponse.status))) {
    internalResponse.discardBody?.();
    internalResponse.body = null;
  }
  if (request.integrityMetadata !== '') {
    const fail = () => { internalResponse.discardBody?.(); fetchFinale(params, FetchResponse.networkError()); };
    if (response.body === null) { fail(); return; }
    response.body.readAll((bytes) => {
      if (!bytesMatchIntegrityMetadata(bytes, request.integrityMetadata)) { fail(); return; }
      response.body = FetchBody.fromBytes(bytes, params.env);
      fetchFinale(params, response);
    }, fail, params.env.exec.global);
  } else {
    fetchFinale(params, response);
  }
}

// Fetch finale's processResponseEndOfBody closure and timing steps.
// https://fetch.spec.whatwg.org/#fetch-finale
function endResponseBody(params: FetchParams, response: FetchResponse): void {
  const { request } = params;
  const unsafeEndTime = request.userAgent.unsafeSharedCurrentTime();
  params.controller.reportTimingSteps = (env) => {
    if (!isHTTPScheme(request.url.scheme)) return;
    let timingInfo = params.timingInfo;
    timingInfo.endTime = env.relativeHighResolutionTime(unsafeEndTime);
    let cacheUsage = response.cacheUsage;
    const bodyInfo = response.bodyInfo;
    if (!response.timingAllowPassed) {
      timingInfo = timingInfo.createOpaque();
      cacheUsage = undefined;
    }
    let status = 0;
    if (request.mode !== 'navigate' || response.redirectTaint === 'same-origin') {
      status = response.status;
      const mimeType = response.headerList.extractMIMEType();
      if (mimeType !== null) {
        bodyInfo.contentType = minimizeSupportedMIMEType(mimeType, (type) => request.userAgent.supportsMIMEType(type));
      }
    }
    if (request.initiatorType !== null) {
      env.markResourceTiming(timingInfo, request.url, request.initiatorType, cacheUsage, bodyInfo, status);
    }
  };
  queueTask(params, () => {
    request.done = true;
    params.processResponseEndOfBody?.(response);
    if (request.initiatorType !== null && request.client !== null &&
      request.client.exec.global === params.taskDestination) {
      params.controller.reportTiming(request.client);
    }
  });
}

// Stream operations enter the body's task/checkpoint owner.
function runBodySteps<T>(params: FetchParams, steps: () => NoInfer<T>, type: PromiseResultType<T>): InternalPromise<T> {
  const result = params.request.userAgent.HostPromise.withResolvers(type);
  params.env.queueNetworkingTask(() => {
    try { result.resolve(steps()); }
    catch (error) { result.reject(error); }
  }, params.env.exec.global);
  return result.promise;
}

function queueTask(params: FetchParams, steps: () => void): void {
  if (params.taskDestination === null) throw new InternalError('Fetch callback delivery requires a task destination');
  params.env.queueNetworkingTask(steps, params.taskDestination);
}

/** Select or validate a private cached response, otherwise perform the wire exchange. */
// Cache selection through response storage in HTTP-network-or-cache fetch.
// https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
// https://www.rfc-editor.org/rfc/rfc9111.html#section-4
function fetchWithCache(
  params: FetchParams, includeCredentials: boolean, forceNewConnection: boolean, sourceRequest: FetchRequest,
): InternalPromise<FetchResponse> {
  const { request, env } = params;
  const { userAgent } = request;
  const result = userAgent.HostPromise.withResolvers(responseType);
  const cache = userAgent.httpCache.determine(request);
  const generation = cache?.generation;
  if (cache === null) request.cacheMode = 'no-store';
  queue(() => {
    if (params.canceled) { result.resolve(FetchResponse.appropriateNetworkError(params)); return; }
    const mode = request.cacheMode;
    // Partial-body combination and evaluation of authored preconditions are optional.
    // Forward these requests intact rather than fabricate a representation or a 304.
    const canSelect = mode !== 'no-store' && mode !== 'reload' &&
      !request.headerList.has('Range') && !conditionalHeaderNames.some((name) => request.headerList.has(name));
    const stored = canSelect ? cache?.select(request) : undefined;
    const now = Date.now();
    const requestControl = request.headerList.get('Cache-Control') ?? '';
    if (stored) {
      const freshness = stored.freshness(now);
      const reuse = mode === 'force-cache' || mode === 'only-if-cached' || mode !== 'no-cache' &&
        evaluateCacheRequest(freshness, requestControl).canReuse;
      // Explicit request restrictions take precedence over an optional stale extension.
      const background = mode === 'default' && !reuse &&
        freshness.staleWhileRevalidate && requestControl === '' && request.client !== null;
      if (reuse || background) {
        const response = stored.materialize(request, 'local', now, env);
        userAgent.webDriverBiDiResponseStarted(request, response);
        if (background) revalidateInBackground(sourceRequest);
        result.resolve(response);
        return;
      }
      const tag = stored.response.headerList.get('ETag');
      const modified = stored.response.headerList.get('Last-Modified');
      if (tag !== null) request.headerList.append('If-None-Match', tag);
      if (modified !== null) request.headerList.append('If-Modified-Since', modified);
    }
    if (mode === 'only-if-cached') { result.resolve(FetchResponse.networkError()); return; }
    // RFC 9111 §5.2.1.7 is an HTTP response, unlike Fetch's cache-mode network error.
    if (CacheControl.parse(requestControl)?.has('only-if-cached')) {
      const response = new FetchResponse();
      response.status = 504;
      result.resolve(response);
      return;
    }
    const requestTime = Date.now();
    httpNetworkFetch(params, includeCredentials, forceNewConnection, mode === 'no-store' ? undefined : cache ?? undefined)
      .then((response) => {
        if (params.canceled) { response.discardBody?.(); result.resolve(FetchResponse.appropriateNetworkError(params)); return; }
        if (response.type === 'error') { result.resolve(response); return; }
        const responseTime = Date.now();
        if (cache && generation === cache.generation) {
          if (shouldInvalidateCache(request.method, response.status)) cache.invalidate(request);
          if (mode !== 'no-store' && request.method === 'HEAD' && response.status === 200) {
            cache.freshen(request, response, requestTime, responseTime);
          }
          if (stored && response.status === 304) {
            cache.revalidate(request, response, requestTime, responseTime);
          }
        }
        if (stored && response.status === 304) {
          response.discardBody?.();
          queue(() => result.resolve(params.canceled ? FetchResponse.appropriateNetworkError(params) :
            stored.materialize(request, 'validated', responseTime, env)));
        } else {
          result.resolve(response);
        }
      }, undefined, idlType.undefined).observe(() => {}, (error: unknown) => result.reject(error));
  });
  return result.promise;

  function queue(steps: () => void): void {
    env.queueNetworkingTask(() => {
      try { steps(); }
      catch (error) { result.reject(error); }
    }, env.exec.global);
  }
}

/** Consume revalidation incrementally and tie its lifetime to the originating client. */
// The stale-while-revalidate branch of https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
function revalidateInBackground(sourceRequest: FetchRequest): void {
  const client = sourceRequest.client!;
  const request = sourceRequest.clone(null);
  request.cacheMode = 'no-cache';
  request.preventNoCacheCacheControlHeaderModification = true;
  request.allowServiceWorkerInterception = false;
  // This response exists only to refresh the client's cache; drain its body to publish the entry.
  request.keepalive = false;
  const timing = new FetchTimingInfo();
  timing.startTime = timing.postRedirectStartTime = coarsenTime(client.userAgent.unsafeSharedCurrentTime(), client.crossOriginIsolatedCapability);
  const params = new FetchParams(request, timing, client);
  params.taskDestination = client.exec.global;
  params.crossOriginIsolatedCapability = client.crossOriginIsolatedCapability;
  params.processResponse = (response) => {
    const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
    internalResponse.body?.incrementallyRead(() => {}, () => {}, () => {}, client.exec.global);
  };
  client.fetchGroup.fetchRecords.push({ request, controller: params.controller });
  // Enter main fetch directly: revalidation must not consume a preload candidate.
  mainFetch(params);
}

function urlCredentials(url: URLRecord): AuthenticationCredentials {
  return {
    username: utf8DecodeWithoutBOM(Uint8Array.from(percentDecodeString(url.username))),
    password: utf8DecodeWithoutBOM(Uint8Array.from(percentDecodeString(url.password))),
  };
}

const conditionalHeaderNames = ['If-Modified-Since', 'If-None-Match', 'If-Unmodified-Since', 'If-Match', 'If-Range'];

// -----------------------------------------------------------------------------
// Network streams
// -----------------------------------------------------------------------------

/** Reads exactly one body chunk for each transport demand, always on the owning HTML loop. */
class NetworkUpload implements HTTPUploadSource {
  #body: FetchBody;
  #params: FetchParams;
  #reader: ReadableStreamDefaultReaderImpl | undefined;
  #finished = false;
  #pending: InternalPromiseWithResolvers<Uint8Array | null> | undefined;

  constructor(body: FetchBody, params: FetchParams) {
    this.#body = body;
    this.#params = params;
  }

  read(): InternalPromise<Uint8Array | null> {
    if (this.#pending) throw new InternalError('HTTP transport requested concurrent upload reads');
    const { env, request } = this.#params;
    const result = request.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>('UploadChunk'));
    this.#pending = result;
    env.queueNetworkingTask(() => {
      if (this.#finished || this.#params.canceled) { this.#settle(null); return; }
      try {
        if (!this.#reader) {
          this.#reader = this.#body.stream.getDefaultReader();
          this.#reader.closed.observe(() => {}, () => {});
        }
        this.#reader.readChunk({
          chunkSteps: (chunk) => {
            try {
              if (typeof chunk !== 'object' || chunk === null || getBufferTypeName(chunk) !== 'Uint8Array') {
                throw new TypeError('Request body stream produced a non-Uint8Array chunk');
              }
              this.#settle(getBufferSourceCopy(chunk));
            } catch (error) { this.#fail(error); }
          },
          closeSteps: () => {
            this.#finished = true;
            this.#reader!.release(env);
            this.#reader = undefined;
            this.#settle(null);
          },
          errorSteps: (error) => this.#fail(error),
        });
      } catch (error) { this.#fail(error); }
    }, env.exec.global);
    return result.promise;
  }

  cancel(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#settle(null);
    const { env } = this.#params;
    env.queueNetworkingTask(() => {
      const pending = this.#reader ? this.#reader.cancel() : this.#body.stream.cancelInternal(undefined);
      pending.observe(() => {}, () => {});
      this.#reader?.release(env);
      this.#reader = undefined;
    }, env.exec.global);
  }

  #settle(bytes: Uint8Array | null): void {
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.resolve(bytes);
  }

  #fail(error: unknown): void {
    const { controller, env } = this.#params;
    if (!this.#params.canceled) {
      if (isDOMException(error, 'AbortError')) controller.abort(env);
      else controller.terminate();
    }
    this.cancel();
  }
}

/** Fetch's network byte buffer, retaining chunks until the response stream pulls them. */
class NetworkBody {
  stream: ReadableStreamImpl;
  #params: FetchParams;
  #finish: () => void;
  #control: HTTPTransportControl | undefined;
  #chunks: (Uint8Array | undefined)[] = [];
  #head = 0;
  #offset = 0;
  #size = 0;
  #paused = false;
  #ended = false;
  #finished = false;
  #failure: (() => unknown) | undefined;
  #pull: InternalPromiseWithResolvers<void> | undefined;
  #taskQueued = false;

  constructor(params: FetchParams, finish: () => void) {
    this.#params = params;
    this.#finish = finish;
    this.stream = ReadableStreamImpl.createWithByteReadingSupport(
      () => {
        this.#pull = params.env.exec.Promise.withResolvers(idlType.undefined);
        this.#scheduleDelivery();
        return this.#pull.promise;
      },
      (reason) => { params.controller.abort(reason, params.env); },
      0, params.env,
    );
  }

  setControl(control: HTTPTransportControl): void {
    this.#control = control;
    if (this.#failure) control.abort();
    else if (this.#paused) control.pause();
  }

  receive(bytes: Uint8Array): void {
    if (this.#finished || this.#failure || bytes.byteLength === 0) return;
    this.#chunks.push(bytes);
    this.#size += bytes.byteLength;
    if (!this.#paused && this.#size >= upperBufferLimit) {
      this.#paused = true;
      this.#control?.pause();
    }
    this.#scheduleDelivery();
  }

  end(): void {
    this.#ended = true;
    this.#scheduleDelivery();
  }

  fail(reason: () => unknown): void {
    if (this.#finished || this.#failure) return;
    this.#failure = reason;
    this.#chunks = [];
    this.#head = this.#offset = this.#size = 0;
    this.#control?.abort();
    this.#scheduleDelivery();
  }

  #scheduleDelivery(): void {
    if (this.#finished || this.#taskQueued) return;
    if (!this.#failure && !(this.#ended && this.#size === 0) &&
      !(this.#pull && this.#size > 0)) return;
    this.#taskQueued = true;
    const { env } = this.#params;
    env.queueNetworkingTask(() => {
      this.#taskQueued = false;
      this.#deliver();
    }, env.exec.global);
  }

  #deliver(): void {
    if (this.#finished) return;
    const pull = this.#pull;
    this.#pull = undefined;
    if (this.#failure) {
      this.stream.error(this.#failure());
      this.#complete();
    } else {
      if (pull && this.#size > 0) {
        const bytes = this.#chunks[this.#head]!;
        const offset = this.stream.pullFromBytes(bytes, this.#offset);
        this.#size -= offset - this.#offset;
        this.#offset = offset;
        if (offset === bytes.byteLength) {
          this.#chunks[this.#head++] = undefined;
          this.#offset = 0;
          if (this.#head === this.#chunks.length) {
            this.#chunks = [];
            this.#head = 0;
          } else if (this.#head >= 64 && this.#head * 2 >= this.#chunks.length) {
            this.#chunks = this.#chunks.slice(this.#head);
            this.#head = 0;
          }
        }
      }
      if (this.#ended && this.#size === 0) {
        this.stream.close();
        this.#complete();
      } else if (this.#paused && this.#size < lowerBufferLimit) {
        this.#paused = false;
        this.#control?.resume();
      }
    }
    pull?.resolve(undefined);
  }

  #complete(): void {
    this.#finished = true;
    this.#finish();
  }
}

// HTTP-network fetch permits implementation-chosen upper/lower network-buffer limits.
// https://fetch.spec.whatwg.org/#http-network-fetch
// A received transport chunk can overshoot the upper limit; paused delivery cannot accumulate tasks.
const upperBufferLimit = 64 * 1024;
const lowerBufferLimit = 32 * 1024;

const responseType = internalType<FetchResponse>('FetchResponse');
const optionalResponseType = internalType<FetchResponse | null>('FetchResponse?');
const redirectResponseType = internalType<FetchResponse | undefined>('RedirectResponse');
const requestType = internalType<FetchRequest>('FetchRequest');

type HTTPAttempt = {
  httpParams: FetchParams;
  httpRequest: FetchRequest;
  includeCredentials: boolean;
  sentEntry: AuthenticationEntry | null;
};
const attemptType = internalType<HTTPAttempt | FetchResponse>('HTTPAttempt');
