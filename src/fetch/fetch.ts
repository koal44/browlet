import { areSameOrigin } from '../url/index';
import type { JSEnvironment } from '../js-engine/index';
import { InternalError } from '../infra/internal-error';
import { ParallelQueue } from '../infra/parallel-queue';
import { coarsenTime } from '../infra/time';
import { FetchBody } from './body';
import type { FetchController } from './controller';
import { FetchParams } from './params';
import type { FetchRequest } from './request';
import type { FetchResponse } from './response';
import { FetchTimingInfo } from './timing';
import { isHTTPScheme } from './url';

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
    const pending = userAgent.hostPromises.withResolvers<FetchResponse>();
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
      value = documentAccept;
    } else {
      switch (request.destination) {
        case 'document': case 'frame': case 'iframe': value = documentAccept; break;
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
  params.mainFetch();
  return params.controller;
}

/** Optional processing steps and callback destination for a fetch. */
export type FetchOptions = Partial<Pick<FetchParams,
  'processRequestBodyChunkLength' | 'processRequestEndOfBody' | 'processEarlyHintsResponse' |
  'processResponse' | 'processResponseEndOfBody' | 'processResponseConsumeBody'
>> & {
  /** Deliver processing steps on a parallel queue instead of the client's global. */
  useParallelQueue?: boolean;
};

// https://fetch.spec.whatwg.org/#document-accept-header-value
const documentAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
