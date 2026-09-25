import { InternalError } from '../../infra/internal-error';
import { areSameOrigin, obtainURLOrigin, serializeOrigin, type Origin } from '../../url/index';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Whether the response permits exposing detailed timing for this request. */
// https://fetch.spec.whatwg.org/#concept-tao-check
export function isTimingAllowed(response: FetchResponse, request: FetchRequest): boolean {
  if (request.origin === undefined) throw new InternalError('TAO check requires a populated request origin');
  if (request.timingAllowFailed) return false;
  const values = response.headerList.getDecodeAndSplit('Timing-Allow-Origin') ?? [];
  if (values.includes('*') || values.includes(request.serializeOrigin())) return true;
  if (request.mode === 'navigate' && !areSameOrigin(obtainURLOrigin(request.currentURL), request.origin)) return false;
  return request.responseTainting === 'basic';
}

/** Whether every navigation redirect permits timing exposure to the destination origin. */
// https://fetch.spec.whatwg.org/#navigation-tao-check
export function isNavigationTimingAllowed(response: FetchResponse, destinationOrigin: Origin): boolean {
  const origin = serializeOrigin(destinationOrigin);
  return response.navigationTimingAllowValuesList.every((values) => values.includes('*') || values.includes(origin));
}
