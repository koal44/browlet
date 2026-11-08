import { defineEnumeration, defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr } from '../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../timing/index';
import type { HTTPStatus } from '../../http/index';
import type { CacheUsage, FetchTimingInfo, ResponseBodyInfo, ServiceWorkerTimingInfo } from '../../fetch/index';

import type { NotRestoredReasonsImpl } from '../browsing/navigation/diagnostics/index';
import type { DocumentLoadTimingInfo, DocumentUnloadTimingInfo } from '../dom/nodes/index';
import type { BrowletEnvironment } from '../environment/index';

import { PerformanceResourceTimingImpl } from './resource';
import { PerformanceTimingConfidenceImpl } from './confidence';

/** A Document's navigation measurements, retaining milestones as its loading progresses. */
// https://w3c.github.io/navigation-timing/#sec-PerformanceNavigationTiming
export class PerformanceNavigationTimingImpl extends PerformanceResourceTimingImpl {
  /** Document-relative milestones; HTML has already selected their time origin. */
  documentTimingInfo: DocumentLoadTimingInfo;
  /** Previous-Document milestones, selected by HTML's origin and redirect checks. */
  previousDocumentUnloadTiming: DocumentUnloadTimingInfo;
  /** Navigation-specific worker observations, measured on Fetch's shared clock. */
  serviceWorkerTimingInfo: ServiceWorkerTimingInfo | null;
  /** Kind of navigation that created this Document. */
  type: NavigationTimingType;
  /** Count already selected by HTML's navigation redirect-exposure rules. */
  redirectCount: number;
  /** Document-relative Critical-CH restart observation; zero when no restart occurred. */
  criticalCHRestart: DOMHighResTimeStamp;
  /** Captured diagnostic implementation, or null when the navigation has no diagnostics. */
  // SPEC_CLASH(navigation-timing-reasons-identity): Retain the specified object; Chromium rebuilds it on every read. Firefox/WebKit do not expose the attribute.
  notRestoredReasons: NotRestoredReasonsImpl | null;
  /** Destination-selected MIME metadata, separate from Fetch's initiating-client view. */
  #contentType: string;
  /** Captured after a real underlying assessment becomes available; never randomized again. */
  #confidence: PerformanceTimingConfidenceImpl | null = null;

  /** Construct from prepared inputs without buffering the entry or notifying observers. */
  // Navigation Timing §§3.1–3.3. Performance owns creation/buffering in §5.
  // Callers prepare public status/body/header fields and select unload visibility before construction.
  constructor(
    requestedURL: string, inputs: NavigationTimingInit, criticalCHRestart: DOMHighResTimeStamp,
    notRestoredReasons: NotRestoredReasonsImpl | null, allowTransferSize: boolean, env: BrowletEnvironment,
  ) {
    super(
      'navigation', requestedURL, inputs.fetchTimingInfo, inputs.cacheUsage ?? '',
      inputs.bodyInfo, inputs.responseStatus, '', allowTransferSize, inputs.serverTimingHeaders, env,
    );
    this.entryType = 'navigation';
    this.startTime = 0;
    // This entry can be exposed before its load-event queueing; capture its association now.
    this.navigationId = env.getWindowOrWorkerGlobalScopeMixin().performance.currentNavigationId;
    this.documentTimingInfo = inputs.documentTimingInfo;
    this.previousDocumentUnloadTiming = inputs.previousDocumentUnloadTiming;
    this.serviceWorkerTimingInfo = inputs.serviceWorkerTimingInfo;
    this.type = inputs.type;
    this.redirectCount = inputs.redirectCount;
    this.criticalCHRestart = criticalCHRestart;
    this.notRestoredReasons = notRestoredReasons;
    this.#contentType = inputs.contentType;
  }

  // https://w3c.github.io/navigation-timing/#PerformanceEntry
  override get duration(): DOMHighResTimeStamp { return this.loadEventEnd - this.startTime; }

