import { performanceIDL } from './performance';
import { performanceEntryIDL, performanceEntryListIDL, performanceEntryNavigationIDL, performanceTimelineIDL } from './timeline';
import {
  performanceObserverIDL, performanceObserverInitIDL, performanceObserverCallbackIDL, performanceObserverCallbackOptionsIDL,
} from './observer';
import { performanceObserverEntryListIDL } from './observer-entry-list';

/** High Resolution Time, Performance Timeline, and the Soft Navigations entry amendment. */
export const performanceIDLDefinitions = [
  performanceIDL, performanceEntryIDL, performanceEntryListIDL, performanceEntryNavigationIDL, performanceTimelineIDL,
  performanceObserverIDL, performanceObserverInitIDL, performanceObserverCallbackIDL, performanceObserverCallbackOptionsIDL,
  performanceObserverEntryListIDL,
];
