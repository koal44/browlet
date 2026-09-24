import type { ParallelQueue } from '../infra/parallel-queue';
import { getBufferTypeName, type GlobalObject, type JSEnvironment } from '../js-engine/index';
import { InternalError } from '../infra/internal-error';
import type { PromiseValue } from '../infra/promises';
import { surroundingTabOrSpacePattern } from '../infra/patterns';
import { coarsenTime } from '../infra/time';
import { isHTTPToken } from '../http/index';
import { minimizeSupportedMIMEType, serializeMIMEType } from '../mime/index';
import { TransformStreamImpl } from '../streams/index';
import { areSameOrigin, obtainURLOrigin } from '../url/index';
import { FetchBody } from './body';
import { FetchController } from './controller';
import {
  convertHeaderNamesToSortedLowercaseSet, isCORSNonWildcardRequestHeaderName, isRequestBodyHeaderName,
} from './headers';
import { shouldBlockDueToBadPort, shouldBlockDueToMIMEType, shouldBlockDueToNosniff } from './http/blocking';
import { isCORSSafelistedMethod } from './http/methods';
import { httpNetworkFetch } from './http/network';
import { isNullBodyStatus, isRangeStatus, isRedirectStatus } from './http/statuses';
import { bytesMatchIntegrityMetadata } from './integrity';
import type { FetchRequest } from './request';
import { FetchResponse, isFilteredResponse } from './response';
import { fetchBlob } from './schemes/blob';
import { processDataURL } from './schemes/data';
import { queueFetchTask } from './tasks';
import type { FetchTimingInfo, ServiceWorkerTimingInfo } from './timing';
import { isHTTPScheme, isLocalURL } from './url';

/** State and processing steps for one Fetch execution. */
export class FetchParams {
  /** Request being processed by this fetch execution. */
  request: FetchRequest;
  /** Optional upload-progress callback receiving the byte length of each transmitted chunk. */
  processRequestBodyChunkLength: ((length: number) => void) | null = null;
  /** Optional callback invoked after the request body has been transmitted. */
  processRequestEndOfBody: (() => void) | null = null;
  /** Optional callback for a 103 Early Hints response received before the final response. */
  processEarlyHintsResponse: ((response: FetchResponse) => void) | null = null;
  /** Optional callback receiving the response before its body necessarily finishes. */
  processResponse: ((response: FetchResponse) => void) | null = null;
  /** Optional callback invoked when response end-of-body processing completes. */
  processResponseEndOfBody: ((response: FetchResponse) => void) | null = null;
  /** Optional callback receiving consumed bytes, null for no body, or failure when reading fails. */
  processResponseConsumeBody: ((response: FetchResponse, body: Uint8Array | null | 'failure') => void) | null = null;
  /** Global or parallel queue receiving fetch callbacks; null until a destination is selected. */
  taskDestination: GlobalObject | ParallelQueue | null = null;
  /** Selects the timing precision permitted by the client's cross-origin isolation. */
  crossOriginIsolatedCapability = false;
  /** Cancellation, timing-reporting, and manual-redirect control for this execution. */
  controller = new FetchController();
  /** Timing observations accumulated while the request is processed. */
  timingInfo: FetchTimingInfo;
  /** Response selected from preload, its pending completion, or null when none is selected. */
  // A Promise represents the draft's "pending" state and wakes the waiting fetch without polling.
  // SPEC_MISMATCH: preloaded response candidate: null, "pending", or a response
  preloadedResponseCandidate: FetchResponse | PromiseValue<FetchResponse> | null = null;
  /** Execution owner for body streams, separate from the request's optional client. */
  env: JSEnvironment;

  constructor(request: FetchRequest, timingInfo: FetchTimingInfo, env: JSEnvironment) {
    this.request = request;
    this.timingInfo = timingInfo;
    this.env = env;
  }

  get aborted(): boolean {
    return this.controller.state === 'aborted';
  }

