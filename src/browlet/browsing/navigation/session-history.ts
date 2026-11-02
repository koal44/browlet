import { InternalError } from '../../../infra/index';
import { randomUUID } from '../../../js-engine/index';
import type { URLRecord } from '../../../url/index';

import type { ScrollRestoration } from '../history/index';
import type { SerializedRecord } from '../../scripting/structured-data/index';
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
  /** Persisted Navigation API state, independent of classic History state. */
  navigationAPIState: SerializedRecord;
  /** UUID identifying this history position; replacement retains it. */
  navigationAPIKey: string;
  /** UUID identifying this specific entry; replacement creates a new ID. */
  navigationAPIID: string;
  /** Whether traversal restores this entry's saved scroll position automatically. */
  scrollRestorationMode: ScrollRestoration;
};

/** Create a pending history entry for an existing document. */
export function createSessionHistoryEntry(
  documentState: DocumentBackedState,
): SessionHistoryEntry {
  const url = documentState.document.url;

  // TODO(HTML 7.4): Classic History serialized state, scroll position, and persisted user state.
  return {
    step: 'pending', url, documentState,
    navigationAPIState: documentState.document.env.serializeForStorage(undefined),
    navigationAPIKey: randomUUID(), navigationAPIID: randomUUID(),
    scrollRestorationMode: 'auto',
  };
}

/** Attempt restoration of an entry's saved scrollable regions, unless the user has scrolled. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#restore-scroll-position-data
export function restoreScrollPositionData(_entry: SessionHistoryEntry): void {
  // TODO(HTML §7.4.6.3): Retained scroll position data, restorable regions, and has-been-scrolled-by-the-user state.
  // Restoration can retry while content loads; scroll anchoring and CSSOM View supply the resulting positions.
  throw new InternalError('Session-history scroll restoration is not implemented');
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
