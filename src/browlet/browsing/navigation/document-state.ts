import type { ReferrerPolicy } from '../../../fetch/index';
import type { Origin, URLRecord } from '../../../url/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { PolicyContainer } from '../policy/index';
import type { NestedHistory } from './session-history';

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

/** Initialize history state, retaining the supplied document when present. */
export function createDocumentState(document: DocumentImpl): DocumentBackedState;
export function createDocumentState(document: DocumentImpl | null): DocumentState;
export function createDocumentState(document: DocumentImpl | null): DocumentState {
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

export type PostResource = {
  /** Captured submission body, or failure when it could not be retained. */
  requestBody: Uint8Array | 'failure';
  /** Form encoding used for the retained body. */
  requestContentType:
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'
    | 'text/plain';
};
