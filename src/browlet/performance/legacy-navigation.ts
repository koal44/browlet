import { constant, defineInterface, definePartialInterface, idlType, impl, integer, op, reference, roAttr, xattr } from '../../web-idl/core/index';
import { Moment, monotonicClock, type DOMHighResTimeStamp, type EpochTimeStamp } from '../../timing/index';
import type { FetchTimingInfo } from '../../fetch/index';

import type { WindowEnvironment } from '../environment/index';

/** Legacy epoch-millisecond view of this Window's current Document and its retained measurements. */
// https://w3c.github.io/navigation-timing/#sec-performance-timing
export class PerformanceTimingImpl {
  env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.env = env;
  }

  // SPEC_GAP(legacy-timing-detached): No removal rule is specified. Retain the Window's Document measurements.
  // SPEC_CLASH(legacy-timing-detached): Firefox/WebKit retain timestamps after frame removal; Chromium returns zero.
  get navigationStart(): EpochTimeStamp {
    return Math.trunc(this.env.getTimeOriginTimestamp().milliseconds);
  }

  get unloadEventStart(): EpochTimeStamp {
    const document = this.env.window.getAssociatedDocument();
    return document.wasCreatedViaCrossOriginRedirects ? 0 : this.relativeToEpoch(document.previousDocumentUnloadTiming.unloadEventStartTime);
  }

  get unloadEventEnd(): EpochTimeStamp {
    const document = this.env.window.getAssociatedDocument();
    return document.wasCreatedViaCrossOriginRedirects ? 0 : this.relativeToEpoch(document.previousDocumentUnloadTiming.unloadEventEndTime);
  }

  // SPEC_CLASH(legacy-timing-redirect-privacy): Follow the legacy same-origin gate and Chromium, regardless of TAO.
  // WebKit exposes TAO-authorized redirect times; Firefox exposes the preceding same-origin Document's unload times.
  get redirectStart(): EpochTimeStamp {
    const document = this.env.window.getAssociatedDocument();
    return document.wasCreatedViaCrossOriginRedirects ? 0 : this.sharedToEpoch(this.fetchTimingInfo?.redirectStartTime ?? 0);
  }

  get redirectEnd(): EpochTimeStamp {
    const document = this.env.window.getAssociatedDocument();
    return document.wasCreatedViaCrossOriginRedirects ? 0 : this.sharedToEpoch(this.fetchTimingInfo?.redirectEndTime ?? 0);
  }

  get fetchStart(): EpochTimeStamp {
    // SPEC_CLASH(legacy-timing-unavailable-fetch): Preserve zero without Fetch measurements, as Chromium does
    // for initial about:blank network phases; Firefox/WebKit substitute epoch times, including absent TLS.
    return this.sharedToEpoch(this.fetchTimingInfo?.postRedirectStartTime ?? 0);
  }

  get domainLookupStart(): EpochTimeStamp {
    return this.sharedToEpoch(this.fetchTimingInfo?.finalConnectionTimingInfo?.domainLookupStartTime ?? 0) || this.fetchStart;
  }

  get domainLookupEnd(): EpochTimeStamp {
    return this.sharedToEpoch(this.fetchTimingInfo?.finalConnectionTimingInfo?.domainLookupEndTime ?? 0) || this.domainLookupStart;
  }

  get connectStart(): EpochTimeStamp {
    // The legacy connection interval excludes DNS, including when Fetch retained a combined interval.
    return Math.max(this.domainLookupEnd, this.sharedToEpoch(this.fetchTimingInfo?.finalConnectionTimingInfo?.connectionStartTime ?? 0));
  }

  get connectEnd(): EpochTimeStamp {
    return this.sharedToEpoch(this.fetchTimingInfo?.finalConnectionTimingInfo?.connectionEndTime ?? 0) || this.connectStart;
  }

  get secureConnectionStart(): EpochTimeStamp {
    return this.sharedToEpoch(this.fetchTimingInfo?.finalConnectionTimingInfo?.secureConnectionStartTime ?? 0);
  }

  get requestStart(): EpochTimeStamp {
    return this.sharedToEpoch(this.fetchTimingInfo?.finalNetworkRequestStartTime ?? 0) || this.connectEnd;
  }

  get responseStart(): EpochTimeStamp {
    const timing = this.fetchTimingInfo;
    return this.sharedToEpoch(timing?.firstInterimNetworkResponseStartTime || timing?.finalNetworkResponseStartTime || 0) || this.requestStart;
  }

  get responseEnd(): EpochTimeStamp {
    return this.sharedToEpoch(this.fetchTimingInfo?.endTime ?? 0);
  }

  get domLoading(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().domLoadingTime);
  }

  get domInteractive(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().loadTimingInfo.domInteractiveTime);
  }

  get domContentLoadedEventStart(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().loadTimingInfo.domContentLoadedEventStartTime);
  }

  get domContentLoadedEventEnd(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().loadTimingInfo.domContentLoadedEventEndTime);
  }

  get domComplete(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().loadTimingInfo.domCompleteTime);
  }

  get loadEventStart(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().loadTimingInfo.loadEventStartTime);
  }

  get loadEventEnd(): EpochTimeStamp {
    return this.relativeToEpoch(this.env.window.getAssociatedDocument().loadTimingInfo.loadEventEndTime);
  }

  private get fetchTimingInfo(): FetchTimingInfo | undefined {
    return this.env.window.getAssociatedDocument().navigationTimingEntry?.timingInfo;
  }

  /** Convert a recorded Document-relative milestone; zero remains an unobserved event. */
  private relativeToEpoch(time: DOMHighResTimeStamp): EpochTimeStamp {
    return time === 0 ? 0 : Math.trunc(this.env.getTimeOriginTimestamp().milliseconds + time);
  }

  /** Convert Fetch's coarsened shared clock without confusing an actual time-origin reading with absence. */
  private sharedToEpoch(time: DOMHighResTimeStamp): EpochTimeStamp {
    if (time === 0) return 0;
    const relative = this.env.relativeHighResolutionCoarseTime(new Moment(monotonicClock, time));
    return Math.trunc(this.env.getTimeOriginTimestamp().milliseconds + relative.milliseconds);
  }
}

