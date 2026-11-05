import { performanceIDL } from './performance';
import { performanceEntryIDL, performanceEntryListIDL, performanceEntryNavigationIDL, performanceTimelineIDL } from './timeline';
import {
  performanceObserverIDL, performanceObserverInitIDL, performanceObserverCallbackIDL, performanceObserverCallbackOptionsIDL,
} from './observer';
import { performanceObserverEntryListIDL } from './observer-entry-list';
import { resourceTimingPerformanceIDL, performanceResourceTimingIDL, renderBlockingStatusTypeIDL } from './resource';
import { performanceServerTimingIDL, serverTimingResourceIDL } from './server';

/** High Resolution Time, Performance Timeline, Resource/Server Timing, and the Soft Navigations amendment. */
export const performanceIDLDefinitions = [
  performanceIDL, performanceEntryIDL, performanceEntryListIDL, performanceEntryNavigationIDL, performanceTimelineIDL,
  performanceObserverIDL, performanceObserverInitIDL, performanceObserverCallbackIDL, performanceObserverCallbackOptionsIDL,
  performanceObserverEntryListIDL,
  resourceTimingPerformanceIDL, performanceResourceTimingIDL, renderBlockingStatusTypeIDL,
  performanceServerTimingIDL, serverTimingResourceIDL,
];
