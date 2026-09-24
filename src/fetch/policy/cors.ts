import { InternalError } from '../../infra/internal-error';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Whether the response's CORS headers deny access to the request's origin and credentials. */
// https://fetch.spec.whatwg.org/#concept-cors-check
export function isBlockedByCORS(_response: FetchResponse, _request: FetchRequest): boolean {
  // PROVISIONAL(Fetch 9): implement Access-Control-Allow-Origin and credentials validation.
  throw new InternalError('CORS check is not implemented');
}