  // https://w3c.github.io/navigation-timing/#PerformanceResourceTiming
  override get redirectStart(): DOMHighResTimeStamp { return this.redirectCount === 0 ? 0 : super.redirectStart; }

  override get redirectEnd(): DOMHighResTimeStamp { return this.redirectCount === 0 ? 0 : super.redirectEnd; }

  override get contentType(): string { return this.#contentType; }

  override get workerStart(): DOMHighResTimeStamp {
    const workerTiming = this.serviceWorkerTimingInfo;
    // SPEC_CLASH(navigation-timing-worker-clock): The draft returns shared-clock values directly. Convert once in the entry's realm, as Chromium/WebKit do; Firefox's controlled-page probe returned zero for workerStart.
    return workerTiming === null ? super.workerStart :
      PerformanceResourceTimingImpl.convertFetchTimestamp(workerTiming.startTime, this.env);
  }

  override get fetchStart(): DOMHighResTimeStamp {
    const workerTiming = this.serviceWorkerTimingInfo;
    return workerTiming === null ? super.fetchStart :
      PerformanceResourceTimingImpl.convertFetchTimestamp(workerTiming.fetchEventDispatchTime, this.env);
  }

  // HTML records these milestones relative to the incoming Document's global. They are not Fetch timestamps.
  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-unloadeventstart
  get unloadEventStart(): DOMHighResTimeStamp { return this.previousDocumentUnloadTiming.unloadEventStartTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-unloadeventend
  get unloadEventEnd(): DOMHighResTimeStamp { return this.previousDocumentUnloadTiming.unloadEventEndTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-dominteractive
  get domInteractive(): DOMHighResTimeStamp { return this.documentTimingInfo.domInteractiveTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-domcontentloadedeventstart
  get domContentLoadedEventStart(): DOMHighResTimeStamp { return this.documentTimingInfo.domContentLoadedEventStartTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-domcontentloadedeventend
  get domContentLoadedEventEnd(): DOMHighResTimeStamp { return this.documentTimingInfo.domContentLoadedEventEndTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-domcomplete
  get domComplete(): DOMHighResTimeStamp { return this.documentTimingInfo.domCompleteTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-loadeventstart
  get loadEventStart(): DOMHighResTimeStamp { return this.documentTimingInfo.loadEventStartTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-loadeventend
  get loadEventEnd(): DOMHighResTimeStamp { return this.documentTimingInfo.loadEventEndTime; }

  // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-confidence
  get confidence(): PerformanceTimingConfidenceImpl | null {
    if (this.documentTimingInfo.domInteractiveTime === 0) return null;
    if (this.#confidence !== null) return this.#confidence;
    const underlying = this.env.userAgent.getUnderlyingNavigationTimingConfidence(this);
    // TODO(Navigation Timing host measurements): A missing assessment is unavailable, not high or low.
    // The UserAgent must assess this navigation's transient conditions, not conditions at getter time.
    if (underlying === null) return null;
    // SPEC_CLASH(navigation-confidence-lifetime): Store the specified retained object, repairing the omitted assignment and honoring the once-per-entry note. Chromium retains only its randomized values and rebuilds objects.
    return this.#confidence = new PerformanceTimingConfidenceImpl(underlying, this.env);
  }
}

/** Prepared creation inputs; the entry retains live Fetch and Document measurements. */
// https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry
// This is Browlet's internal init shape, not a Web IDL dictionary or a Performance entry.
export type NavigationTimingInit = {
  /** Kind of navigation that produced this document. */
  type: NavigationTimingType;
  /** Redirect count selected by HTML's redirect-taint and navigation TAO rules. */
  redirectCount: number;
  /** Controller timestamps, or fallback timing retaining only the Document's navigation start. */
  fetchTimingInfo: FetchTimingInfo;
  /** Live response body sizes retained by Fetch. */
  bodyInfo: ResponseBodyInfo;
  /** Minimized response MIME type selected for the destination Document. */
  contentType: string;
  /** Final response metrics selected for the destination's secure-context status. */
  serverTimingHeaders: string[];
  /** Document milestones updated as loading progresses. */
  documentTimingInfo: DocumentLoadTimingInfo;
  /** Previous-Document milestones, updated in place by the unload operation after privacy checks. */
  previousDocumentUnloadTiming: DocumentUnloadTimingInfo;
  /** Response-selected worker timings; null when no worker supplied them. */
  serviceWorkerTimingInfo: ServiceWorkerTimingInfo | null;
  /** Raw Fetch cache classification, before Resource Timing's cache-mode conversion. */
  cacheUsage: CacheUsage | undefined;
  /** HTTP response status before performance exposure rules are applied. */
  responseStatus: HTTPStatus;
};

/** Kind of navigation recorded in the document's performance entry. */
export type NavigationTimingType = 'navigate' | 'reload' | 'back_forward';

/*
 * [Exposed=Window]
 * interface PerformanceNavigationTiming : PerformanceResourceTiming {
 *   readonly attribute DOMHighResTimeStamp unloadEventStart;
 *   readonly attribute DOMHighResTimeStamp unloadEventEnd;
 *   readonly attribute DOMHighResTimeStamp domInteractive;
 *   readonly attribute DOMHighResTimeStamp domContentLoadedEventStart;
 *   readonly attribute DOMHighResTimeStamp domContentLoadedEventEnd;
 *   readonly attribute DOMHighResTimeStamp domComplete;
 *   readonly attribute DOMHighResTimeStamp loadEventStart;
 *   readonly attribute DOMHighResTimeStamp loadEventEnd;
 *   readonly attribute NavigationTimingType type;
 *   readonly attribute unsigned short redirectCount;
 *   readonly attribute DOMHighResTimeStamp criticalCHRestart;
 *   readonly attribute NotRestoredReasons? notRestoredReasons;
 *   readonly attribute PerformanceTimingConfidence confidence;
 *   [Default] object toJSON();
 * };
 */
export const performanceNavigationTimingIDL = defineInterface({
  name: 'PerformanceNavigationTiming', inherits: 'PerformanceResourceTiming', exposed: 'Window',
  implementation: impl(PerformanceNavigationTimingImpl),
  members: [
    roAttr('unloadEventStart', reference('DOMHighResTimeStamp')),
    roAttr('unloadEventEnd', reference('DOMHighResTimeStamp')),
    roAttr('domInteractive', reference('DOMHighResTimeStamp')),
    roAttr('domContentLoadedEventStart', reference('DOMHighResTimeStamp')),
    roAttr('domContentLoadedEventEnd', reference('DOMHighResTimeStamp')),
    roAttr('domComplete', reference('DOMHighResTimeStamp')),
    roAttr('loadEventStart', reference('DOMHighResTimeStamp')),
    roAttr('loadEventEnd', reference('DOMHighResTimeStamp')),
    roAttr('type', reference('NavigationTimingType')),
    roAttr('redirectCount', idlType.unsignedShort),
    roAttr('criticalCHRestart', reference('DOMHighResTimeStamp')),
    roAttr('notRestoredReasons', nullable(reference('NotRestoredReasons'))),
    // SPEC_CLASH(navigation-confidence-nullability): Follow the getter's null return and Chromium's observable behavior; the draft's IDL incorrectly makes the attribute nonnullable.
    roAttr('confidence', nullable(reference('PerformanceTimingConfidence'))),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

/*
 * enum NavigationTimingType {
 *   "navigate",
 *   "reload",
 *   "back_forward"
 * };
 */
export const navigationTimingTypeIDL = defineEnumeration({
  name: 'NavigationTimingType', values: ['navigate', 'reload', 'back_forward'] satisfies NavigationTimingType[],
});
