import { InternalError } from '../../../../infra/index';
import type { Origin, URLRecord } from '../../../../url/index';
import type { ReferrerPolicy } from '../../../../fetch/index';

import type { PolicyContainer } from '../../policy/index';
import type { NotRestoredReasons } from '../diagnostics/index';
import type { DocumentImpl } from '../../../dom/nodes/index';

import type { NestedHistory } from './session-history';

/** Retains the document or the inputs needed to recreate it during history traversal. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#document-state
export class DocumentState {
  /** Live document, or null when it must be recreated. */
  document: DocumentImpl | null = null;
  /** Policy container retained for a later history load. */
  historyPolicyContainer: PolicyContainer | null = null;
  /** Request referrer using Fetch's representation: undefined means client, null means no-referrer. */
  requestReferrer: URLRecord | null | undefined = undefined;
  /** Policy for fetches of this Document, distinct from its policy container's policy for outgoing fetches. */
  requestReferrerPolicy: ReferrerPolicy = 'strict-origin-when-cross-origin';
  /** Origin of the document that initiated this navigation. */
  initiatorOrigin: Origin | null = null;
  /** Retained origin for local about: Documents and comparison after repopulation. */
  // History preparation compares this snapshot with the populated origin before resetting state/target names.
  origin: Origin | null = null;
  /** Inherited base URL used by about:blank and srcdoc documents. */
  aboutBaseURL: URLRecord | null = null;
  /** Session histories belonging to child navigables. */
  nestedHistories: NestedHistory[] = [];
  /** Stored srcdoc HTML or POST data used to recreate the document. */
  // Navigation request construction reuses retained POST bytes; srcdoc parameter assembly is connected.
  resource: string | PostResource | null = null;
  /** Whether a reload was requested for this state. */
  reloadPending = false;
  /** Whether this state has previously held a populated document. */
  everPopulated = false;
  /** Target name to restore with the navigable. */
  navigableTargetName = '';
  /** Back/forward-cache restoration diagnostics, when available. */
  notRestoredReasons: NotRestoredReasons | null = null;

  /** Initialize state with a live Document; navigation separately supplies its retained metadata. */
  static create(document: DocumentImpl): DocumentBackedState {
    return Object.assign(new DocumentState(), { document });
  }

  /** Retain navigation inputs before the destination Document is populated. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-create-document-state
  static createForNavigation(
    url: URLRecord, initiatorOriginSnapshot: Origin, initiatorBaseURLSnapshot: URLRecord,
    referrerPolicy: ReferrerPolicy, resource: PostResource | string | null, targetName: string,
  ): DocumentState {
    const state = new DocumentState();
    state.requestReferrerPolicy = referrerPolicy;
    state.initiatorOrigin = initiatorOriginSnapshot;
    state.resource = resource;
    state.navigableTargetName = targetName;
    if (
      url.scheme === 'about' && url.host === null && url.username === '' && url.password === '' &&
      (url.path === 'blank' || (url.path === 'srcdoc' && url.query === null && url.fragment === null))
    ) {
      state.origin = initiatorOriginSnapshot;
      state.aboutBaseURL = initiatorBaseURLSnapshot;
    }
    return state;
  }

  /** Request destruction of a cached Document; a fully active Document cannot be evicted. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#document-state
  evictDocument(): void {
    const document = this.document;
    if (document === null) return;
    if (document.isFullyActive()) throw new InternalError('A fully active Document cannot be evicted');
    // TODO(HTML §7.5.10): Recursive destruction must clear this retained state, even for an inactive Document.
    // The lifecycle owner clears the Document after teardown; this request does not clear it early.
    document.destroyAndDescendants();
  }
}

/** Session-history state while its Document is present. */
export type DocumentBackedState = DocumentState & { document: DocumentImpl; };

// https://html.spec.whatwg.org/multipage/browsing-the-web.html#post-resource
export type PostResource = {
  /** Stable submission bytes, read only in parallel; failure when they cannot be recovered unchanged. */
  // TODO(HTML §4.10.22/§7.4.2): Submission must snapshot the body; navigation must replay it or handle failure.
  // A future external store must return the same bytes on every read, or transition to failure.
  requestBody: Uint8Array | 'failure';
  /** Form encoding used for the retained body. */
  requestContentType:
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'
    | 'text/plain';
};
