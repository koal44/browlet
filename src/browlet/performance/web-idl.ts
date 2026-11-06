import { performanceIDL } from './performance';
import { performanceEntryIDL, performanceEntryListIDL, performanceEntryNavigationIDL, performanceTimelineIDL } from './timeline';
import {
  performanceObserverIDL, performanceObserverInitIDL, performanceObserverCallbackIDL, performanceObserverCallbackOptionsIDL,
} from './observer';
import { performanceObserverEntryListIDL } from './observer-entry-list';
import { resourceTimingPerformanceIDL, performanceResourceTimingIDL, renderBlockingStatusTypeIDL } from './resource';
import { performanceServerTimingIDL, serverTimingResourceIDL } from './server';
import { performanceNavigationTimingIDL, navigationTimingTypeIDL } from './navigation';
import { performanceTimingConfidenceIDL, performanceTimingConfidenceValueIDL } from './confidence';

/** High Resolution Time, Performance Timeline, its timing families, and the Soft Navigations amendment. */
export const performanceIDLDefinitions = [
  performanceIDL, performanceEntryIDL, performanceEntryListIDL, performanceEntryNavigationIDL, performanceTimelineIDL,
  performanceObserverIDL, performanceObserverInitIDL, performanceObserverCallbackIDL, performanceObserverCallbackOptionsIDL,
  performanceObserverEntryListIDL,
  resourceTimingPerformanceIDL, performanceResourceTimingIDL, renderBlockingStatusTypeIDL,
  performanceServerTimingIDL, serverTimingResourceIDL,
  performanceNavigationTimingIDL, navigationTimingTypeIDL,
  performanceTimingConfidenceIDL, performanceTimingConfidenceValueIDL,
];
