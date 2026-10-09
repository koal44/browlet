import type { URLRecord } from '../../../url/index';
import type { DocumentBackedState, DocumentState } from './document-state';

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

/** Create a pending history entry for an existing document. */
export function createSessionHistoryEntry(
  documentState: DocumentBackedState,
): SessionHistoryEntry {
  const url = documentState.document.url;

  // The History and Navigation APIs will add their serialized-state,
  // navigation-key, scroll-restoration, and persisted-user-state slots.
  return { step: 'pending', url, documentState };
}

export type NestedHistory = {
  /** Identity of the child navigable whose history is retained. */
  id: symbol;
  /** Child history entries, ordered by history step. */
  entries: SessionHistoryEntry[];
};

/** One reason that a document cannot be restored from the back/forward cache. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#nrr-details-struct
export type NotRestoredReasonDetails = {
  reason: string;
};
