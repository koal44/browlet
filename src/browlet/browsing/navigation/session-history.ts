import type { DocumentImpl } from '../../dom/nodes/document';
import type { PolicyContainer } from '../policy/container';
import type { ReferrerPolicy } from '../../../fetch/index';
import type { Origin, URLRecord } from '../../../url/index';

/** Retains the document or the inputs needed to recreate it during history traversal. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#document-state
export type DocumentState = {
  /** Live document, or null when it must be recreated. */
  document: DocumentImpl | null;
  /** Policy container retained for a later history load. */
  historyPolicyContainer: PolicyContainer | null;
  /** Navigation referrer; undefined until selected, null when no referrer is sent. */
  requestReferrer: URLRecord | null | undefined;
  /** Referrer policy retained for reloading this entry. */
  requestReferrerPolicy: ReferrerPolicy;
  /** Origin of the document that initiated this navigation. */
  initiatorOrigin: Origin | null;
  /** Origin assigned to the history document, when determined. */
  origin: Origin | null;
  /** Inherited base URL used by about:blank and srcdoc documents. */
  aboutBaseURL: URLRecord | null;
  /** Session histories belonging to child navigables. */
  nestedHistories: NestedHistory[];
  /** Stored source text or POST data used to recreate the document. */
  resource: string | PostResource | null;
  /** Whether a reload was requested for this state. */
  reloadPending: boolean;
  /** Whether this state has previously held a populated document. */
  everPopulated: boolean;
  /** Target name to restore with the navigable. */
  navigableTargetName: string;
  /** Back/forward-cache restoration diagnostics, when available. */
  notRestoredReasons: object | null;
};

/** Session-history state while its Document is present. */
export type DocumentBackedState = DocumentState & { document: DocumentImpl; };

/** One reason that a document cannot be restored from the back/forward cache. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#nrr-details-struct
export type NotRestoredReasonDetails = {
  reason: string;
};

/** One URL and document state at a joint session-history step. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#session-history-entry
export type SessionHistoryEntry = {
  /** Assigned history step, or pending before insertion into history. */
  step: number | 'pending';
  /** URL represented by this history entry. */
  url: URLRecord;
  /** Live document and retained reload inputs. */
  documentState: DocumentState;
};

export type NestedHistory = {
  /** Identity of the child navigable whose history is retained. */
  id: symbol;
  /** Child history entries, ordered by history step. */
  entries: SessionHistoryEntry[];
};

export type PostResource = {
  /** Captured submission body, or failure when it could not be retained. */
  requestBody: Uint8Array | 'failure';
  /** Form encoding used for the retained body. */
  requestContentType:
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'
    | 'text/plain';
};

/** Initialize history state, optionally retaining an already-created document. */
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

/** Create a pending history entry for an existing document. */
export function createSessionHistoryEntry(
  documentState: DocumentBackedState,
): SessionHistoryEntry {
  const url = documentState.document.url;

  // The History and Navigation APIs will add their serialized-state,
  // navigation-key, scroll-restoration, and persisted-user-state slots.
  return { step: 'pending', url, documentState };
}
