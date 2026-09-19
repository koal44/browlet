import type { RuntimeContext } from '../js-engine/runtime-context';

/** Fetch §2, fetch timing info. Timestamps are DOMHighResTimeStamp values. */
export class FetchTimingInfo {
  startTime = 0;
  redirectStartTime = 0;
  redirectEndTime = 0;
  postRedirectStartTime = 0;
  finalServiceWorkerStartTime = 0;
  finalNetworkRequestStartTime = 0;
  firstInterimNetworkResponseStartTime = 0;
  finalNetworkResponseStartTime = 0;
  endTime = 0;
  finalConnectionTimingInfo: ConnectionTimingInfo | null = null;
  serviceWorkerTimingInfo: ServiceWorkerTimingInfo | null = null;
  serverTimingHeaders: string[] = [];
  renderBlocking = false;

  /** Fetch §2, create an opaque timing info. */
  createOpaque(): FetchTimingInfo {
    const opaque = new FetchTimingInfo();
    opaque.startTime = this.startTime;
    opaque.postRedirectStartTime = this.startTime;
    return opaque;
  }
}

/** Fetch §2, response body info. */
export class ResponseBodyInfo {
  encodedSize = 0;
  decodedSize = 0;
  contentType = '';
  contentEncoding = '';
}

/** https://fetch.spec.whatwg.org/#connection-timing-info */
export class ConnectionTimingInfo {
  domainLookupStartTime = 0;
  domainLookupEndTime = 0;
  connectionStartTime = 0;
  connectionEndTime = 0;
  secureConnectionStartTime = 0;
  alpnNegotiatedProtocol = new Uint8Array();

  /** https://fetch.spec.whatwg.org/#clamp-and-coarsen-connection-timing-info */
  clampAndCoarsen(
    defaultStartTime: number, crossOriginIsolatedCapability: boolean, runtime: RuntimeContext,
  ): ConnectionTimingInfo {
    const result = new ConnectionTimingInfo();
    result.alpnNegotiatedProtocol = this.alpnNegotiatedProtocol;
    if (this.connectionStartTime < defaultStartTime) {
      result.domainLookupStartTime = defaultStartTime;
      result.domainLookupEndTime = defaultStartTime;
      result.connectionStartTime = defaultStartTime;
      result.connectionEndTime = defaultStartTime;
      result.secureConnectionStartTime = defaultStartTime;
      return result;
    }

    result.domainLookupStartTime = runtime.timing.coarsenTime(this.domainLookupStartTime, crossOriginIsolatedCapability);
    result.domainLookupEndTime = runtime.timing.coarsenTime(this.domainLookupEndTime, crossOriginIsolatedCapability);
    result.connectionStartTime = runtime.timing.coarsenTime(this.connectionStartTime, crossOriginIsolatedCapability);
    result.connectionEndTime = runtime.timing.coarsenTime(this.connectionEndTime, crossOriginIsolatedCapability);
    // Preserve TLS start; the spec currently names connection end here.
    result.secureConnectionStartTime = runtime.timing.coarsenTime(this.secureConnectionStartTime, crossOriginIsolatedCapability);
    return result;
  }
}

/*
 * Service Workers, service worker timing info, retained by Fetch timing
 * and response records. The worker owner creates/populates it; initial times
 * are zero and initial router sources are empty strings.
 * https://w3c.github.io/ServiceWorker/#service-worker-timing
 */
export type ServiceWorkerTimingInfo = {
  startTime: number;
  fetchEventDispatchTime: number;
  workerRouterEvaluationStart: number;
  workerCacheLookupStart: number;
  workerMatchedRouterSource: string;
  workerFinalRouterSource: string;
};
