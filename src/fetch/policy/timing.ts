import { InternalError } from '../../infra/internal-error';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Whether the response permits exposing detailed timing for this request. */
// https://fetch.spec.whatwg.org/#concept-tao-check
export function isTimingAllowed(_response: FetchResponse, _request: FetchRequest): boolean {
  // PROVISIONAL(Fetch 9): implement Timing-Allow-Origin and redirect-chain exposure checks.
  throw new InternalError('TAO check is not implemented');
}
