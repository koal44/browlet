import { InternalError } from '../../infra/internal-error';
import type { InternalPromise } from '../../infra/promises';
import { serializeURL } from '../../url/index';
import { FetchBody } from '../body';
import { FetchParams } from '../params';
import { FetchResponse } from '../response';
import { queueFetchTask } from '../tasks';
import type { HTTPAuthentication } from './authentication';

/** Fetch §4.6: prepare one HTTP transaction, then handle authentication or a fresh-connection retry. */
export function httpNetworkOrCacheFetch(
  params: FetchParams, isAuthenticationFetch = false, isNewConnectionFetch = false,
): InternalPromise<FetchResponse> {
  const { request, env } = params;
  const { userAgent } = request;
  return inOwnerTask(params, () => {
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
    httpRequest.appendFetchMetadataHeaders();
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
    const authentication: HTTPAuthentication = userAgent.httpAuthentication;
    if (includeCredentials) {
      httpRequest.appendCookieHeader();
      if (!httpRequest.headerList.has('Authorization')) {
        const authorization = authentication.getAuthorization(httpRequest, isAuthenticationFetch);
        if (authorization !== null) httpRequest.headerList.append('Authorization', authorization);
      }
    }
    authentication.applyProxyAuthentication(httpRequest);
    userAgent.webDriverBiDiBeforeRequestSent(request);
    const cache = userAgent.httpCachePartitions.determine(httpRequest);
    if (cache === null) httpRequest.cacheMode = 'no-store';
    // TODO(Fetch 9C): select/validate stored responses here and store/invalidate after network fetch.
    // These partitions currently contain no response entries, so every lookup is a miss.
    if (httpRequest.cacheMode === 'only-if-cached') return FetchResponse.networkError();
    return { httpParams, httpRequest, includeCredentials, authentication };
  }).then((prepared) => {
    if (prepared instanceof FetchResponse) return prepared;
    if (params.canceled) return FetchResponse.appropriateNetworkError(params);
    const { httpParams, httpRequest, includeCredentials, authentication } = prepared;
    return httpParams.httpNetworkFetch(includeCredentials, isNewConnectionFetch).then((response) => {
      if (response.type === 'error') return response;
      response.urlList = [...httpRequest.urlList];
      response.rangeRequested = httpRequest.headerList.has('Range');
      response.requestIncludesCredentials = includeCredentials;
      const canPrompt = request.traversableForUserPrompts !== null;
      const needsOriginAuthentication = response.status === 401 && request.responseTainting !== 'cors' && includeCredentials && canPrompt;
      if (needsOriginAuthentication || response.status === 407) {
        if (!canPrompt) { response.discardBody?.(); return FetchResponse.networkError(); }
        if (request.body instanceof FetchBody && request.body.source === null) {
          response.discardBody?.();
          return FetchResponse.networkError();
        }
        const retry = () => {
          response.discardBody?.();
          return httpNetworkOrCacheFetch(params, needsOriginAuthentication, isNewConnectionFetch);
        };
        return inOwnerTask(params, () => {
          if (request.body instanceof FetchBody && request.body.source !== null) {
            request.body = FetchBody.fromSource(request.body.source, env);
          }
        }).then(() => {
          if (params.canceled) return FetchResponse.appropriateNetworkError(params);
          if (needsOriginAuthentication && request.useURLCredentials && !isAuthenticationFetch) return retry();
          return authentication.prompt(request, response).then((accepted) => accepted ? retry() : response);
        });
      }
      if (response.status === 421 && !isNewConnectionFetch &&
        (request.body === null || (request.body instanceof FetchBody && request.body.source !== null))) {
        response.discardBody?.();
        if (params.canceled) return FetchResponse.appropriateNetworkError(params);
        return inOwnerTask(params, () => {
          if (request.body instanceof FetchBody && request.body.source !== null) {
            request.body = FetchBody.fromSource(request.body.source, env);
          }
        }).then(() => httpNetworkOrCacheFetch(params, isAuthenticationFetch, true));
      }
      if (isAuthenticationFetch) authentication.store(request, response);
      return response;
    });
  });
}

/** Stream replay and cloning enter the actual body owner before returning to browser continuations. */
function inOwnerTask<T>(params: FetchParams, steps: () => T): InternalPromise<T> {
  const result = params.request.userAgent.hostPromises.withResolvers<T>();
  queueFetchTask(() => {
    try { result.resolve(steps()); }
    catch (error) { result.reject(error); }
  }, params.env.exec.global, params.env);
  return result.promise;
}

const conditionalHeaderNames = ['If-Modified-Since', 'If-None-Match', 'If-Unmodified-Since', 'If-Match', 'If-Range'];
