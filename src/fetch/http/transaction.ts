import { InternalError } from '../../infra/internal-error';
import type { InternalPromise } from '../../infra/promises';
import { percentDecodeString, serializeURL, setURLPassword, setURLUsername, type URLRecord } from '../../url/index';
import { utf8DecodeWithoutBOM } from '../../encoding/index';
import { encodeBasicCredentials, parseAuthenticationChallenges, selectBasicChallenge } from '../../http/index';
import { FetchBody } from '../body';
import { FetchParams } from '../params';
import { FetchResponse } from '../response';
import { queueFetchTask } from '../tasks';
import type { AuthenticationCredentials, AuthenticationEntry } from './authentication';

// Fetch §4.6, HTTP-network-or-cache fetch.
/** Prepare the wire request and handle authentication or a fresh-connection retry. */
export function httpNetworkOrCacheFetch(
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
      const cache = userAgent.httpCachePartitions.determine(httpRequest);
      if (cache === null) httpRequest.cacheMode = 'no-store';
      // TODO(Fetch 9C): select/validate stored responses here and store/invalidate after network fetch.
      // These partitions currently contain no response entries, so every lookup is a miss.
      if (httpRequest.cacheMode === 'only-if-cached') return FetchResponse.networkError();
      return { httpParams, httpRequest, includeCredentials, sentEntry };
    }).then((prepared) => {
      if (prepared instanceof FetchResponse) return prepared;
      if (params.canceled) return FetchResponse.appropriateNetworkError(params);
      const { httpParams, httpRequest, includeCredentials, sentEntry } = prepared;
      return httpParams.httpNetworkFetch(includeCredentials, isNewConnectionFetch).then((response) => {
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
            return inOwnerTask(params, () => {
              if (request.body instanceof FetchBody && request.body.source !== null) {
                request.body = FetchBody.fromSource(request.body.source, env);
              }
            }).then(() => attempt(needsOriginAuthentication, isNewConnectionFetch));
          };
          if (response.status === 407) {
            return authentication.promptProxy(request, response).then((accepted) => accepted ? retry() : response);
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
          ? userAgent.hostPromises.resolve(candidate)
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
          });
        }
        if (response.status === 421 && !isNewConnectionFetch &&
          (request.body === null || (request.body instanceof FetchBody && request.body.source !== null))) {
          response.discardBody?.();
          return inOwnerTask(params, () => {
            if (request.body instanceof FetchBody && request.body.source !== null) {
              request.body = FetchBody.fromSource(request.body.source, env);
            }
          }).then(() => attempt(isAuthenticationFetch, true));
        }
        if (isAuthenticationFetch && sentEntry !== null && response.status !== 401 && response.status !== 407 && response.status !== 421) {
          authentication.store(request.currentURL, sentEntry, generation);
        }
        return response;
      });
    });
  }
}

function urlCredentials(url: URLRecord): AuthenticationCredentials {
  return {
    username: utf8DecodeWithoutBOM(Uint8Array.from(percentDecodeString(url.username))),
    password: utf8DecodeWithoutBOM(Uint8Array.from(percentDecodeString(url.password))),
  };
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
