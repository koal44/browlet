import {
  DocumentImpl, type DomletDocument, type PolicyContainer,
} from '../domlet/nodes/document';
import type { Origin } from '../url/origin';
import { parseURL, type URLRecord } from '../url/url';

/*
 * A document state holds the information needed to present or recreate one
 * Document from a session history entry.
 */
export type DocumentState = {
  document: DomletDocument | null;
  historyPolicyContainer: PolicyContainer | null;
  requestReferrer: 'no-referrer' | 'client' | URLRecord;
  requestReferrerPolicy: string;
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
  document: DomletDocument | null = null,
): DocumentState {
  return {
    document,
    historyPolicyContainer: null,
    requestReferrer: 'client',
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
  documentState: DocumentState,
): SessionHistoryEntry {
  const document = documentState.document;
  if (document === null) {
    throw new Error('An initial session history entry requires a Document');
  }

  const url = parseURL(DocumentImpl.getURL(document)).url;
  if (url === null) {
    throw new Error('A Document must have a valid URL');
  }

  // The History and Navigation APIs will add their serialized-state,
  // navigation-key, scroll-restoration, and persisted-user-state slots.
  return { step: 'pending', url, documentState };
}
