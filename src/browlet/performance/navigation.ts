import type { HTTPStatus } from '../../http/index';
import type { CacheUsage, FetchTimingInfo, ResponseBodyInfo, ServiceWorkerTimingInfo } from '../../fetch/index';

import type { DocumentLoadTimingInfo, DocumentUnloadTimingInfo } from '../dom/nodes/index';

/** Live inputs retained until the navigation performance entry can be exposed. */
// https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry
// PROVISIONAL(Navigation Timing): this record is not a Performance entry.
// Time-origin conversion, exposure checks, and Timeline delivery remain in ROADMAP.md.
// TODO(Navigation Timing): The real entry must retain its created NotRestoredReasonsImpl, not expose the mutable history record.
// SPEC_GAP(navigation-timing-null-reasons): Entry creation passes nullable Document diagnostics to HTML's non-null creation operation and omits its realm. Resolve at that consumer before exposing the entry.
export type NavigationTimingRecord = {
  /** Kind of navigation that produced this document. */
  type: NavigationTimingType;
  /** Redirect count selected by HTML's redirect-taint and navigation TAO rules. */
  redirectCount: number;
  /** Fetch controller's timestamps for the navigation response. */
  fetchTimingInfo: FetchTimingInfo;
  /** Response body sizes and content type retained by Fetch. */
  bodyInfo: ResponseBodyInfo;
  /** Document milestones updated as loading progresses. */
  documentTimingInfo: DocumentLoadTimingInfo;
  /** Previous-Document milestones; the lifecycle producer remains unfinished. */
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