/** Stable legacy view of the Window's current Document's navigation classification and redirect history. */
// https://w3c.github.io/navigation-timing/#sec-performance-navigation
export class PerformanceNavigationImpl {
  env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.env = env;
  }

  // SPEC_GAP(legacy-navigation-detached): The legacy API specifies no frame-removal lifetime rule.
  // SPEC_CLASH(legacy-navigation-detached): Retain Document values like Firefox; Chromium/WebKit reset type/count.
  get type(): PerformanceNavigationType {
    switch (this.env.window.getAssociatedDocument().legacyNavigationType) {
      case 'navigate': return PerformanceNavigationType.Navigate;
      case 'reload': return PerformanceNavigationType.Reload;
      case 'back_forward': return PerformanceNavigationType.BackForward;
    }
  }

  get redirectCount(): number {
    const document = this.env.window.getAssociatedDocument();
    // SPEC_CLASH(legacy-navigation-redirect-count): Follow the specification and Chromium/Firefox's
    // same-origin gate, regardless of TAO; WebKit exposes TAO-authorized foreign redirect counts.
    if (document.wasCreatedViaCrossOriginRedirects) return 0;
    // HTML already retains the full count for same-origin chains. Initial about:blank has no entry.
    return document.navigationTimingEntry?.redirectCount ?? 0;
  }
}

/** Codes exposed by the legacy PerformanceNavigation interface. */
export enum PerformanceNavigationType {
  Navigate = 0,
  Reload = 1,
  BackForward = 2,
  Reserved = 255,
}

