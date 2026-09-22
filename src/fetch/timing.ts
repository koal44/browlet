import { coarsenTime } from '../infra/time';

/** Fetch §2, fetch timing info. Timestamps are DOMHighResTimeStamp values. */
export class FetchTimingInfo {
  /** Fetch start timestamp in milliseconds, including time spent on redirects. */
  startTime = 0;
  /** Start of the first redirecting fetch in milliseconds; initially zero. */
  redirectStartTime = 0;
  /** End of the last redirect response in milliseconds; initially zero. */
  redirectEndTime = 0;
  /** Start of the fetch after the last redirect, or the original start, in milliseconds. */
  postRedirectStartTime = 0;
  /** Start of the final service-worker interception attempt in milliseconds; initially zero. */
  finalServiceWorkerStartTime = 0;
  /** Start of sending the final network request in milliseconds; initially zero. */
  finalNetworkRequestStartTime = 0;
  /** First interim network response's arrival timestamp in milliseconds; initially zero. */
  firstInterimNetworkResponseStartTime = 0;
  /** Final network response's first-byte timestamp in milliseconds; initially zero. */
  finalNetworkResponseStartTime = 0;
  /** Fetch completion timestamp in milliseconds; initially zero. */
  endTime = 0;
  /** Connection timings for the final request, or null when unavailable. */
  finalConnectionTimingInfo: ConnectionTimingInfo | null = null;
  /** Worker processing observations, or null when no worker timing is attached. */
  serviceWorkerTimingInfo: ServiceWorkerTimingInfo | null = null;
  /** Raw Server-Timing field values retained for later timing reports. */
  serverTimingHeaders: string[] = [];
  /** Whether the fetch was classified as render-blocking. */
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
  /** Body byte count before removing content codings, excluding HTTP headers. */
  encodedSize = 0;
  /** Body byte count after removing content codings. */
  decodedSize = 0;
  /** MIME type retained for timing reports; empty when none is recorded. */
  contentType = '';
  /** Content coding retained for timing reports; empty when none is recorded. */
  contentEncoding = '';
}

/** https://fetch.spec.whatwg.org/#connection-timing-info */
export class ConnectionTimingInfo {
  /** DNS lookup start timestamp in milliseconds; initially zero. */
  domainLookupStartTime = 0;
  /** DNS lookup completion timestamp in milliseconds; initially zero. */
  domainLookupEndTime = 0;
  /** Connection establishment start timestamp in milliseconds; initially zero. */
  connectionStartTime = 0;
  /** Connection establishment completion timestamp in milliseconds; initially zero. */
  connectionEndTime = 0;
  /** TLS handshake start timestamp in milliseconds; initially zero. */
  secureConnectionStartTime = 0;
  /** Negotiated ALPN protocol identifier as bytes; empty when no protocol is recorded. */
  alpnNegotiatedProtocol = new Uint8Array();

  /** https://fetch.spec.whatwg.org/#clamp-and-coarsen-connection-timing-info */
  clampAndCoarsen(
    defaultStartTime: number, crossOriginIsolatedCapability: boolean,
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

    result.domainLookupStartTime = coarsenTime(this.domainLookupStartTime, crossOriginIsolatedCapability);
    result.domainLookupEndTime = coarsenTime(this.domainLookupEndTime, crossOriginIsolatedCapability);
    result.connectionStartTime = coarsenTime(this.connectionStartTime, crossOriginIsolatedCapability);
    result.connectionEndTime = coarsenTime(this.connectionEndTime, crossOriginIsolatedCapability);
    // Preserve TLS start; the spec currently names connection end here.
    result.secureConnectionStartTime = coarsenTime(this.secureConnectionStartTime, crossOriginIsolatedCapability);
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
  /** Service-worker startup timestamp in milliseconds. */
  startTime: number;
  /** Fetch-event dispatch timestamp in milliseconds. */
  fetchEventDispatchTime: number;
  /** Static-router evaluation start timestamp in milliseconds. */
  workerRouterEvaluationStart: number;
  /** Router cache-lookup start timestamp in milliseconds. */
  workerCacheLookupStart: number;
  /** Source selected by a matching router rule; empty when no source is recorded. */
  workerMatchedRouterSource: string;
  /** Source that ultimately supplied the response; empty when no source is recorded. */
  workerFinalRouterSource: string;
};
