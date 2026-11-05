import { InternalError } from '../../../../infra/index';
import { randomUUID } from '../../../../js-engine/index';
import { createOpaqueOrigin, type URLRecord } from '../../../../url/index';
import { FetchRequest } from '../../../../fetch/index';

import type { ScrollRestoration } from '../../history/index';
import type { DocumentImpl } from '../../../dom/nodes/index';
import type { BrowletEnvironment } from '../../../environment/index';
import type { SerializedRecord } from '../../../scripting/structured-data/index';
import type { Navigable, NavigationRequest } from '../navigable';

import type { DocumentState } from './document-state';
import type { SourceSnapshotParams } from './source-snapshot';

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
  /** UUID identifying this history position; same-origin replacement retains it. */
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

  /** Construct the navigation request from retained history and captured source inputs. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching
  // Steps 2–10; the supplied environment owns execution independently of the source client.
  createNavigationRequest(navigable: Navigable, sourceSnapshotParams: SourceSnapshotParams, env: BrowletEnvironment): NavigationRequest {
    const state = this.documentState;
    const resource = state.resource;
    if (typeof resource === 'string') throw new InternalError('Srcdoc resources do not create navigation requests');
    const activeDocument = navigable.activeDocument;
    if (activeDocument === null) throw new InternalError('Navigation requests require an active Document');
    const request: NavigationRequest = Object.assign(new FetchRequest(this.url, env), {
      client: sourceSnapshotParams.fetchClient, policyContainer: sourceSnapshotParams.sourcePolicyContainer,
    });
    request.destination = 'document';
    request.credentialsMode = 'include';
    request.useURLCredentials = true;
    request.redirectMode = 'manual';
    request.replacesClientId = activeDocument.env.id;
    request.mode = 'navigate';
    request.referrer = state.requestReferrer;
    request.referrerPolicy = state.requestReferrerPolicy;
    request.traversableForUserPrompts = navigable.topLevelTraversable;
    if (navigable.isTopLevelTraversable) request.topLevelNavigationInitiatorOrigin = state.initiatorOrigin;
    if (request.client === null) {
      request.origin = createOpaqueOrigin();
      request.allowServiceWorkerInterception = true;
      request.referrer = null;
    }
    if (resource !== null) {
      if (resource.requestBody === 'failure') throw new InternalError('Navigation requests require available POST bytes');
      request.method = 'POST';
      request.body = resource.requestBody;
      request.headerList.set('Content-Type', resource.requestContentType);
    }
    if (state.reloadPending) {
      request.reloadNavigation = true;
      // SPEC_GAP(reload-navigation-cache-mode): HTML/Fetch do not map the reload flag to a cache mode.
      // https://github.com/whatwg/fetch/issues/1899
      // SPEC_CLASH(reload-cache-revalidation): Revalidate like Chromium/Firefox; WebKit refetches the Document.
      request.cacheMode = 'no-cache';
    } else if (state.everPopulated) {
      request.historyNavigation = true;
    }
    request.userActivation = sourceSnapshotParams.hasTransientActivation;
    const container = navigable.container;
    if (container !== null) {
      // SPEC_CLASH(navigation-container-origin): Follow browsers and retain the initiating origin; HTML may substitute the container's.
      // https://github.com/whatwg/html/issues/4703
      const destination = container.localName as 'iframe' | 'frame' | 'object' | 'embed';
      request.destination = destination;
      if (sourceSnapshotParams.fetchClient === container.nodeDocument.env) request.initiatorType = destination;
    }
    return request;
  }

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
