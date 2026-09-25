import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Whether the response's CORS headers deny access to the request's origin and credentials. */
// https://fetch.spec.whatwg.org/#concept-cors-check
export function isBlockedByCORS(response: FetchResponse, request: FetchRequest): boolean {
  const origin = response.headerList.get('Access-Control-Allow-Origin');
  if (origin === null) return true;
  if (request.credentialsMode !== 'include' && origin === '*') return false;
  // Header values are byte strings; the ASCII origin serialization compares directly.
  if (request.serializeOrigin() !== origin) return true;
  return request.credentialsMode === 'include' &&
    response.headerList.get('Access-Control-Allow-Credentials') !== 'true';
}
