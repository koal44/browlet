import type { DocumentImpl } from '../../dom/nodes/document';
import type { PolicyContainer } from '../policy/container';
import type { ReferrerPolicy } from '../../../fetch/index';
import type { Origin, URLRecord } from '../../../url/index';

/*
 * A document state holds the information needed to present or recreate one
 * Document from a session history entry.
 */
export type DocumentState = {
  document: DocumentImpl | null;
  historyPolicyContainer: PolicyContainer | null;
  requestReferrer: URLRecord | null | undefined;
  requestReferrerPolicy: ReferrerPolicy;
  initiatorOrigin: Origin | null;
  origin: Origin | null;
  aboutBaseURL: URLRecord | null;
  nestedHistories: NestedHistory[];
  resource: string | PostResource | null;
  reloadPending: boolean;
  everPopulated: boolean;
  navigableTargetName: string;
  notRestoredReasons: object | null;
};

/** Session-history state while its Document is present. */
export type DocumentBackedState = DocumentState & { document: DocumentImpl; };

/** One reason that a document cannot be restored from the back/forward cache. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#nrr-details-struct
export type NotRestoredReasonDetails = {
  reason: string;
};

export type SessionHistoryEntry = {
  step: number | 'pending';
  url: URLRecord;
  documentState: DocumentState;
};

export type NestedHistory = {
  id: symbol;
  entries: SessionHistoryEntry[];
};

export type PostResource = {
  requestBody: Uint8Array | 'failure';
  requestContentType:
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'
    | 'text/plain';
};

export function createDocumentState(
  document: DocumentImpl,
): DocumentBackedState;
export function createDocumentState(document?: DocumentImpl | null): DocumentState;
export function createDocumentState(
  document: DocumentImpl | null = null,
): DocumentState {
  return {
    document,
    historyPolicyContainer: null,
    requestReferrer: undefined,
    requestReferrerPolicy: 'strict-origin-when-cross-origin',
    initiatorOrigin: null,
    origin: null,
    aboutBaseURL: null,
    nestedHistories: [],
    resource: null,
    reloadPending: false,
    everPopulated: false,
    navigableTargetName: '',
    notRestoredReasons: null,
  };
}

export function createSessionHistoryEntry(
  documentState: DocumentBackedState,
): SessionHistoryEntry {
  const url = documentState.document.url;

  // The History and Navigation APIs will add their serialized-state,
  // navigation-key, scroll-restoration, and persisted-user-state slots.
  return { step: 'pending', url, documentState };
}