  get canceled(): boolean {
    return this.controller.state !== 'ongoing';
  }

  /** Apply main-fetch policy, dispatch, and hand over the resulting response. */
  // https://fetch.spec.whatwg.org/#concept-main-fetch
  // Recursive dispatch waits for a response using the browser's internal Promise destination.
  mainFetch(recursive?: false): void;
  mainFetch(recursive: true): PromiseValue<FetchResponse>;
  mainFetch(recursive = false): PromiseValue<FetchResponse> | void {
    const { request } = this;
    const { userAgent } = request;
    let response: FetchResponse | null = null;
    if (request.localURLsOnly && !isLocalURL(request.currentURL)) response = FetchResponse.networkError();

    request.reportCSPViolations();
    request.upgradeInsecureRequest();
    request.upgradeMixedContent();
    if (shouldBlockDueToBadPort(request) === 'blocked' || request.isBlockedByMixedContent() ||
      request.isBlockedByCSP() || request.isBlockedByIntegrityPolicy()) {
      response = FetchResponse.networkError();
    }
    if (request.policyContainer === undefined) throw new InternalError('Main fetch requires populated request policies');
    if (request.referrerPolicy === '') request.referrerPolicy = request.policyContainer.referrerPolicy;
    if (request.referrer !== null) request.referrer = userAgent.determineRequestReferrer(request);
    request.upgradeForHSTS();
    // Fetch permits HTTPS DNS-record upgrading during connection establishment.
    // TODO(Fetch 9): consume HTTPS RR results there; an upgrade must never retry HTTP.

    const getResponse = () => response ?? this.#dispatch();
    if (recursive) return userAgent.hostPromises.try(getResponse);
    userAgent.runInParallel(() => {
      userAgent.hostPromises.try(getResponse).observe(
        // Body/Streams operations must enter their owner's task and checkpoint.
        (result) => queueFetchTask(() => this.#processResponse(result), this.env.exec.global, this.env),
        (error) => queueFetchTask(() => { throw error; }, this.env.exec.global, this.env),
      );
    });
  }

  /** Select an overridden response or dispatch to scheme/HTTP fetch. */
  // https://fetch.spec.whatwg.org/#concept-override-fetch
  // The internal Promise carries the response produced by downstream dispatch.
  overrideFetch(type: 'scheme-fetch' | 'http-fetch', makeCORSPreflight = false): PromiseValue<FetchResponse> {
    const { request, env } = this;
    return request.userAgent.hostPromises.try(() => {
      const response = request.userAgent.potentiallyOverrideResponse(request, env);
      if (response !== null) return response;

      switch (type) {
        case 'scheme-fetch': return this.schemeFetch();
        case 'http-fetch': return this.httpFetch(makeCORSPreflight);
      }
    });
  }

  /** Obtain a response from the request's current URL scheme. */
  // https://fetch.spec.whatwg.org/#concept-scheme-fetch
  schemeFetch(): PromiseValue<FetchResponse> {
    return this.request.userAgent.hostPromises.try(() => {
      if (this.canceled) return FetchResponse.appropriateNetworkError(this);
      const url = this.request.currentURL;
      switch (url.scheme) {
        case 'about': {
          if (url.path !== 'blank') break;
          const response = new FetchResponse();
          response.statusMessage = 'OK';
          response.headerList.append('Content-Type', 'text/html;charset=utf-8');
          response.body = FetchBody.fromBytes(new Uint8Array(), this.env);
          return response;
        }
        case 'blob': return fetchBlob(this);
        case 'data': {
          const data = processDataURL(url);
          if (data === null) return FetchResponse.networkError();
          const response = new FetchResponse();
          response.statusMessage = 'OK';
          response.headerList.append('Content-Type', serializeMIMEType(data.mimeType));
          response.body = FetchBody.fromBytes(data.body, this.env);
          return response;
        }
        // Fetch leaves file: implementation-defined and permits a network error.
        case 'file': break;
        case 'http': case 'https': return this.httpFetch();
      }
      return FetchResponse.networkError();
    });
  }

  /** Obtain an HTTP response, performing a CORS preflight when requested. */
  // https://fetch.spec.whatwg.org/#concept-http-fetch
  httpFetch(makeCORSPreflight = false): PromiseValue<FetchResponse> {
    const { request } = this;
    const { userAgent } = request;
    return userAgent.hostPromises.try(() => request.allowServiceWorkerInterception
      ? this.#fetchFromServiceWorker() : null).then((response) => {
      return response ?? this.#fetchFromNetwork(makeCORSPreflight);
    }).then((response) => {
      if (response.type === 'error') return response;
      const internal = isFilteredResponse(response) ? response.internalResponse : response;
      if (request.responseTainting === 'opaque' || response.type === 'opaque') {
        if (request.origin === undefined) throw new InternalError('HTTP fetch requires a populated request origin');
        // SPEC_CLASH(corp-clientless-policy): Fetch passes a nullable client to a settings-only check.
        // Clientless requests retain policy state; a missing reporting owner does not bypass CORP.
        const policyContainer = request.client?.policyContainer ?? request.policyContainer;
        if (policyContainer === undefined) throw new InternalError('HTTP fetch requires populated request policies');
        if (internal.isBlockedByCORP(
          request.origin, policyContainer.embedderPolicy, request.destination, false, request.client,
        )) {
          return FetchResponse.networkError();
        }
      }
      if (!isRedirectStatus(internal.status)) return response;
      if (request.isNavigation) {
        request.navigationTimingAllowValuesList.push(internal.headerList.getDecodeAndSplit('Timing-Allow-Origin') ?? []);
      }
      // Slice 9 may reset an HTTP/2 upload stream here for a non-303 redirect.
      switch (request.redirectMode) {
        case 'error': return FetchResponse.networkError();
        case 'manual':
          if (request.mode !== 'navigate') return internal.filter('opaqueredirect');
          this.controller.nextManualRedirectSteps = () => {
            this.httpRedirectFetch(response).observe(
              // Invalid redirect targets finish here; a valid navigation restarts nonrecursive main fetch.
              (result) => {
                if (result !== undefined) queueFetchTask(() => this.#processResponse(result), this.env.exec.global, this.env);
              },
              (error) => queueFetchTask(() => { throw error; }, this.env.exec.global, this.env),
            );
          };
          return response;
        case 'follow':
          userAgent.webDriverBiDiResponseCompleted(request, response);
          return this.httpRedirectFetch(response).then((result) => {
            if (result === undefined) throw new InternalError('An automatic redirect must return a response');
            return result;
          });
      }
    });
  }

  /** Follow an HTTP redirect, or restart delivery for a manually continued navigation. */
  // https://fetch.spec.whatwg.org/#concept-http-redirect-fetch
  // Undefined denotes a manual navigation whose nonrecursive main fetch now owns delivery.
  httpRedirectFetch(response: FetchResponse): PromiseValue<FetchResponse | undefined> {
    const { request, timingInfo, env } = this;
    const { userAgent } = request;
    return userAgent.hostPromises.try(() => {
      const internal = isFilteredResponse(response) ? response.internalResponse : response;
      const location = internal.getLocationURL(request.currentURL.fragment, userAgent);
      if (location === undefined) return response;
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
      if (internal.status !== 303 && request.body?.source === null) return FetchResponse.networkError();
      if (((internal.status === 301 || internal.status === 302) && request.method === 'POST') ||
        (internal.status === 303 && request.method !== 'GET' && request.method !== 'HEAD')) {
        request.method = 'GET';
        request.body = null;
        request.headerList.list = request.headerList.list.filter(([name]) => !isRequestBodyHeaderName(name));
      }
      if (!areSameOrigin(obtainURLOrigin(request.currentURL), obtainURLOrigin(location))) {
        request.headerList.list = request.headerList.list.filter(([name]) => !isCORSNonWildcardRequestHeaderName(name));
      }
      const follow = () => {
        const now = coarsenTime(userAgent.unsafeSharedCurrentTime(), this.crossOriginIsolatedCapability);
        timingInfo.redirectEndTime = timingInfo.postRedirectStartTime = now;
        if (timingInfo.redirectStartTime === 0) timingInfo.redirectStartTime = timingInfo.startTime;
        request.urlList.push(location);
        userAgent.setRequestReferrerPolicyOnRedirect(request, internal);
        if (request.redirectMode === 'manual') {
          if (request.mode !== 'navigate') throw new InternalError('Manual redirect continuation requires a navigation');
          this.mainFetch();
          return undefined;
        }
        return this.mainFetch(true);
      };
      if (request.body === null) return follow();
      const source = request.body.source;
      if (source === null) throw new InternalError('Redirect body replay requires a retained source');
      return this.#runBodySteps(() => {
        request.body = FetchBody.fromSource(source, env);
      }).then(follow);
    });
  }

  /** Obtain a response through HTTP caching and network transport. */
  // https://fetch.spec.whatwg.org/#concept-http-network-or-cache-fetch
  httpNetworkOrCacheFetch(_isAuthenticationFetch = false, _isNewConnectionFetch = false): PromiseValue<FetchResponse> {
    // PROVISIONAL(Fetch 9): implement cache selection, network fetch, and authentication.
    return this.request.userAgent.hostPromises.reject(new InternalError('HTTP-network-or-cache fetch is not implemented'));
  }

  /** Perform the HTTP transport exchange; network-or-cache integration follows in Fetch 9B. */
  // https://fetch.spec.whatwg.org/#concept-http-network-fetch
  httpNetworkFetch(includeCredentials = false, forceNewConnection = false): PromiseValue<FetchResponse> {
    return httpNetworkFetch(this, includeCredentials, forceNewConnection);
  }

  /** Perform a preflight request and populate the browser's CORS permission cache. */
  // https://fetch.spec.whatwg.org/#cors-preflight-fetch-0
  corsPreflightFetch(): PromiseValue<FetchResponse> {
    // PROVISIONAL(Fetch 9): implement the preflight transaction and permission validation.
    return this.request.userAgent.hostPromises.reject(new InternalError('CORS-preflight fetch is not implemented'));
  }

  #fetchFromServiceWorker(): PromiseValue<FetchResponse | null> {
    const { request, env, timingInfo, controller } = this;
    const { userAgent } = request;
    const prepare = () => {
      const copy = request.clone();
      if (copy.body !== null) {
        if (!(copy.body instanceof FetchBody)) throw new InternalError('HTTP fetch requires an extracted request body');
        const transform = new TransformStreamImpl(null, {}, {}, env);
        transform.setUp((chunk) => {
          if (this.canceled) return;
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
    const prepared = request.body === null ? userAgent.hostPromises.try(prepare) : this.#runBodySteps(prepare);
    return prepared.then((copy) => {
      const startTime = coarsenTime(userAgent.unsafeSharedCurrentTime(), this.crossOriginIsolatedCapability);
      return userAgent.handleFetch(copy, controller, this.crossOriginIsolatedCapability).then(
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
          return this.#runBodySteps(() => {
            if (!(request.body instanceof FetchBody)) throw new InternalError('HTTP fetch requires an extracted request body');
            // Cancellation does not wait for the source's cancellation promise.
            request.body.stream.cancelInternal(undefined).observe(() => {}, () => {});
            return validate();
          });
        },
      );
    });
  }

  #fetchFromNetwork(makeCORSPreflight: boolean): PromiseValue<FetchResponse> {
    const { request } = this;
    const { hostPromises, corsPreflightCache } = request.userAgent;
    const needsPreflight = makeCORSPreflight &&
      ((!corsPreflightCache.matchesMethod(request.method, request) &&
        (!isCORSSafelistedMethod(request.method) || request.useCORSPreflight)) ||
        request.headerList.getCORSUnsafeRequestHeaderNames().some((name) => !corsPreflightCache.matchesHeaderName(name, request)));
    const preflight = needsPreflight ? this.corsPreflightFetch() : hostPromises.try(() => null);
    return preflight.then((preflightResponse: FetchResponse | null) => {
      if (preflightResponse?.type === 'error') return preflightResponse;
      if (request.redirectMode === 'follow') request.allowServiceWorkerInterception = false;
      return this.httpNetworkOrCacheFetch().then((response: FetchResponse) => {
        if (request.responseTainting === 'cors' && response.isBlockedByCORS(request)) return FetchResponse.networkError();
        if (!response.isTimingAllowed(request)) request.timingAllowFailed = true;
        return response;
      });
    });
  }

  // Stream construction, teeing, cancellation, and replay enter the body's task/checkpoint owner.
  #runBodySteps<T>(steps: () => T): PromiseValue<T> {
    const result = this.request.userAgent.hostPromises.withResolvers<T>();
    queueFetchTask(() => {
      try { result.resolve(steps()); }
      catch (error) { result.reject(error); }
    }, this.env.exec.global, this.env);
    return result.promise;
  }

  #dispatch(): FetchResponse | PromiseValue<FetchResponse> {
    if (this.preloadedResponseCandidate !== null) return this.preloadedResponseCandidate;
    const { request } = this;
    if (request.origin === undefined) throw new InternalError('Main fetch requires a populated request origin');
    if ((areSameOrigin(obtainURLOrigin(request.currentURL), request.origin) && request.responseTainting === 'basic') ||
      request.currentURL.scheme === 'data' || request.mode === 'navigate' ||
      request.mode === 'websocket' || request.mode === 'webtransport') {
      request.responseTainting = 'basic';
      return this.overrideFetch('scheme-fetch');
    }
    if (request.mode === 'same-origin') return FetchResponse.networkError();
    if (request.mode === 'no-cors') {
      if (request.redirectMode !== 'follow') return FetchResponse.networkError();
      request.responseTainting = 'opaque';
      return this.overrideFetch('scheme-fetch');
    }
    if (!isHTTPScheme(request.currentURL.scheme)) return FetchResponse.networkError();
    request.responseTainting = 'cors';
    if (request.useCORSPreflight || (request.unsafeRequest &&
      (!isCORSSafelistedMethod(request.method) || request.headerList.getCORSUnsafeRequestHeaderNames().length > 0))) {
      return this.overrideFetch('http-fetch', true).then((response: FetchResponse) => {
        if (response.type === 'error') request.userAgent.corsPreflightCache.clearEntries(request);
        return response;
      });
    }
    return this.overrideFetch('http-fetch');
  }

  #processResponse(response: FetchResponse): void {
    const { request } = this;
    if (response.type !== 'error' && !isFilteredResponse(response)) {
      if (request.responseTainting === 'cors') {
        const names = response.headerList.extractValues('Access-Control-Expose-Headers', parseHeaderNames, true);
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
    let internal = isFilteredResponse(response) ? response.internalResponse : response;
    if (internal.urlList.length === 0) internal.urlList = [...request.urlList];
    internal.redirectTaint = request.redirectTaint;
    if (request.isNavigation) {
      internal.navigationTimingAllowValuesList = request.navigationTimingAllowValuesList.map((values) => [...values]);
    }
    if (!request.timingAllowFailed) internal.timingAllowPassed = true;
    if (response.type !== 'error' && (internal.isBlockedByMixedContent(request) || internal.isBlockedByCSP(request) ||
      shouldBlockDueToMIMEType(internal, request) === 'blocked' || shouldBlockDueToNosniff(internal, request) === 'blocked')) {
      response = internal = FetchResponse.networkError();
    }
    if (response.type === 'opaque' && isRangeStatus(internal.status) && internal.rangeRequested &&
      !request.headerList.has('Range')) {
      response = internal = FetchResponse.networkError();
    }
    if (response.type !== 'error' && (request.method === 'HEAD' || request.method === 'CONNECT' ||
      isNullBodyStatus(internal.status))) {
      // Detach the body rather than canceling its stream; transport must disregard later enqueues.
      internal.body = null;
    }
    if (request.integrityMetadata !== '') {
      const fail = () => this.handoverResponse(FetchResponse.networkError());
      if (response.body === null) { fail(); return; }
      response.body.fullyRead((bytes) => {
        if (!bytesMatchIntegrityMetadata(bytes, request.integrityMetadata)) { fail(); return; }
        response.body = FetchBody.fromBytes(bytes, this.env);
        this.handoverResponse(response);
      }, fail, this.env.exec.global);
    } else {
      this.handoverResponse(response);
    }
  }

  /** Deliver headers and observe/consume the body, entered on the body's execution owner's task. */
  // https://fetch.spec.whatwg.org/#fetch-finale
  handoverResponse(response: FetchResponse): void {
    const { request, timingInfo, env } = this;
    const internal = isFilteredResponse(response) ? response.internalResponse : response;
    if (response.type !== 'error' && request.client?.isSecureContext) {
      timingInfo.serverTimingHeaders = internal.headerList.getDecodeAndSplit('Server-Timing') ?? [];
    }
    if (request.destination === 'document') this.controller.fullTimingInfo = timingInfo;
    const endOfBody = () => this.#endResponseBody(response);
    if (this.processResponse !== null) {
      const processResponse = this.processResponse;
      this.#queueTask(() => processResponse(response));
    }
    if (response.type === 'error') request.userAgent.webDriverBiDiFetchError(request);
    else request.userAgent.webDriverBiDiResponseCompleted(request, response);

    if (internal.body === null) {
      endOfBody();
    } else {
      const transform = new TransformStreamImpl(null, {}, {}, env);
      transform.setUp((chunk) => transform.enqueue(chunk), endOfBody);
      internal.body.stream = internal.body.stream.pipeThroughTransform(transform);
    }
    if (this.processResponseConsumeBody !== null) {
      const consume = this.processResponseConsumeBody;
      if (internal.body === null) {
        this.#queueTask(() => consume(response, null));
      } else {
        internal.body.fullyRead(
          (bytes) => consume(response, bytes), () => consume(response, 'failure'), this.taskDestination,
        );
      }
    }
  }

  #endResponseBody(response: FetchResponse): void {
    const { request } = this;
    const unsafeEndTime = request.userAgent.unsafeSharedCurrentTime();
    this.controller.reportTimingSteps = (env) => {
      if (!isHTTPScheme(request.url.scheme)) return;
      let timingInfo = this.timingInfo;
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
    this.#queueTask(() => {
      request.done = true;
      this.processResponseEndOfBody?.(response);
      if (request.initiatorType !== null && request.client !== null &&
        request.client.exec.global === this.taskDestination) {
        this.controller.reportTiming(request.client);
      }
    });
  }

  #queueTask(steps: () => void): void {
    if (this.taskDestination === null) throw new InternalError('Fetch callback delivery requires a task destination');
    queueFetchTask(steps, this.taskDestination, this.env);
  }
}

// Access-Control-Expose-Headers uses #field-name: empty list members are ignored,
// but a non-token invalidates the field rather than exposing a partial result.
function parseHeaderNames(value: string): string[] | null {
  const names: string[] = [];
  for (const part of value.split(',')) {
    const name = part.replace(surroundingTabOrSpacePattern, '');
    if (name === '') continue;
    if (!isHTTPToken(name)) return null;
    names.push(name);
  }
  return names;
}
