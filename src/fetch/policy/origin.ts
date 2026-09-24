import { InternalError } from '../../infra/internal-error';
import { areSameOrigin, obtainURLOrigin } from '../../url/index';
import type { FetchRequest } from '../request';

/** Append the request origin, applying redirect taint and non-CORS disclosure policy. */
// https://fetch.spec.whatwg.org/#append-a-request-origin-header
export function appendOriginHeader(request: FetchRequest): void {
  if (request.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
  let serializedOrigin = request.serializeOrigin();
  if (request.responseTainting === 'cors' || request.mode === 'websocket' || request.mode === 'webtransport') {
    request.headerList.append('Origin', serializedOrigin);
    return;
  }
  if (request.method === 'GET' || request.method === 'HEAD') return;

  if (request.mode !== 'cors') {
    switch (request.referrerPolicy) {
      case 'no-referrer':
        serializedOrigin = 'null';
        break;
      case 'no-referrer-when-downgrade':
      case 'strict-origin':
      case 'strict-origin-when-cross-origin':
        if (request.origin.kind === 'tuple' && request.origin.scheme === 'https' && request.currentURL.scheme !== 'https') {
          serializedOrigin = 'null';
        }
        break;
      case 'same-origin':
        if (!areSameOrigin(request.origin, obtainURLOrigin(request.currentURL))) serializedOrigin = 'null';
        break;
    }
  }
  request.headerList.append('Origin', serializedOrigin);
}
