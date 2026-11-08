import { copyURL } from '../../url/index';
import { FetchResponse, isFilteredResponse } from '../../fetch/index';

import type { ScriptResponseSnapshot } from './protocol';

/** Capture consumed metadata and bytes, retaining taint separately from the underlying response. */
export function captureScriptResponse(response: FetchResponse, bodyBytes: Uint8Array | null | 'failure'): ScriptResponseSnapshot {
  const underlying = isFilteredResponse(response) ? response.internalResponse : response;
  return {
    type: response.type,
    aborted: response.aborted,
    urlList: underlying.urlList.map((url) => { const copy = copyURL(url); copy.blobURLEntry = null; return copy; }),
    status: underlying.status,
    statusMessage: underlying.statusMessage,
    headers: underlying.headerList.list,
    bodyBytes,
  };
}

/** Rebuild the response view, keeping unsafe metadata private beneath any filtered response. */
export function restoreScriptResponse(snapshot: ScriptResponseSnapshot): FetchResponse {
  const response = new FetchResponse();
  response.aborted = snapshot.aborted;
  response.urlList = snapshot.urlList;
  response.status = snapshot.status;
  response.statusMessage = snapshot.statusMessage;
  response.headerList.list = snapshot.headers;
  if (snapshot.type === 'default' || snapshot.type === 'error') {
    response.type = snapshot.type;
    return response;
  }
  return response.filter(snapshot.type);
}