/*
 * [Exposed=Window]
 * interface PerformanceTiming {
 *   readonly attribute unsigned long long navigationStart;
 *   readonly attribute unsigned long long unloadEventStart;
 *   readonly attribute unsigned long long unloadEventEnd;
 *   readonly attribute unsigned long long redirectStart;
 *   readonly attribute unsigned long long redirectEnd;
 *   readonly attribute unsigned long long fetchStart;
 *   readonly attribute unsigned long long domainLookupStart;
 *   readonly attribute unsigned long long domainLookupEnd;
 *   readonly attribute unsigned long long connectStart;
 *   readonly attribute unsigned long long connectEnd;
 *   readonly attribute unsigned long long secureConnectionStart;
 *   readonly attribute unsigned long long requestStart;
 *   readonly attribute unsigned long long responseStart;
 *   readonly attribute unsigned long long responseEnd;
 *   readonly attribute unsigned long long domLoading;
 *   readonly attribute unsigned long long domInteractive;
 *   readonly attribute unsigned long long domContentLoadedEventStart;
 *   readonly attribute unsigned long long domContentLoadedEventEnd;
 *   readonly attribute unsigned long long domComplete;
 *   readonly attribute unsigned long long loadEventStart;
 *   readonly attribute unsigned long long loadEventEnd;
 *   [Default] object toJSON();
 * };
 */
export const performanceTimingIDL = defineInterface({
  name: 'PerformanceTiming', exposed: 'Window', implementation: impl(PerformanceTimingImpl),
  members: [
    roAttr('navigationStart', idlType.unsignedLongLong),
    roAttr('unloadEventStart', idlType.unsignedLongLong),
    roAttr('unloadEventEnd', idlType.unsignedLongLong),
    roAttr('redirectStart', idlType.unsignedLongLong),
    roAttr('redirectEnd', idlType.unsignedLongLong),
    roAttr('fetchStart', idlType.unsignedLongLong),
    roAttr('domainLookupStart', idlType.unsignedLongLong),
    roAttr('domainLookupEnd', idlType.unsignedLongLong),
    roAttr('connectStart', idlType.unsignedLongLong),
    roAttr('connectEnd', idlType.unsignedLongLong),
    roAttr('secureConnectionStart', idlType.unsignedLongLong),
    roAttr('requestStart', idlType.unsignedLongLong),
    roAttr('responseStart', idlType.unsignedLongLong),
    roAttr('responseEnd', idlType.unsignedLongLong),
    roAttr('domLoading', idlType.unsignedLongLong),
    roAttr('domInteractive', idlType.unsignedLongLong),
    roAttr('domContentLoadedEventStart', idlType.unsignedLongLong),
    roAttr('domContentLoadedEventEnd', idlType.unsignedLongLong),
    roAttr('domComplete', idlType.unsignedLongLong),
    roAttr('loadEventStart', idlType.unsignedLongLong),
    roAttr('loadEventEnd', idlType.unsignedLongLong),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

/*
 * [Exposed=Window]
 * interface PerformanceNavigation {
 *   const unsigned short TYPE_NAVIGATE = 0;
 *   const unsigned short TYPE_RELOAD = 1;
 *   const unsigned short TYPE_BACK_FORWARD = 2;
 *   const unsigned short TYPE_RESERVED = 255;
 *   readonly attribute unsigned short type;
 *   readonly attribute unsigned short redirectCount;
 *   [Default] object toJSON();
 * };
 */
export const performanceNavigationIDL = defineInterface({
  name: 'PerformanceNavigation', exposed: 'Window', implementation: impl(PerformanceNavigationImpl),
  members: [
    constant('TYPE_NAVIGATE', idlType.unsignedShort, integer(PerformanceNavigationType.Navigate)),
    constant('TYPE_RELOAD', idlType.unsignedShort, integer(PerformanceNavigationType.Reload)),
    constant('TYPE_BACK_FORWARD', idlType.unsignedShort, integer(PerformanceNavigationType.BackForward)),
    constant('TYPE_RESERVED', idlType.unsignedShort, integer(PerformanceNavigationType.Reserved)),
    roAttr('type', idlType.unsignedShort),
    roAttr('redirectCount', idlType.unsignedShort),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

// https://w3c.github.io/navigation-timing/#sec-extensions-performance-interface
/*
 * [Exposed=Window]
 * partial interface Performance {
 *   [SameObject]
 *   readonly attribute PerformanceTiming timing;
 *   [SameObject]
 *   readonly attribute PerformanceNavigation navigation;
 * };
 */
export const legacyNavigationPerformanceIDL = definePartialInterface({
  name: 'Performance', exposed: 'Window',
  members: [
    roAttr('timing', reference('PerformanceTiming'), xattr('SameObject')),
    roAttr('navigation', reference('PerformanceNavigation'), xattr('SameObject')),
  ],
});
