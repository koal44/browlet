import type { FetchTimingInfo, ResponseBodyInfo } from '../../fetch/index';
import type { NavigationTimingType } from '../browsing/navigation/navigation';
import type { DocumentLoadTimingInfo } from '../dom/nodes/document';

/** Live inputs retained until the navigation performance entry can be exposed. */
// https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry
// PROVISIONAL(Navigation Timing): this record is not a Performance entry.
// Time-origin conversion, exposure checks, and Timeline delivery remain in ROADMAP.md.
export type NavigationTimingRecord = {
  /** Kind of navigation that produced this document. */
  type: NavigationTimingType;
  /** Fetch controller's timestamps for the navigation response. */
  fetchTimingInfo: FetchTimingInfo;
  /** Response body sizes and content type retained by Fetch. */
  bodyInfo: ResponseBodyInfo;
  /** Document milestones updated as loading progresses. */
  documentTimingInfo: DocumentLoadTimingInfo;
  /** HTTP response status before performance exposure rules are applied. */
  responseStatus: number;
};
