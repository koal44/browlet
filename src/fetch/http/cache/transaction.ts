import { evaluateCacheRequest, parseCacheControl, shouldInvalidateCache } from '../../../http/index';
import type { InternalPromise } from '../../../infra/promises';
import { coarsenTime } from '../../../infra/time';
import { FetchParams } from '../../params';
import type { FetchRequest } from '../../request';
import { FetchResponse, isFilteredResponse } from '../../response';
import { queueFetchTask } from '../../tasks';
import { FetchTimingInfo } from '../../timing';

/** Select or validate a private cached response, otherwise perform the wire exchange. */
// Fetch §4.6, cache selection through response storage; RFC 9111 §§3–4.
export function fetchWithCache(
  params: FetchParams, includeCredentials: boolean, forceNewConnection: boolean, sourceRequest: FetchRequest,
): InternalPromise<FetchResponse> {
  const { request, env } = params;
  const { userAgent } = request;
  const result = userAgent.hostPromises.withResolvers<FetchResponse>();
  const cache = userAgent.httpCachePartitions.determine(request);
  const generation = cache?.generation;
  if (cache === null) request.cacheMode = 'no-store';
  queue(() => {
    if (params.canceled) { result.resolve(FetchResponse.appropriateNetworkError(params)); return; }
    const mode = request.cacheMode;
    // Partial-body combination and evaluation of authored preconditions are optional.
    // Forward these requests intact rather than fabricate a representation or a 304.
    const canSelect = mode !== 'no-store' && mode !== 'reload' &&
      !request.headerList.has('Range') && !conditionalHeaders.some((name) => request.headerList.has(name));
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
    if (parseCacheControl(requestControl)?.some(({ name }) => name === 'only-if-cached')) {
      const response = new FetchResponse();
      response.status = 504;
      result.resolve(response);
      return;
    }
    const requestTime = Date.now();
    params.httpNetworkFetch(includeCredentials, forceNewConnection, mode === 'no-store' ? undefined : cache ?? undefined)
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
      }).observe(() => {}, (error: unknown) => result.reject(error));
  });
  return result.promise;

  function queue(steps: () => void): void {
    queueFetchTask(() => {
      try { steps(); }
      catch (error) { result.reject(error); }
    }, env.exec.global, env);
  }
}

/** Consume revalidation incrementally and tie its lifetime to the originating client. */
function revalidateInBackground(sourceRequest: FetchRequest): void {
  const client = sourceRequest.client!;
  const request = sourceRequest.clone(null);
  request.cacheMode = 'no-cache';
  request.preventNoCacheCacheControlHeaderModification = true;
  request.allowServiceWorkerInterception = false;
  // This unused response exists only to refresh this client's cache (Fetch §4.6).
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
  params.mainFetch();
}

const conditionalHeaders = ['If-Match', 'If-None-Match', 'If-Modified-Since', 'If-Unmodified-Since', 'If-Range'];
