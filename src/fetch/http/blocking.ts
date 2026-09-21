import { getMIMETypeEssence } from '../../mime/index';
import { isScriptLikeDestination, type FetchRequest } from '../request';
import type { FetchResponse } from '../response';
import { isHTTPScheme } from '../url';

/** https://fetch.spec.whatwg.org/#block-bad-port */
export function shouldBlockDueToBadPort(request: FetchRequest): 'blocked' | 'allowed' {
  const url = request.currentURL;
  return isHTTPScheme(url.scheme) && url.port !== null && badPorts.has(url.port) ? 'blocked' : 'allowed';
}

/** https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-mime-type? */
export function shouldBlockDueToMIMEType(response: FetchResponse, request: FetchRequest): 'blocked' | 'allowed' {
  const mimeType = response.headerList.extractMIMEType();
  if (mimeType === null) return 'allowed';
  const essence = getMIMETypeEssence(mimeType);
  if (isScriptLikeDestination(request.destination) && (
    essence.startsWith('audio/') || essence.startsWith('image/') ||
    essence.startsWith('video/') || essence === 'text/csv'
  )) return 'blocked';
  return 'allowed';
}

/** https://fetch.spec.whatwg.org/#bad-port */
const badPorts = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
