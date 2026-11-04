import { InternalError } from '../../../../infra/index';
import { randomUUID } from '../../../../js-engine/index';
import type { URLRecord } from '../../../../url/index';

import type { ScrollRestoration } from '../../history/index';
import type { DocumentImpl } from '../../../dom/nodes/index';
import type { BrowletEnvironment } from '../../../environment/index';
import type { SerializedRecord } from '../../../scripting/structured-data/index';

import type { DocumentState } from './document-state';

/** One URL and document state at a joint session-history step. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#session-history-entry
export class SessionHistoryEntry {
  /** Assigned history step, or pending before insertion into history. */
  step: number | 'pending' = 'pending';
  /** URL represented by this history entry. */
  url: URLRecord;
  /** Live document and retained reload inputs. */
  documentState: DocumentState;
  /** Classic History state, initially serialized null and independent of Navigation state. */
  classicHistoryAPIState: SerializedRecord;
  /** Persisted Navigation API state, independent of classic History state. */
  navigationAPIState: SerializedRecord;
  /** UUID identifying this history position; replacement retains it. */
  navigationAPIKey: string = randomUUID();
  /** UUID identifying this specific entry; replacement creates a new ID. */
  navigationAPIID: string = randomUUID();
  /** Whether traversal restores this entry's saved scroll position automatically. */
  scrollRestorationMode: ScrollRestoration = 'auto';
  /** Saved scroll positions; null until scroll-region capture is implemented. */
  // TODO(HTML §7.4.6.3): supply viewport/region identity and position data without retaining a destroyed Document.
  // SPEC_MISMATCH: session history entry's scroll position data
  scrollPositionData: null = null;
  /** Optional user-agent state; Browlet does not yet persist form values or directionality. */
  persistedUserState: null = null;

  /** Initialize an entry independently of whether its destination Document has been populated. */
  constructor(url: URLRecord, documentState: DocumentState, env: BrowletEnvironment) {
    this.url = url;
    this.documentState = documentState;
    this.classicHistoryAPIState = env.serializeForStorage(null);
    this.navigationAPIState = env.serializeForStorage(undefined);
  }

  /** The shared state's current Document, or null until populated or after destruction. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#she-document
  get document(): DocumentImpl | null { return this.documentState.document; }

  /** Capture scroll positions and any optional user state for a later traversal. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#save-persisted-state
  savePersistedState(): void {
    // TODO(HTML §7.4.6.3): enumerate restorable regions and capture their positions.
    // Optional form-state capture should retain directionality alongside values when implemented.
    throw new InternalError('Persisted history state capture is not implemented');
  }

  /** Apply automatic scroll restoration and any user-agent state retained in this entry. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#restore-persisted-state
  restorePersistedState(): void {
    // TODO(HTML §7.4.6.3): respect auto/manual and Navigation's scroll-restoration suppression before scrolling.
    // Optional control restoration does not fire input/change; form-associated custom elements have their own callback.
    throw new InternalError('Persisted history state restoration is not implemented');
  }

  /** Attempt restoration of the saved scrollable regions, unless the user has scrolled. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#restore-scroll-position-data
  restoreScrollPositionData(): void {
    // TODO(HTML §7.4.6.3): Capture scrollPositionData, restorable regions, and has-been-scrolled-by-the-user state.
    // Restoration can retry while content loads; scroll anchoring and CSSOM View supply the resulting positions.
    throw new InternalError('Session-history scroll restoration is not implemented');
  }
}

export type NestedHistory = {
  /** Identity of the child navigable whose history is retained. */
  // SPEC_GAP(nested-history-reload-identity): HTML leaves child identification across reloads unspecified.
  id: symbol;
  /** Child history entries, ordered by history step. */
  entries: SessionHistoryEntry[];
};
