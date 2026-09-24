import { InternalError } from '../../infra/internal-error';
import { urlsEqual } from '../../url/index';
import { FetchBody } from '../body';
import { serializeInteger } from '../environment';
import { buildContentRange, parseSingleRangeHeaderValue } from '../http/ranges';
import type { FetchParams } from '../params';
import { FetchResponse } from '../response';

/** Fetch a captured Blob URL registration, enforcing partition access and an optional byte range. */
// The blob: branch of https://fetch.spec.whatwg.org/#concept-scheme-fetch
export function fetchBlob(params: FetchParams): FetchResponse {
  const { request, env } = params;
  const entry = request.currentURL.blobURLEntry;
  if (request.method !== 'GET' || entry === null) return FetchResponse.networkError();

  const requestEnv = request.determineEnvironment();
  const isTopLevelSelfFetch = request.client?.isTopLevelWindow &&
    requestEnv !== null && urlsEqual(requestEnv.creationURL, request.currentURL);
  const access = request.destination === 'document' ? 'top-level-navigation'
    : isTopLevelSelfFetch ? 'top-level-self-fetch' : requestEnv;
  // SPEC_CLASH(blob-clientless-access-context): Fetch permits null; File API requires a context or exemption.
  // Clientless requests are valid, but ordinary Blob access still needs a partition context.
  // Unlike CORP's retained policy, a request origin is not a retained storage-partition context.
  // A future browser-owned Blob consumer must supply that authorization explicitly.
  if (access === null) throw new InternalError('Blob fetch requires an access context');
  const blob = request.userAgent.obtainBlobObject(entry, access);
  if (blob === null) return FetchResponse.networkError();

  const response = new FetchResponse();
  const fullLength = BigInt(blob.size);
  const rangeHeader = request.headerList.get('Range');
  let responseBlob = blob;
  let contentRange: string | null = null;
  response.statusMessage = 'OK';
  if (rangeHeader !== null) {
    response.rangeRequested = true;
    const range = parseSingleRangeHeaderValue(rangeHeader, true);
    // SPEC_CLASH(blob-suffix-range-bounds): the draft can produce negative or inverted bounds.
    // Clamp oversized suffixes like Chromium/WebKit, and reject ranges with no bytes.
    // Gecko rejects oversized suffixes; the reviewed choice is in the Fetch roadmap.
    if (range === null || fullLength === 0n) return FetchResponse.networkError();
    let [start, end] = range;
    if (start === undefined) {
      if (end === 0n) return FetchResponse.networkError();
      start = end! >= fullLength ? 0n : fullLength - end!;
      end = fullLength - 1n;
    } else {
      if (start >= fullLength) return FetchResponse.networkError();
      if (end === undefined || end >= fullLength) end = fullLength - 1n;
    }
    responseBlob = blob.slice(Number(start), Number(end + 1n), blob.type);
    response.status = 206;
    response.statusMessage = 'Partial Content';
    contentRange = buildContentRange(start, end, fullLength);
  }
  response.body = FetchBody.extract(responseBlob, false, env).body;
  response.headerList.append('Content-Length', serializeInteger(responseBlob.size));
  response.headerList.append('Content-Type', blob.type);
  if (contentRange !== null) response.headerList.append('Content-Range', contentRange);
  return response;
}
