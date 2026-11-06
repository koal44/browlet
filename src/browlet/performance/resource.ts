import { isomorphicDecode } from '../../js-engine/index';
import {
  arg, defineEnumeration, defineInterface, definePartialInterface, idlType, impl, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';
import { Moment, monotonicClock, type DOMHighResTimeStamp } from '../../timing/index';
import type { HTTPStatus } from '../../http/index';
import type { CacheUsage, FetchTimingInfo, ResponseBodyInfo } from '../../fetch/index';

import { eventHandlerAttr } from '../scripting/index';
import type { BrowletEnvironment } from '../environment/index';

import { PerformanceEntryImpl } from './timeline';
import { PerformanceServerTimingImpl } from './server';

/** Resource measurements owned by the requesting global, using Fetch's already filtered records. */
// https://w3c.github.io/resource-timing/#sec-performanceresourcetiming
export class PerformanceResourceTimingImpl extends PerformanceEntryImpl {
  initiatorType: string;
  deliveryType: string;
  requestedURL: string;
  cacheMode: CacheUsage | '';
  timingInfo: FetchTimingInfo;
  resourceInfo: ResponseBodyInfo;
  responseStatus: HTTPStatus;
  /** Whether transfer size is available and may be exposed; zero body sizes cannot establish either. */
  allowTransferSize: boolean;
  /** Parsed metrics from Fetch's secure-context and timing-allow filtered headers. */
  // https://w3c.github.io/server-timing/#dom-performanceresourcetiming-servertiming
  // SPEC_CLASH(server-timing-identity): Retain metrics like all browsers and the frozen array like Firefox; the draft reparses on each getter call, while Chromium/WebKit copy the array.
  serverTiming: PerformanceServerTimingImpl[] = [];

  /** Set up an entry without inserting it into the timeline or delivering it to observers. */
  // https://w3c.github.io/resource-timing/#setup-the-resource-timing-entry
  // Fetch supplies filtered timing/body records and response status; this does not run TAO or CORS checks.
  // The extra flag retains Fetch's TAO/CORS permission and suppresses estimates without navigation transport data.
  // Server-Timing fields are selected separately so Navigation can retain live Fetch records
  // without inheriting or overwriting the initiating client's header visibility.
  constructor(
    initiatorType: string, requestedURL: string, timingInfo: FetchTimingInfo, cacheMode: CacheUsage | '',
    bodyInfo: ResponseBodyInfo, responseStatus: HTTPStatus, deliveryType = '',
    allowTransferSize: boolean, serverTimingHeaders: string[], env: BrowletEnvironment,
  ) {
    super(
      PerformanceResourceTimingImpl.convertFetchTimestamp(timingInfo.startTime, env), 'resource', requestedURL,
      PerformanceResourceTimingImpl.convertFetchTimestamp(timingInfo.endTime, env), env,
    );
    this.initiatorType = initiatorType;
    this.requestedURL = requestedURL;
    this.timingInfo = timingInfo;
    this.resourceInfo = bodyInfo;
    this.cacheMode = cacheMode;
    this.responseStatus = responseStatus;
    this.deliveryType = deliveryType === '' && cacheMode !== '' ? 'cache' : deliveryType;
    this.allowTransferSize = allowTransferSize;
    // SPEC_CLASH(server-timing-cross-origin): Honor TAO like Chromium/Firefox; WebKit exercises the specification's permission to keep foreign metrics hidden.
    // The filtered header list, not allowTransferSize, carries that decision independently of CORS.
    // Navigation supplies destination-visible headers separately from Fetch's initiator-visible list.
    for (const field of serverTimingHeaders) {
      const metric = PerformanceServerTimingImpl.parse(field, env);
      if (metric !== null) this.serverTiming.push(metric);
    }
  }

  /** Convert an already coarsened shared-clock timestamp, preserving zero as an absent observation. */
  // https://w3c.github.io/resource-timing/#dfn-convert-fetch-timestamp
  static convertFetchTimestamp(time: DOMHighResTimeStamp, env: BrowletEnvironment): DOMHighResTimeStamp {
    return time === 0 ? 0 : env.relativeHighResolutionCoarseTime(new Moment(monotonicClock, time)).milliseconds;
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-workerstart
  get workerStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalServiceWorkerStartTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-redirectstart
  get redirectStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.redirectStartTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-redirectend
  get redirectEnd(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.redirectEndTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-fetchstart
  get fetchStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.postRedirectStartTime, this.env);
  }

  // SPEC_GAP(resource-timing-absent-records): Fetch permits null connection/worker timing records, but these getters dereference them. Return zero/empty values for missing observations.
  // Cache/reused-connection normalization remains Fetch's responsibility; absence does not fabricate DNS/TLS activity.
  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-domainlookupstart
  get domainLookupStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalConnectionTimingInfo?.domainLookupStartTime ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-domainlookupend
  get domainLookupEnd(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalConnectionTimingInfo?.domainLookupEndTime ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-connectstart
  get connectStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalConnectionTimingInfo?.connectionStartTime ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-connectend
  get connectEnd(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalConnectionTimingInfo?.connectionEndTime ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-secureconnectionstart
  get secureConnectionStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalConnectionTimingInfo?.secureConnectionStartTime ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-nexthopprotocol
  get nextHopProtocol(): string {
    const connection = this.timingInfo.finalConnectionTimingInfo;
    return connection === null ? '' : isomorphicDecode(connection.alpnNegotiatedProtocol);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-requeststart
  get requestStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalNetworkRequestStartTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-finalresponseheadersstart
  get finalResponseHeadersStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.finalNetworkResponseStartTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-firstinterimresponsestart
  get firstInterimResponseStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.firstInterimNetworkResponseStartTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-responsestart
  get responseStart(): DOMHighResTimeStamp {
    const interim = this.firstInterimResponseStart;
    return interim !== 0 ? interim : this.finalResponseHeadersStart;
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-responseend
  get responseEnd(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.endTime, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-workerrouterevaluationstart
  get workerRouterEvaluationStart(): DOMHighResTimeStamp {
    // SPEC_CLASH(resource-timing-router-clock): Service Workers records shared timestamps; Resource Timing omits conversion. Convert once, as Blink and WebKit do.
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.serviceWorkerTimingInfo?.workerRouterEvaluationStart ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-workercachelookupstart
  get workerCacheLookupStart(): DOMHighResTimeStamp {
    return PerformanceResourceTimingImpl.convertFetchTimestamp(this.timingInfo.serviceWorkerTimingInfo?.workerCacheLookupStart ?? 0, this.env);
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-workermatchedroutersource
  get workerMatchedRouterSource(): string {
    return this.timingInfo.serviceWorkerTimingInfo?.workerMatchedRouterSource ?? '';
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-workerfinalroutersource
  get workerFinalRouterSource(): string {
    return this.timingInfo.serviceWorkerTimingInfo?.workerFinalRouterSource ?? '';
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-transfersize
  get transferSize(): number {
    // SPEC_CLASH(resource-timing-transfer-exposure): The formula adds 300 even to hidden responses. Retain Fetch's permission explicitly, including its CORS body-access check.
    if (!this.allowTransferSize || this.cacheMode === 'local') return 0;
    if (this.cacheMode === 'validated') return 300;
    return this.resourceInfo.encodedSize + 300;
  }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-encodedbodysize
  get encodedBodySize(): number { return this.resourceInfo.encodedSize; }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-decodedbodysize
  get decodedBodySize(): number { return this.resourceInfo.decodedSize; }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-renderblockingstatus
  get renderBlockingStatus(): RenderBlockingStatusType { return this.timingInfo.renderBlocking ? 'blocking' : 'non-blocking'; }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-contenttype
  get contentType(): string { return this.resourceInfo.contentType; }

  // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-contentencoding
  get contentEncoding(): string { return this.resourceInfo.contentEncoding; }
}

export type RenderBlockingStatusType = 'blocking' | 'non-blocking';

/*
 * [Exposed=(Window,Worker)]
 * interface PerformanceResourceTiming : PerformanceEntry {
 *   readonly attribute DOMString initiatorType;
 *   readonly attribute DOMString deliveryType;
 *   readonly attribute ByteString nextHopProtocol;
 *   readonly attribute DOMHighResTimeStamp workerStart;
 *   readonly attribute DOMHighResTimeStamp redirectStart;
 *   readonly attribute DOMHighResTimeStamp redirectEnd;
 *   readonly attribute DOMHighResTimeStamp fetchStart;
 *   readonly attribute DOMHighResTimeStamp domainLookupStart;
 *   readonly attribute DOMHighResTimeStamp domainLookupEnd;
 *   readonly attribute DOMHighResTimeStamp connectStart;
 *   readonly attribute DOMHighResTimeStamp connectEnd;
 *   readonly attribute DOMHighResTimeStamp secureConnectionStart;
 *   readonly attribute DOMHighResTimeStamp requestStart;
 *   readonly attribute DOMHighResTimeStamp finalResponseHeadersStart;
 *   readonly attribute DOMHighResTimeStamp firstInterimResponseStart;
 *   readonly attribute DOMHighResTimeStamp responseStart;
 *   readonly attribute DOMHighResTimeStamp responseEnd;
 *   readonly attribute DOMHighResTimeStamp workerRouterEvaluationStart;
 *   readonly attribute DOMHighResTimeStamp workerCacheLookupStart;
 *   readonly attribute DOMString workerMatchedRouterSource;
 *   readonly attribute DOMString workerFinalRouterSource;
 *   readonly attribute unsigned long long transferSize;
 *   readonly attribute unsigned long long encodedBodySize;
 *   readonly attribute unsigned long long decodedBodySize;
 *   readonly attribute unsigned short responseStatus;
 *   readonly attribute RenderBlockingStatusType renderBlockingStatus;
 *   readonly attribute DOMString contentType;
 *   readonly attribute DOMString contentEncoding;
 *   [Default] object toJSON();
 * };
 */
export const performanceResourceTimingIDL = defineInterface({
  name: 'PerformanceResourceTiming', inherits: 'PerformanceEntry', exposed: ['Window', 'Worker'],
  implementation: impl(PerformanceResourceTimingImpl),
  members: [
    roAttr('initiatorType', idlType.DOMString),
    roAttr('deliveryType', idlType.DOMString),
    roAttr('nextHopProtocol', idlType.ByteString),
    roAttr('workerStart', reference('DOMHighResTimeStamp')),
    roAttr('redirectStart', reference('DOMHighResTimeStamp')),
    roAttr('redirectEnd', reference('DOMHighResTimeStamp')),
    roAttr('fetchStart', reference('DOMHighResTimeStamp')),
    roAttr('domainLookupStart', reference('DOMHighResTimeStamp')),
    roAttr('domainLookupEnd', reference('DOMHighResTimeStamp')),
    roAttr('connectStart', reference('DOMHighResTimeStamp')),
    roAttr('connectEnd', reference('DOMHighResTimeStamp')),
    roAttr('secureConnectionStart', reference('DOMHighResTimeStamp')),
    roAttr('requestStart', reference('DOMHighResTimeStamp')),
    roAttr('finalResponseHeadersStart', reference('DOMHighResTimeStamp')),
    roAttr('firstInterimResponseStart', reference('DOMHighResTimeStamp')),
    roAttr('responseStart', reference('DOMHighResTimeStamp')),
    roAttr('responseEnd', reference('DOMHighResTimeStamp')),
    roAttr('workerRouterEvaluationStart', reference('DOMHighResTimeStamp')),
    roAttr('workerCacheLookupStart', reference('DOMHighResTimeStamp')),
    // SPEC_CLASH(resource-timing-router-names): Keep the specified/WebKit names; Chromium uses workerMatchedSourceType and workerFinalSourceType. Firefox exposes neither pair.
    roAttr('workerMatchedRouterSource', idlType.DOMString),
    roAttr('workerFinalRouterSource', idlType.DOMString),
    roAttr('transferSize', idlType.unsignedLongLong),
    roAttr('encodedBodySize', idlType.unsignedLongLong),
    roAttr('decodedBodySize', idlType.unsignedLongLong),
    roAttr('responseStatus', idlType.unsignedShort),
    roAttr('renderBlockingStatus', reference('RenderBlockingStatusType')),
    roAttr('contentType', idlType.DOMString),
    roAttr('contentEncoding', idlType.DOMString),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

/*
 * enum RenderBlockingStatusType {
 *   "blocking",
 *   "non-blocking"
 * };
 */
export const renderBlockingStatusTypeIDL = defineEnumeration({
  name: 'RenderBlockingStatusType', values: ['blocking', 'non-blocking'] satisfies RenderBlockingStatusType[],
});

// Resource Timing's contribution to Performance; the implementation remains on PerformanceImpl.
// https://w3c.github.io/resource-timing/#sec-extensions-performance-interface
/*
 * partial interface Performance {
 *   undefined clearResourceTimings ();
 *   undefined setResourceTimingBufferSize (unsigned long maxSize);
 *   attribute EventHandler onresourcetimingbufferfull;
 * };
 */
export const resourceTimingPerformanceIDL = definePartialInterface({
  name: 'Performance',
  members: [
    op('clearResourceTimings', idlType.undefined),
    op('setResourceTimingBufferSize', idlType.undefined, [arg('maxSize', idlType.unsignedLong)]),
    eventHandlerAttr('onresourcetimingbufferfull'),
  ],
});
